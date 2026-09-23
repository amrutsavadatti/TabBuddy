import { addSnapshot, getSnapshots, updateSnapshot } from './storage';
import { tabToSnapshotTab, type TriageTab } from './triage';
import type { Snapshot } from './types';

export const ARCHIVED_SNAPSHOT_NAME = 'Archived';
export const ARCHIVED_ACCENT_COLOR = 'hsl(0 0% 60%)';

export function isArchivedSnapshot(snapshot: Pick<Snapshot, 'name'>): boolean {
  return snapshot.name === ARCHIVED_SNAPSHOT_NAME;
}

/** Case-insensitive, so users can't create a confusing "archived" lookalike. */
export function isReservedSnapshotName(name: string): boolean {
  return name.trim().toLowerCase() === ARCHIVED_SNAPSHOT_NAME.toLowerCase();
}

/** Renames a snapshot. The Archived snapshot is identified by its name, so it
 * can't be renamed and nothing else may take its name. A blank name leaves
 * the snapshot unchanged. */
export async function renameSnapshot(id: string, name: string): Promise<string> {
  const target = (await getSnapshots()).find((s) => s.id === id);
  if (!target) throw new Error('That snapshot no longer exists.');
  if (isArchivedSnapshot(target)) throw new Error('The Archived snapshot cannot be renamed.');
  const trimmed = name.trim();
  if (!trimmed) return target.name;
  if (isReservedSnapshotName(trimmed)) {
    throw new Error('"Archived" is reserved for TabBuddy\'s archive. Please choose another name.');
  }
  await updateSnapshot(id, { name: trimmed, updatedAt: Date.now() });
  return trimmed;
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
