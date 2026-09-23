const SNOOZE_KEY = 'nudgeSnoozes';
export const SNOOZE_DURATION_MS = 2 * 24 * 60 * 60 * 1000; // 2 days, flat from click

type SnoozeMap = Record<string, number>; // tabId (as string) -> snoozedUntil timestamp

async function getSnoozeMap(): Promise<SnoozeMap> {
  const result = await browser.storage.local.get(SNOOZE_KEY);
  return (result[SNOOZE_KEY] as SnoozeMap | undefined) ?? {};
}

export async function isTabSnoozed(tabId: number, now: number = Date.now()): Promise<boolean> {
  const map = await getSnoozeMap();
  const until = map[tabId];
  return until !== undefined && until > now;
}

/** Flat 2-day snooze from the moment this is called (i.e. from "No"). */
export async function snoozeTab(tabId: number, now: number = Date.now()): Promise<void> {
  const map = await getSnoozeMap();
  map[tabId] = now + SNOOZE_DURATION_MS;
  await browser.storage.local.set({ [SNOOZE_KEY]: map });
}

export async function clearSnooze(tabId: number): Promise<void> {
  const map = await getSnoozeMap();
  delete map[tabId];
  await browser.storage.local.set({ [SNOOZE_KEY]: map });
}

/** Drops expired entries so storage doesn't grow without bound. */
export async function pruneExpiredSnoozes(now: number = Date.now()): Promise<void> {
  const map = await getSnoozeMap();
  const pruned: SnoozeMap = {};
  for (const [tabId, until] of Object.entries(map)) {
    if (until > now) pruned[tabId] = until;
  }
  await browser.storage.local.set({ [SNOOZE_KEY]: pruned });
}
