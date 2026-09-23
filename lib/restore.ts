import type { Browser } from 'wxt/browser';
import type { Snapshot } from './types';
import { getLazyRestoreEnabled } from './lazyRestore';
import { buildLazyTabUrl, isHttpUrl } from './lazyTab';
import { setManagedTabs } from './managedTabs';
import { updateSnapshot } from './storage';

async function focusExistingWindow(windowId: number): Promise<boolean> {
  try {
    await browser.windows.get(windowId);
  } catch {
    return false;
  }
  await browser.windows.update(windowId, { focused: true });
  return true;
}

async function recreateTabGroups(
  createdTabIds: (number | undefined)[],
  snapshot: Snapshot,
  windowId: number,
): Promise<void> {
  const tabIdsByGroupIndex = new Map<number, number[]>();

  createdTabIds.forEach((tabId, index) => {
    const groupIndex = snapshot.tabs[index]?.groupIndex;
    if (groupIndex === null || groupIndex === undefined || tabId === undefined) {
      return;
    }
    const tabIds = tabIdsByGroupIndex.get(groupIndex) ?? [];
    tabIds.push(tabId);
    tabIdsByGroupIndex.set(groupIndex, tabIds);
  });

  for (const [groupIndex, tabIds] of tabIdsByGroupIndex) {
    const groupMeta = snapshot.tabGroups[groupIndex];
    if (!groupMeta || tabIds.length === 0) continue;
    const newGroupId = await browser.tabs.group({
      tabIds: tabIds as [number, ...number[]],
      createProperties: { windowId },
    });
    await browser.tabGroups.update(newGroupId, {
      title: groupMeta.title,
      color: groupMeta.color as Browser.tabGroups.Color,
    });
  }
}

async function openInNewWindow(snapshot: Snapshot): Promise<number> {
  // With lazy restore on, only the first (active) tab loads for real. The
  // rest open as light placeholders that load when the user switches to them.
  const lazy = await getLazyRestoreEnabled();
  const urls = snapshot.tabs.map((tab, index) =>
    lazy && index > 0 && isHttpUrl(tab.url) ? buildLazyTabUrl(tab) : tab.url,
  );
  const createdWindow = await browser.windows.create(
    urls.length ? { url: urls } : {},
  );
  if (!createdWindow?.id) {
    throw new Error('Failed to create window for snapshot restore');
  }

  const createdTabs = createdWindow.tabs ?? [];
  await Promise.all(
    createdTabs.map((tab, index) => {
      const savedTab = snapshot.tabs[index];
      if (savedTab?.pinned && tab.id !== undefined) {
        return browser.tabs.update(tab.id, { pinned: true });
      }
      return Promise.resolve();
    }),
  );

  await recreateTabGroups(
    createdTabs.map((tab) => tab.id),
    snapshot,
    createdWindow.id,
  );

  await setManagedTabs(
    snapshot.id,
    createdTabs.map((tab) => tab.id).filter((id): id is number => id !== undefined),
  );

  return createdWindow.id;
}

export async function restoreSnapshot(snapshot: Snapshot): Promise<number> {
  if (snapshot.linkedWindowId !== null) {
    const focused = await focusExistingWindow(snapshot.linkedWindowId);
    if (focused) {
      await updateSnapshot(snapshot.id, { usageCount: snapshot.usageCount + 1 });
      return snapshot.linkedWindowId;
    }
  }

  const windowId = await openInNewWindow(snapshot);
  await updateSnapshot(snapshot.id, {
    linkedWindowId: windowId,
    usageCount: snapshot.usageCount + 1,
  });
  return windowId;
}
