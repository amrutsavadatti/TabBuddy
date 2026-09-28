import { describe, expect, it, vi } from 'vitest';
import { focusPlayingTab, getPlayingTabs, selectPlayingTabs, setTabMuted } from './audibleTabs';

const tab = (over: Record<string, unknown> = {}) => ({
  id: 1,
  windowId: 10,
  title: 'A tab',
  url: 'https://a.com/',
  audible: true,
  lastAccessed: 100,
  ...over,
});

describe('selectPlayingTabs', () => {
  it('keeps only tabs that are making sound', () => {
    const result = selectPlayingTabs([tab({ id: 1 }), tab({ id: 2, audible: false }), tab({ id: 3, audible: undefined })]);
    expect(result.map((t) => t.id)).toEqual([1]);
  });

  it('lists the most recently used first', () => {
    const result = selectPlayingTabs([
      tab({ id: 1, lastAccessed: 100 }),
      tab({ id: 2, lastAccessed: 900 }),
      tab({ id: 3, lastAccessed: 500 }),
    ]);
    expect(result.map((t) => t.id)).toEqual([2, 3, 1]);
  });

  it('includes a muted tab that is still reported as audible, flagged as muted', () => {
    const [muted] = selectPlayingTabs([tab({ mutedInfo: { muted: true } })]);
    expect(muted!.muted).toBe(true);
  });

  it('is not muted by default', () => {
    expect(selectPlayingTabs([tab()])[0]!.muted).toBe(false);
  });

  it('falls back to the address, then a generic name, when there is no title', () => {
    expect(selectPlayingTabs([tab({ title: '' })])[0]!.title).toBe('https://a.com/');
    expect(selectPlayingTabs([tab({ title: '', url: '' })])[0]!.title).toBe('Untitled tab');
  });

  it('skips tabs without an id or window', () => {
    expect(selectPlayingTabs([tab({ id: undefined }), tab({ windowId: undefined })])).toEqual([]);
  });

  it('returns nothing when nothing is playing', () => {
    expect(selectPlayingTabs([])).toEqual([]);
  });
});

describe('getPlayingTabs', () => {
  it('asks the browser only for audible tabs', async () => {
    const query = vi.spyOn(browser.tabs, 'query').mockResolvedValue([tab()] as any);
    const result = await getPlayingTabs();
    expect(query).toHaveBeenCalledWith({ audible: true });
    expect(result).toHaveLength(1);
  });
});

describe('actions', () => {
  it('brings a tab to the front in its own window', async () => {
    const updateTab = vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    const updateWindow = vi.spyOn(browser.windows, 'update').mockResolvedValue({} as any);
    await focusPlayingTab({ id: 4, windowId: 9 });
    expect(updateTab).toHaveBeenCalledWith(4, { active: true });
    expect(updateWindow).toHaveBeenCalledWith(9, { focused: true });
  });

  it('mutes and unmutes a tab', async () => {
    const updateTab = vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    await setTabMuted(4, true);
    await setTabMuted(4, false);
    expect(updateTab).toHaveBeenNthCalledWith(1, 4, { muted: true });
    expect(updateTab).toHaveBeenNthCalledWith(2, 4, { muted: false });
  });
});
