import {
  MAX_ACTIVITY_ENTRIES,
  MAX_UNDOABLE_ENTRIES,
  type ActivityEntry,
} from '../bridge/protocol';
import type { SnapshotTab } from './types';

/** A tab that was closed on the agent's behalf, with what is needed to bring it back. */
export interface ClosedTab {
  /** The real page. */
  url: string;
  /** The address exactly as the browser reported it (a lazy placeholder's own address), for matching the browser's recently-closed list. */
  rawUrl: string;
  title: string;
  pinned: boolean;
  windowId: number;
}

/** Everything undo needs to reverse one confirmed action. */
export type UndoPayload =
  | { kind: 'archive'; archivedSnapshotId: string; tabs: ClosedTab[] }
  | { kind: 'close'; tabs: ClosedTab[] }
  | {
      kind: 'removeFromSnapshot';
      snapshotId: string;
      snapshotName: string;
      /** The snapshot's updatedAt right after the removal, to tell later whether it changed. */
      snapshotUpdatedAfter: number;
      removed: { index: number; tab: SnapshotTab }[];
    };

export interface StoredActivity {
  id: string;
  at: number;
  tool: string;
  summary: string;
  undo?: UndoPayload;
  undone: boolean;
}

const ACTIVITY_KEY = 'agentActivity';
/** A favicon bigger than this is not kept in undo data: it is only cosmetic. */
const MAX_KEPT_FAVICON = 4000;

/** Drops a favicon too big to be worth keeping in the log. */
export function slimTab(tab: SnapshotTab): SnapshotTab {
  if (tab.favIconUrl && tab.favIconUrl.length > MAX_KEPT_FAVICON) {
    const { favIconUrl: _dropped, ...rest } = tab;
    return rest;
  }
  return tab;
}

async function read(): Promise<StoredActivity[]> {
  const result = await browser.storage.local.get(ACTIVITY_KEY);
  const stored = result[ACTIVITY_KEY];
  return Array.isArray(stored) ? (stored as StoredActivity[]) : [];
}

async function write(entries: StoredActivity[]): Promise<void> {
  await browser.storage.local.set({ [ACTIVITY_KEY]: entries });
}

function toEntry(stored: StoredActivity): ActivityEntry {
  return {
    id: stored.id,
    at: stored.at,
    tool: stored.tool,
    summary: stored.summary,
    undoable: stored.undo !== undefined && !stored.undone,
    undone: stored.undone,
  };
}

/** Adds an entry, oldest first in storage. Keeps the newest 100 entries, and
 * the data needed to undo only for the newest 20 that have any, so the log
 * cannot grow to crowd out the user's snapshots. Returns the entry's id, which
 * is also its undoId. */
export async function recordActivity(
  input: { tool: string; summary: string; undo?: UndoPayload },
  now: number = Date.now(),
): Promise<string> {
  const entry: StoredActivity = {
    id: crypto.randomUUID(),
    at: now,
    tool: input.tool,
    summary: input.summary,
    undo: input.undo,
    undone: false,
  };
  const kept = [...(await read()), entry].slice(-MAX_ACTIVITY_ENTRIES);

  let undoable = 0;
  for (let i = kept.length - 1; i >= 0; i--) {
    const item = kept[i]!;
    if (item.undo === undefined) continue;
    undoable += 1;
    if (undoable > MAX_UNDOABLE_ENTRIES) {
      const { undo: _expired, ...rest } = item;
      kept[i] = rest;
    }
  }
  await write(kept);
  return entry.id;
}

/** Newest first. */
export async function listActivity(limit?: number): Promise<{ entries: ActivityEntry[]; total: number }> {
  const all = await read();
  const newestFirst = [...all].reverse().map(toEntry);
  return { entries: limit === undefined ? newestFirst : newestFirst.slice(0, limit), total: all.length };
}

export async function getActivity(id: string): Promise<StoredActivity | undefined> {
  return (await read()).find((entry) => entry.id === id);
}

/** Marks an entry undone and drops its undo data: it can be used only once. */
export async function markUndone(id: string): Promise<void> {
  const entries = await read();
  await write(
    entries.map((entry) => {
      if (entry.id !== id) return entry;
      const { undo: _used, ...rest } = entry;
      return { ...rest, undone: true };
    }),
  );
}
