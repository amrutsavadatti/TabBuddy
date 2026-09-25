// Snoozes are keyed by page address, not Chrome's tab id: tab ids reset when
// the browser restarts, which would drop a kept tab's snooze or apply it to an
// unrelated tab. (The old tab-id key is removed on the next prune.)
const SNOOZE_KEY = 'nudgeSnoozesByUrl';
const LEGACY_SNOOZE_KEY = 'nudgeSnoozes';
export const SNOOZE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days, flat from click

type SnoozeMap = Record<string, number>; // snooze key -> snoozedUntil timestamp

/** The address a snooze is remembered by. The #fragment is dropped so a page
 * that only changes its hash (single-page apps) keeps its snooze. */
export function snoozeKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

async function getSnoozeMap(): Promise<SnoozeMap> {
  const result = await browser.storage.local.get(SNOOZE_KEY);
  return (result[SNOOZE_KEY] as SnoozeMap | undefined) ?? {};
}

/** Addresses whose snooze is still running, read in one go for a whole scan. */
export async function getSnoozedKeys(now: number = Date.now()): Promise<Set<string>> {
  const map = await getSnoozeMap();
  return new Set(Object.entries(map).filter(([, until]) => until > now).map(([key]) => key));
}

export async function isUrlSnoozed(url: string, now: number = Date.now()): Promise<boolean> {
  return (await getSnoozedKeys(now)).has(snoozeKey(url));
}

/** Flat 2-day snooze from the moment this is called (i.e. from "Keep"). Every
 * open tab on the same address is covered. */
export async function snoozeUrl(url: string, now: number = Date.now()): Promise<void> {
  if (!url) return;
  const map = await getSnoozeMap();
  map[snoozeKey(url)] = now + SNOOZE_DURATION_MS;
  await browser.storage.local.set({ [SNOOZE_KEY]: map });
}

export async function clearSnooze(url: string): Promise<void> {
  const map = await getSnoozeMap();
  delete map[snoozeKey(url)];
  await browser.storage.local.set({ [SNOOZE_KEY]: map });
}

/** Drops expired entries so storage doesn't grow without bound, and removes
 * the obsolete tab-id snoozes from before they were keyed by address. */
export async function pruneExpiredSnoozes(now: number = Date.now()): Promise<void> {
  const map = await getSnoozeMap();
  const pruned: SnoozeMap = {};
  for (const [key, until] of Object.entries(map)) {
    if (until > now) pruned[key] = until;
  }
  await browser.storage.local.set({ [SNOOZE_KEY]: pruned });
  await browser.storage.local.remove(LEGACY_SNOOZE_KEY);
}
