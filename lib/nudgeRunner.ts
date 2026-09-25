import { DEFAULT_INACTIVITY_THRESHOLD_MS } from './importance';
import { getManagedTabIds } from './managedTabs';
import { findNudgeCandidates, type ScanTab } from './nudgeScan';
import { getSnoozedKeys, pruneExpiredSnoozes, snoozeKey } from './nudgeState';

export interface NudgeCandidate {
  id: number;
  title: string;
  url: string;
}

/**
 * Scans all open tabs and logs which ones are unimportant + not snoozed.
 * No popup yet (Slice N3) — this slice is scan-and-log only.
 *
 * `inactivityThresholdMs` is exposed so it can be lowered for manual
 * testing (e.g. `runNudgeScanNow(60_000)` to treat 1-minute-old tabs as
 * stale) without waiting for the real 24h threshold.
 */
export async function runNudgeScan(
  inactivityThresholdMs: number = DEFAULT_INACTIVITY_THRESHOLD_MS,
): Promise<NudgeCandidate[]> {
  const now = Date.now();
  await pruneExpiredSnoozes(now);

  const tabs = await browser.tabs.query({});
  const scanTabs: (ScanTab & { title: string; url: string })[] = tabs
    .filter((tab): tab is typeof tab & { id: number } => tab.id !== undefined)
    .map((tab) => ({
      id: tab.id,
      title: tab.title ?? '',
      url: tab.url ?? '',
      lastAccessed: tab.lastAccessed,
      pinned: tab.pinned,
      audible: tab.audible,
    }));

  const snoozedKeys = await getSnoozedKeys(now);
  const snoozedIds = new Set(
    scanTabs.filter((tab) => snoozedKeys.has(snoozeKey(tab.url))).map((tab) => tab.id),
  );

  // Tabs owned by a snapshot are never nudged: closing one would silently
  // drop it from the snapshot the next time the user presses Update.
  const managedIds = await getManagedTabIds();

  const candidateIds = new Set(
    findNudgeCandidates(
      scanTabs,
      (id) => snoozedIds.has(id) || managedIds.has(id),
      now,
      inactivityThresholdMs,
    ),
  );

  const candidates = scanTabs
    .filter((tab) => candidateIds.has(tab.id))
    .map(({ id, title, url }) => ({ id, title, url }));

  console.log(
    `[TabBuddy nudge] scanned ${scanTabs.length} tabs — ${candidates.length} candidate(s), ${snoozedIds.size} snoozed, ${managedIds.size} in snapshots`,
    candidates,
  );

  return candidates;
}
