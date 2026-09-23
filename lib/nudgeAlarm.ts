export const NUDGE_ALARM_NAME = 'tabbuddy-nudge-scan';

/** Creates the scan alarm only if it's missing or its period changed.
 * Re-creating an alarm resets its countdown, and MV3 service workers
 * restart often — so blindly calling `alarms.create` on every start would
 * keep pushing the next scan back and it might never fire. */
export async function ensureNudgeAlarm(periodInMinutes: number): Promise<void> {
  const existing = await browser.alarms.get(NUDGE_ALARM_NAME);
  if (existing && existing.periodInMinutes === periodInMinutes) return;
  await browser.alarms.create(NUDGE_ALARM_NAME, { periodInMinutes });
}
