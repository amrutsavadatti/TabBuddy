export interface SnapshotTab {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
}

export interface Snapshot {
  id: string;
  name: string;
  tabs: SnapshotTab[];
  linkedWindowId: number | null;
  createdAt: number;
  updatedAt: number;
}
