import { describe, expect, it, vi } from 'vitest';
import { openOrFocusDashboard, openTriageSession } from './dashboard';

describe('openOrFocusDashboard', () => {
  it('opens the dashboard in a new window of its own when none is open', async () => {
    const windowSpy = vi.spyOn(browser.windows, 'create');
    const tabSpy = vi.spyOn(browser.tabs, 'create');
    await openOrFocusDashboard();

    expect(windowSpy).toHaveBeenCalledTimes(1);
    expect(windowSpy).toHaveBeenCalledWith({
      url: browser.runtime.getURL('/dashboard.html'),
      focused: true,
    });
    expect(tabSpy).not.toHaveBeenCalled(); // not a tab added to the current window
  });

  it('opens a window only the first time: asking again focuses it', async () => {
    const dashboardUrl = browser.runtime.getURL('/dashboard.html');
    const windowSpy = vi.spyOn(browser.windows, 'create').mockImplementation((async () => {
      // what the browser does: the new window holds one tab showing the page
      await browser.tabs.create({ url: dashboardUrl });
      return { id: 7 };
    }) as never);
    const tabUpdate = vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as never);
    const windowUpdate = vi.spyOn(browser.windows, 'update').mockResolvedValue({} as never);

    await openOrFocusDashboard();
    expect(windowSpy).toHaveBeenCalledTimes(1);
    expect(tabUpdate).not.toHaveBeenCalled();

    await openOrFocusDashboard();
    await openOrFocusDashboard();
    expect(windowSpy).toHaveBeenCalledTimes(1); // still only the one window
    expect(tabUpdate).toHaveBeenCalledTimes(2);
    expect(windowUpdate).toHaveBeenCalledTimes(2);
  });

  it('opens a fresh window again once the dashboard has been closed', async () => {
    const dashboardUrl = browser.runtime.getURL('/dashboard.html');
    const windowSpy = vi.spyOn(browser.windows, 'create').mockImplementation((async () => {
      await browser.tabs.create({ url: dashboardUrl });
      return { id: 7 };
    }) as never);
    vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as never);
    vi.spyOn(browser.windows, 'update').mockResolvedValue({} as never);

    await openOrFocusDashboard();
    expect(windowSpy).toHaveBeenCalledTimes(1);

    // the user closes the dashboard window: no dashboard tab is left
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([] as never);
    await openOrFocusDashboard();

    expect(windowSpy).toHaveBeenCalledTimes(2);
  });

  it('does not count the sort-tabs screen as an open dashboard', async () => {
    await browser.tabs.create({ url: browser.runtime.getURL('/dashboard.html?triage=5') });
    const windowSpy = vi.spyOn(browser.windows, 'create');
    await openOrFocusDashboard();
    expect(windowSpy).toHaveBeenCalledTimes(1);
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
