import type { Snapshot, SnapshotTab, SnapshotTabGroup } from './types';

async function captureCurrentWindow(): Promise<{
  tabs: SnapshotTab[];
  tabGroups: SnapshotTabGroup[];
}> {
  const currentWindow = await browser.windows.getCurrent();
  const [tabs, groups] = await Promise.all([
    browser.tabs.query({ windowId: currentWindow.id }),
    browser.tabGroups.query({ windowId: currentWindow.id }),
  ]);

  const groupIdToIndex = new Map<number, number>();
  const tabGroups: SnapshotTabGroup[] = groups.map((group, index) => {
    groupIdToIndex.set(group.id, index);
    return { title: group.title ?? '', color: group.color };
  });

  const snapshotTabs: SnapshotTab[] = tabs.map((tab) => ({
    url: tab.url ?? '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned ?? false,
    groupIndex:
      tab.groupId !== undefined && groupIdToIndex.has(tab.groupId)
        ? groupIdToIndex.get(tab.groupId)!
        : null,
  }));

  return { tabs: snapshotTabs, tabGroups };
}

export async function createSnapshotFromCurrentWindow(
  name: string,
): Promise<Snapshot> {
  const { tabs, tabGroups } = await captureCurrentWindow();
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    tabs,
    tabGroups,
    linkedWindowId: null,
    createdAt: now,
    updatedAt: now,
  };
}
