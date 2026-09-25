const GATE_KEY = 'nudgeGate';

/** How long without keyboard/mouse input counts as "away". */
export const AWAY_AFTER_SECONDS = 300;

export type IdleState = 'active' | 'idle' | 'locked';

interface GateStored {
  /** No nudge before this time (ms). Set when the user returns from being away. */
  quietUntil: number;
  /** When the gate was last evaluated; a big gap means the device was asleep. */
  lastScanAt: number;
}

async function readGate(): Promise<GateStored> {
  const result = await browser.storage.session.get(GATE_KEY);
  const stored = result[GATE_KEY] as Partial<GateStored> | undefined;
  return { quietUntil: stored?.quietUntil ?? 0, lastScanAt: stored?.lastScanAt ?? 0 };
}

async function writeGate(gate: GateStored): Promise<void> {
  await browser.storage.session.set({ [GATE_KEY]: gate });
}

/** Pure rule: nudge only when the user is present, and not within one full
 * interval of coming back. A long gap since the last check means the device
 * was asleep (or the browser closed), which counts as coming back too. */
export function evaluateNudgeGate(input: {
  idleState: IdleState;
  now: number;
  intervalMs: number;
  quietUntil: number;
  lastScanAt: number;
}): { allow: boolean; quietUntil: number } {
  let quietUntil = input.quietUntil;
  const wasAsleep = input.lastScanAt > 0 && input.now - input.lastScanAt > input.intervalMs * 2;
  if (wasAsleep) quietUntil = Math.max(quietUntil, input.now + input.intervalMs);
  return { allow: input.idleState === 'active' && input.now >= quietUntil, quietUntil };
}

/** Checks the gate and records that a check happened. */
export async function checkNudgeGate(
  idleState: IdleState,
  intervalMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  const stored = await readGate();
  const { allow, quietUntil } = evaluateNudgeGate({ idleState, now, intervalMs, ...stored });
  await writeGate({ quietUntil, lastScanAt: now });
  return allow;
}

/** The user came back from being away: stay quiet for one full interval. */
export async function noteReturnedFromAway(
  intervalMs: number,
  now: number = Date.now(),
): Promise<void> {
  const stored = await readGate();
  await writeGate({ ...stored, quietUntil: now + intervalMs });
}
