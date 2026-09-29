import { MAX_TITLE_LENGTH, type ProposalTab } from '../bridge/protocol';
import { recordActivity, type ClosedTab, type UndoPayload } from './activityLog';
import { BridgeFailure } from './bridgeFailure';
import { resolveLazyTab } from './lazyTab';
import { getManagedTabIds } from './managedTabs';
import { pageKey } from './pageKey';
import type { Snapshot } from './types';
import type { TriageTab } from './triage';

/** The per-tab checks shared by every proposal that touches open tabs: whether a
 * tab may be proposed at all, and whether it is still what was proposed when the
 * user confirms. */

export const NOT_OPEN = 'no open tab with that id (it may have been closed)';

/** A tab that passed the re-check, with what undo will need later. */
export type LiveTab = TriageTab & { rawUrl: string; windowId: number };

export function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const asClosed = (tab: LiveTab): ClosedTab => ({
  url: tab.url,
  rawUrl: tab.rawUrl,
  title: tab.title,
  pinned: tab.pinned ?? false,
  windowId: tab.windowId,
});

/** Writes the activity entry for a confirmed action. The action has already
 * happened, so a failure to log it must not turn into a failure to report it:
 * undoId is then null. */
export async function record(summary: string, undo: UndoPayload, request?: string): Promise<string | null> {
  try {
    return await recordActivity({ tool: 'confirm_proposal', summary, undo, request });
  } catch {
    return null;
  }
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

export interface InspectContext {
  /** True when the tab is going to be saved somewhere, so it must be a real web page. */
  requireWeb: boolean;
  /** What to say when a tab is not a web page and one is required. */
  notWebReason?: string;
  includeProtected: boolean;
  managedIds: ReadonlySet<number>;
  snapshots: Pick<Snapshot, 'name' | 'linkedWindowId'>[];
  /** The address prefix of TabBuddy's own pages, which are never touched. */
  ownPages: string;
}

/** May this tab be proposed? Either the tab as it will be shown to the user, or
 * the reason it is left out. A private tab is reported exactly like a closed
 * one: the bridge never touches it, and never reveals it. */
export async function inspectTab(
  tabId: number,
  ctx: InspectContext,
): Promise<{ tab: ProposalTab } | { skip: string }> {
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    tab = undefined;
  }
  if (!tab || tab.incognito || tab.id === undefined || tab.windowId === undefined) {
    return { skip: NOT_OPEN };
  }
  const real = resolveLazyTab(tab);
  const url = real.url ?? '';
  if (ctx.requireWeb && pageKey(url) === null) {
    return { skip: ctx.notWebReason ?? 'not a web page, so there is nothing worth archiving' };
  }
  if (url.startsWith(ctx.ownPages)) return { skip: "one of TabBuddy's own pages" };
  if (!ctx.includeProtected) {
    const owner = ctx.managedIds.has(tab.id)
      ? (ctx.snapshots.find((s) => s.linkedWindowId === tab.windowId)?.name ?? '')
      : null;
    const reason = protectionReason(tab, owner);
    if (reason !== null) return { skip: `${reason}, so it is left alone unless the user explicitly asks for it` };
  }
  return {
    tab: { tabId, windowId: tab.windowId, title: truncateTitle(real.title || url || 'Untitled tab'), url },
  };
}

/** Checks every proposed tab against what is open now, and returns the live
 * tabs. If any is gone, shows a different page, or has become one that must be
 * left alone, throws tabs_changed, and nothing has been touched. `nothingDone`
 * completes "Nothing was …" in the message. */
export async function recheckTabs(
  proposed: ProposalTab[],
  includeProtected: boolean,
  nothingDone: string,
): Promise<LiveTab[]> {
  const managedIds = await getManagedTabIds();
  const problems: string[] = [];
  const live: LiveTab[] = [];
  for (const item of proposed) {
    const label = `"${truncateTitle(item.title).slice(0, 50)}"`;
    let tab;
    try {
      tab = await browser.tabs.get(item.tabId);
    } catch {
      tab = undefined;
    }
    if (!tab || tab.incognito || tab.id === undefined) {
      problems.push(`${label} was closed`);
      continue;
    }
    const real = resolveLazyTab(tab);
    if ((real.url ?? '') !== item.url) {
      problems.push(`${label} now shows a different page`);
      continue;
    }
    if (!includeProtected) {
      const reason = protectionReason(tab, managedIds.has(tab.id) ? '' : null);
      if (reason !== null) {
        problems.push(`${label} is now ${reason}`);
        continue;
      }
    }
    live.push({
      id: tab.id,
      url: real.url ?? '',
      title: real.title || item.title,
      favIconUrl: real.favIconUrl,
      pinned: tab.pinned ?? false,
      rawUrl: tab.url ?? '',
      windowId: item.windowId,
    });
  }

  if (problems.length > 0) {
    const shown = problems.slice(0, 5).join('; ');
    const more = problems.length > 5 ? ` (and ${problems.length - 5} more)` : '';
    throw new BridgeFailure(
      'tabs_changed',
      `Nothing was ${nothingDone}: ${problems.length} of the ${proposed.length} tabs changed since the proposal. ${shown}${more}. Propose again with fresh tab ids.`,
    );
  }
  return live;
}
