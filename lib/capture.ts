import { resolveLazyTab } from './lazyTab';
import { setManagedTabs } from './managedTabs';
import { hasTabGroupsSupport } from './tabGroupsSupport';
import type { Snapshot, SnapshotTab, SnapshotTabGroup } from './types';

export async function captureWindowTabs(windowId: number): Promise<{
  tabs: SnapshotTab[];
  tabGroups: SnapshotTabGroup[];
  tabIds: number[];
}> {
  const [tabs, groups] = await Promise.all([
    browser.tabs.query({ windowId }),
    hasTabGroupsSupport() ? browser.tabGroups.query({ windowId }) : Promise.resolve([]),
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

/** Captures a window's tabs into a new (unsaved) snapshot. With `link` (the
 * default) the snapshot is tied to the window and its tabs are protected from
 * nudges, like the toolbar's Save; without it the snapshot is a plain copy. */
export async function createSnapshotFromWindow(
  windowId: number,
  name: string,
  { link = true }: { link?: boolean } = {},
): Promise<Snapshot> {
  const { tabs, tabGroups, tabIds } = await captureWindowTabs(windowId);
  const now = Date.now();
  const id = crypto.randomUUID();
  if (link) await setManagedTabs(id, tabIds);
  return {
    id,
    name,
    tabs,
    tabGroups,
    linkedWindowId: link ? windowId : null,
    categoryIds: [],
    usageCount: 0,
    pinned: false,
    pinnedPosition: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function createSnapshotFromCurrentWindow(
  name: string,
): Promise<Snapshot> {
  const currentWindow = await browser.windows.getCurrent();
  return createSnapshotFromWindow(currentWindow.id!, name);
}
