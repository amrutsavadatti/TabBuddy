import type { Snapshot, SnapshotTab, SnapshotTabGroup } from './types';

export async function captureWindowTabs(windowId: number): Promise<{
  tabs: SnapshotTab[];
  tabGroups: SnapshotTabGroup[];
}> {
  const [tabs, groups] = await Promise.all([
    browser.tabs.query({ windowId }),
    browser.tabGroups.query({ windowId }),
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
  const currentWindow = await browser.windows.getCurrent();
  const { tabs, tabGroups } = await captureWindowTabs(currentWindow.id!);
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    tabs,
    tabGroups,
    linkedWindowId: currentWindow.id ?? null,
    usageCount: 0,
    pinned: false,
    pinnedPosition: null,
    createdAt: now,
    updatedAt: now,
  };
}
