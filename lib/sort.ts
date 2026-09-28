import { isArchivedSnapshot } from './archive';
import type { Snapshot } from './types';

export type SortOption = 'mfu' | 'recentlyUpdated' | 'recentlyCreated';

export const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'mfu', label: 'Most frequently used' },
  { id: 'recentlyUpdated', label: 'Recently updated' },
  { id: 'recentlyCreated', label: 'Recently created' },
];

const SORTERS: Record<SortOption, (a: Snapshot, b: Snapshot) => number> = {
  mfu: (a, b) => b.usageCount - a.usageCount,
  recentlyUpdated: (a, b) => b.updatedAt - a.updatedAt,
  recentlyCreated: (a, b) => b.createdAt - a.createdAt,
};

/**
 * Pinned snapshots first (in pin order, unaffected by sort choice — that's
 * an explicit user-controlled position), then unpinned snapshots ordered by
 * the chosen sort option.
 */
export function getDisplayOrder(
  snapshots: Snapshot[],
  sortBy: SortOption = 'mfu',
): {
  pinned: Snapshot[];
  unpinned: Snapshot[];
} {
  const pinned = snapshots
    .filter((s) => s.pinned)
    .sort((a, b) => (a.pinnedPosition ?? 0) - (b.pinnedPosition ?? 0));
  const unpinned = snapshots.filter((s) => !s.pinned).sort(SORTERS[sortBy]);

  return { pinned, unpinned };
}

/** The snapshots the user opens most, for a quick-access list (e.g. the
 * toolbar popup). Archived and never-opened snapshots are left out, so the
 * list is either genuinely useful or empty — never padded with filler. */
export function getMostUsedSnapshots(snapshots: Snapshot[], count: number): Snapshot[] {
  return snapshots
    .filter((s) => !isArchivedSnapshot(s) && s.usageCount > 0)
    .sort((a, b) => b.usageCount - a.usageCount || b.updatedAt - a.updatedAt)
    .slice(0, count);
}
