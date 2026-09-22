import type { Snapshot } from './types';

const SNAPSHOTS_KEY = 'snapshots';

export async function getSnapshots(): Promise<Snapshot[]> {
  const result = await browser.storage.local.get(SNAPSHOTS_KEY);
  return (result[SNAPSHOTS_KEY] as Snapshot[] | undefined) ?? [];
}

export async function addSnapshot(snapshot: Snapshot): Promise<void> {
  const snapshots = await getSnapshots();
  snapshots.push(snapshot);
  await browser.storage.local.set({ [SNAPSHOTS_KEY]: snapshots });
}

export async function updateSnapshot(
  id: string,
  changes: Partial<Snapshot>,
): Promise<void> {
  const snapshots = await getSnapshots();
  const updated = snapshots.map((snapshot) =>
    snapshot.id === id ? { ...snapshot, ...changes } : snapshot,
  );
  await browser.storage.local.set({ [SNAPSHOTS_KEY]: updated });
}
