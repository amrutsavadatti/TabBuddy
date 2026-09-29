import {
  MAX_STALE_TABS,
  type OpenWindow,
  type StaleTab,
  type StaleTabsResult,
} from '../bridge/protocol';
import { scoreTabImportance } from './importance';
import { findNudgeCandidates } from './nudgeScan';
import { snoozeKey } from './nudgeState';

export interface StaleOptions {
  openWindows: OpenWindow[];
  /** Addresses (see snoozeKey) whose snooze is still running. */
  snoozedKeys: ReadonlySet<string>;
  now: number;
  thresholdMs: number;
  limit?: number;
}

/** Pure: the open tabs TabBuddy's nudges would flag as stale, most stale
 * first. It uses the same rules as the nudges: pinned and playing tabs never
 * count, and neither do tabs in a snapshot's live window or tabs the user
 * chose to Keep. Those last two are counted in `skipped` so a short list can
 * be explained. */
export function findStaleTabs({
  openWindows,
  snoozedKeys,
  now,
  thresholdMs,
  limit = MAX_STALE_TABS,
}: StaleOptions): StaleTabsResult {
  const all = openWindows.flatMap((window) =>
    window.tabs.map((tab) => ({ windowId: window.windowId, tab })),
  );
  const byId = new Map(all.map((entry) => [entry.tab.id, entry]));
  const isSkipped = (id: number) => {
    const { tab } = byId.get(id)!;
    return tab.managed || snoozedKeys.has(snoozeKey(tab.url));
  };

  const staleIds = new Set(
    findNudgeCandidates(
      all.map(({ tab }) => ({
        id: tab.id,
        lastAccessed: tab.lastAccessed ?? undefined,
        pinned: tab.pinned,
        audible: tab.audible,
      })),
      isSkipped,
      now,
      thresholdMs,
    ),
  );

  const skipped = { managed: 0, snoozed: 0 };
  for (const entry of all) {
    const old =
      scoreTabImportance(
        {
          lastAccessed: entry.tab.lastAccessed ?? undefined,
          pinned: entry.tab.pinned,
          audible: entry.tab.audible,
        },
        now,
        thresholdMs,
      ) === 'unimportant';
    if (!old || staleIds.has(entry.tab.id)) continue;
    if (entry.tab.managed) skipped.managed += 1;
    else skipped.snoozed += 1;
  }

  const stale: StaleTab[] = all
    .filter(({ tab }) => staleIds.has(tab.id))
    .map(({ windowId, tab }) => ({
      windowId,
      tabId: tab.id,
      title: tab.title,
      url: tab.url,
      lastAccessed: tab.lastAccessed!,
      minutesSinceLastUse: Math.floor((now - tab.lastAccessed!) / 60_000),
    }))
    .sort((a, b) => a.lastAccessed - b.lastAccessed);

  return {
    olderThanMinutes: Math.round(thresholdMs / 60_000),
    tabs: stale.slice(0, limit),
    total: stale.length,
    truncated: stale.length > limit,
    skipped,
  };
}
