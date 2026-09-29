import { describe, expect, it } from 'vitest';
import type { OpenTab, OpenWindow } from '../bridge/protocol';
import { findStaleTabs } from './staleTabs';

const NOW = 1_000_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function tab(id: number, extra: Partial<OpenTab> = {}): OpenTab {
  return {
    id,
    title: `Tab ${id}`,
    url: `https://site${id}.test/`,
    active: false,
    pinned: false,
    audible: false,
    lastAccessed: NOW - 2 * DAY,
    managed: false,
    lazy: false,
    ...extra,
  };
}

const win = (windowId: number, tabs: OpenTab[]): OpenWindow => ({ windowId, focused: false, snapshot: null, tabs });

function find(windows: OpenWindow[], overrides: Partial<Parameters<typeof findStaleTabs>[0]> = {}) {
  return findStaleTabs({
    openWindows: windows,
    snoozedKeys: new Set(),
    now: NOW,
    thresholdMs: DAY,
    ...overrides,
  });
}

describe('findStaleTabs', () => {
  it('flags tabs untouched for longer than the threshold, most stale first', () => {
    const result = find([
      win(1, [
        tab(1, { lastAccessed: NOW - 2 * DAY }),
        tab(2, { lastAccessed: NOW - 5 * DAY }),
        tab(3, { lastAccessed: NOW - 2 * HOUR }), // recent
      ]),
    ]);
    expect(result.tabs.map((t) => t.tabId)).toEqual([2, 1]);
    expect(result.tabs[0]).toEqual({
      windowId: 1,
      tabId: 2,
      title: 'Tab 2',
      url: 'https://site2.test/',
      lastAccessed: NOW - 5 * DAY,
      minutesSinceLastUse: 5 * 24 * 60,
    });
    expect(result.olderThanMinutes).toBe(24 * 60);
  });

  it('uses the given threshold', () => {
    const windows = [win(1, [tab(1, { lastAccessed: NOW - 3 * HOUR })])];
    expect(find(windows, { thresholdMs: 2 * HOUR }).tabs).toHaveLength(1);
    expect(find(windows, { thresholdMs: 4 * HOUR }).tabs).toHaveLength(0);
    expect(find(windows, { thresholdMs: 2 * HOUR }).olderThanMinutes).toBe(120);
  });

  it('never flags pinned tabs, tabs playing sound, or tabs with no last-access time', () => {
    const result = find([
      win(1, [tab(1, { pinned: true }), tab(2, { audible: true }), tab(3, { lastAccessed: null })]),
    ]);
    expect(result.tabs).toEqual([]);
    expect(result.skipped).toEqual({ managed: 0, snoozed: 0 });
  });

  it("skips tabs in a snapshot's live window and counts them", () => {
    const result = find([win(1, [tab(1, { managed: true }), tab(2)])]);
    expect(result.tabs.map((t) => t.tabId)).toEqual([2]);
    expect(result.skipped).toEqual({ managed: 1, snoozed: 0 });
  });

  it('skips tabs the user chose to Keep, by address ignoring the #fragment', () => {
    const result = find(
      [win(1, [tab(1, { url: 'https://kept.test/page#section' }), tab(2)])],
      { snoozedKeys: new Set(['https://kept.test/page']) },
    );
    expect(result.tabs.map((t) => t.tabId)).toEqual([2]);
    expect(result.skipped).toEqual({ managed: 0, snoozed: 1 });
  });

  it('counts a tab that is both managed and snoozed once, as managed', () => {
    const result = find([win(1, [tab(1, { managed: true, url: 'https://k.test/' })])], {
      snoozedKeys: new Set(['https://k.test/']),
    });
    expect(result.skipped).toEqual({ managed: 1, snoozed: 0 });
  });

  it('does not count recent tabs as skipped', () => {
    const result = find([win(1, [tab(1, { managed: true, lastAccessed: NOW - HOUR })])]);
    expect(result.skipped).toEqual({ managed: 0, snoozed: 0 });
  });

  it('caps the list and reports the real total', () => {
    const tabs = Array.from({ length: 5 }, (_, i) => tab(i + 1, { lastAccessed: NOW - (i + 2) * DAY }));
    const result = find([win(1, tabs)], { limit: 2 });
    expect(result.tabs.map((t) => t.tabId)).toEqual([5, 4]); // the most stale
    expect(result.total).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it('spans windows and remembers which window each tab is in', () => {
    const result = find([win(1, [tab(1)]), win(2, [tab(2, { lastAccessed: NOW - 9 * DAY })])]);
    expect(result.tabs.map((t) => [t.tabId, t.windowId])).toEqual([[2, 2], [1, 1]]);
  });
});
