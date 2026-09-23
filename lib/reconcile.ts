import { clearManagedTabs, setManagedTabs } from './managedTabs';
import { getSnapshots, updateSnapshots } from './storage';

/** Browser startup: window and tab ids all reset, so every saved link to a
 * window id is stale (and could collide with an unrelated new window). */
export async function clearAllWindowLinks(): Promise<void> {
  const snapshots = await getSnapshots();
  await updateSnapshots(
    snapshots
      .filter((s) => s.linkedWindowId !== null)
      .map((s) => ({ id: s.id, changes: { linkedWindowId: null } })),
  );
  await clearManagedTabs();
}

/** Extension reload/update: window ids are still valid but the session
 * registry may be empty. Drop links to windows that are gone, and re-register
 * tabs of surviving linked windows by matching their saved URLs (a one-time
 * bootstrap — the tab-id registry takes over from here). */
export async function reconcileAfterReload(): Promise<void> {
  const snapshots = await getSnapshots();
  const staleLinks: string[] = [];

  for (const snapshot of snapshots) {
    if (snapshot.linkedWindowId === null) continue;
    try {
      await browser.windows.get(snapshot.linkedWindowId);
    } catch {
      staleLinks.push(snapshot.id);
      continue;
    }
    const savedUrls = new Set(snapshot.tabs.map((t) => t.url));
    const liveTabs = await browser.tabs.query({ windowId: snapshot.linkedWindowId });
    const ids = liveTabs
      .filter((t) => t.id !== undefined && t.url !== undefined && savedUrls.has(t.url))
      .map((t) => t.id!);
    await setManagedTabs(snapshot.id, ids);
  }

  if (staleLinks.length > 0) {
    await updateSnapshots(
      staleLinks.map((id) => ({ id, changes: { linkedWindowId: null } })),
    );
  }
}
