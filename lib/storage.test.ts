import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/test/factories';
import { getManagedTabIds, setManagedTabs } from './managedTabs';
import {
  addSnapshot,
  addSnapshots,
  deleteSnapshot,
  deleteSnapshots,
  getSnapshots,
  updateSnapshot,
  updateSnapshots,
} from './storage';

describe('getSnapshots', () => {
  it('returns an empty array when nothing is stored', async () => {
    expect(await getSnapshots()).toEqual([]);
  });
});

describe('addSnapshot / addSnapshots', () => {
  it('appends a single snapshot', async () => {
    const snapshot = makeSnapshot({ name: 'A' });
    await addSnapshot(snapshot);
    expect(await getSnapshots()).toEqual([snapshot]);
  });

  it('appends multiple snapshots in one write', async () => {
    const existing = makeSnapshot({ name: 'Existing' });
    await addSnapshot(existing);
    const batch = [makeSnapshot({ name: 'B' }), makeSnapshot({ name: 'C' })];
    await addSnapshots(batch);
    const all = await getSnapshots();
    expect(all).toHaveLength(3);
    expect(all.map((s) => s.name)).toEqual(['Existing', 'B', 'C']);
  });
});

describe('deleteSnapshot / deleteSnapshots', () => {
  it('removes a single snapshot by id', async () => {
    const a = makeSnapshot({ name: 'A' });
    const b = makeSnapshot({ name: 'B' });
    await addSnapshots([a, b]);
    await deleteSnapshot(a.id);
    expect(await getSnapshots()).toEqual([b]);
  });

  it('stops treating a deleted snapshot\'s tabs as managed', async () => {
    const a = makeSnapshot({ name: 'A' });
    const b = makeSnapshot({ name: 'B' });
    await addSnapshots([a, b]);
    await setManagedTabs(a.id, [1, 2]);
    await setManagedTabs(b.id, [3]);

    await deleteSnapshot(a.id);

    expect([...(await getManagedTabIds())]).toEqual([3]);
  });

  it('removes multiple snapshots in a single read-modify-write (no race)', async () => {
    const a = makeSnapshot({ name: 'A' });
    const b = makeSnapshot({ name: 'B' });
    const c = makeSnapshot({ name: 'C' });
    await addSnapshots([a, b, c]);
    // Simulates the bulk-delete path (previously buggy via Promise.all of
    // individual deletes racing on their own get/set pairs).
    await deleteSnapshots([a.id, b.id]);
    expect(await getSnapshots()).toEqual([c]);
  });
});

describe('updateSnapshot / updateSnapshots', () => {
  it('applies a partial update to one snapshot', async () => {
    const snapshot = makeSnapshot({ name: 'Original', usageCount: 0 });
    await addSnapshot(snapshot);
    await updateSnapshot(snapshot.id, { name: 'Renamed', usageCount: 1 });
    const [updated] = await getSnapshots();
    expect(updated?.name).toBe('Renamed');
    expect(updated?.usageCount).toBe(1);
  });

  it('leaves unrelated snapshots untouched', async () => {
    const a = makeSnapshot({ name: 'A' });
    const b = makeSnapshot({ name: 'B' });
    await addSnapshots([a, b]);
    await updateSnapshot(a.id, { name: 'A-renamed' });
    const all = await getSnapshots();
    expect(all.find((s) => s.id === b.id)?.name).toBe('B');
  });

  it('applies different updates to multiple snapshots in one write', async () => {
    const a = makeSnapshot({ name: 'A', pinnedPosition: null });
    const b = makeSnapshot({ name: 'B', pinnedPosition: null });
    await addSnapshots([a, b]);
    await updateSnapshots([
      { id: a.id, changes: { pinnedPosition: 0 } },
      { id: b.id, changes: { pinnedPosition: 1 } },
    ]);
    const all = await getSnapshots();
    expect(all.find((s) => s.id === a.id)?.pinnedPosition).toBe(0);
    expect(all.find((s) => s.id === b.id)?.pinnedPosition).toBe(1);
  });
});
