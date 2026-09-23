import { addSnapshot, getSnapshots, updateSnapshot } from './storage';
import { tabToSnapshotTab, type TriageTab } from './triage';
import type { Snapshot } from './types';

export const ARCHIVED_SNAPSHOT_NAME = 'Archived';
export const ARCHIVED_ACCENT_COLOR = 'hsl(0 0% 60%)';

export function isArchivedSnapshot(snapshot: Pick<Snapshot, 'name'>): boolean {
  return snapshot.name === ARCHIVED_SNAPSHOT_NAME;
}

/** Idempotent — safe to call on every background script start. Guarantees
 * the reserved "Archived" snapshot exists even for installs that predate
 * this feature. */
export async function ensureArchivedSnapshotExists(): Promise<void> {
  await getOrCreateArchivedSnapshot();
}

async function getOrCreateArchivedSnapshot(): Promise<Snapshot> {
  const all = await getSnapshots();
  const existing = all.find((s) => s.name === ARCHIVED_SNAPSHOT_NAME);
  if (existing) return existing;

  const snapshot: Snapshot = {
    id: crypto.randomUUID(),
    name: ARCHIVED_SNAPSHOT_NAME,
    tabs: [],
    tabGroups: [],
    linkedWindowId: null,
    categoryIds: [],
    usageCount: 0,
    pinned: true,
    pinnedPosition: all.filter((s) => s.pinned).length,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await addSnapshot(snapshot);
  return snapshot;
}

/** Appends a tab to the reserved "Archived" snapshot (creating it on first
 * use) and closes the real browser tab. Used by the nudge popup's
 * "Archive & Close" action. */
export async function archiveTab(tab: TriageTab): Promise<void> {
  const archived = await getOrCreateArchivedSnapshot();
  await updateSnapshot(archived.id, {
    tabs: [...archived.tabs, tabToSnapshotTab(tab)],
    updatedAt: Date.now(),
  });
  try {
    await browser.tabs.remove(tab.id);
  } catch {
    // already closed by the user in the meantime — fine either way
  }
}
