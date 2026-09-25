import { describe, expect, it, vi } from 'vitest';
import { getAskedMap } from './nudgeAsked';
import { closeNudgesFor, findOpenNudges, openNextNudge } from './nudgeWindow';

const nudgeUrl = (tabId: number) => browser.runtime.getURL(`/nudge.html?tabId=${tabId}` as never);

const win = (id: number, url: string) => ({ id, tabs: [{ url }] });

function mockWindows(list: unknown[]) {
  vi.spyOn(browser.windows, 'getAll').mockResolvedValue(list as any);
}

describe('findOpenNudges', () => {
  it('finds open nudge popups and the tab each is about', async () => {
    mockWindows([win(1, 'https://a.com/'), win(2, nudgeUrl(42))]);
    expect(await findOpenNudges()).toEqual([{ windowId: 2, targetTabId: 42 }]);
  });

  it('returns nothing when no nudge is open', async () => {
    mockWindows([win(1, 'https://a.com/')]);
    expect(await findOpenNudges()).toEqual([]);
  });

  it('uses the pending url of a window that is still opening', async () => {
    mockWindows([{ id: 3, tabs: [{ url: '', pendingUrl: nudgeUrl(5) }] }]);
    expect(await findOpenNudges()).toEqual([{ windowId: 3, targetTabId: 5 }]);
  });

  it('copes with a nudge page that has no valid tab id', async () => {
    mockWindows([win(4, browser.runtime.getURL('/nudge.html' as never))]);
    expect(await findOpenNudges()).toEqual([{ windowId: 4, targetTabId: null }]);
  });
});

describe('closeNudgesFor', () => {
  it('closes only the nudge asking about that tab', async () => {
    mockWindows([win(1, nudgeUrl(10)), win(2, nudgeUrl(11))]);
    const removeSpy = vi.spyOn(browser.windows, 'remove').mockResolvedValue(undefined as any);

    await closeNudgesFor(10);

    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(1);
  });

  it('does not throw if the window is already gone', async () => {
    mockWindows([win(1, nudgeUrl(10))]);
    vi.spyOn(browser.windows, 'remove').mockRejectedValue(new Error('No window'));
    await expect(closeNudgesFor(10)).resolves.toBeUndefined();
  });
});

describe('openNextNudge', () => {
  it('shows the first candidate and records that it was asked', async () => {
    mockWindows([]);
    const createSpy = vi.spyOn(browser.windows, 'create').mockResolvedValue({ id: 9 } as any);
    vi.spyOn(browser.windows, 'getLastFocused').mockResolvedValue({} as any);

    expect(await openNextNudge([7, 8])).toBe(7);

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect((await getAskedMap()).has(7)).toBe(true);
    expect((await getAskedMap()).has(8)).toBe(false);
  });

  it('shows nothing while a nudge is already open', async () => {
    mockWindows([win(1, nudgeUrl(3))]);
    const createSpy = vi.spyOn(browser.windows, 'create');

    expect(await openNextNudge([7])).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
    expect((await getAskedMap()).size).toBe(0);
  });

  it('shows nothing when there are no candidates', async () => {
    mockWindows([]);
    const createSpy = vi.spyOn(browser.windows, 'create');
    expect(await openNextNudge([])).toBeNull();
    expect(createSpy).not.toHaveBeenCalled();
  });
});
