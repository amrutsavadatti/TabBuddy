import { describe, expect, it } from 'vitest';
import {
  clearSnooze,
  isUrlSnoozed,
  pruneExpiredSnoozes,
  snoozeKey,
  snoozeUrl,
  SNOOZE_DURATION_MS,
} from './nudgeState';

const A = 'https://a.com/page';
const B = 'https://b.com/page';

describe('snoozeUrl / isUrlSnoozed', () => {
  it('is not snoozed by default', async () => {
    expect(await isUrlSnoozed(A)).toBe(false);
  });

  it('is snoozed immediately after snoozing', async () => {
    const now = 1_000_000;
    await snoozeUrl(A, now);
    expect(await isUrlSnoozed(A, now)).toBe(true);
  });

  it('snoozes for exactly the flat 2-day duration from the call time', async () => {
    const now = 1_000_000;
    await snoozeUrl(A, now);
    expect(await isUrlSnoozed(A, now + SNOOZE_DURATION_MS - 1)).toBe(true);
    expect(await isUrlSnoozed(A, now + SNOOZE_DURATION_MS + 1)).toBe(false);
  });

  it('only affects the snoozed address, not others', async () => {
    const now = 1_000_000;
    await snoozeUrl(A, now);
    expect(await isUrlSnoozed(B, now)).toBe(false);
  });

  it('ignores the #fragment, so a hash-only change keeps the snooze', async () => {
    const now = 1_000_000;
    await snoozeUrl('https://app.com/inbox#/thread/1', now);
    expect(await isUrlSnoozed('https://app.com/inbox#/thread/2', now)).toBe(true);
  });

  it('still tells different paths and queries apart', async () => {
    const now = 1_000_000;
    await snoozeUrl('https://a.com/one?x=1', now);
    expect(await isUrlSnoozed('https://a.com/one?x=2', now)).toBe(false);
    expect(await isUrlSnoozed('https://a.com/two?x=1', now)).toBe(false);
  });

  it('does not store a snooze for an empty address', async () => {
    await snoozeUrl('');
    expect(await isUrlSnoozed('')).toBe(false);
  });

  it('is kept in persistent storage so it survives a browser restart', async () => {
    await snoozeUrl(A, 1_000_000);
    const stored = await browser.storage.local.get('nudgeSnoozesByUrl');
    expect(Object.keys(stored.nudgeSnoozesByUrl as Record<string, number>)).toEqual([snoozeKey(A)]);
  });
});

describe('clearSnooze', () => {
  it('removes an existing snooze', async () => {
    const now = 1_000_000;
    await snoozeUrl(A, now);
    await clearSnooze(A);
    expect(await isUrlSnoozed(A, now)).toBe(false);
  });
});

describe('pruneExpiredSnoozes', () => {
  it('removes expired entries but keeps active ones', async () => {
    const now = 1_000_000;
    await snoozeUrl(A, now);
    await snoozeUrl(B, now - SNOOZE_DURATION_MS - 1);

    await pruneExpiredSnoozes(now);

    expect(await isUrlSnoozed(A, now)).toBe(true);
    expect(await isUrlSnoozed(B, now)).toBe(false);
  });

  it('discards the obsolete tab-id snoozes from before this change', async () => {
    await browser.storage.local.set({ nudgeSnoozes: { '17': 9_999_999_999_999 } });
    await pruneExpiredSnoozes();
    expect((await browser.storage.local.get('nudgeSnoozes')).nudgeSnoozes).toBeUndefined();
  });
});
