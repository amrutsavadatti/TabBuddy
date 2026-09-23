import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/test/factories';
import { addSnapshot, addSnapshots, getSnapshots } from './storage';
import {
  addCategory,
  addSnapshotsToCategories,
  addSnapshotToCategory,
  deleteCategory,
  getCategories,
  getCategoryColor,
  getSnapshotsInCategory,
  getUncategorizedSnapshots,
  removeSnapshotFromCategory,
  renameCategory,
  setCategoryColor,
  setSnapshotCategories,
} from './categories';

describe('category CRUD', () => {
  it('starts empty', async () => {
    expect(await getCategories()).toEqual([]);
  });

  it('adds a category with a trimmed name and no color by default', async () => {
    const c = await addCategory('  Job Hunt  ');
    expect(c.name).toBe('Job Hunt');
    expect(c.color).toBeNull();
    expect(await getCategories()).toEqual([c]);
  });

  it('rejects an empty name', async () => {
    await expect(addCategory('   ')).rejects.toThrow('cannot be empty');
  });

  it('suffixes duplicate names', async () => {
    await addCategory('Work');
    const second = await addCategory('Work');
    expect(second.name).toBe('Work (2)');
  });

  it('renames a category, keeping names unique', async () => {
    const a = await addCategory('A');
    await addCategory('B');
    await renameCategory(a.id, 'B');
    expect((await getCategories())[0]!.name).toBe('B (2)');
  });

  it('renaming a category to its own name keeps it unchanged', async () => {
    const a = await addCategory('A');
    await renameCategory(a.id, 'A');
    expect((await getCategories())[0]!.name).toBe('A');
  });

  it('sets and clears a color', async () => {
    const a = await addCategory('A');
    await setCategoryColor(a.id, '#ff0000');
    expect((await getCategories())[0]!.color).toBe('#ff0000');
    await setCategoryColor(a.id, null);
    expect((await getCategories())[0]!.color).toBeNull();
  });
});

describe('tagging snapshots', () => {
  it('adds a snapshot to several categories', async () => {
    const snap = makeSnapshot();
    await addSnapshot(snap);
    const a = await addCategory('A');
    const b = await addCategory('B');

    await addSnapshotToCategory(snap.id, a.id);
    await addSnapshotToCategory(snap.id, b.id);

    expect((await getSnapshots())[0]!.categoryIds).toEqual([a.id, b.id]);
  });

  it('does not duplicate a tag added twice', async () => {
    const snap = makeSnapshot();
    await addSnapshot(snap);
    const a = await addCategory('A');
    await addSnapshotToCategory(snap.id, a.id);
    await addSnapshotToCategory(snap.id, a.id);
    expect((await getSnapshots())[0]!.categoryIds).toEqual([a.id]);
  });

  it('removes a tag without touching the others', async () => {
    const snap = makeSnapshot();
    await addSnapshot(snap);
    const a = await addCategory('A');
    const b = await addCategory('B');
    await setSnapshotCategories(snap.id, [a.id, b.id]);

    await removeSnapshotFromCategory(snap.id, a.id);

    expect((await getSnapshots())[0]!.categoryIds).toEqual([b.id]);
  });

  it('rejects an unknown category or snapshot', async () => {
    const snap = makeSnapshot();
    await addSnapshot(snap);
    await expect(addSnapshotToCategory(snap.id, 'nope')).rejects.toThrow('category');
    const a = await addCategory('A');
    await expect(addSnapshotToCategory('nope', a.id)).rejects.toThrow('snapshot');
  });

  it('refuses to categorize the reserved Archived snapshot', async () => {
    const archived = makeSnapshot({ name: 'Archived' });
    await addSnapshot(archived);
    const a = await addCategory('A');
    await expect(addSnapshotToCategory(archived.id, a.id)).rejects.toThrow('Archived');
  });

  it('treats snapshots saved before categories existed as untagged', async () => {
    const legacy = { ...makeSnapshot() } as Partial<ReturnType<typeof makeSnapshot>>;
    delete legacy.categoryIds;
    await browser.storage.local.set({ snapshots: [legacy] });

    const [loaded] = await getSnapshots();
    expect(loaded!.categoryIds).toEqual([]);
  });
});

describe('deleteCategory', () => {
  it('removes the tag from every snapshot but keeps the snapshots', async () => {
    const a = await addCategory('A');
    const b = await addCategory('B');
    const s1 = makeSnapshot({ categoryIds: [a.id, b.id] });
    const s2 = makeSnapshot({ categoryIds: [a.id] });
    const s3 = makeSnapshot({ categoryIds: [b.id] });
    await addSnapshots([s1, s2, s3]);

    await deleteCategory(a.id);

    const stored = await getSnapshots();
    expect(stored).toHaveLength(3);
    expect(stored.find((s) => s.id === s1.id)!.categoryIds).toEqual([b.id]);
    expect(stored.find((s) => s.id === s2.id)!.categoryIds).toEqual([]);
    expect(stored.find((s) => s.id === s3.id)!.categoryIds).toEqual([b.id]);
    expect((await getCategories()).map((c) => c.id)).toEqual([b.id]);
  });
});

describe('selectors', () => {
  it('finds snapshots in a category, including ones in several', () => {
    const s1 = makeSnapshot({ categoryIds: ['a', 'b'] });
    const s2 = makeSnapshot({ categoryIds: ['b'] });
    const s3 = makeSnapshot({ categoryIds: [] });
    expect(getSnapshotsInCategory([s1, s2, s3], 'b')).toEqual([s1, s2]);
    expect(getSnapshotsInCategory([s1, s2, s3], 'a')).toEqual([s1]);
  });

  it('lists uncategorized snapshots, ignoring dangling ids and Archived', () => {
    const tagged = makeSnapshot({ categoryIds: ['a'] });
    const dangling = makeSnapshot({ categoryIds: ['deleted'] });
    const plain = makeSnapshot({ categoryIds: [] });
    const archived = makeSnapshot({ name: 'Archived', categoryIds: [] });
    expect(getUncategorizedSnapshots([tagged, dangling, plain, archived], [{ id: 'a' }])).toEqual([
      dangling,
      plain,
    ]);
  });
});

describe('getCategoryColor', () => {
  it('uses the chosen color when set', () => {
    expect(getCategoryColor({ name: 'A', color: '#123456' })).toBe('#123456');
  });

  it('derives a stable color from the name otherwise', () => {
    const first = getCategoryColor({ name: 'Work', color: null });
    expect(first).toMatch(/^hsl\(/);
    expect(getCategoryColor({ name: 'Work', color: null })).toBe(first);
  });
});

describe('addSnapshotsToCategories', () => {
  it('tags every listed snapshot with every category, keeping existing tags', async () => {
    const a = await addCategory('A');
    const b = await addCategory('B');
    const s1 = makeSnapshot({ categoryIds: [a.id] });
    const s2 = makeSnapshot();
    const s3 = makeSnapshot();
    await addSnapshots([s1, s2, s3]);

    const count = await addSnapshotsToCategories([s1.id, s2.id], [a.id, b.id]);

    expect(count).toBe(2);
    const stored = await getSnapshots();
    expect(stored.find((s) => s.id === s1.id)!.categoryIds).toEqual([a.id, b.id]);
    expect(stored.find((s) => s.id === s2.id)!.categoryIds).toEqual([a.id, b.id]);
    expect(stored.find((s) => s.id === s3.id)!.categoryIds).toEqual([]);
  });

  it('skips the Archived snapshot', async () => {
    const a = await addCategory('A');
    const archived = makeSnapshot({ name: 'Archived' });
    const normal = makeSnapshot();
    await addSnapshots([archived, normal]);

    const count = await addSnapshotsToCategories([archived.id, normal.id], [a.id]);

    expect(count).toBe(1);
    const stored = await getSnapshots();
    expect(stored.find((s) => s.id === archived.id)!.categoryIds).toEqual([]);
  });

  it('rejects an unknown category and changes nothing', async () => {
    const s1 = makeSnapshot();
    await addSnapshots([s1]);
    await expect(addSnapshotsToCategories([s1.id], ['nope'])).rejects.toThrow('category');
    expect((await getSnapshots())[0]!.categoryIds).toEqual([]);
  });
});
