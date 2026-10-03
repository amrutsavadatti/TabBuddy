import type { Snapshot } from './types';

const normalize = (text: string) => text.trim().toLowerCase();

/** Snapshots whose name contains the query (ignoring case and surrounding
 * spaces). An empty query keeps everything, in the order given. */
export function filterSnapshotsByName(snapshots: Snapshot[], query: string): Snapshot[] {
  const needle = normalize(query);
  return needle === '' ? snapshots : snapshots.filter((s) => s.name.toLowerCase().includes(needle));
}

/** Search results for a quick-access list such as the toolbar popup: names that
 * start with the query first, then the snapshots opened most, then the most
 * recently updated. An empty query finds nothing (the caller shows something
 * else), unlike filterSnapshotsByName. */
export function searchSnapshots(snapshots: Snapshot[], query: string): Snapshot[] {
  const needle = normalize(query);
  if (needle === '') return [];
  const startsWith = (s: Snapshot) => s.name.toLowerCase().startsWith(needle);
  return filterSnapshotsByName(snapshots, query).sort(
    (a, b) =>
      Number(startsWith(b)) - Number(startsWith(a)) ||
      b.usageCount - a.usageCount ||
      b.updatedAt - a.updatedAt,
  );
}
