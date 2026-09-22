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
});
