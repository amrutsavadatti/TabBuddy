import type { Snapshot, SnapshotTab } from '@/lib/types';

let counter = 0;

export function makeTab(overrides: Partial<SnapshotTab> = {}): SnapshotTab {
  counter++;
  return {
    url: `https://example${counter}.com/`,
    title: `Example ${counter}`,
    favIconUrl: undefined,
    pinned: false,
    groupIndex: null,
    ...overrides,
  };
}

export function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  counter++;
  const now = Date.now();
  return {
    id: `snapshot-${counter}`,
    name: `Snapshot ${counter}`,
    tabs: [makeTab()],
    tabGroups: [],
    linkedWindowId: null,
    categoryIds: [],
    usageCount: 0,
    pinned: false,
    pinnedPosition: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
