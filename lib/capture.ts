import type { Snapshot, SnapshotTab } from './types';

export async function captureCurrentWindow(): Promise<SnapshotTab[]> {
  const tabs = await browser.tabs.query({ currentWindow: true });
  return tabs.map((tab) => ({
    url: tab.url ?? '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned ?? false,
  }));
}

export async function createSnapshotFromCurrentWindow(
  name: string,
): Promise<Snapshot> {
  const tabs = await captureCurrentWindow();
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    tabs,
    createdAt: now,
    updatedAt: now,
  };
}
