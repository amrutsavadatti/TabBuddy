import type { Snapshot } from './types';
import { captureWindowTabs } from './capture';
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

  const { tabs, tabGroups } = await captureWindowTabs(snapshot.linkedWindowId);
  await updateSnapshot(snapshot.id, {
    tabs,
    tabGroups,
    updatedAt: Date.now(),
  });
  return true;
}
