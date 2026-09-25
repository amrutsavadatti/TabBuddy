import { describe, expect, it } from 'vitest';
import { checkNudgeGate, evaluateNudgeGate, noteReturnedFromAway } from './nudgeGate';

const MIN = 60_000;
const base = { intervalMs: 20 * MIN, quietUntil: 0, lastScanAt: 0 };

describe('evaluateNudgeGate', () => {
  it('allows a nudge for an active user', () => {
    expect(evaluateNudgeGate({ ...base, idleState: 'active', now: 1_000_000 }).allow).toBe(true);
  });

  it('blocks while the user is idle or the screen is locked', () => {
    expect(evaluateNudgeGate({ ...base, idleState: 'idle', now: 1_000_000 }).allow).toBe(false);
    expect(evaluateNudgeGate({ ...base, idleState: 'locked', now: 1_000_000 }).allow).toBe(false);
  });

  it('stays quiet until quietUntil has passed', () => {
    const now = 1_000_000;
    expect(evaluateNudgeGate({ ...base, idleState: 'active', now, quietUntil: now + 1 }).allow).toBe(false);
    expect(evaluateNudgeGate({ ...base, idleState: 'active', now, quietUntil: now }).allow).toBe(true);
  });

  it('treats a long gap since the last check as coming back from sleep', () => {
    const now = 10 * 60 * MIN;
    const result = evaluateNudgeGate({
      ...base,
      idleState: 'active',
      now,
      lastScanAt: now - 5 * 60 * MIN,
    });
    expect(result.allow).toBe(false);
    expect(result.quietUntil).toBe(now + base.intervalMs);
  });

  it('does not mistake a normal tick for a gap', () => {
    const now = 1_000_000;
    const result = evaluateNudgeGate({
      ...base,
      idleState: 'active',
      now,
      lastScanAt: now - base.intervalMs,
    });
    expect(result.allow).toBe(true);
  });
});

describe('stored gate', () => {
  it('lets the first check through', async () => {
    expect(await checkNudgeGate('active', 20 * MIN, 1_000_000)).toBe(true);
  });

  it('holds nudges back for one interval after returning from away', async () => {
    const now = 1_000_000;
    await noteReturnedFromAway(20 * MIN, now);
    expect(await checkNudgeGate('active', 20 * MIN, now + 5 * MIN)).toBe(false);
    expect(await checkNudgeGate('active', 20 * MIN, now + 20 * MIN)).toBe(true);
  });

  it('keeps its state in session storage, not persistent storage', async () => {
    await checkNudgeGate('active', 20 * MIN, 1_000_000);
    expect(await browser.storage.local.get(null)).toEqual({});
  });
});
