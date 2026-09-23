import { describe, expect, it } from 'vitest';
import {
  clearSnooze,
  isTabSnoozed,
  pruneExpiredSnoozes,
  snoozeTab,
  SNOOZE_DURATION_MS,
} from './nudgeState';

describe('snoozeTab / isTabSnoozed', () => {
  it('is not snoozed by default', async () => {
    expect(await isTabSnoozed(1)).toBe(false);
  });

  it('is snoozed immediately after snoozing', async () => {
    const now = 1_000_000;
    await snoozeTab(1, now);
    expect(await isTabSnoozed(1, now)).toBe(true);
  });

  it('snoozes for exactly the flat 2-day duration from the call time', async () => {
    const now = 1_000_000;
    await snoozeTab(1, now);
    expect(await isTabSnoozed(1, now + SNOOZE_DURATION_MS - 1)).toBe(true);
    expect(await isTabSnoozed(1, now + SNOOZE_DURATION_MS + 1)).toBe(false);
  });

  it('only affects the snoozed tab, not others', async () => {
    const now = 1_000_000;
    await snoozeTab(1, now);
    expect(await isTabSnoozed(2, now)).toBe(false);
  });
});

describe('clearSnooze', () => {
  it('removes an existing snooze', async () => {
    const now = 1_000_000;
    await snoozeTab(1, now);
    await clearSnooze(1);
    expect(await isTabSnoozed(1, now)).toBe(false);
  });
});

describe('pruneExpiredSnoozes', () => {
  it('removes expired entries but keeps active ones', async () => {
    const now = 1_000_000;
    await snoozeTab(1, now); // expires at now + 2 days
    await snoozeTab(2, now - SNOOZE_DURATION_MS - 1); // already expired

    await pruneExpiredSnoozes(now);

    expect(await isTabSnoozed(1, now)).toBe(true);
    expect(await isTabSnoozed(2, now)).toBe(false);
  });
});
