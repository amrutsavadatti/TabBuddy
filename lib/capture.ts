import { resolveLazyTab } from './lazyTab';
import { setManagedTabs } from './managedTabs';
import type { Snapshot, SnapshotTab, SnapshotTabGroup } from './types';

export async function captureWindowTabs(windowId: number): Promise<{
  tabs: SnapshotTab[];
  tabGroups: SnapshotTabGroup[];
  tabIds: number[];
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

  const snapshotTabs: SnapshotTab[] = tabs.map(resolveLazyTab).map((tab) => ({
    url: tab.url ?? '',
    title: tab.title ?? '',
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned ?? false,
    groupIndex:
      tab.groupId !== undefined && groupIdToIndex.has(tab.groupId)
        ? groupIdToIndex.get(tab.groupId)!
        : null,
  }));

  const tabIds = tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);

  return { tabs: snapshotTabs, tabGroups, tabIds };
}

export async function createSnapshotFromCurrentWindow(
  name: string,
): Promise<Snapshot> {
  const currentWindow = await browser.windows.getCurrent();
  const { tabs, tabGroups, tabIds } = await captureWindowTabs(currentWindow.id!);
  const now = Date.now();
  const id = crypto.randomUUID();
  await setManagedTabs(id, tabIds);
  return {
    id,
    name,
    tabs,
    tabGroups,
    linkedWindowId: currentWindow.id ?? null,
    categoryIds: [],
    usageCount: 0,
    pinned: false,
    pinnedPosition: null,
    createdAt: now,
    updatedAt: now,
  };
}
