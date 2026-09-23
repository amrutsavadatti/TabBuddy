import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NUDGE_INTERVAL_MINUTES,
  getNudgeEnabled,
  DEFAULT_NUDGE_STALE_MINUTES,
  getNudgeIntervalMinutes,
  getNudgeStaleMinutes,
  setNudgeEnabled,
  setNudgeIntervalMinutes,
  setNudgeStaleMinutes,
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

describe('getNudgeStaleMinutes', () => {
  it('defaults to 24 hours when nothing is stored', async () => {
    expect(await getNudgeStaleMinutes()).toBe(DEFAULT_NUDGE_STALE_MINUTES);
  });

  it('respects a stored value', async () => {
    await setNudgeStaleMinutes(90);
    expect(await getNudgeStaleMinutes()).toBe(90);
  });

  it('falls back to the default for an invalid stored value', async () => {
    await setNudgeStaleMinutes(-5);
    expect(await getNudgeStaleMinutes()).toBe(DEFAULT_NUDGE_STALE_MINUTES);
  });
});
