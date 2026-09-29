import type { ActivityEntry, UndoResult } from '../bridge/protocol';

/** Toasts shown at once when a burst of activity arrives. */
export const MAX_ACTIVITY_TOASTS = 3;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Archived 12 tabs" → "Agent archived 12 tabs". */
export function toastMessageFor(entry: Pick<ActivityEntry, 'summary'>): string {
  const summary = entry.summary;
  return `Agent ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
}

/** Pure: the toasts to show for a fresh read of the log. `knownIds` is what the
 * dashboard had already seen, or null on the first read, when nothing is shown
 * (old activity is not news). Undos are skipped: one done from the panel shows
 * its own toast, and an undo done by the agent is in the panel. A burst is
 * capped, ending with a count of the rest. Oldest first. */
export function newActivityToasts(
  knownIds: ReadonlySet<string> | null,
  entriesNewestFirst: ActivityEntry[],
): string[] {
  if (knownIds === null) return [];
  const fresh = entriesNewestFirst.filter((e) => !knownIds.has(e.id) && e.tool !== 'undo').reverse();
  if (fresh.length <= MAX_ACTIVITY_TOASTS) return fresh.map(toastMessageFor);
  const shown = fresh.slice(0, MAX_ACTIVITY_TOASTS - 1).map(toastMessageFor);
  const rest = fresh.length - shown.length;
  return [...shown, `Agent did ${rest} more things: see Agent activity`];
}

/** One sentence for the user about what an undo did. */
export function describeUndoResult(result: UndoResult): string {
  switch (result.undid) {
    case 'archive': {
      const back = result.reopen.restored + result.reopen.reopened;
      const failed =
        result.reopen.failed > 0 ? `; ${result.reopen.failed} could not be reopened and stayed archived` : '';
      return `Reopened ${plural(back, 'tab', 'tabs')} and took ${back === 1 ? 'it' : 'them'} out of the archive${failed}`;
    }
    case 'close': {
      const back = result.reopen.restored + result.reopen.reopened;
      const failed = result.reopen.failed > 0 ? `; ${result.reopen.failed} could not be reopened` : '';
      return `Reopened ${plural(back, 'tab', 'tabs')}${failed}`;
    }
    case 'triage': {
      const back = result.reopen.restored + result.reopen.reopened;
      const undone: string[] = [];
      if (result.removedFromArchived) undone.push(`${plural(result.removedFromArchived, 'tab', 'tabs')} out of the archive`);
      if (result.removedFromSnapshots) undone.push(`${plural(result.removedFromSnapshots, 'tab', 'tabs')} out of snapshots`);
      if (result.deletedSnapshots) undone.push(`${plural(result.deletedSnapshots, 'new snapshot', 'new snapshots')} deleted`);
      if (result.keptSnapshots) undone.push(`${plural(result.keptSnapshots, 'new snapshot', 'new snapshots')} kept`);
      const took = undone.length > 0 ? ` and took back what the plan saved (${undone.join(', ')})` : '';
      const failed = result.reopen.failed > 0 ? `; ${result.reopen.failed} could not be reopened` : '';
      return `Reopened ${plural(back, 'tab', 'tabs')}${took}${failed}`;
    }
    case 'removeFromSnapshot': {
      const changed = result.snapshotChangedSince ? ' (it had changed, so positions may differ)' : '';
      return `Put ${plural(result.restoredTabs, 'saved tab', 'saved tabs')} back in "${result.snapshot.name}"${changed}`;
    }
  }
}

/** Actions carrying the same request phrase stay in one group while they follow
 * each other within this long. */
export const SAME_REQUEST_GAP_MS = 60 * 60_000;
/** Actions with no request phrase are grouped as a burst: within this long of each other. */
export const UNLABELLED_GAP_MS = 15 * 60_000;

export interface ActivityGroup {
  /** The id of the group's newest entry. */
  id: string;
  /** What the user asked for, as the agent phrased it; null when it did not say. */
  request: string | null;
  /** Newest first. */
  entries: ActivityEntry[];
  newestAt: number;
  oldestAt: number;
}

const requestKey = (request: string | undefined) => (request ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Pure: sorts the log into what the user asked for, newest group first.
 * Entries with the same request phrase (ignoring case and spacing) that follow
 * each other within an hour belong together; an entry with no phrase joins only
 * other unlabelled ones within fifteen minutes. The same request made again
 * much later is a new group. */
export function groupActivity(entriesNewestFirst: ActivityEntry[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const entry of entriesNewestFirst) {
    const last = groups.at(-1);
    const key = requestKey(entry.request);
    const allowedGap = key === '' ? UNLABELLED_GAP_MS : SAME_REQUEST_GAP_MS;
    if (last && requestKey(last.request ?? undefined) === key && last.oldestAt - entry.at <= allowedGap) {
      last.entries.push(entry);
      last.oldestAt = entry.at;
    } else {
      groups.push({
        id: entry.id,
        request: entry.request ?? null,
        entries: [entry],
        newestAt: entry.at,
        oldestAt: entry.at,
      });
    }
  }
  return groups;
}
