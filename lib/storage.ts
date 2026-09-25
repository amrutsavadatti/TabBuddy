import { unmanageSnapshots } from './managedTabs';
import type { Snapshot } from './types';

export const SNAPSHOTS_KEY = 'snapshots';

/** Snapshots saved before categories existed have no categoryIds. */
export function normalizeSnapshots(raw: unknown): Snapshot[] {
  const stored = Array.isArray(raw) ? (raw as Snapshot[]) : [];
  return stored.map((s) => ({ ...s, categoryIds: s.categoryIds ?? [] }));
}

export async function getSnapshots(): Promise<Snapshot[]> {
  const result = await browser.storage.local.get(SNAPSHOTS_KEY);
  return normalizeSnapshots(result[SNAPSHOTS_KEY]);
}

export async function addSnapshot(snapshot: Snapshot): Promise<void> {
  const snapshots = await getSnapshots();
  snapshots.push(snapshot);
  await browser.storage.local.set({ [SNAPSHOTS_KEY]: snapshots });
}

export async function addSnapshots(newSnapshots: Snapshot[]): Promise<void> {
  const snapshots = await getSnapshots();
  await browser.storage.local.set({
    [SNAPSHOTS_KEY]: [...snapshots, ...newSnapshots],
  });
}

export async function deleteSnapshot(id: string): Promise<void> {
  return deleteSnapshots([id]);
}

export async function deleteSnapshots(ids: string[]): Promise<void> {
  const idsToDelete = new Set(ids);
  const snapshots = await getSnapshots();
  const remaining = snapshots.filter((snapshot) => !idsToDelete.has(snapshot.id));
  await browser.storage.local.set({ [SNAPSHOTS_KEY]: remaining });
  await unmanageSnapshots(ids);
}

export async function updateSnapshot(
  id: string,
  changes: Partial<Snapshot>,
): Promise<void> {
  return updateSnapshots([{ id, changes }]);
}

/** Applies multiple updates in a single read-modify-write to avoid races
 * that occur when concurrent get/set pairs overwrite each other. */
export async function updateSnapshots(
  updates: { id: string; changes: Partial<Snapshot> }[],
): Promise<void> {
  const changesById = new Map(updates.map((u) => [u.id, u.changes]));
  const snapshots = await getSnapshots();
  const updated = snapshots.map((snapshot) => {
    const changes = changesById.get(snapshot.id);
    return changes ? { ...snapshot, ...changes } : snapshot;
  });
  await browser.storage.local.set({ [SNAPSHOTS_KEY]: updated });
}
