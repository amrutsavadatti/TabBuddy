const NUDGE_ENABLED_KEY = 'nudgeEnabled';
export const NUDGE_INTERVAL_KEY = 'nudgeIntervalMinutes';

export const NUDGE_INTERVAL_OPTIONS_MINUTES = [5, 10, 20, 30, 60, 120] as const;
export const DEFAULT_NUDGE_INTERVAL_MINUTES = 20;

export async function getNudgeEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(NUDGE_ENABLED_KEY);
  const stored = result[NUDGE_ENABLED_KEY];
  return stored === undefined ? true : Boolean(stored);
}

export async function setNudgeEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [NUDGE_ENABLED_KEY]: enabled });
}

export async function getNudgeIntervalMinutes(): Promise<number> {
  const result = await browser.storage.local.get(NUDGE_INTERVAL_KEY);
  const stored = result[NUDGE_INTERVAL_KEY];
  return typeof stored === 'number' && stored > 0 ? stored : DEFAULT_NUDGE_INTERVAL_MINUTES;
}

export async function setNudgeIntervalMinutes(minutes: number): Promise<void> {
  await browser.storage.local.set({ [NUDGE_INTERVAL_KEY]: minutes });
}
