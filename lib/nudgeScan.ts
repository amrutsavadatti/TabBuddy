import {
  DEFAULT_INACTIVITY_THRESHOLD_MS,
  scoreTabImportance,
  type ImportanceInput,
} from './importance';

export interface ScanTab extends ImportanceInput {
  id: number;
}

/** Pure: which tab ids are unimportant and not currently snoozed. */
export function findNudgeCandidates(
  tabs: ScanTab[],
  isSnoozed: (tabId: number) => boolean,
  now: number = Date.now(),
  inactivityThresholdMs: number = DEFAULT_INACTIVITY_THRESHOLD_MS,
): number[] {
  return tabs
    .filter((tab) => scoreTabImportance(tab, now, inactivityThresholdMs) === 'unimportant')
    .filter((tab) => !isSnoozed(tab.id))
    .map((tab) => tab.id);
}
