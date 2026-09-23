import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NUDGE_INTERVAL_MINUTES,
  getNudgeEnabled,
  getNudgeIntervalMinutes,
  setNudgeEnabled,
  setNudgeIntervalMinutes,
} from './nudgeSettings';

describe('getNudgeEnabled', () => {
  it('defaults to true when nothing is stored', async () => {
    expect(await getNudgeEnabled()).toBe(true);
  });

  it('respects a stored false value', async () => {
    await setNudgeEnabled(false);
    expect(await getNudgeEnabled()).toBe(false);
  });

  it('respects a stored true value', async () => {
    await setNudgeEnabled(false);
    await setNudgeEnabled(true);
    expect(await getNudgeEnabled()).toBe(true);
  });
});

describe('getNudgeIntervalMinutes', () => {
  it('defaults to 20 minutes when nothing is stored', async () => {
    expect(await getNudgeIntervalMinutes()).toBe(DEFAULT_NUDGE_INTERVAL_MINUTES);
  });

  it('respects a stored value', async () => {
    await setNudgeIntervalMinutes(60);
    expect(await getNudgeIntervalMinutes()).toBe(60);
  });

  it('falls back to the default for an invalid stored value', async () => {
    await setNudgeIntervalMinutes(0);
    expect(await getNudgeIntervalMinutes()).toBe(DEFAULT_NUDGE_INTERVAL_MINUTES);
  });
});
