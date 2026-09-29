import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_ADD_TABS } from '../bridge/protocol';
import { dispatch } from './agentBridge';
import { addTabsToSnapshot, parseAddTabsParams } from './agentSnapshots';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { buildLazyTabUrl } from './lazyTab';
import { addSnapshot, getSnapshots } from './storage';
import { makeSnapshot, makeTab } from '@/test/factories';

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as BridgeFailure).code;
  }
  return 'no error';
};

/** Makes tabs.get answer from a table of tabs, and reject for any other id. */
function mockOpenTabs(tabs: Record<number, Record<string, unknown>>) {
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((async (id: number) => {
    if (!(id in tabs)) throw new Error(`No tab with id: ${id}`);
    return { id, incognito: false, ...tabs[id] };
  }) as never);
}

describe('parseAddTabsParams', () => {
  it('accepts open tabs, links, or both, and removes repeated tab ids', () => {
    expect(parseAddTabsParams({ id: 's', tabIds: [1, 1, 2] })).toEqual({ id: 's', tabIds: [1, 2], urls: [] });
    expect(parseAddTabsParams({ id: 's', urls: ['https://a.test/'] })).toEqual({
      id: 's',
      tabIds: [],
      urls: ['https://a.test/'],
    });
    expect(parseAddTabsParams({ id: 's', tabIds: [1], urls: ['https://a.test/'] }).urls).toHaveLength(1);
  });

  it.each([
    [undefined],
    [{}],
    [{ id: '' , tabIds: [1] }],
    [{ id: 's' }],
    [{ id: 's', tabIds: [], urls: [] }],
    [{ id: 's', tabIds: ['1'] }],
    [{ id: 's', tabIds: [1.5] }],
    [{ id: 's', tabIds: 'x' }],
    [{ id: 's', urls: 'https://a.test/' }],
    [{ id: 's', tabIds: Array.from({ length: MAX_ADD_TABS + 1 }, (_, i) => i) }],
    [{ id: 's', tabIds: Array.from({ length: 30 }, (_, i) => i), urls: Array(21).fill('https://a.test/') }],
  ])('rejects %j as invalid_params', (params) => {
    try {
      parseAddTabsParams(params);
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
    }
  });
});

describe('addTabsToSnapshot', () => {
  it('appends open tabs to the end, in order, keeping title and pinned state', async () => {
    const snapshot = makeSnapshot({ name: 'Reading', tabs: [makeTab({ url: 'https://old.test/' })] });
    await addSnapshot(snapshot);
    mockOpenTabs({
      11: { url: 'https://a.test/one', title: 'One', pinned: true },
      12: { url: 'https://b.test/two', title: 'Two' },
    });

    const result = await addTabsToSnapshot({ id: snapshot.id, tabIds: [11, 12] });

    expect(result.added).toEqual([
      { index: 1, url: 'https://a.test/one', title: 'One' },
      { index: 2, url: 'https://b.test/two', title: 'Two' },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.tabCount).toBe(3);
    const [stored] = await getSnapshots();
    expect(stored!.tabs.map((t) => t.url)).toEqual(['https://old.test/', 'https://a.test/one', 'https://b.test/two']);
    expect(stored!.tabs[1]).toMatchObject({ pinned: true, groupIndex: null });
    expect(stored!.tabs[2]).toMatchObject({ pinned: false });
    expect(stored!.updatedAt).toBeGreaterThanOrEqual(snapshot.updatedAt);
  });

  it('never closes the tabs it adds', async () => {
    const snapshot = makeSnapshot();
    await addSnapshot(snapshot);
    mockOpenTabs({ 5: { url: 'https://a.test/', title: 'A' } });
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove');
    await addTabsToSnapshot({ id: snapshot.id, tabIds: [5] });
    expect(remove).not.toHaveBeenCalled();
  });

  it('skips a page already in the snapshot, even with tracking parameters or a fragment', async () => {
    const snapshot = makeSnapshot({ tabs: [makeTab({ url: 'https://a.test/page' })] });
    await addSnapshot(snapshot);
    mockOpenTabs({
      1: { url: 'https://www.a.test/page?utm_source=news#top', title: 'Same page' },
      2: { url: 'https://a.test/other', title: 'New' },
    });

    const result = await addTabsToSnapshot({ id: snapshot.id, tabIds: [1, 2] });

    expect(result.added.map((a) => a.url)).toEqual(['https://a.test/other']);
    expect(result.skipped).toEqual([
      { value: 'https://www.a.test/page?utm_source=news#top', reason: 'already in this snapshot' },
    ]);
  });

  it('adds a page listed twice only once, and says so', async () => {
    const snapshot = makeSnapshot({ tabs: [] });
    await addSnapshot(snapshot);
    mockOpenTabs({ 1: { url: 'https://a.test/', title: 'A' } });
    const result = await addTabsToSnapshot({
      id: snapshot.id,
      tabIds: [1],
      urls: ['https://a.test/?utm_source=x'],
    });
    expect(result.added).toHaveLength(1);
    expect(result.skipped.map((s) => s.reason)).toEqual(['listed more than once']);
  });

  it('reports closed, private and non-web tabs instead of failing', async () => {
    const snapshot = makeSnapshot({ tabs: [] });
    await addSnapshot(snapshot);
    mockOpenTabs({
      1: { url: 'https://ok.test/', title: 'OK' },
      2: { url: 'https://private.test/', title: 'Private', incognito: true },
      3: { url: 'chrome://settings', title: 'Settings' },
    });

    const result = await addTabsToSnapshot({ id: snapshot.id, tabIds: [1, 2, 3, 99] });

    expect(result.added.map((a) => a.url)).toEqual(['https://ok.test/']);
    expect(result.skipped).toEqual([
      { value: 'tab 2', reason: 'no open tab with that id (it may have been closed)' },
      { value: 'tab 3: chrome://settings', reason: 'not a web page' },
      { value: 'tab 99', reason: 'no open tab with that id (it may have been closed)' },
    ]);
    // a private tab looks exactly like a closed one, and its address is never shown
    expect(JSON.stringify(result)).not.toContain('private.test');
  });

  it('saves the real page for a lazy placeholder tab', async () => {
    const snapshot = makeSnapshot({ tabs: [] });
    await addSnapshot(snapshot);
    mockOpenTabs({
      7: { url: buildLazyTabUrl({ url: 'https://real.test/page', title: 'Real page' }), title: 'real.test' },
    });
    const result = await addTabsToSnapshot({ id: snapshot.id, tabIds: [7] });
    expect(result.added).toEqual([{ index: 0, url: 'https://real.test/page', title: 'Real page' }]);
  });

  it('appends links, with a site-name title when none is given', async () => {
    const snapshot = makeSnapshot({ tabs: [makeTab()] });
    await addSnapshot(snapshot);
    const result = await addTabsToSnapshot({
      id: snapshot.id,
      urls: ['https://www.example.com/a', { url: 'https://docs.test/x', title: 'The docs' }, 'javascript:alert(1)'],
    });
    expect(result.added).toEqual([
      { index: 1, url: 'https://www.example.com/a', title: 'example.com' },
      { index: 2, url: 'https://docs.test/x', title: 'The docs' },
    ]);
    expect(result.skipped).toEqual([{ value: 'javascript:alert(1)', reason: 'not an http or https address' }]);
  });

  it('takes open tabs and links together', async () => {
    const snapshot = makeSnapshot({ tabs: [] });
    await addSnapshot(snapshot);
    mockOpenTabs({ 1: { url: 'https://open.test/', title: 'Open' } });
    const result = await addTabsToSnapshot({ id: snapshot.id, tabIds: [1], urls: ['https://link.test/'] });
    expect(result.added.map((a) => a.url)).toEqual(['https://open.test/', 'https://link.test/']);
  });

  it('adding nothing new is a normal result and leaves the snapshot untouched', async () => {
    const snapshot = makeSnapshot({ tabs: [makeTab({ url: 'https://a.test/' })], updatedAt: 111 });
    await addSnapshot(snapshot);
    mockOpenTabs({ 1: { url: 'https://a.test/', title: 'A' } });

    const result = await addTabsToSnapshot({ id: snapshot.id, tabIds: [1], urls: ['nonsense'] });

    expect(result.added).toEqual([]);
    expect(result.skipped).toHaveLength(2);
    expect(result.tabCount).toBe(1);
    expect((await getSnapshots())[0]!.updatedAt).toBe(111);
  });

  it('says when the snapshot is open in a window, since Update would drop what was added', async () => {
    const open = makeSnapshot({ linkedWindowId: 42 });
    const closed = makeSnapshot({ linkedWindowId: null });
    await addSnapshot(open);
    await addSnapshot(closed);
    expect((await addTabsToSnapshot({ id: open.id, urls: ['https://a.test/'] })).snapshotIsOpen).toBe(true);
    expect((await addTabsToSnapshot({ id: closed.id, urls: ['https://a.test/'] })).snapshotIsOpen).toBe(false);
  });

  it('refuses the Archived snapshot, and answers not_found for an unknown one', async () => {
    const archived = makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, tabs: [] });
    await addSnapshot(archived);
    expect(await code(addTabsToSnapshot({ id: archived.id, urls: ['https://a.test/'] }))).toBe('invalid_params');
    expect((await getSnapshots())[0]!.tabs).toEqual([]);
    expect(await code(addTabsToSnapshot({ id: 'missing', urls: ['https://a.test/'] }))).toBe('not_found');
  });

  it('is reachable through the dispatcher, with failures mapped to error codes', async () => {
    const snapshot = makeSnapshot({ tabs: [] });
    await addSnapshot(snapshot);
    const ok = (await dispatch({
      id: 'a',
      method: 'addTabsToSnapshot',
      params: { id: snapshot.id, urls: ['https://a.test/'] },
    })) as any;
    expect(ok.result).toMatchObject({ tabCount: 1, added: [{ index: 0, url: 'https://a.test/' }] });
    expect(await dispatch({ id: 'b', method: 'addTabsToSnapshot', params: { id: 'nope', urls: ['https://a.test/'] } })).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(await dispatch({ id: 'c', method: 'addTabsToSnapshot', params: { id: snapshot.id } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });

  it('leaves other snapshots alone', async () => {
    const target = makeSnapshot({ name: 'Target', tabs: [] });
    const other = makeSnapshot({ name: 'Other', tabs: [makeTab()] });
    await addSnapshot(target);
    await addSnapshot(other);
    await addTabsToSnapshot({ id: target.id, urls: ['https://a.test/'] });
    const stored = await getSnapshots();
    expect(stored.find((s) => s.name === 'Other')).toEqual(other);
  });
});
