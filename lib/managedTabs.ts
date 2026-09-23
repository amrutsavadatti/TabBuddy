const MANAGED_TABS_KEY = 'managedTabs';

type ManagedMap = Record<string, number[]>;

async function readMap(): Promise<ManagedMap> {
  const result = await browser.storage.session.get(MANAGED_TABS_KEY);
  return (result[MANAGED_TABS_KEY] as ManagedMap | undefined) ?? {};
}

async function writeMap(map: ManagedMap): Promise<void> {
  await browser.storage.session.set({ [MANAGED_TABS_KEY]: map });
}

/** Chrome tab ids only live until the browser restarts, so this uses
 * `storage.session` (cleared on restart) rather than `storage.local`. */
export async function setManagedTabs(snapshotId: string, tabIds: number[]): Promise<void> {
  const map = await readMap();
  map[snapshotId] = [...new Set(tabIds)];
  await writeMap(map);
}

export async function getManagedTabIds(): Promise<Set<number>> {
  const map = await readMap();
  return new Set(Object.values(map).flat());
}

export async function unmanageTab(tabId: number): Promise<void> {
  const map = await readMap();
  let changed = false;
  for (const [snapshotId, ids] of Object.entries(map)) {
    if (ids.includes(tabId)) {
      map[snapshotId] = ids.filter((id) => id !== tabId);
      changed = true;
    }
  }
  if (changed) await writeMap(map);
}

export async function unmanageSnapshots(snapshotIds: string[]): Promise<void> {
  const map = await readMap();
  let changed = false;
  for (const id of snapshotIds) {
    if (id in map) {
      delete map[id];
      changed = true;
    }
  }
  if (changed) await writeMap(map);
}

export async function clearManagedTabs(): Promise<void> {
  await browser.storage.session.remove(MANAGED_TABS_KEY);
}
