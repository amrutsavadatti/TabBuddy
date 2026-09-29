import {
  MAX_TRIAGE_TABS,
  type ConfirmTriageResult,
  type ProposalTab,
  type TriagePlanParams,
  type TriagePlanResult,
  type TriageStepResult,
} from '../bridge/protocol';
import { parseRequest } from './agentRequest';
import { parseSnapshotName } from './agentSave';
import { findOrCreateCategories, parseCategoryNames } from './agentSnapshots';
import type { UndoPayload } from './activityLog';
import { isArchivedSnapshot, saveToArchive } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { getManagedTabIds } from './managedTabs';
import { getUniqueName } from './names';
import { pageKey } from './pageKey';
import { asClosed, inspectTab, plural, recheckTabs, record, type LiveTab } from './proposalChecks';
import { createProposal, type TriageProposal, type TriageStep } from './proposals';
import { addSnapshot, deleteSnapshots, getSnapshots, updateSnapshot } from './storage';
import { tabToSnapshotTab } from './triage';
import type { Snapshot, SnapshotTab } from './types';

export interface ParsedTriage {
  close: number[];
  archive: number[];
  fileInto: { id: string; tabIds: number[] }[];
  newSnapshots: { name: string; tabIds: number[]; categoryNames: string[] }[];
  windowId: number | undefined;
  includeProtected: boolean;
}

function tabIdList(value: unknown, field: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'number' || !Number.isInteger(id))) {
    throw new BridgeFailure(
      'invalid_params',
      `${field} must be a list of tab ids from list_open_windows, search_tabs or summarize_window.`,
    );
  }
  return [...new Set(value as number[])];
}

/** Pure: checks a triage plan. Every tab may be in only one bucket, whichever
 * bucket that is, and the plan may name at most MAX_TRIAGE_TABS tabs in all. */
export function parseTriageParams(params: unknown): ParsedTriage {
  const p = (params ?? {}) as Partial<TriagePlanParams>;

  const close = tabIdList(p.close, 'close');
  const archive = tabIdList(p.archive, 'archive');

  if (p.fileInto !== undefined && !Array.isArray(p.fileInto)) {
    throw new BridgeFailure('invalid_params', 'fileInto must be a list of {id, tabIds}, one per snapshot.');
  }
  const filed = new Map<string, number[]>();
  for (const entry of p.fileInto ?? []) {
    if (!entry || typeof entry.id !== 'string' || entry.id === '') {
      throw new BridgeFailure('invalid_params', 'Each fileInto entry needs the id of a snapshot, from list_snapshots.');
    }
    const ids = tabIdList(entry.tabIds, `fileInto tabIds for snapshot ${entry.id}`);
    filed.set(entry.id, [...new Set([...(filed.get(entry.id) ?? []), ...ids])]);
  }
  const fileInto = [...filed].map(([id, tabIds]) => ({ id, tabIds })).filter((e) => e.tabIds.length > 0);

  if (p.newSnapshots !== undefined && !Array.isArray(p.newSnapshots)) {
    throw new BridgeFailure('invalid_params', 'newSnapshots must be a list of {name, tabIds}, one per new snapshot.');
  }
  const newSnapshots = (p.newSnapshots ?? [])
    .map((entry) => {
      if (!entry) throw new BridgeFailure('invalid_params', 'Each newSnapshots entry needs a name and tabIds.');
      return {
        name: parseSnapshotName(entry.name),
        tabIds: tabIdList(entry.tabIds, `newSnapshots tabIds for "${entry.name}"`),
        categoryNames: parseCategoryNames(entry.categoryNames),
      };
    })
    .filter((e) => e.tabIds.length > 0);

  // One tab, one bucket.
  const placed = new Map<number, string>();
  const conflicts: string[] = [];
  const place = (ids: number[], label: string) => {
    for (const id of ids) {
      const earlier = placed.get(id);
      if (earlier === undefined) placed.set(id, label);
      else conflicts.push(`tab ${id} is in both ${earlier} and ${label}`);
    }
  };
  place(close, 'close');
  place(archive, 'archive');
  for (const e of fileInto) place(e.tabIds, `fileInto ${e.id}`);
  for (const e of newSnapshots) place(e.tabIds, `the new snapshot "${e.name}"`);
  if (conflicts.length > 0) {
    throw new BridgeFailure(
      'invalid_params',
      `Each tab can go in only one bucket, but ${conflicts.slice(0, 5).join('; ')}${conflicts.length > 5 ? `; and ${conflicts.length - 5} more` : ''}.`,
    );
  }

  if (placed.size === 0) {
    throw new BridgeFailure(
      'invalid_params',
      'The plan is empty: give tab ids in at least one of close, archive, fileInto or newSnapshots.',
    );
  }
  if (placed.size > MAX_TRIAGE_TABS) {
    throw new BridgeFailure('invalid_params', `A plan can cover at most ${MAX_TRIAGE_TABS} tabs; this one has ${placed.size}.`);
  }
  if (p.windowId !== undefined && (typeof p.windowId !== 'number' || !Number.isInteger(p.windowId))) {
    throw new BridgeFailure('invalid_params', 'windowId must be a window id from list_open_windows.');
  }
  if (p.includeProtected !== undefined && typeof p.includeProtected !== 'boolean') {
    throw new BridgeFailure('invalid_params', 'includeProtected must be true or false.');
  }
  return { close, archive, fileInto, newSnapshots, windowId: p.windowId, includeProtected: p.includeProtected === true };
}

const NOT_SAVABLE = 'not a web page, so it cannot be saved';

/** Step one of two: checks every tab in every bucket, remembers the plan for
 * five minutes, and changes nothing. A tab that cannot or should not be touched
 * is left out and listed; a bucket left with no tabs disappears. */
export async function proposeTriagePlan(params: unknown): Promise<TriagePlanResult> {
  const plan = parseTriageParams(params);
  const [managedIds, snapshots] = await Promise.all([getManagedTabIds(), getSnapshots()]);
  const ownPages = browser.runtime.getURL('/' as never);

  // Target snapshots first: a wrong id should fail before any tab is looked at.
  const names = new Map<string, string>();
  for (const entry of plan.fileInto) {
    const target = snapshots.find((s) => s.id === entry.id);
    if (!target) {
      throw new BridgeFailure('not_found', `No snapshot with id ${entry.id}. Call list_snapshots for current ids.`);
    }
    if (isArchivedSnapshot(target)) {
      throw new BridgeFailure('invalid_params', 'The Archived snapshot is filled with the archive bucket, not fileInto.');
    }
    names.set(entry.id, target.name);
  }

  const skipped: TriagePlanResult['skipped'] = [];
  const inspect = async (tabIds: number[], saves: boolean): Promise<ProposalTab[]> => {
    const tabs: ProposalTab[] = [];
    for (const tabId of tabIds) {
      const checked = await inspectTab(tabId, {
        requireWeb: saves,
        notWebReason: NOT_SAVABLE,
        includeProtected: plan.includeProtected,
        managedIds,
        snapshots,
        ownPages,
      });
      if ('skip' in checked) skipped.push({ tabId, reason: checked.skip });
      else tabs.push(checked.tab);
    }
    return tabs;
  };

  const steps: TriageStep[] = [];
  const closeTabs = await inspect(plan.close, false);
  if (closeTabs.length > 0) steps.push({ action: 'close', tabs: closeTabs });
  const archiveTabsList = await inspect(plan.archive, true);
  if (archiveTabsList.length > 0) steps.push({ action: 'archive', tabs: archiveTabsList });
  for (const entry of plan.fileInto) {
    const tabs = await inspect(entry.tabIds, true);
    if (tabs.length > 0) steps.push({ action: 'fileInto', snapshotId: entry.id, snapshotName: names.get(entry.id)!, tabs });
  }
  for (const entry of plan.newSnapshots) {
    const tabs = await inspect(entry.tabIds, true);
    if (tabs.length > 0) steps.push({ action: 'newSnapshot', name: entry.name, categoryNames: entry.categoryNames, tabs });
  }

  if (steps.length === 0) {
    throw new BridgeFailure(
      'invalid_params',
      `None of those tabs can be triaged: ${skipped.map((s) => `tab ${s.tabId} (${s.reason})`).join('; ')}`,
    );
  }

  const planned = steps.flatMap((s) => s.tabs);
  const totals = { close: 0, archive: 0, fileInto: 0, newSnapshot: 0 };
  for (const step of steps) totals[step.action] += step.tabs.length;

  let leftOpen: number | null = null;
  if (plan.windowId !== undefined) {
    const inWindow = (await browser.tabs.query({ windowId: plan.windowId })).filter(
      (t) => !t.incognito && !(t.url ?? '').startsWith(ownPages),
    );
    leftOpen = inWindow.length - planned.filter((t) => t.windowId === plan.windowId).length;
  }

  const proposal = await createProposal({
    kind: 'triage',
    steps,
    includeProtected: plan.includeProtected,
    request: parseRequest(params),
  });

  const parts: string[] = [];
  if (totals.close) parts.push(`close ${plural(totals.close, 'tab', 'tabs')} without saving`);
  if (totals.archive) parts.push(`archive ${plural(totals.archive, 'tab', 'tabs')}`);
  for (const step of steps) {
    if (step.action === 'fileInto') parts.push(`add ${plural(step.tabs.length, 'tab', 'tabs')} to "${step.snapshotName}"`);
    if (step.action === 'newSnapshot') parts.push(`save ${plural(step.tabs.length, 'tab', 'tabs')} as the new snapshot "${step.name}"`);
  }
  const summary =
    `${parts[0]!.charAt(0).toUpperCase()}${parts.join(', ').slice(1)}. Everything is saved first, then all ` +
    `${plural(planned.length, 'tab', 'tabs')} ${planned.length === 1 ? 'is' : 'are'} closed` +
    (leftOpen === null ? '.' : `; ${plural(leftOpen, 'tab', 'tabs')} stay${leftOpen === 1 ? 's' : ''} open.`);

  return {
    proposalId: proposal.id,
    action: 'triage',
    summary,
    expiresAt: proposal.expiresAt,
    expiresInSeconds: Math.round((proposal.expiresAt - proposal.createdAt) / 1000),
    steps: steps.map((step): TriageStepResult => {
      if (step.action === 'fileInto') {
        return { action: 'fileInto', snapshot: { id: step.snapshotId, name: step.snapshotName }, tabs: step.tabs };
      }
      return step;
    }),
    totals,
    leftOpen,
    skipped,
  };
}

// ---- confirming ----

interface Rollback {
  createdSnapshotIds: string[];
  /** Snapshots that were added to, with what they held before, oldest first. */
  restore: { id: string; tabs: SnapshotTab[]; updatedAt: number }[];
}

/** Undoes the saving done so far, best effort, when a later step failed. */
async function rollBack(rollback: Rollback): Promise<void> {
  for (const id of rollback.createdSnapshotIds) {
    try {
      await deleteSnapshots([id]);
    } catch {
      // nothing more can be done
    }
  }
  for (const item of [...rollback.restore].reverse()) {
    try {
      await updateSnapshot(item.id, { tabs: item.tabs, updatedAt: item.updatedAt });
    } catch {
      // nothing more can be done
    }
  }
}

/** Step two of two for a triage plan. Every tab is checked again first, and the
 * snapshots to file into must still exist; if anything changed, nothing is
 * touched. Then in two phases: first all the saving (new snapshots, tabs added
 * to existing ones, the archive), undone again if any of it fails, and only
 * then the closing of every tab. One activity entry, and one undo, covers all
 * of it. */
export async function confirmTriage(proposal: TriageProposal): Promise<ConfirmTriageResult> {
  const live = await recheckTabs(
    proposal.steps.flatMap((step) => step.tabs),
    proposal.includeProtected,
    'changed',
  );
  const liveById = new Map(live.map((tab) => [tab.id, tab]));
  const liveOf = (tabs: ProposalTab[]): LiveTab[] => tabs.map((t) => liveById.get(t.tabId)!);

  const existing = await getSnapshots();
  for (const step of proposal.steps) {
    if (step.action !== 'fileInto') continue;
    const target = existing.find((s) => s.id === step.snapshotId);
    if (!target || isArchivedSnapshot(target)) {
      throw new BridgeFailure(
        'tabs_changed',
        `Nothing was changed: "${step.snapshotName}" no longer exists. Call list_snapshots and propose again.`,
      );
    }
  }

  const rollback: Rollback = { createdSnapshotIds: [], restore: [] };
  const filed: ConfirmTriageResult['filed'] = [];
  const created: ConfirmTriageResult['created'] = [];
  const undoAppended: Extract<UndoPayload, { kind: 'triage' }>['appended'] = [];
  const undoCreated: Extract<UndoPayload, { kind: 'triage' }>['created'] = [];
  let undoArchive: Extract<UndoPayload, { kind: 'triage' }>['archive'] = null;
  let archived = 0;

  // Phase one: save everything. Nothing has been closed yet.
  try {
    for (const step of proposal.steps) {
      if (step.action === 'newSnapshot') {
        const categories = await findOrCreateCategories(step.categoryNames);
        const now = Date.now();
        const snapshot: Snapshot = {
          id: crypto.randomUUID(),
          name: getUniqueName(step.name, (await getSnapshots()).map((s) => s.name)),
          tabs: liveOf(step.tabs).map(tabToSnapshotTab),
          tabGroups: [],
          linkedWindowId: null,
          categoryIds: categories.map((c) => c.id),
          usageCount: 0,
          pinned: false,
          pinnedPosition: null,
          createdAt: now,
          updatedAt: now,
        };
        await addSnapshot(snapshot);
        rollback.createdSnapshotIds.push(snapshot.id);
        created.push({ snapshotId: snapshot.id, name: snapshot.name, tabCount: snapshot.tabs.length });
        undoCreated.push({
          snapshotId: snapshot.id,
          name: snapshot.name,
          updatedAfter: snapshot.updatedAt,
          urls: snapshot.tabs.map((t) => t.url),
        });
      } else if (step.action === 'fileInto') {
        const target = (await getSnapshots()).find((s) => s.id === step.snapshotId)!;
        const have = new Set(target.tabs.flatMap((t) => (pageKey(t.url) === null ? [] : [pageKey(t.url)!])));
        const fresh: LiveTab[] = [];
        let alreadyThere = 0;
        for (const tab of liveOf(step.tabs)) {
          const key = pageKey(tab.url);
          if (key !== null && have.has(key)) {
            alreadyThere += 1;
          } else {
            if (key !== null) have.add(key);
            fresh.push(tab);
          }
        }
        if (fresh.length > 0) {
          rollback.restore.push({ id: target.id, tabs: target.tabs, updatedAt: target.updatedAt });
          await updateSnapshot(target.id, {
            tabs: [...target.tabs, ...fresh.map(tabToSnapshotTab)],
            updatedAt: Date.now(),
          });
        }
        filed.push({ snapshotId: target.id, name: target.name, added: fresh.length, alreadyThere });
        if (fresh.length > 0) {
          undoAppended.push({ snapshotId: target.id, snapshotName: target.name, urls: fresh.map((t) => t.url) });
        }
      } else if (step.action === 'archive') {
        const tabs = liveOf(step.tabs);
        const saved = await saveToArchive(tabs);
        rollback.restore.push({ id: saved.snapshotId, ...saved.previous });
        archived += tabs.length;
        undoArchive = { archivedSnapshotId: saved.snapshotId, urls: tabs.map((t) => t.url) };
      }
    }
  } catch (error) {
    await rollBack(rollback);
    throw error;
  }

  // Phase two: everything is saved, so close every tab in the plan.
  const closedTabs: LiveTab[] = [];
  for (const tab of live) {
    try {
      await browser.tabs.remove(tab.id);
      closedTabs.push(tab);
    } catch {
      // already closed by the user in the meantime: fine either way
    }
  }

  const bits: string[] = [];
  const closeOnly = proposal.steps.filter((s) => s.action === 'close').reduce((n, s) => n + s.tabs.length, 0);
  if (closeOnly) bits.push(`closed ${closeOnly}`);
  if (archived) bits.push(`archived ${archived}`);
  const addedTotal = filed.reduce((n, f) => n + f.added, 0);
  if (filed.length) bits.push(`added ${addedTotal} to ${plural(filed.length, 'snapshot', 'snapshots')}`);
  if (created.length) bits.push(`saved ${plural(created.length, 'new snapshot', 'new snapshots')}`);
  const undoId = await record(
    `Triaged ${plural(live.length, 'tab', 'tabs')} (${bits.join(', ')})`,
    { kind: 'triage', closed: closedTabs.map(asClosed), archive: undoArchive, appended: undoAppended, created: undoCreated },
    proposal.request,
  );

  return { action: 'triage', undoId, closed: closedTabs.length, archived, filed, created };
}
