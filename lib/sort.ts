import type { Snapshot } from './types';

/** Pinned snapshots first (in pin order), then unpinned by most-frequently-used. */
export function getDisplayOrder(snapshots: Snapshot[]): {
  pinned: Snapshot[];
  unpinned: Snapshot[];
} {
  const pinned = snapshots
    .filter((s) => s.pinned)
    .sort((a, b) => (a.pinnedPosition ?? 0) - (b.pinnedPosition ?? 0));
  const unpinned = snapshots
    .filter((s) => !s.pinned)
    .sort((a, b) => b.usageCount - a.usageCount);

  return { pinned, unpinned };
}
