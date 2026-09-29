import {
  MAX_PROPOSAL_TABS,
  MAX_TITLE_LENGTH,
  type ConfirmProposalResult,
  type ProposalResult,
  type ProposalTab,
  type ProposeArchiveTabsParams,
  type ProposeRemoveFromSnapshotParams,
  type SnapshotEditProposalResult,
} from '../bridge/protocol';
import { recordActivity, slimTab, type ClosedTab, type UndoPayload } from './activityLog';
import { parseRequest } from './agentRequest';
import { archiveTabs } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { resolveLazyTab } from './lazyTab';
import { getManagedTabIds } from './managedTabs';
import { pageKey } from './pageKey';
import { createProposal, takeProposal, type RemoveFromSnapshotProposal, type TabProposal } from './proposals';
import { getSnapshots, updateSnapshot } from './storage';
import type { TriageTab } from './triage';

const NOT_OPEN = 'no open tab with that id (it may have been closed)';

/** A tab that passed the re-check, with what undo will need later. */
type LiveTab = TriageTab & { rawUrl: string; windowId: number };

/** Writes the activity entry for a confirmed action. The action has already
 * happened, so a failure to log it must not turn into a failure to report it:
 * undoId is then null. */
async function record(summary: string, undo: UndoPayload, request?: string): Promise<string | null> {
  try {
    return await recordActivity({ tool: 'confirm_proposal', summary, undo, request });
  } catch {
    return null;
  }
}

const asClosed = (tab: LiveTab): ClosedTab => ({
  url: tab.url,
  rawUrl: tab.rawUrl,
  title: tab.title,
  pinned: tab.pinned ?? false,
  windowId: tab.windowId,
});

function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Pure: checks a request to archive or close open tabs. */
export function parseProposeTabsParams(params: unknown): { tabIds: number[]; includeProtected: boolean } {
  const p = (params ?? {}) as Partial<ProposeArchiveTabsParams>;
  if (
    !Array.isArray(p.tabIds) ||
    p.tabIds.length === 0 ||
    p.tabIds.some((id) => typeof id !== 'number' || !Number.isInteger(id))
  ) {
    throw new BridgeFailure(
      'invalid_params',
      'tabIds must be a non-empty list of tab ids from list_open_windows, search_tabs or summarize_window.',
    );
  }
  const tabIds = [...new Set(p.tabIds)];
  if (tabIds.length > MAX_PROPOSAL_TABS) {
    throw new BridgeFailure('invalid_params', `Propose at most ${MAX_PROPOSAL_TABS} tabs at a time.`);
  }
  if (p.includeProtected !== undefined && typeof p.includeProtected !== 'boolean') {
    throw new BridgeFailure('invalid_params', 'includeProtected must be true or false.');
  }
  return { tabIds, includeProtected: p.includeProtected === true };
}
export const parseProposeArchiveParams = parseProposeTabsParams;

/** Pure: why a tab is left alone unless the user explicitly asked for it. The
 * nudges leave these tabs alone too: the user pinned them, is using them, or a
 * snapshot owns them (closing one would quietly drop it from that snapshot). */
export function protectionReason(
  tab: { pinned?: boolean; audible?: boolean },
  ownedBySnapshot: string | null | undefined,
): string | null {
  if (tab.pinned) return 'pinned';
  if (tab.audible) return 'playing sound';
  if (ownedBySnapshot !== undefined && ownedBySnapshot !== null) {
    return ownedBySnapshot === ''
      ? "part of a snapshot's open window"
      : `part of the open window of the snapshot "${ownedBySnapshot}"`;
  }
  return null;
}

/** Step one of two for open tabs: works out what archiving (or closing) them
 * would do, remembers it for five minutes, and changes nothing. Tabs that
 * cannot or should not be touched are left out and listed with a reason.
 * Archiving needs a real web page; closing may also take blank and other
 * browser pages, but never TabBuddy's own. */
async function proposeTabs(action: 'archive' | 'close', params: unknown): Promise<ProposalResult> {
  const { tabIds, includeProtected } = parseProposeTabsParams(params);
  const [managedIds, snapshots] = await Promise.all([getManagedTabIds(), getSnapshots()]);
  const ownPages = browser.runtime.getURL('/' as never);

  const tabs: ProposalTab[] = [];
  const skipped: ProposalResult['skipped'] = [];
  for (const tabId of tabIds) {
    let tab;
    try {
      tab = await browser.tabs.get(tabId);
    } catch {
      tab = undefined;
    }
    // A private tab is reported exactly like a closed one: the bridge never touches it.
    if (!tab || tab.incognito || tab.id === undefined || tab.windowId === undefined) {
      skipped.push({ tabId, reason: NOT_OPEN });
      continue;
    }
    const real = resolveLazyTab(tab);
    const url = real.url ?? '';
    if (action === 'archive' && pageKey(url) === null) {
      skipped.push({ tabId, reason: 'not a web page, so there is nothing worth archiving' });
      continue;
    }
    if (url.startsWith(ownPages)) {
      skipped.push({ tabId, reason: "one of TabBuddy's own pages" });
      continue;
    }
    if (!includeProtected) {
      const owner = managedIds.has(tab.id)
        ? (snapshots.find((s) => s.linkedWindowId === tab.windowId)?.name ?? '')
        : null;
      const reason = protectionReason(tab, owner);
      if (reason !== null) {
        skipped.push({ tabId, reason: `${reason}, so it is left alone unless the user explicitly asks for it` });
        continue;
      }
    }
    tabs.push({ tabId, windowId: tab.windowId, title: truncateTitle(real.title || url || 'Untitled tab'), url });
  }

  const verb = action === 'archive' ? 'archived' : 'closed';
  if (tabs.length === 0) {
    throw new BridgeFailure(
      'invalid_params',
      `None of those tabs can be ${verb}: ${skipped.map((s) => `tab ${s.tabId} (${s.reason})`).join('; ')}`,
    );
  }

  const proposal = await createProposal({ kind: action, tabs, includeProtected, request: parseRequest(params) });
  const many = tabs.length !== 1;
  return {
    proposalId: proposal.id,
    action,
    summary:
      action === 'archive'
        ? `Archive ${plural(tabs.length, 'tab', 'tabs')} into the Archived snapshot and close ${many ? 'them' : 'it'}.`
        : `Close ${plural(tabs.length, 'tab', 'tabs')} WITHOUT saving ${many ? 'them' : 'it'} anywhere.`,
    expiresAt: proposal.expiresAt,
    expiresInSeconds: Math.round((proposal.expiresAt - proposal.createdAt) / 1000),
    tabs,
    skipped,
  };
}

export const proposeArchiveTabs = (params: unknown) => proposeTabs('archive', params);
export const proposeCloseTabs = (params: unknown) => proposeTabs('close', params);

// ---- removing saved tabs from a snapshot ----

/** Pure: checks a request to remove saved tabs from a snapshot. */
export function parseProposeRemoveParams(params: unknown): { id: string; indexes: number[] } {
  const p = (params ?? {}) as Partial<ProposeRemoveFromSnapshotParams>;
  if (typeof p.id !== 'string' || p.id === '') {
    throw new BridgeFailure('invalid_params', 'id must be a snapshot id from list_snapshots.');
  }
  if (
    !Array.isArray(p.indexes) ||
    p.indexes.length === 0 ||
    p.indexes.some((i) => typeof i !== 'number' || !Number.isInteger(i))
  ) {
    throw new BridgeFailure(
      'invalid_params',
      'indexes must be a non-empty list of tab positions, as get_snapshot and search_tabs report them.',
    );
  }
  const indexes = [...new Set(p.indexes)];
  if (indexes.length > MAX_PROPOSAL_TABS) {
    throw new BridgeFailure('invalid_params', `Propose at most ${MAX_PROPOSAL_TABS} tabs at a time.`);
  }
  return { id: p.id, indexes };
}

/** Step one of two for saved tabs: which tabs would leave the snapshot, and
 * what it would hold afterwards. Positions shift whenever the snapshot changes,
 * so the proposal remembers when the snapshot was last updated. Nothing is
 * changed. It works on the Archived snapshot too (that is how you clear the
 * archive), and it never touches tabs open in the browser. */
export async function proposeRemoveFromSnapshot(params: unknown): Promise<SnapshotEditProposalResult> {
  const { id, indexes } = parseProposeRemoveParams(params);
  const snapshot = (await getSnapshots()).find((s) => s.id === id);
  if (!snapshot) {
    throw new BridgeFailure('not_found', 'No snapshot with that id. Call list_snapshots for current ids.');
  }

  const entries: RemoveFromSnapshotProposal['entries'] = [];
  const skipped: SnapshotEditProposalResult['skipped'] = [];
  for (const index of [...indexes].sort((a, b) => a - b)) {
    const tab = snapshot.tabs[index];
    if (!tab) {
      skipped.push({ index, reason: `no tab at that position (it holds ${plural(snapshot.tabs.length, 'tab', 'tabs')})` });
    } else {
      entries.push({ index, title: truncateTitle(tab.title || tab.url), url: tab.url });
    }
  }
  if (entries.length === 0) {
    throw new BridgeFailure(
      'invalid_params',
      `Nothing to remove from "${snapshot.name}": ${skipped.map((s) => `#${s.index} (${s.reason})`).join('; ')}`,
    );
  }

  const proposal = await createProposal({
    kind: 'removeFromSnapshot',
    snapshotId: snapshot.id,
    snapshotName: snapshot.name,
    snapshotUpdatedAt: snapshot.updatedAt,
    entries,
    request: parseRequest(params),
  });
  const left = snapshot.tabs.length - entries.length;
  return {
    proposalId: proposal.id,
    action: 'removeFromSnapshot',
    summary:
      `Remove ${plural(entries.length, 'saved tab', 'saved tabs')} from "${snapshot.name}" for good ` +
      `(it will hold ${plural(left, 'tab', 'tabs')}${left === 0 ? ', so it will be empty' : ''}).`,
    expiresAt: proposal.expiresAt,
    expiresInSeconds: Math.round((proposal.expiresAt - proposal.createdAt) / 1000),
    snapshot: { id: snapshot.id, name: snapshot.name, tabCount: snapshot.tabs.length },
    tabs: entries,
    skipped,
    snapshotIsOpen: snapshot.linkedWindowId !== null,
  };
}

// ---- confirming ----

/** Checks every proposed tab against what is open now, and returns the live
 * tabs. If any is gone, shows a different page, or has become one that must be
 * left alone, throws tabs_changed, and nothing has been touched. */
async function recheckTabs(proposal: TabProposal): Promise<LiveTab[]> {
  const managedIds = await getManagedTabIds();
  const problems: string[] = [];
  const live: LiveTab[] = [];
  for (const proposed of proposal.tabs) {
    const label = `"${truncateTitle(proposed.title).slice(0, 50)}"`;
    let tab;
    try {
      tab = await browser.tabs.get(proposed.tabId);
    } catch {
      tab = undefined;
    }
    if (!tab || tab.incognito || tab.id === undefined) {
      problems.push(`${label} was closed`);
      continue;
    }
    const real = resolveLazyTab(tab);
    if ((real.url ?? '') !== proposed.url) {
      problems.push(`${label} now shows a different page`);
      continue;
    }
    if (!proposal.includeProtected) {
      const reason = protectionReason(tab, managedIds.has(tab.id) ? '' : null);
      if (reason !== null) {
        problems.push(`${label} is now ${reason}`);
        continue;
      }
    }
    live.push({
      id: tab.id,
      url: real.url ?? '',
      title: real.title || proposed.title,
      favIconUrl: real.favIconUrl,
      pinned: tab.pinned ?? false,
      rawUrl: tab.url ?? '',
      windowId: proposed.windowId,
    });
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join('; ');
    const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
    const done = proposal.kind === 'archive' ? 'archived or closed' : 'closed';
    throw new BridgeFailure(
      'tabs_changed',
      `Nothing was ${done}: ${problems.length} of the ${proposal.tabs.length} tabs changed since the proposal. ${shown}${more}. Propose again with fresh tab ids.`,
    );
  }
  return live;
}

async function confirmRemoveFromSnapshot(proposal: RemoveFromSnapshotProposal): Promise<ConfirmProposalResult> {
  const snapshot = (await getSnapshots()).find((s) => s.id === proposal.snapshotId);
  if (!snapshot) {
    throw new BridgeFailure(
      'tabs_changed',
      `Nothing was removed: "${proposal.snapshotName}" no longer exists. Call list_snapshots and propose again.`,
    );
  }
  if (snapshot.updatedAt !== proposal.snapshotUpdatedAt) {
    throw new BridgeFailure(
      'tabs_changed',
      `Nothing was removed: "${snapshot.name}" was changed since the proposal, so the tab positions may have moved. Call get_snapshot and propose again.`,
    );
  }
  const drop = new Set(proposal.entries.map((e) => e.index));
  const removed = snapshot.tabs.flatMap((tab, index) => (drop.has(index) ? [{ index, tab: slimTab(tab) }] : []));
  const remaining = snapshot.tabs.filter((_, index) => !drop.has(index));
  const updatedAt = Date.now();
  await updateSnapshot(snapshot.id, { tabs: remaining, updatedAt });
  const undoId = await record(
    `Removed ${plural(removed.length, 'saved tab', 'saved tabs')} from "${snapshot.name}"`,
    { kind: 'removeFromSnapshot', snapshotId: snapshot.id, snapshotName: snapshot.name, snapshotUpdatedAfter: updatedAt, removed },
    proposal.request,
  );
  return {
    action: 'removeFromSnapshot',
    undoId,
    removed: removed.length,
    snapshot: { id: snapshot.id, name: snapshot.name, tabCount: remaining.length },
  };
}

/** Step two of two, for every kind of proposal. The proposal is used up first,
 * so it can never run twice. Everything is then checked against what was
 * proposed; if anything has changed, nothing at all is done and the caller must
 * propose again. Archived tabs are saved before they are closed. */
export async function confirmProposal(params: unknown): Promise<ConfirmProposalResult> {
  const { proposalId } = (params ?? {}) as { proposalId?: unknown };
  if (typeof proposalId !== 'string' || proposalId === '') {
    throw new BridgeFailure('invalid_params', 'proposalId must be the id returned by a propose_ tool.');
  }
  const proposal = await takeProposal(proposalId);

  if (proposal.kind === 'removeFromSnapshot') return confirmRemoveFromSnapshot(proposal);

  const live = await recheckTabs(proposal);
  if (proposal.kind === 'archive') {
    const done = await archiveTabs(live);
    const undoId = await record(`Archived ${plural(live.length, 'tab', 'tabs')}`, {
      kind: 'archive',
      archivedSnapshotId: done.snapshotId,
      tabs: live.map(asClosed),
    }, proposal.request);
    return {
      action: 'archive',
      undoId,
      archived: live.length,
      closed: done.closed,
      archivedSnapshot: { id: done.snapshotId, tabCount: done.snapshotTabCount },
    };
  }

  const closedTabs: LiveTab[] = [];
  for (const tab of live) {
    try {
      await browser.tabs.remove(tab.id);
      closedTabs.push(tab);
    } catch {
      // already closed by the user in the meantime: fine either way
    }
  }
  const undoId = await record(`Closed ${plural(closedTabs.length, 'tab', 'tabs')}`, {
    kind: 'close',
    tabs: closedTabs.map(asClosed),
  }, proposal.request);
  return { action: 'close', undoId, closed: closedTabs.length };
}
