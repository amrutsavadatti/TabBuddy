import type { UndoResult } from '../bridge/protocol';
import { getActivity, markUndone, recordActivity, type UndoPayload } from './activityLog';
import { BridgeFailure } from './bridgeFailure';
import { reopenTabs } from './reopenTabs';
import { getSnapshots, updateSnapshot } from './storage';

async function undoRemoval(payload: Extract<UndoPayload, { kind: 'removeFromSnapshot' }>): Promise<UndoResult> {
  const snapshot = (await getSnapshots()).find((s) => s.id === payload.snapshotId);
  if (!snapshot) {
    throw new BridgeFailure(
      'not_found',
      `"${payload.snapshotName}" no longer exists, so its removed tabs cannot be put back.`,
    );
  }
  // Put them back in ascending order of their original positions; a position
  // past the end (the snapshot shrank since) goes at the end.
  const tabs = [...snapshot.tabs];
  for (const { index, tab } of [...payload.removed].sort((a, b) => a.index - b.index)) {
    tabs.splice(Math.min(index, tabs.length), 0, tab);
  }
  await updateSnapshot(snapshot.id, { tabs, updatedAt: Date.now() });
  return {
    action: 'undo',
    undid: 'removeFromSnapshot',
    restoredTabs: payload.removed.length,
    snapshot: { id: snapshot.id, name: snapshot.name, tabCount: tabs.length },
    snapshotChangedSince: snapshot.updatedAt !== payload.snapshotUpdatedAfter,
  };
}

async function undoClose(payload: Extract<UndoPayload, { kind: 'close' }>): Promise<UndoResult> {
  const { succeeded, ...reopen } = await reopenTabs(payload.tabs);
  if (payload.tabs.length > 0 && succeeded.length === 0) {
    throw new BridgeFailure('internal', 'None of the closed tabs could be reopened.');
  }
  return { action: 'undo', undid: 'close', reopen };
}

async function undoArchive(payload: Extract<UndoPayload, { kind: 'archive' }>): Promise<UndoResult> {
  const { succeeded, ...reopen } = await reopenTabs(payload.tabs);
  if (payload.tabs.length > 0 && succeeded.length === 0) {
    throw new BridgeFailure('internal', 'None of the archived tabs could be reopened, so they were left in the archive.');
  }

  // Take back only what was archived, and only for tabs that really came back,
  // so a tab that failed to reopen is never lost. Newest matching entry first.
  let removedFromArchived = 0;
  const archived = (await getSnapshots()).find((s) => s.id === payload.archivedSnapshotId);
  if (archived) {
    const tabs = [...archived.tabs];
    for (const tab of succeeded) {
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (tabs[i]!.url === tab.url) {
          tabs.splice(i, 1);
          removedFromArchived += 1;
          break;
        }
      }
    }
    if (removedFromArchived > 0) await updateSnapshot(archived.id, { tabs, updatedAt: Date.now() });
  }
  return { action: 'undo', undid: 'archive', reopen, removedFromArchived };
}

/** Reverses one confirmed action from the activity log, once. If it cannot be
 * reversed the entry is left as it was, so it can be tried again. */
export async function undoActivity(undoId: unknown): Promise<UndoResult> {
  if (typeof undoId !== 'string' || undoId === '') {
    throw new BridgeFailure('invalid_params', 'undoId must be the undoId a confirm_proposal result gave, or an id from get_agent_activity.');
  }
  const entry = await getActivity(undoId);
  if (!entry) {
    throw new BridgeFailure('not_found', 'No activity with that id. Call get_agent_activity for current ones.');
  }
  if (entry.undone) {
    throw new BridgeFailure('invalid_params', `"${entry.summary}" has already been undone.`);
  }
  if (!entry.undo) {
    throw new BridgeFailure(
      'invalid_params',
      `"${entry.summary}" cannot be undone: only archiving, closing and removing saved tabs can be, and only the 20 most recent.`,
    );
  }

  const payload = entry.undo;
  const result =
    payload.kind === 'removeFromSnapshot'
      ? await undoRemoval(payload)
      : payload.kind === 'close'
        ? await undoClose(payload)
        : await undoArchive(payload);

  await markUndone(entry.id);
  try {
    await recordActivity({ tool: 'undo', summary: `Undid: ${entry.summary}` });
  } catch {
    // the undo itself worked; failing to log it must not hide that
  }
  return result;
}
