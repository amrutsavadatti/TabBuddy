import type { Snapshot } from './types';
import { captureWindowTabs } from './capture';
import { setManagedTabs } from './managedTabs';
import { updateSnapshot } from './storage';

export async function updateSnapshotFromLiveWindow(
  snapshot: Snapshot,
): Promise<boolean> {
  if (snapshot.linkedWindowId === null) {
    return false;
  }

  try {
    await browser.windows.get(snapshot.linkedWindowId);
  } catch {
    return false;
  }

  const { tabs, tabGroups, tabIds } = await captureWindowTabs(snapshot.linkedWindowId);
  await setManagedTabs(snapshot.id, tabIds);
  await updateSnapshot(snapshot.id, {
    tabs,
    tabGroups,
    updatedAt: Date.now(),
  });
  return true;
}
