export type TabImportance = 'important' | 'unimportant';

export interface ImportanceInput {
  lastAccessed?: number;
  pinned?: boolean;
  audible?: boolean;
}

export const DEFAULT_INACTIVITY_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Purely local heuristic: pinned or currently-audible tabs are always
 * "important" (the user has signaled intent to keep them). Otherwise a tab
 * is "unimportant" once it's gone untouched for longer than the threshold.
 * A missing lastAccessed (shouldn't normally happen for a real tab) is
 * treated as important — safer to under-nudge than over-nudge.
 */
export function scoreTabImportance(
  tab: ImportanceInput,
  now: number = Date.now(),
  inactivityThresholdMs: number = DEFAULT_INACTIVITY_THRESHOLD_MS,
): TabImportance {
  if (tab.pinned) return 'important';
  if (tab.audible) return 'important';
  if (tab.lastAccessed === undefined) return 'important';

  const inactiveFor = now - tab.lastAccessed;
  return inactiveFor >= inactivityThresholdMs ? 'unimportant' : 'important';
}
