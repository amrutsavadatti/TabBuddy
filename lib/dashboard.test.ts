import { describe, expect, it, vi } from 'vitest';
import { openOrFocusDashboard, openTriageSession } from './dashboard';

describe('openOrFocusDashboard', () => {
  it('creates a new dashboard tab when none is open', async () => {
    const createSpy = vi.spyOn(browser.tabs, 'create');
    await openOrFocusDashboard();

    expect(createSpy).toHaveBeenCalledWith({
      url: browser.runtime.getURL('/dashboard.html'),
    });
  });

  it('focuses the existing dashboard tab instead of creating a duplicate', async () => {
    const dashboardUrl = browser.runtime.getURL('/dashboard.html');
    const existingTab = await browser.tabs.create({ url: dashboardUrl });

    const createSpy = vi.spyOn(browser.tabs, 'create');
    const updateTabSpy = vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    const updateWindowSpy = vi
      .spyOn(browser.windows, 'update')
      .mockResolvedValue({} as any);

    await openOrFocusDashboard();

    expect(createSpy).not.toHaveBeenCalled();
    expect(updateTabSpy).toHaveBeenCalledWith(existingTab.id, { active: true });
    expect(updateWindowSpy).toHaveBeenCalledWith(existingTab.windowId, { focused: true });
  });
});

describe('openTriageSession', () => {
  it('opens a dashboard tab with the window id in the triage query param', async () => {
    const createSpy = vi.spyOn(browser.tabs, 'create');
    await openTriageSession(42);

    expect(createSpy).toHaveBeenCalledWith({
      url: browser.runtime.getURL('/dashboard.html?triage=42'),
    });
  });

  it('for a whole window, neither picks the window nor steals focus, as before', async () => {
    const createSpy = vi.spyOn(browser.tabs, 'create');
    const updateWindow = vi.spyOn(browser.windows, 'update');
    await openTriageSession(42);
    expect(createSpy.mock.calls[0]![0]).toEqual({ url: browser.runtime.getURL('/dashboard.html?triage=42') });
    expect(updateWindow).not.toHaveBeenCalled();
  });

  it('for handed-over tabs, opens in that window, in front, and brings the window forward', async () => {
    const createSpy = vi.spyOn(browser.tabs, 'create');
    const updateWindow = vi.spyOn(browser.windows, 'update').mockResolvedValue({} as any);
    await openTriageSession(42, [3, 4]);
    expect(createSpy).toHaveBeenCalledWith({
      url: browser.runtime.getURL('/dashboard.html?triage=42&tabs=3,4'),
      windowId: 42,
      active: true,
    });
    expect(updateWindow).toHaveBeenCalledWith(42, { focused: true });
  });
});
