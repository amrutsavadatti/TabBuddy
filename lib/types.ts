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
  createdAt: number;
  updatedAt: number;
}
