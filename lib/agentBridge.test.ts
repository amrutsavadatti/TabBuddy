import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_SNAPSHOT_TABS_PER_CALL, MAX_TITLE_LENGTH, PROTOCOL_VERSION } from '../bridge/protocol';
import {
  BridgeFailure,
  describeSnapshot,
  dispatch,
  parseGetSnapshotParams,
  parseSearchParams,
  parseStaleParams,
  parseUsageParams,
  summarizeSnapshot,
} from './agentBridge';
import { addCategory, setSnapshotCategories } from './categories';
import { setManagedTabs } from './managedTabs';
import { addSnapshot, getSnapshots } from './storage';
import { makeSnapshot, makeTab } from '@/test/factories';

describe('dispatch', () => {
  it('reports an unknown method', async () => {
    const response = await dispatch({ id: 'a', method: 'nope' });
    expect(response).toEqual({
      id: 'a',
      error: { code: 'unknown_method', message: 'Unknown method: nope' },
    });
  });

  it('does not treat inherited object keys as methods', async () => {
    const response = await dispatch({ id: 'a', method: 'toString' });
    expect(response).toMatchObject({ error: { code: 'unknown_method' } });
  });

  it('returns the handler result under the request id', async () => {
    const response = await dispatch(
      { id: 'r1', method: 'echo', params: 5 },
      { echo: async (params) => params },
    );
    expect(response).toEqual({ id: 'r1', result: 5 });
  });

  it('keeps a BridgeFailure code', async () => {
    const response = await dispatch(
      { id: 'x', method: 'fail' },
      {
        fail: async () => {
          throw new BridgeFailure('not_found', 'No such snapshot.');
        },
      },
    );
    expect(response).toEqual({
      id: 'x',
      error: { code: 'not_found', message: 'No such snapshot.' },
    });
  });

  it('maps any other thrown error to internal', async () => {
    const response = await dispatch(
      { id: 'x', method: 'boom' },
      {
        boom: async () => {
          throw new Error('kaput');
        },
      },
    );
    expect(response).toEqual({ id: 'x', error: { code: 'internal', message: 'kaput' } });
  });
});

describe('hello', () => {
  it('returns the protocol version and extension version', async () => {
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      version: '1.2.3',
    } as ReturnType<typeof fakeBrowser.runtime.getManifest>);
    const response = await dispatch({ id: 'h', method: 'hello' });
    expect(response).toEqual({
      id: 'h',
      result: { protocol: PROTOCOL_VERSION, extensionVersion: '1.2.3' },
    });
  });
});

describe('summarizeSnapshot', () => {
  it('counts tabs, flags open snapshots and drops tab details and favicons', () => {
    const snapshot = makeSnapshot({
      name: 'Job Hunt',
      tabs: [
        makeTab({ favIconUrl: 'data:image/png;base64,AAAA' }),
        makeTab(),
      ],
      linkedWindowId: 7,
      categoryIds: ['c1'],
      usageCount: 3,
      pinned: true,
    });
    const summary = summarizeSnapshot(snapshot);
    expect(summary).toEqual({
      id: snapshot.id,
      name: 'Job Hunt',
      tabCount: 2,
      categoryIds: ['c1'],
      categoryNames: [],
      usageCount: 3,
      pinned: true,
      isOpen: true,
      updatedAt: snapshot.updatedAt,
    });
    expect(JSON.stringify(summary)).not.toContain('data:image');
  });

  it('marks a snapshot with no linked window as not open', () => {
    expect(summarizeSnapshot(makeSnapshot({ linkedWindowId: null })).isOpen).toBe(false);
  });
});

describe('listSnapshots', () => {
  it('returns a summary for every stored snapshot', async () => {
    const a = makeSnapshot({ name: 'A' });
    const b = makeSnapshot({ name: 'B', linkedWindowId: 2 });
    await addSnapshot(a);
    await addSnapshot(b);

    const response = await dispatch({ id: 'l', method: 'listSnapshots' });
    expect(response).toMatchObject({ id: 'l' });
    const result = (response as { result: { name: string; isOpen: boolean }[] }).result;
    expect(result.map((s) => [s.name, s.isOpen])).toEqual([
      ['A', false],
      ['B', true],
    ]);
  });

  it('returns an empty list when nothing is saved', async () => {
    expect(await dispatch({ id: 'l', method: 'listSnapshots' })).toEqual({ id: 'l', result: [] });
  });
});

describe('describeSnapshot', () => {
  it('addresses tabs by index and resolves group names, without favicons', () => {
    const snapshot = makeSnapshot({
      tabs: [
        makeTab({ url: 'https://a.test/', title: 'A', favIconUrl: 'data:image/png;base64,AAAA', groupIndex: 1 }),
        makeTab({ url: 'https://b.test/', title: 'B', pinned: true, groupIndex: null }),
        makeTab({ url: 'https://c.test/', title: 'C', groupIndex: 7 }), // dangling group
      ],
      tabGroups: [
        { title: 'Unused', color: 'red' },
        { title: 'Research', color: 'blue' },
      ],
    });
    const detail = describeSnapshot(snapshot, { offset: 0, limit: 50 });
    expect(detail.tabs).toEqual([
      { index: 0, url: 'https://a.test/', title: 'A', pinned: false, group: 'Research' },
      { index: 1, url: 'https://b.test/', title: 'B', pinned: true, group: null },
      { index: 2, url: 'https://c.test/', title: 'C', pinned: false, group: null },
    ]);
    expect(detail.truncated).toBe(false);
    expect(detail.tabCount).toBe(3);
    expect(JSON.stringify(detail)).not.toContain('data:image');
  });

  it('pages through the tabs and keeps original indexes', () => {
    const snapshot = makeSnapshot({ tabs: Array.from({ length: 5 }, () => makeTab()) });
    const first = describeSnapshot(snapshot, { offset: 0, limit: 2 });
    expect(first.tabs.map((t) => t.index)).toEqual([0, 1]);
    expect(first.truncated).toBe(true);
    const last = describeSnapshot(snapshot, { offset: 4, limit: 2 });
    expect(last.tabs.map((t) => t.index)).toEqual([4]);
    expect(last.truncated).toBe(false);
    expect(describeSnapshot(snapshot, { offset: 9, limit: 2 }).tabs).toEqual([]);
  });

  it('cuts very long titles', () => {
    const snapshot = makeSnapshot({ tabs: [makeTab({ title: 'x'.repeat(500) })] });
    const title = describeSnapshot(snapshot, { offset: 0, limit: 10 }).tabs[0]!.title;
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('parseGetSnapshotParams', () => {
  it('fills in defaults and caps the limit', () => {
    expect(parseGetSnapshotParams({ id: 'a' })).toEqual({ id: 'a', offset: 0, limit: MAX_SNAPSHOT_TABS_PER_CALL });
    expect(parseGetSnapshotParams({ id: 'a', limit: 99999 }).limit).toBe(MAX_SNAPSHOT_TABS_PER_CALL);
  });

  it.each([
    [undefined],
    [{}],
    [{ id: '' }],
    [{ id: 5 }],
    [{ id: 'a', offset: -1 }],
    [{ id: 'a', offset: 1.5 }],
    [{ id: 'a', limit: 0 }],
    [{ id: 'a', limit: '3' }],
  ])('rejects %j as invalid_params', (params) => {
    expect(() => parseGetSnapshotParams(params)).toThrow(BridgeFailure);
    try {
      parseGetSnapshotParams(params);
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
    }
  });
});

describe('getSnapshot', () => {
  it('returns the snapshot detail for a known id', async () => {
    const snapshot = makeSnapshot({ name: 'Research', tabs: [makeTab({ title: 'Docs' })] });
    await addSnapshot(snapshot);
    const response = await dispatch({ id: 'g', method: 'getSnapshot', params: { id: snapshot.id } });
    expect(response).toMatchObject({
      id: 'g',
      result: { name: 'Research', tabCount: 1, tabs: [{ index: 0, title: 'Docs' }], truncated: false },
    });
  });

  it('answers not_found for an unknown id', async () => {
    const response = await dispatch({ id: 'g', method: 'getSnapshot', params: { id: 'missing' } });
    expect(response).toMatchObject({ id: 'g', error: { code: 'not_found' } });
  });

  it('answers invalid_params without an id', async () => {
    const response = await dispatch({ id: 'g', method: 'getSnapshot' });
    expect(response).toMatchObject({ id: 'g', error: { code: 'invalid_params' } });
  });
});

describe('category names', () => {
  it('summarizeSnapshot resolves names and ignores categories that no longer exist', () => {
    const snapshot = makeSnapshot({ categoryIds: ['c1', 'gone', 'c2'] });
    const categories = [
      { id: 'c1', name: 'Work', color: null, createdAt: 1 },
      { id: 'c2', name: 'Fun', color: null, createdAt: 2 },
    ];
    expect(summarizeSnapshot(snapshot, categories).categoryNames).toEqual(['Work', 'Fun']);
  });
});

describe('listCategories', () => {
  it('counts the snapshots in each category', async () => {
    const work = await addCategory('Work');
    await addCategory('Empty');
    const a = makeSnapshot();
    const b = makeSnapshot();
    await addSnapshot(a);
    await addSnapshot(b);
    await setSnapshotCategories(a.id, [work.id]);
    await setSnapshotCategories(b.id, [work.id]);

    const response = await dispatch({ id: 'c', method: 'listCategories' });
    expect((response as { result: unknown }).result).toEqual([
      { id: work.id, name: 'Work', snapshotCount: 2 },
      { id: expect.any(String), name: 'Empty', snapshotCount: 0 },
    ]);
  });

  it('returns an empty list when there are none', async () => {
    expect(await dispatch({ id: 'c', method: 'listCategories' })).toEqual({ id: 'c', result: [] });
  });
});

describe('listSnapshots with a category filter', () => {
  async function setup() {
    const work = await addCategory('Work');
    const inWork = makeSnapshot({ name: 'In work' });
    const outside = makeSnapshot({ name: 'Outside' });
    await addSnapshot(inWork);
    await addSnapshot(outside);
    await setSnapshotCategories(inWork.id, [work.id]);
    return { work, inWork };
  }
  const names = (response: unknown) =>
    (response as { result: { name: string }[] }).result.map((s) => s.name);

  it('returns only snapshots in that category, with the category name', async () => {
    const { work } = await setup();
    const response = await dispatch({ id: 'l', method: 'listSnapshots', params: { categoryId: work.id } });
    expect(names(response)).toEqual(['In work']);
    expect((response as any).result[0].categoryNames).toEqual(['Work']);
  });

  it('returns everything without a filter', async () => {
    await setup();
    expect(names(await dispatch({ id: 'l', method: 'listSnapshots' }))).toEqual(['In work', 'Outside']);
  });

  it('answers not_found for an unknown category and invalid_params for a bad one', async () => {
    await setup();
    expect(await dispatch({ id: 'l', method: 'listSnapshots', params: { categoryId: 'nope' } })).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(await dispatch({ id: 'l', method: 'listSnapshots', params: { categoryId: 5 } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });
});

describe('listOpenWindows', () => {
  it('lists open windows with their linked snapshot and managed tabs', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    const tab = await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://a.test/' });
    const snapshot = makeSnapshot({ name: 'Job Hunt', linkedWindowId: win.id ?? null });
    await addSnapshot(snapshot);
    await setManagedTabs(snapshot.id, [tab.id!]);

    const response = await dispatch({ id: 'w', method: 'listOpenWindows' });
    const result = (response as any).result;
    expect(result.truncated).toBe(false);
    const listed = result.windows.find((w: any) => w.windowId === win.id);
    expect(listed.snapshot).toEqual({ id: snapshot.id, name: 'Job Hunt' });
    const listedTab = listed.tabs.find((t: any) => t.id === tab.id);
    expect(listedTab).toMatchObject({ url: 'https://a.test/', managed: true, lazy: false });
  });
});

describe('parseSearchParams', () => {
  it('fills in defaults and caps the limit', () => {
    expect(parseSearchParams({ query: 'pricing' })).toEqual({ query: 'pricing', scope: 'all', limit: 50 });
    expect(parseSearchParams({ query: 'x1', limit: 999 }).limit).toBe(50);
  });

  it.each([
    [undefined],
    [{}],
    [{ query: '' }],
    [{ query: ' ,, ' }],
    [{ query: 5 }],
    [{ query: 'a', scope: 'everywhere' }],
    [{ query: 'a', limit: 0 }],
    [{ query: 'a', limit: 1.5 }],
  ])('rejects %j as invalid_params', (params) => {
    expect(() => parseSearchParams(params)).toThrow(BridgeFailure);
  });
});

describe('searchTabs', () => {
  it('searches saved, archived and open tabs through the dispatcher', async () => {
    await addSnapshot(
      makeSnapshot({ name: 'Research', tabs: [makeTab({ title: 'Vector DB pricing', url: 'https://v.test/' })] }),
    );
    await addSnapshot(
      makeSnapshot({ name: 'Archived', tabs: [makeTab({ title: 'Old pricing sheet', url: 'https://old.test/' })] }),
    );
    const win = (await fakeBrowser.windows.create({}))!;
    await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://live.test/pricing', title: 'Live pricing' } as any);

    const all = await dispatch({ id: 's', method: 'searchTabs', params: { query: 'pricing' } });
    const result = (all as any).result;
    expect(result.matches.map((m: any) => m.source).sort()).toEqual(['archived', 'open', 'saved']);

    const archivedOnly = await dispatch({ id: 's', method: 'searchTabs', params: { query: 'pricing', scope: 'archived' } });
    expect((archivedOnly as any).result.matches.map((m: any) => m.snapshotName)).toEqual(['Archived']);
  });

  it('answers invalid_params for an empty query', async () => {
    expect(await dispatch({ id: 's', method: 'searchTabs', params: { query: '' } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });
});

describe('parseStaleParams and parseUsageParams', () => {
  it('accepts no params, and a positive number of minutes', () => {
    expect(parseStaleParams(undefined)).toEqual({ olderThanMinutes: undefined });
    expect(parseStaleParams({ olderThanMinutes: 90 })).toEqual({ olderThanMinutes: 90 });
  });

  it.each([[{ olderThanMinutes: 0 }], [{ olderThanMinutes: -5 }], [{ olderThanMinutes: '60' }], [{ olderThanMinutes: NaN }]])(
    'rejects %j',
    (params) => expect(() => parseStaleParams(params)).toThrow(BridgeFailure),
  );

  it('defaults and caps the usage limit, and rejects bad ones', () => {
    expect(parseUsageParams(undefined)).toEqual({ limit: 5 });
    expect(parseUsageParams({ limit: 999 })).toEqual({ limit: 20 });
    expect(() => parseUsageParams({ limit: 0 })).toThrow(BridgeFailure);
    expect(() => parseUsageParams({ limit: 2.5 })).toThrow(BridgeFailure);
  });
});

describe('getStaleTabs', () => {
  it('flags old tabs using the given threshold, and leaves managed tabs out', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    const old = await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://old.test/' });
    const kept = await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://managed.test/' });
    const longAgo = Date.now() - 3 * 60 * 60_000;
    for (const t of [old, kept]) (t as { lastAccessed?: number }).lastAccessed = longAgo;
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([old, kept] as never);
    vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([{ id: win.id, tabs: [old, kept] }] as never);
    await setManagedTabs('snap', [kept.id!]);

    const response = await dispatch({ id: 'g', method: 'getStaleTabs', params: { olderThanMinutes: 60 } });
    const result = (response as any).result;
    expect(result.olderThanMinutes).toBe(60);
    expect(result.tabs.map((t: any) => t.url)).toEqual(['https://old.test/']);
    expect(result.skipped).toEqual({ managed: 1, snoozed: 0 });
  });

  it('defaults to the nudge setting when no threshold is given', async () => {
    await fakeBrowser.storage.local.set({ nudgeStaleMinutes: 30 });
    vi.spyOn(fakeBrowser.windows, 'getAll').mockResolvedValue([] as never);
    const response = await dispatch({ id: 'g', method: 'getStaleTabs' });
    expect((response as any).result.olderThanMinutes).toBe(30);
  });

  it('answers invalid_params for a bad threshold', async () => {
    expect(await dispatch({ id: 'g', method: 'getStaleTabs', params: { olderThanMinutes: 0 } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });
});

describe('getUsageStats', () => {
  it('returns the top snapshots and sites, honouring Quick links being off', async () => {
    await addSnapshot(makeSnapshot({ name: 'Often', usageCount: 9 }));
    await fakeBrowser.storage.local.set({
      siteStats: { 'github.com': { score: 4, lastVisitAt: Date.now(), hidden: false } },
    });
    const on = (await dispatch({ id: 'u', method: 'getUsageStats' })) as any;
    expect(on.result.topSnapshots.map((s: any) => s.name)).toEqual(['Often']);
    expect(on.result.topSites.map((s: any) => s.domain)).toEqual(['github.com']);

    await fakeBrowser.storage.local.set({ quickLinksEnabled: false });
    const off = (await dispatch({ id: 'u', method: 'getUsageStats' })) as any;
    expect(off.result.topSites).toEqual([]);
    expect(off.result.siteTrackingEnabled).toBe(false);
  });
});

describe('restoreSnapshot', () => {
  const call = (params: unknown) => dispatch({ id: 'r', method: 'restoreSnapshot', params });

  it('opens the snapshot in a new window, links it, and counts the use', async () => {
    const snapshot = makeSnapshot({
      name: 'Job Hunt',
      usageCount: 2,
      tabs: [makeTab({ url: 'https://a.test/' }), makeTab({ url: 'https://b.test/' })],
    });
    await addSnapshot(snapshot);

    const response = (await call({ id: snapshot.id })) as any;
    expect(response.result).toMatchObject({ snapshotName: 'Job Hunt', tabCount: 2, reusedExistingWindow: false });

    const [stored] = await getSnapshots();
    expect(stored!.usageCount).toBe(3);
    expect(stored!.linkedWindowId).toBe(response.result.windowId);
  });

  it('brings an already-open snapshot forward instead of opening a duplicate', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    const snapshot = makeSnapshot({ linkedWindowId: win.id ?? null, usageCount: 5 });
    await addSnapshot(snapshot);
    const windowsBefore = (await fakeBrowser.windows.getAll()).length;

    const response = (await call({ id: snapshot.id })) as any;
    expect(response.result).toMatchObject({ windowId: win.id, reusedExistingWindow: true });
    expect((await fakeBrowser.windows.getAll()).length).toBe(windowsBefore);
    expect((await getSnapshots())[0]!.usageCount).toBe(6);
  });

  it('answers not_found, invalid_params, and refuses an empty snapshot', async () => {
    expect(await call({ id: 'missing' })).toMatchObject({ error: { code: 'not_found' } });
    expect(await call({})).toMatchObject({ error: { code: 'invalid_params' } });
    const empty = makeSnapshot({ name: 'Empty', tabs: [] });
    await addSnapshot(empty);
    const response = (await call({ id: empty.id })) as any;
    expect(response.error).toMatchObject({ code: 'invalid_params' });
    expect(response.error.message).toContain('Empty');
  });
});

describe('openUrls and focusTab through the dispatcher', () => {
  it('refuses a javascript: address without opening anything', async () => {
    const create = vi.spyOn(fakeBrowser.windows, 'create');
    const response = await dispatch({ id: 'o', method: 'openUrls', params: { urls: ['javascript:alert(1)'] } });
    expect(response).toMatchObject({ error: { code: 'invalid_params' } });
    expect(create).not.toHaveBeenCalled();
  });

  it('reports not_found when focusing a tab that does not exist', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockRejectedValue(new Error('gone'));
    expect(await dispatch({ id: 'f', method: 'focusTab', params: { tabId: 1 } })).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});

describe('openUrls avoids snapshot windows', () => {
  it('opens in a new window when the window used last is linked to a snapshot', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    await addSnapshot(makeSnapshot({ linkedWindowId: win.id ?? null }));
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: win.id, incognito: false } as never);
    vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({
      id: 77,
      tabs: [{ id: 770, url: 'https://a.test/' }],
    } as never);
    const tabsCreate = vi.spyOn(fakeBrowser.tabs, 'create');

    const response = (await dispatch({ id: 'o', method: 'openUrls', params: { urls: ['https://a.test/'] } })) as any;

    expect(tabsCreate).not.toHaveBeenCalled();
    expect(response.result).toMatchObject({ windowId: 77, openedInNewWindow: true });
  });
});

describe('snapshot editing through the dispatcher', () => {
  it('creates a snapshot from urls, renames it and tags it', async () => {
    const created = (await dispatch({
      id: 'c',
      method: 'createSnapshotFromUrls',
      params: { name: 'Reading', urls: ['https://a.test/'], categoryNames: ['Learning'] },
    })) as any;
    expect(created.result).toMatchObject({ name: 'Reading', tabCount: 1 });

    const renamed = (await dispatch({
      id: 'r',
      method: 'renameSnapshot',
      params: { id: created.result.snapshotId, name: 'Reading list' },
    })) as any;
    expect(renamed.result).toMatchObject({ previousName: 'Reading', name: 'Reading list' });

    const tagged = (await dispatch({
      id: 't',
      method: 'tagSnapshots',
      params: { snapshotIds: [created.result.snapshotId], categoryNames: ['Later'] },
    })) as any;
    expect(tagged.result).toMatchObject({ tagged: 1, categories: [{ name: 'Later', created: true }] });
  });

  it('maps failures to error codes', async () => {
    expect(await dispatch({ id: 'x', method: 'renameSnapshot', params: { id: 'nope', name: 'X' } })).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(await dispatch({ id: 'x', method: 'createSnapshotFromUrls', params: { name: 'Archived', urls: ['https://a.test/'] } })).toMatchObject({
      error: { code: 'reserved_name' },
    });
  });
});
