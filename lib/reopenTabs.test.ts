import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ClosedTab } from './activityLog';
import { reopenTabs } from './reopenTabs';

const closed = (n: number, extra: Partial<ClosedTab> = {}): ClosedTab => ({
  url: `https://s${n}.test/`,
  rawUrl: `https://s${n}.test/`,
  title: `Tab ${n}`,
  pinned: false,
  windowId: 1,
  ...extra,
});

/** What the browser remembers having closed. */
const tabSession = (n: number, sessionId = `tab-${n}`) => ({ lastModified: n, tab: { sessionId, url: `https://s${n}.test/` } });
const windowSession = (urls: string[], sessionId: string) => ({
  lastModified: 1,
  window: { sessionId, tabs: urls.map((url) => ({ url })) },
});

function mockBrowser({
  sessions = [] as unknown[],
  restore = async () => ({}) as unknown,
  windowExists = true,
  lastFocused = { id: 7, incognito: false } as { id?: number; incognito?: boolean } | null,
} = {}) {
  const getRecentlyClosed = vi.spyOn(fakeBrowser.sessions, 'getRecentlyClosed').mockResolvedValue(sessions as never);
  const restoreSession = vi.spyOn(fakeBrowser.sessions, 'restore').mockImplementation(restore as never);
  vi.spyOn(fakeBrowser.windows, 'get').mockImplementation((async (id: number) => {
    if (!windowExists) throw new Error('No window with id');
    return { id, incognito: false };
  }) as never);
  vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockImplementation((async () => {
    if (!lastFocused) throw new Error('no window');
    return lastFocused;
  }) as never);
  const createTab = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({ id: 99 } as never);
  const createWindow = vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 55 } as never);
  return { getRecentlyClosed, restoreSession, createTab, createWindow };
}

describe('reopenTabs', () => {
  it('restores a tab from the browser\'s recently-closed list, not by opening it fresh', async () => {
    const m = mockBrowser({ sessions: [tabSession(1)] });
    const result = await reopenTabs([closed(1)]);
    expect(m.restoreSession).toHaveBeenCalledWith('tab-1');
    expect(m.createTab).not.toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 1, reopened: 0, failed: 0 });
    expect(result.succeeded.map((t) => t.url)).toEqual(['https://s1.test/']);
  });

  it('matches on the address the browser reported, which for a lazy placeholder is not the real page', async () => {
    const placeholder = 'chrome-extension://abc/lazy.html?u=https%3A%2F%2Freal.test%2F';
    const m = mockBrowser({
      sessions: [{ lastModified: 1, tab: { sessionId: 'lazy-1', url: placeholder } }],
    });
    const result = await reopenTabs([closed(1, { url: 'https://real.test/', rawUrl: placeholder })]);
    expect(m.restoreSession).toHaveBeenCalledWith('lazy-1');
    expect(result.restored).toBe(1);
  });

  it('restores a closed window as a whole when every one of its tabs is one of ours', async () => {
    const m = mockBrowser({ sessions: [windowSession(['https://s1.test/', 'https://s2.test/'], 'win-1')] });
    const result = await reopenTabs([closed(1), closed(2)]);
    expect(m.restoreSession).toHaveBeenCalledTimes(1);
    expect(m.restoreSession).toHaveBeenCalledWith('win-1');
    expect(result).toMatchObject({ restored: 2, reopened: 0, failed: 0 });
    expect(result.succeeded).toHaveLength(2);
  });

  it('does not restore a closed window that holds a tab of the user\'s own, and opens ours fresh instead', async () => {
    const m = mockBrowser({ sessions: [windowSession(['https://s1.test/', 'https://theirs.test/'], 'win-1')] });
    const result = await reopenTabs([closed(1)]);
    expect(m.restoreSession).not.toHaveBeenCalled();
    expect(m.createTab).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ restored: 0, reopened: 1, failed: 0 });
  });

  it('uses each remembered tab once, even when the same page was closed twice', async () => {
    const m = mockBrowser({ sessions: [tabSession(1, 'first'), tabSession(1, 'second'), tabSession(1, 'third')] });
    const result = await reopenTabs([closed(1), closed(1)]);
    expect(m.restoreSession.mock.calls.map(([id]) => id)).toEqual(['first', 'second']);
    expect(result.restored).toBe(2);
  });

  it('opens fresh whatever the browser no longer remembers', async () => {
    const m = mockBrowser({ sessions: [tabSession(1)] });
    const result = await reopenTabs([closed(1), closed(2)]);
    expect(result).toMatchObject({ restored: 1, reopened: 1, failed: 0 });
    expect(m.createTab).toHaveBeenCalledTimes(1);
    expect(m.createTab).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://s2.test/' }));
  });

  it('opens everything fresh when the recently-closed list is unavailable, or restoring fails', async () => {
    const m = mockBrowser();
    m.getRecentlyClosed.mockRejectedValue(new Error('not supported'));
    expect(await reopenTabs([closed(1)])).toMatchObject({ restored: 0, reopened: 1 });

    const m2 = mockBrowser({ sessions: [tabSession(1)], restore: async () => Promise.reject(new Error('gone')) });
    const result = await reopenTabs([closed(1)]);
    expect(m2.createTab).toHaveBeenCalled();
    expect(result).toMatchObject({ restored: 0, reopened: 1, failed: 0 });
  });

  it('opens a fresh tab in the window it came from, pinned as it was, and behind the current tab', async () => {
    const m = mockBrowser();
    await reopenTabs([closed(1, { windowId: 4, pinned: true })]);
    expect(m.createTab).toHaveBeenCalledWith({ windowId: 4, url: 'https://s1.test/', pinned: true, active: false });
  });

  it('falls back to the window used last when the original is gone', async () => {
    const m = mockBrowser({ windowExists: false, lastFocused: { id: 7, incognito: false } });
    await reopenTabs([closed(1, { windowId: 4 })]);
    expect(m.createTab).toHaveBeenCalledWith(expect.objectContaining({ windowId: 7 }));
    expect(m.createWindow).not.toHaveBeenCalled();
  });

  it('never opens a tab in an incognito window, and makes a new window when none is usable', async () => {
    const m = mockBrowser({ windowExists: false, lastFocused: { id: 7, incognito: true } });
    await reopenTabs([closed(1)]);
    expect(m.createTab).not.toHaveBeenCalled();
    expect(m.createWindow).toHaveBeenCalledWith({ url: 'https://s1.test/', focused: true });

    const m2 = mockBrowser({ windowExists: false, lastFocused: null });
    await reopenTabs([closed(2)]);
    expect(m2.createWindow).toHaveBeenCalledWith({ url: 'https://s2.test/', focused: true });
  });

  it('opens the real page, not the placeholder, when it has to open fresh', async () => {
    const m = mockBrowser();
    await reopenTabs([closed(1, { url: 'https://real.test/', rawUrl: 'chrome-extension://abc/lazy.html?u=x' })]);
    expect(m.createTab).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://real.test/' }));
  });

  it('reports what it could not bring back instead of throwing', async () => {
    const m = mockBrowser();
    m.createTab.mockRejectedValueOnce(new Error('cannot open'));
    const result = await reopenTabs([closed(1), closed(2)]);
    expect(result).toMatchObject({ restored: 0, reopened: 1, failed: 1 });
    expect(result.succeeded.map((t) => t.url)).toEqual(['https://s2.test/']);
  });

  it('does nothing for nothing', async () => {
    mockBrowser();
    expect(await reopenTabs([])).toEqual({ restored: 0, reopened: 0, failed: 0, succeeded: [] });
  });
});
