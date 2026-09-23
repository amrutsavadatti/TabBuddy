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

export interface Category {
  id: string;
  name: string;
  /** CSS color; null means derive one from the name. */
  color: string | null;
  createdAt: number;
}

export interface Snapshot {
  id: string;
  name: string;
  tabs: SnapshotTab[];
  tabGroups: SnapshotTabGroup[];
  linkedWindowId: number | null;
  /** Ids of the categories (tags) this snapshot belongs to. */
  categoryIds: string[];
  usageCount: number;
  pinned: boolean;
  pinnedPosition: number | null;
  createdAt: number;
  updatedAt: number;
}
