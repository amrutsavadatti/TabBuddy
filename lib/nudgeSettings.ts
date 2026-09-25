export const NUDGE_ENABLED_KEY = 'nudgeEnabled';
export const NUDGE_INTERVAL_KEY = 'nudgeIntervalMinutes';
export const NUDGE_STALE_KEY = 'nudgeStaleMinutes';

export const DEFAULT_NUDGE_INTERVAL_MINUTES = 20;
export const DEFAULT_NUDGE_STALE_MINUTES = 24 * 60;

export async function getNudgeEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(NUDGE_ENABLED_KEY);
  const stored = result[NUDGE_ENABLED_KEY];
  return stored === undefined ? true : Boolean(stored);
}

export async function setNudgeEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [NUDGE_ENABLED_KEY]: enabled });
}

async function getPositiveNumber(key: string, fallback: number): Promise<number> {
  const result = await browser.storage.local.get(key);
  const stored = result[key];
  return typeof stored === 'number' && stored > 0 ? stored : fallback;
}

export function getNudgeIntervalMinutes(): Promise<number> {
  return getPositiveNumber(NUDGE_INTERVAL_KEY, DEFAULT_NUDGE_INTERVAL_MINUTES);
}

export async function setNudgeIntervalMinutes(minutes: number): Promise<void> {
  await browser.storage.local.set({ [NUDGE_INTERVAL_KEY]: minutes });
}

export function getNudgeStaleMinutes(): Promise<number> {
  return getPositiveNumber(NUDGE_STALE_KEY, DEFAULT_NUDGE_STALE_MINUTES);
}

export async function setNudgeStaleMinutes(minutes: number): Promise<void> {
  await browser.storage.local.set({ [NUDGE_STALE_KEY]: minutes });
}
