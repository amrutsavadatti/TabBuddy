import {
  MAX_PROPOSAL_TABS,
  MAX_TITLE_LENGTH,
  type ConfirmProposalResult,
  type ProposalResult,
  type ProposalTab,
  type ProposeArchiveTabsParams,
} from '../bridge/protocol';
import { archiveTabs } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { resolveLazyTab } from './lazyTab';
import { getManagedTabIds } from './managedTabs';
import { pageKey } from './pageKey';
import { createProposal, takeProposal } from './proposals';
import { getSnapshots } from './storage';
import type { TriageTab } from './triage';

const NOT_OPEN = 'no open tab with that id (it may have been closed)';

function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

/** Pure: checks a proposeArchiveTabs request. */
export function parseProposeArchiveParams(params: unknown): { tabIds: number[]; includeProtected: boolean } {
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

/** Step one of two: works out what archiving these tabs would do, remembers it
 * for five minutes, and changes nothing. Tabs that cannot or should not be
 * archived are left out and listed with a reason. */
export async function proposeArchiveTabs(params: unknown): Promise<ProposalResult> {
  const { tabIds, includeProtected } = parseProposeArchiveParams(params);
  const [managedIds, snapshots] = await Promise.all([getManagedTabIds(), getSnapshots()]);

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
    if (pageKey(real.url ?? '') === null) {
      skipped.push({ tabId, reason: 'not a web page, so there is nothing worth archiving' });
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
    tabs.push({
      tabId,
      windowId: tab.windowId,
      title: truncateTitle(real.title || real.url!),
      url: real.url!,
    });
  }

  if (tabs.length === 0) {
    throw new BridgeFailure(
      'invalid_params',
      `None of those tabs can be archived: ${skipped.map((s) => `tab ${s.tabId} (${s.reason})`).join('; ')}`,
    );
  }

  const proposal = await createProposal({ kind: 'archive', tabs, includeProtected });
  return {
    proposalId: proposal.id,
    action: 'archive',
    summary: `Archive ${tabs.length} tab${tabs.length === 1 ? '' : 's'} into the Archived snapshot and close ${tabs.length === 1 ? 'it' : 'them'}.`,
    expiresAt: proposal.expiresAt,
    expiresInSeconds: Math.round((proposal.expiresAt - proposal.createdAt) / 1000),
    tabs,
    skipped,
  };
}

/** Step two of two. The proposal is used up first, so it can never run twice.
 * Every tab is then checked against what was proposed; if any is gone, points
 * at a different page, or has become one that must be left alone, nothing at
 * all is changed and the caller must propose again. Otherwise the tabs are
 * saved to the Archived snapshot, and only then closed. */
export async function confirmProposal(params: unknown): Promise<ConfirmProposalResult> {
  const { proposalId } = (params ?? {}) as { proposalId?: unknown };
  if (typeof proposalId !== 'string' || proposalId === '') {
    throw new BridgeFailure('invalid_params', 'proposalId must be the id returned by a propose_ tool.');
  }
  const proposal = await takeProposal(proposalId);
  const managedIds = await getManagedTabIds();

  const problems: string[] = [];
  const live: TriageTab[] = [];
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
    if (real.url !== proposed.url) {
      problems.push(`${label} now shows a different page`);
      continue;
    }
    if (!proposal.includeProtected) {
      const reason = protectionReason(tab, managedIds.has(tab.id) ? '' : null);
      if (reason !== null) {
        problems.push(`${label} is now ${reason === 'pinned' ? 'pinned' : reason}`);
        continue;
      }
    }
    live.push({
      id: tab.id,
      url: real.url!,
      title: real.title || proposed.title,
      favIconUrl: real.favIconUrl,
      pinned: tab.pinned ?? false,
    });
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join('; ');
    const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
    throw new BridgeFailure(
      'tabs_changed',
      `Nothing was archived or closed: ${problems.length} of the ${proposal.tabs.length} tabs changed since the proposal. ${shown}${more}. Propose again with fresh tab ids.`,
    );
  }

  const done = await archiveTabs(live);
  return {
    action: 'archive',
    archived: live.length,
    closed: done.closed,
    archivedSnapshot: { id: done.snapshotId, tabCount: done.snapshotTabCount },
  };
}
