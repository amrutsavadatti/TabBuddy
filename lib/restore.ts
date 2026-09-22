import type { Snapshot } from './types';
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

async function openInNewWindow(snapshot: Snapshot): Promise<number> {
  const urls = snapshot.tabs.map((tab) => tab.url);
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

  return createdWindow.id;
}

export async function restoreSnapshot(snapshot: Snapshot): Promise<number> {
  if (snapshot.linkedWindowId !== null) {
    const focused = await focusExistingWindow(snapshot.linkedWindowId);
    if (focused) {
      return snapshot.linkedWindowId;
    }
  }

  const windowId = await openInNewWindow(snapshot);
  await updateSnapshot(snapshot.id, { linkedWindowId: windowId });
  return windowId;
}
