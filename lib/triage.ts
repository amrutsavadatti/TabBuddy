import type { SnapshotTab } from './types';

export interface TriageTab {
  id: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
}

export function tabToSnapshotTab(tab: TriageTab): SnapshotTab {
  return {
    url: tab.url,
    title: tab.title,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned,
    groupIndex: null,
  };
}
