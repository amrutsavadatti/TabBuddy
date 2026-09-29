import {
  MAX_TRIAGE_TABS,
  type ProposalTab,
  type StartManualTriageParams,
  type StartManualTriageResult,
} from '../bridge/protocol';
import { BridgeFailure } from './bridgeFailure';
import { openTriageSession } from './dashboard';
import { inspectTab } from './proposalChecks';

/** Pure: checks a request to hand tabs to the user's one-by-one sorting screen. */
export function parseManualTriageParams(params: unknown): { tabIds: number[] } {
  const p = (params ?? {}) as Partial<StartManualTriageParams>;
  if (
    !Array.isArray(p.tabIds) ||
    p.tabIds.length === 0 ||
    p.tabIds.some((id) => typeof id !== 'number' || !Number.isInteger(id))
  ) {
    throw new BridgeFailure(
      'invalid_params',
      'tabIds must be a non-empty list of the tab ids you were unsure about, from list_open_windows or summarize_window.',
    );
  }
  const tabIds = [...new Set(p.tabIds)];
  if (tabIds.length > MAX_TRIAGE_TABS) {
    throw new BridgeFailure('invalid_params', `Hand over at most ${MAX_TRIAGE_TABS} tabs at a time.`);
  }
  return { tabIds };
}

/** Opens TabBuddy's one-by-one sorting screen for just these tabs, in the window
 * they are in, and brings it forward. The user decides each tab themselves; this
 * closes and saves nothing, and the rest of the window is left alone. Closed,
 * private and TabBuddy's own tabs are left out. Pinned and playing tabs are
 * included, because a person, not the agent, is making each call. */
export async function startManualTriage(params: unknown): Promise<StartManualTriageResult> {
  const { tabIds } = parseManualTriageParams(params);
  const ownPages = browser.runtime.getURL('/' as never);

  const accepted: ProposalTab[] = [];
  const skipped: StartManualTriageResult['skipped'] = [];
  for (const tabId of tabIds) {
    const checked = await inspectTab(tabId, {
      requireWeb: false,
      includeProtected: true,
      managedIds: new Set(),
      snapshots: [],
      ownPages,
    });
    if ('skip' in checked) skipped.push({ tabId, reason: checked.skip });
    else accepted.push(checked.tab);
  }

  if (accepted.length === 0) {
    throw new BridgeFailure(
      'invalid_params',
      `None of those tabs can be sorted: ${skipped.map((s) => `tab ${s.tabId} (${s.reason})`).join('; ')}`,
    );
  }
  const windows = [...new Set(accepted.map((t) => t.windowId))];
  if (windows.length > 1) {
    throw new BridgeFailure(
      'invalid_params',
      `Those tabs are in ${windows.length} different windows. The sorting screen works on one window at a time: hand over one window's tabs, then the next.`,
    );
  }

  const windowId = windows[0]!;
  await openTriageSession(windowId, accepted.map((t) => t.tabId));
  return { opened: true, windowId, tabCount: accepted.length, skipped };
}
