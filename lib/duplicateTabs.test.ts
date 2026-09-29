import { describe, expect, it } from 'vitest';
import type { OpenTab, OpenWindow } from '../bridge/protocol';
import { findDuplicateTabs } from './duplicateTabs';

function tab(id: number, url: string, extra: Partial<OpenTab> = {}): OpenTab {
  return {
    id,
    title: `Tab ${id}`,
    url,
    active: false,
    pinned: false,
    audible: false,
    lastAccessed: 1000,
    managed: false,
    lazy: false,
    ...extra,
  };
}
const win = (windowId: number, tabs: OpenTab[]): OpenWindow => ({ windowId, focused: false, snapshot: null, tabs });

describe('findDuplicateTabs', () => {
  it('groups tabs on the same page, ignoring tracking parameters, fragments and www', () => {
    const result = findDuplicateTabs({
      windows: [
        win(1, [
          tab(1, 'https://www.a.test/page?utm_source=x'),
          tab(2, 'https://a.test/page#top'),
          tab(3, 'https://a.test/other'),
        ]),
      ],
    });
    expect(result.groupCount).toBe(1);
    expect(result.groups[0]!.tabs.map((t) => t.tabId).sort()).toEqual([1, 2]);
    expect(result.extraTabCount).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('finds duplicates across windows and says which window each is in', () => {
    const result = findDuplicateTabs({
      windows: [win(1, [tab(1, 'https://a.test/')]), win(2, [tab(2, 'https://a.test/')])],
    });
    expect(result.groups[0]!.tabs.map((t) => [t.tabId, t.windowId]).sort()).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('only looks inside one window when asked', () => {
    const windows = [
      win(1, [tab(1, 'https://a.test/'), tab(2, 'https://a.test/')]),
      win(2, [tab(3, 'https://a.test/')]),
    ];
    expect(findDuplicateTabs({ windows, windowId: 2 }).groupCount).toBe(0);
    expect(findDuplicateTabs({ windows, windowId: 1 }).groupCount).toBe(1);
  });

  it('suggests keeping the tab being looked at, then pinned, then snapshot-owned, then playing, then the newest', () => {
    const group = (tabs: OpenTab[]) => findDuplicateTabs({ windows: [win(1, tabs)] }).groups[0]!;
    const u = 'https://a.test/';
    expect(group([tab(1, u), tab(2, u, { active: true }), tab(3, u, { pinned: true })]).keepTabId).toBe(2);
    expect(group([tab(1, u), tab(2, u, { managed: true }), tab(3, u, { pinned: true })]).keepTabId).toBe(3);
    expect(group([tab(1, u), tab(2, u, { audible: true }), tab(3, u, { managed: true })]).keepTabId).toBe(3);
    expect(group([tab(1, u, { audible: true }), tab(2, u)]).keepTabId).toBe(1);
    const newest = group([
      tab(1, u, { lastAccessed: 10 }),
      tab(2, u, { lastAccessed: 99 }),
      tab(3, u, { lastAccessed: 50 }),
    ]);
    expect(newest.keepTabId).toBe(2);
    expect(newest.tabs.map((t) => t.tabId)).toEqual([2, 3, 1]);
    expect(newest.extraTabIds).toEqual([3, 1]);
    expect(newest.url).toBe(u);
  });

  it('never lists the tab to keep among the extras', () => {
    const g = findDuplicateTabs({
      windows: [win(1, [tab(1, 'https://a.test/'), tab(2, 'https://a.test/')])],
    }).groups[0]!;
    expect(g.extraTabIds).not.toContain(g.keepTabId);
    expect(g.extraTabIds).toHaveLength(1);
  });

  it('puts the biggest pile first and counts every extra tab', () => {
    const result = findDuplicateTabs({
      windows: [
        win(1, [
          tab(1, 'https://small.test/'),
          tab(2, 'https://small.test/'),
          tab(3, 'https://big.test/'),
          tab(4, 'https://big.test/'),
          tab(5, 'https://big.test/'),
        ]),
      ],
    });
    expect(result.groups.map((g) => g.extraTabIds.length)).toEqual([2, 1]);
    expect(result.extraTabCount).toBe(3);
  });

  it('caps the groups but still counts them all', () => {
    const tabs = Array.from({ length: 6 }, (_, i) => [
      tab(i * 2, `https://s${i}.test/`),
      tab(i * 2 + 1, `https://s${i}.test/`),
    ]).flat();
    const result = findDuplicateTabs({ windows: [win(1, tabs)], limit: 4 });
    expect(result.groups).toHaveLength(4);
    expect(result.groupCount).toBe(6);
    expect(result.extraTabCount).toBe(6);
    expect(result.truncated).toBe(true);
  });

  it('ignores pages that are not on the web', () => {
    const result = findDuplicateTabs({
      windows: [win(1, [tab(1, 'chrome://newtab/'), tab(2, 'chrome://newtab/'), tab(3, ''), tab(4, '')])],
    });
    expect(result.groupCount).toBe(0);
  });
});
