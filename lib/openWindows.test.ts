import { describe, expect, it } from 'vitest';
import { MAX_TITLE_LENGTH } from '../bridge/protocol';
import { shapeOpenWindows, type ShapeOptions, type WindowLike } from './openWindows';

const ORIGIN = 'chrome-extension://abc/';
const noLazy: ShapeOptions['resolveLazy'] = (tab) => tab;

function shape(windows: WindowLike[], overrides: Partial<ShapeOptions> = {}) {
  return shapeOpenWindows({
    windows,
    snapshots: [],
    managedTabIds: new Set(),
    resolveLazy: noLazy,
    extensionOrigin: ORIGIN,
    ...overrides,
  });
}

const tab = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Tab ${id}`,
  url: `https://site${id}.test/`,
  ...extra,
});

describe('shapeOpenWindows', () => {
  it('describes each tab with the fields an agent needs', () => {
    const { windows } = shape([
      {
        id: 1,
        focused: true,
        tabs: [tab(10, { active: true, pinned: true, audible: true, lastAccessed: 1234 }), tab(11)],
      },
    ]);
    expect(windows).toEqual([
      {
        windowId: 1,
        focused: true,
        snapshot: null,
        tabs: [
          {
            id: 10,
            title: 'Tab 10',
            url: 'https://site10.test/',
            active: true,
            pinned: true,
            audible: true,
            lastAccessed: 1234,
            managed: false,
            lazy: false,
          },
          {
            id: 11,
            title: 'Tab 11',
            url: 'https://site11.test/',
            active: false,
            pinned: false,
            audible: false,
            lastAccessed: null,
            managed: false,
            lazy: false,
          },
        ],
      },
    ]);
  });

  it('leaves out incognito windows and incognito tabs', () => {
    const result = shape([
      { id: 1, incognito: true, tabs: [tab(1)] },
      { id: 2, tabs: [tab(2), tab(3, { incognito: true })] },
    ]);
    expect(result.windows.map((w) => w.windowId)).toEqual([2]);
    expect(result.windows[0]!.tabs.map((t) => t.id)).toEqual([2]);
    expect(result.tabCount).toBe(1);
  });

  it("leaves out TabBuddy's own pages, and drops a window left empty", () => {
    const result = shape([
      { id: 1, tabs: [tab(1), tab(2, { url: `${ORIGIN}dashboard.html` })] },
      { id: 2, tabs: [tab(3, { url: `${ORIGIN}nudge.html?tab=9` })] }, // nudge popup
    ]);
    expect(result.windows.map((w) => [w.windowId, w.tabs.map((t) => t.id)])).toEqual([[1, [1]]]);
  });

  it('names the snapshot a window was opened from', () => {
    const result = shape(
      [{ id: 5, tabs: [tab(1)] }, { id: 6, tabs: [tab(2)] }],
      { snapshots: [{ id: 's1', name: 'Job Hunt', linkedWindowId: 5 }] },
    );
    expect(result.windows.map((w) => w.snapshot)).toEqual([{ id: 's1', name: 'Job Hunt' }, null]);
  });

  it("marks tabs that belong to a snapshot's live window as managed", () => {
    const { windows } = shape([{ id: 1, tabs: [tab(1), tab(2)] }], { managedTabIds: new Set([2]) });
    expect(windows[0]!.tabs.map((t) => t.managed)).toEqual([false, true]);
  });

  it('shows the real page for a lazy placeholder and flags it', () => {
    const resolveLazy: ShapeOptions['resolveLazy'] = (t) =>
      t.url?.startsWith(`${ORIGIN}lazy.html`)
        ? { ...t, url: 'https://real.test/page', title: 'Real page' }
        : t;
    const { windows } = shape(
      [{ id: 1, tabs: [tab(1, { url: `${ORIGIN}lazy.html?u=https%3A%2F%2Freal.test%2Fpage`, title: 'x' }), tab(2)] }],
      { resolveLazy },
    );
    expect(windows[0]!.tabs[0]).toMatchObject({ url: 'https://real.test/page', title: 'Real page', lazy: true });
    expect(windows[0]!.tabs[1]!.lazy).toBe(false);
  });

  it('cuts long titles and falls back to the url for a blank one', () => {
    const { windows } = shape([
      { id: 1, tabs: [tab(1, { title: 'x'.repeat(500) }), tab(2, { title: '' })] },
    ]);
    expect(windows[0]!.tabs[0]!.title).toHaveLength(MAX_TITLE_LENGTH);
    expect(windows[0]!.tabs[1]!.title).toBe('https://site2.test/');
  });

  it('caps the total number of tabs across windows and says so', () => {
    const windows = [
      { id: 1, tabs: [tab(1), tab(2), tab(3)] },
      { id: 2, tabs: [tab(4), tab(5)] },
    ];
    const result = shape(windows, { limit: 4 });
    expect(result.tabCount).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.windows.map((w) => w.tabs.length)).toEqual([3, 1]);
    expect(shape(windows, { limit: 5 }).truncated).toBe(false);
  });

  it('skips tabs and windows without ids', () => {
    const result = shape([{ tabs: [tab(1)] }, { id: 2, tabs: [{ url: 'https://x.test/' }, tab(3)] }]);
    expect(result.windows.map((w) => [w.windowId, w.tabs.map((t) => t.id)])).toEqual([[2, [3]]]);
  });
});
