import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { ensureNudgeAlarm, NUDGE_ALARM_NAME } from './nudgeAlarm';

describe('ensureNudgeAlarm', () => {
  it('creates the alarm when none exists', async () => {
    await ensureNudgeAlarm(5);
    const alarm = await fakeBrowser.alarms.get(NUDGE_ALARM_NAME);
    expect(alarm?.periodInMinutes).toBe(5);
  });

  it('does not reset an existing alarm with the same period', async () => {
    await ensureNudgeAlarm(5);
    const first = await fakeBrowser.alarms.get(NUDGE_ALARM_NAME);
    await new Promise((r) => setTimeout(r, 5));
    await ensureNudgeAlarm(5);
    const second = await fakeBrowser.alarms.get(NUDGE_ALARM_NAME);
    expect(second?.scheduledTime).toBe(first?.scheduledTime);
  });

  it('replaces the alarm when the period changes', async () => {
    await ensureNudgeAlarm(5);
    await ensureNudgeAlarm(30);
    const alarm = await fakeBrowser.alarms.get(NUDGE_ALARM_NAME);
    expect(alarm?.periodInMinutes).toBe(30);
  });
});
