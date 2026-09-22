import type { Snapshot } from './types';

export async function restoreSnapshot(snapshot: Snapshot): Promise<number> {
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
