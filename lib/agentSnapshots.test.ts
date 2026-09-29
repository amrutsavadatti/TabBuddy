import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_SNAPSHOT_URLS } from '../bridge/protocol';
import {
  createSnapshotFromUrls,
  findOrCreateCategories,
  parseCategoryNames,
  parseSnapshotUrls,
  renameSnapshotTo,
  tagSnapshots,
  updateSnapshotFromWindow,
} from './agentSnapshots';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { addCategory, getCategories } from './categories';
import { getManagedTabIds } from './managedTabs';
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
const codeSync = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as BridgeFailure).code;
  }
  return 'no error';
};

describe('parseCategoryNames', () => {
  it('returns nothing when there are none', () => expect(parseCategoryNames(undefined)).toEqual([]));

  it('trims, collapses spaces, and treats names that differ only in case as one', () => {
    expect(parseCategoryNames(['  Learning ', 'learning', 'Deep   Work'])).toEqual(['Learning', 'Deep Work']);
  });

  it.each([['Learning'], [[1]], [['  ']], [['x'.repeat(51)]], [Array(11).fill('a').map((a, i) => a + i)]])(
    'rejects %j',
    (value) => expect(codeSync(() => parseCategoryNames(value))).toBe('invalid_params'),
  );
});

describe('findOrCreateCategories', () => {
  it('reuses a category whatever its case, and creates the missing ones', async () => {
    const work = await addCategory('Work');
    const uses = await findOrCreateCategories(['work', 'Learning']);
    expect(uses[0]).toEqual({ id: work.id, name: 'Work', created: false });
    expect(uses[1]).toMatchObject({ name: 'Learning', created: true });
    expect((await getCategories()).map((c) => c.name)).toEqual(['Work', 'Learning']);
  });
});

describe('parseSnapshotUrls', () => {
  it('accepts plain urls and {url, title} pairs, with the site name as the fallback title', () => {
    const { tabs, skipped } = parseSnapshotUrls([
      'https://www.example.com/a',
      { url: 'https://docs.test/guide', title: '  The Guide  ' },
      { url: 'https://noname.test/' },
    ]);
    expect(tabs).toEqual([
      { url: 'https://www.example.com/a', title: 'example.com', pinned: false, groupIndex: null },
      { url: 'https://docs.test/guide', title: 'The Guide', pinned: false, groupIndex: null },
      { url: 'https://noname.test/', title: 'noname.test', pinned: false, groupIndex: null },
    ]);
    expect(skipped).toEqual([]);
  });

  it('leaves out non-web addresses and repeats, and says so', () => {
    const { tabs, skipped } = parseSnapshotUrls([
      'https://ok.test/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://ok.test/',
      { url: 5 },
      'nonsense',
    ]);
    expect(tabs.map((t) => t.url)).toEqual(['https://ok.test/']);
    expect(skipped.map((s) => s.reason)).toEqual([
      'not an http or https address',
      'not an http or https address',
      'listed more than once',
      'not an http or https address',
      'not an http or https address',
    ]);
    expect(skipped[0]!.value).toBe('javascript:alert(1)');
  });

  it('cuts very long titles', () => {
    const { tabs } = parseSnapshotUrls([{ url: 'https://a.test/', title: 'x'.repeat(500) }]);
    expect(tabs[0]!.title).toHaveLength(200);
  });

  it('fails, naming each problem, when nothing is usable', () => {
    try {
      parseSnapshotUrls(['javascript:x', 'nope']);
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
      expect((error as Error).message).toContain('javascript:x');
      expect((error as Error).message).toContain('nope');
    }
  });

  it.each([[undefined], [[]], ['https://a.test/'], [Array(MAX_SNAPSHOT_URLS + 1).fill('https://a.test/')]])(
    'rejects %j',
    (value) => expect(codeSync(() => parseSnapshotUrls(value))).toBe('invalid_params'),
  );
});

describe('createSnapshotFromUrls', () => {
  it('saves a snapshot without opening a window or protecting any tabs', async () => {
    const createWindow = vi.spyOn(fakeBrowser.windows, 'create');
    const createTab = vi.spyOn(fakeBrowser.tabs, 'create');

    const result = await createSnapshotFromUrls({
      name: 'System Design & DSA',
      urls: [{ url: 'https://neetcode.io/roadmap', title: 'NeetCode roadmap' }, 'https://github.com/x/y'],
    });

    expect(result).toEqual({
      snapshotId: expect.any(String),
      name: 'System Design & DSA',
      tabCount: 2,
      skipped: [],
      categories: [],
    });
    expect(createWindow).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
    const [saved] = await getSnapshots();
    expect(saved).toMatchObject({
      linkedWindowId: null,
      usageCount: 0,
      pinned: false,
      tabGroups: [],
      categoryIds: [],
    });
    expect(saved!.tabs.map((t) => t.title)).toEqual(['NeetCode roadmap', 'github.com']);
    expect([...(await getManagedTabIds())]).toEqual([]);
  });

  it('tags it in the same call, creating categories that do not exist yet', async () => {
    const work = await addCategory('Work');
    const result = await createSnapshotFromUrls({
      name: 'Reading list',
      urls: ['https://a.test/'],
      categoryNames: ['work', 'Learning'],
    });
    expect(result.categories).toEqual([
      { id: work.id, name: 'Work', created: false },
      { id: expect.any(String), name: 'Learning', created: true },
    ]);
    expect((await getSnapshots())[0]!.categoryIds).toEqual(result.categories.map((c) => c.id));
  });

  it('adds "(2)" to a taken name, and reports what was skipped', async () => {
    await addSnapshot(makeSnapshot({ name: 'Reading list' }));
    const result = await createSnapshotFromUrls({
      name: 'Reading list',
      urls: ['https://a.test/', 'javascript:x'],
    });
    expect(result.name).toBe('Reading list (2)');
    expect(result.skipped).toHaveLength(1);
    expect(result.tabCount).toBe(1);
  });

  it('refuses a bad name or bad urls before creating anything', async () => {
    expect(await code(createSnapshotFromUrls({ name: 'Archived', urls: ['https://a.test/'] }))).toBe('reserved_name');
    expect(await code(createSnapshotFromUrls({ name: '', urls: ['https://a.test/'] }))).toBe('invalid_params');
    expect(
      await code(createSnapshotFromUrls({ name: 'X', urls: ['nope'], categoryNames: ['Brand new'] })),
    ).toBe('invalid_params');
    expect(await getSnapshots()).toEqual([]);
    expect(await getCategories()).toEqual([]); // no stray category from a failed call
  });
});

describe('updateSnapshotFromWindow', () => {
  beforeEach(() => {
    vi.spyOn(fakeBrowser as any, 'tabGroups', 'get').mockReturnValue({ query: async () => [] });
  });

  it('re-saves the snapshot from its open window and reports the change', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    const snapshot = makeSnapshot({
      name: 'Job Hunt',
      linkedWindowId: win.id ?? null,
      tabs: [makeTab(), makeTab(), makeTab()],
    });
    await addSnapshot(snapshot);
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://only.test/', title: 'Only', pinned: false, groupId: -1 },
    ] as never);

    const result = await updateSnapshotFromWindow({ id: snapshot.id });

    expect(result).toEqual({ id: snapshot.id, name: 'Job Hunt', previousTabCount: 3, tabCount: 1 });
    expect((await getSnapshots())[0]!.tabs.map((t) => t.url)).toEqual(['https://only.test/']);
  });

  it('explains that a snapshot that is not open cannot be updated', async () => {
    const snapshot = makeSnapshot({ name: 'Closed one', linkedWindowId: null });
    await addSnapshot(snapshot);
    try {
      await updateSnapshotFromWindow({ id: snapshot.id });
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
      expect((error as Error).message).toContain('restore_snapshot');
    }
    expect((await getSnapshots())[0]!.tabs).toEqual(snapshot.tabs); // untouched
  });

  it('answers not_found, invalid_params, and refuses the Archived snapshot', async () => {
    expect(await code(updateSnapshotFromWindow({ id: 'missing' }))).toBe('not_found');
    expect(await code(updateSnapshotFromWindow({}))).toBe('invalid_params');
    const archived = makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME });
    await addSnapshot(archived);
    expect(await code(updateSnapshotFromWindow({ id: archived.id }))).toBe('invalid_params');
  });
});

describe('renameSnapshotTo', () => {
  it('renames a snapshot and reports the old and new names', async () => {
    const snapshot = makeSnapshot({ name: 'Old' });
    await addSnapshot(snapshot);
    expect(await renameSnapshotTo({ id: snapshot.id, name: '  New name ' })).toEqual({
      id: snapshot.id,
      previousName: 'Old',
      name: 'New name',
    });
    expect((await getSnapshots())[0]!.name).toBe('New name');
  });

  it('adds "(2)" if another snapshot has the name, but not for its own name', async () => {
    const a = makeSnapshot({ name: 'A' });
    const b = makeSnapshot({ name: 'B' });
    await addSnapshot(a);
    await addSnapshot(b);
    expect((await renameSnapshotTo({ id: b.id, name: 'A' })).name).toBe('A (2)');
    expect((await renameSnapshotTo({ id: a.id, name: 'A' })).name).toBe('A');
  });

  it('protects the Archived snapshot and its name', async () => {
    const archived = makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME });
    const other = makeSnapshot({ name: 'Other' });
    await addSnapshot(archived);
    await addSnapshot(other);
    expect(await code(renameSnapshotTo({ id: archived.id, name: 'Nope' }))).toBe('invalid_params');
    expect(await code(renameSnapshotTo({ id: other.id, name: 'archived' }))).toBe('reserved_name');
  });

  it('answers not_found and invalid_params', async () => {
    expect(await code(renameSnapshotTo({ id: 'missing', name: 'X' }))).toBe('not_found');
    expect(await code(renameSnapshotTo({ name: 'X' }))).toBe('invalid_params');
    const snapshot = makeSnapshot();
    await addSnapshot(snapshot);
    expect(await code(renameSnapshotTo({ id: snapshot.id, name: '  ' }))).toBe('invalid_params');
  });
});

describe('tagSnapshots', () => {
  it('tags snapshots, creating a category that does not exist yet', async () => {
    const a = makeSnapshot();
    const b = makeSnapshot();
    await addSnapshot(a);
    await addSnapshot(b);

    const result = await tagSnapshots({ snapshotIds: [a.id, b.id, a.id], categoryNames: ['Learning'] });

    expect(result.tagged).toBe(2);
    expect(result.categories).toEqual([{ id: expect.any(String), name: 'Learning', created: true }]);
    const stored = await getSnapshots();
    expect(stored.map((s) => s.categoryIds)).toEqual([[result.categories[0]!.id], [result.categories[0]!.id]]);
  });

  it('adds to a snapshot\'s existing categories without duplicating any', async () => {
    const work = await addCategory('Work');
    const s = makeSnapshot({ categoryIds: [work.id] });
    await addSnapshot(s);
    const result = await tagSnapshots({ snapshotIds: [s.id], categoryNames: ['work', 'Learning'] });
    expect(result.categories.map((c) => [c.name, c.created])).toEqual([['Work', false], ['Learning', true]]);
    expect((await getSnapshots())[0]!.categoryIds).toEqual([work.id, result.categories[1]!.id]);
  });

  it('checks every snapshot first, so a bad id leaves no stray category', async () => {
    const good = makeSnapshot();
    await addSnapshot(good);
    expect(await code(tagSnapshots({ snapshotIds: [good.id, 'nope'], categoryNames: ['Brand new'] }))).toBe('not_found');
    expect(await getCategories()).toEqual([]);
    expect((await getSnapshots())[0]!.categoryIds).toEqual([]);
  });

  it('refuses the Archived snapshot', async () => {
    const archived = makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME });
    await addSnapshot(archived);
    expect(await code(tagSnapshots({ snapshotIds: [archived.id], categoryNames: ['X'] }))).toBe('invalid_params');
    expect(await getCategories()).toEqual([]);
  });

  it.each([
    [undefined],
    [{}],
    [{ snapshotIds: [], categoryNames: ['X'] }],
    [{ snapshotIds: ['a'], categoryNames: [] }],
    [{ snapshotIds: ['a'] }],
    [{ snapshotIds: [5], categoryNames: ['X'] }],
    [{ snapshotIds: Array(51).fill('a'), categoryNames: ['X'] }],
  ])('rejects %j', async (params) => {
    expect(await code(tagSnapshots(params))).toBe('invalid_params');
  });
});
