import { CATEGORIES_KEY } from './categories';
import { LAZY_RESTORE_KEY } from './lazyRestore';
import { NUDGE_ENABLED_KEY, NUDGE_INTERVAL_KEY, NUDGE_STALE_KEY } from './nudgeSettings';
import { PEEK_STORAGE_KEY } from './peek';
import { normalizeSnapshots, SNAPSHOTS_KEY } from './storage';
import type { Category, Snapshot } from './types';

const SETTINGS_KEYS = [
  PEEK_STORAGE_KEY,
  LAZY_RESTORE_KEY,
  NUDGE_ENABLED_KEY,
  NUDGE_INTERVAL_KEY,
  NUDGE_STALE_KEY,
];

export interface LiveChange {
  snapshots?: Snapshot[];
  categories?: Category[];
  /** True when any dashboard setting changed and should be re-read. */
  settings: boolean;
}

/** Turns a `storage.onChanged` event into what the open dashboard should
 * refresh, or null if nothing it shows changed. Uses the event's own new
 * values so there is no extra read that could race with another write. */
export function interpretStorageChange(
  changes: Record<string, { newValue?: unknown }>,
  area: string,
): LiveChange | null {
  if (area !== 'local') return null;

  const result: LiveChange = { settings: SETTINGS_KEYS.some((key) => key in changes) };
  if (SNAPSHOTS_KEY in changes) {
    result.snapshots = normalizeSnapshots(changes[SNAPSHOTS_KEY]!.newValue);
  }
  if (CATEGORIES_KEY in changes) {
    const raw = changes[CATEGORIES_KEY]!.newValue;
    result.categories = Array.isArray(raw) ? (raw as Category[]) : [];
  }

  return result.snapshots || result.categories || result.settings ? result : null;
}
