export interface SnapshotTab {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  /** Index into the parent Snapshot's `tabGroups` array, or null if ungrouped. */
  groupIndex: number | null;
}

export interface SnapshotTabGroup {
  title: string;
  color: string;
}

export interface Snapshot {
  id: string;
  name: string;
  tabs: SnapshotTab[];
  tabGroups: SnapshotTabGroup[];
  linkedWindowId: number | null;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}
