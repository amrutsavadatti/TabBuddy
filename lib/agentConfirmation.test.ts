import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { CONFIRM_WAIT_MS, type ConfirmProposalResult } from '../bridge/protocol';
import {
  clearDecision,
  confirmWithUser,
  readDecision,
  recordDecision,
  waitForDecision,
  type ConfirmDeps,
  type Decision,
  type Outcome,
  type WaitDeps,
} from './agentConfirmation';
import { BridgeFailure } from './bridgeFailure';
import type { Proposal } from './proposals';

beforeEach(() => fakeBrowser.reset());

describe('waitForDecision', () => {
  function setup() {
    let decision: Decision | undefined;
    const decisionListeners = new Set<() => void>();
    const closeListeners = new Set<() => void>();
    let timer: { callback: () => void; ms: number } | null = null;
    const deps: WaitDeps = {
      readDecision: async () => decision,
      onDecisionChange: (cb) => {
        decisionListeners.add(cb);
        return () => decisionListeners.delete(cb);
      },
      onWindowClosed: (cb) => {
        closeListeners.add(cb);
        return () => closeListeners.delete(cb);
      },
      setTimer: (callback, ms) => {
        timer = { callback, ms };
        return timer;
      },
      clearTimer: () => {
        timer = null;
      },
    };
    return {
      deps,
      answer(value: Decision) {
        decision = value;
        decisionListeners.forEach((l) => l());
      },
      closeWindow() {
        closeListeners.forEach((l) => l());
      },
      fireTimer: () => timer?.callback(),
      get timer() {
        return timer;
      },
      listeners: () => decisionListeners.size + closeListeners.size,
      preset(value: Decision) {
        decision = value;
      },
    };
  }

  it('resolves confirmed when the user confirms', async () => {
    const t = setup();
    const waiting = waitForDecision(t.deps, 1000);
    t.answer('confirm');
    expect(await waiting).toBe('confirmed');
  });

  it('resolves cancelled on Cancel', async () => {
    const t = setup();
    const waiting = waitForDecision(t.deps, 1000);
    t.answer('cancel');
    expect(await waiting).toBe('cancelled');
  });

  it('treats closing the window without answering as a cancel', async () => {
    const t = setup();
    const waiting = waitForDecision(t.deps, 1000);
    t.closeWindow();
    expect(await waiting).toBe('cancelled');
  });

  it('lets a Confirm written before the window closed win over the close', async () => {
    const t = setup();
    const waiting = waitForDecision(t.deps, 1000);
    t.preset('confirm'); // written, but its change event has not been heard yet
    t.closeWindow();
    expect(await waiting).toBe('confirmed');
  });

  it('times out after the time it was given', async () => {
    const t = setup();
    const waiting = waitForDecision(t.deps, 1234);
    expect(t.timer?.ms).toBe(1234);
    t.fireTimer();
    expect(await waiting).toBe('timeout');
  });

  it('notices an answer that was already there', async () => {
    const t = setup();
    t.preset('confirm');
    expect(await waitForDecision(t.deps, 1000)).toBe('confirmed');
  });

  it('stops listening and stops the timer once it has an answer, and ignores later events', async () => {
    const t = setup();
    const waiting = waitForDecision(t.deps, 1000);
    t.answer('cancel');
    expect(await waiting).toBe('cancelled');
    expect(t.listeners()).toBe(0);
    expect(t.timer).toBeNull();
    t.answer('confirm');
    t.closeWindow();
  });
});

describe('decisions in storage', () => {
  it('records, reads and clears an answer per proposal, in session storage', async () => {
    await recordDecision('a', 'confirm');
    await recordDecision('b', 'cancel');
    expect(await readDecision('a')).toBe('confirm');
    expect(await readDecision('b')).toBe('cancel');
    await clearDecision('a');
    expect(await readDecision('a')).toBeUndefined();
    expect(await readDecision('b')).toBe('cancel');
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual([]);
  });
});

describe('confirmWithUser', () => {
  const NOW = 1_000_000;
  const proposal = { id: 'p1', kind: 'close', tabs: [], expiresAt: NOW + 5 * 60_000 } as unknown as Proposal;
  const confirmed = { action: 'close', undoId: 'u1', closed: 2 } as ConfirmProposalResult;

  function setup(over: Partial<ConfirmDeps> & { outcome?: Outcome; ask?: boolean } = {}) {
    const calls: string[] = [];
    const deps: ConfirmDeps = {
      askInBrowser: async () => over.ask ?? true,
      peek: async () => proposal,
      openWindow: vi.fn(async () => {
        calls.push('open');
        return 7;
      }),
      wait: vi.fn(async () => {
        calls.push('wait');
        return over.outcome ?? 'confirmed';
      }),
      closeWindow: vi.fn(async () => void calls.push('closeWindow')),
      clearDecision: vi.fn(async () => void calls.push('clearDecision')),
      discard: vi.fn(async () => void calls.push('discard')),
      confirm: vi.fn(async () => {
        calls.push('confirm');
        return confirmed;
      }),
      now: () => NOW,
      ...over,
    };
    return { deps, calls };
  }

  it('goes straight to confirming when the setting is off', async () => {
    const { deps } = setup({ ask: false });
    expect(await confirmWithUser({ proposalId: 'p1' }, deps)).toBe(confirmed);
    expect(deps.openWindow).not.toHaveBeenCalled();
    expect(deps.confirm).toHaveBeenCalledWith({ proposalId: 'p1' });
  });

  it('lets confirmProposal report a missing or malformed proposal id', async () => {
    const { deps } = setup({ peek: async () => null });
    await confirmWithUser({ proposalId: 'gone' }, deps);
    await confirmWithUser({}, deps);
    expect(deps.openWindow).not.toHaveBeenCalled();
    expect(deps.confirm).toHaveBeenCalledTimes(2);
  });

  it('opens the window, waits, and confirms only after the user does', async () => {
    const { deps, calls } = setup({ outcome: 'confirmed' });
    expect(await confirmWithUser({ proposalId: 'p1' }, deps)).toBe(confirmed);
    expect(calls.slice(0, 3)).toEqual(['open', 'wait', 'confirm']);
    expect(deps.discard).not.toHaveBeenCalled();
  });

  it('waits at most two minutes, or less if the proposal expires sooner', async () => {
    const long = setup();
    await confirmWithUser({ proposalId: 'p1' }, long.deps);
    expect(long.deps.wait).toHaveBeenCalledWith('p1', 7, CONFIRM_WAIT_MS);

    const soon = { ...proposal, expiresAt: NOW + 45_000 } as Proposal;
    const short = setup({ peek: async () => soon });
    await confirmWithUser({ proposalId: 'p1' }, short.deps);
    expect(short.deps.wait).toHaveBeenCalledWith('p1', 7, 45_000);
  });

  it.each([
    ['cancelled', 'said no'],
    ['timeout', 'did not answer'],
  ] as const)('reports declined on %s, changes nothing and uses the proposal up', async (outcome, phrase) => {
    const { deps, calls } = setup({ outcome });
    const result = await confirmWithUser({ proposalId: 'p1' }, deps);
    expect(result).toMatchObject({
      action: 'declined',
      declined: true,
      reason: outcome === 'timeout' ? 'timeout' : 'cancelled',
    });
    expect((result as { message: string }).message).toContain(phrase);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(calls).toContain('discard');
  });

  it('always tidies up: window closed and answer cleared, whatever happened', async () => {
    for (const outcome of ['confirmed', 'cancelled', 'timeout'] as const) {
      const { deps } = setup({ outcome });
      await confirmWithUser({ proposalId: 'p1' }, deps);
      expect(deps.closeWindow).toHaveBeenCalledWith(7);
      expect(deps.clearDecision).toHaveBeenCalledWith('p1');
    }
    const failing = setup({ confirm: async () => Promise.reject(new BridgeFailure('tabs_changed', 'x')) });
    await expect(confirmWithUser({ proposalId: 'p1' }, failing.deps)).rejects.toMatchObject({ code: 'tabs_changed' });
    expect(failing.deps.closeWindow).toHaveBeenCalled();
  });

  it('changes nothing and keeps the proposal if the window cannot open', async () => {
    const { deps } = setup({ openWindow: async () => Promise.reject(new Error('no display')) });
    await expect(confirmWithUser({ proposalId: 'p1' }, deps)).rejects.toMatchObject({
      code: 'internal',
      message: expect.stringContaining('still works'),
    });
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.discard).not.toHaveBeenCalled();
  });

  it('refuses to open a second window for a proposal that is already waiting', async () => {
    let release!: (o: Outcome) => void;
    const first = setup({ wait: () => new Promise<Outcome>((r) => (release = r)) });
    const pending = confirmWithUser({ proposalId: 'p1' }, first.deps);
    await vi.waitFor(() => expect(first.deps.openWindow).toHaveBeenCalled());
    await expect(confirmWithUser({ proposalId: 'p1' }, setup().deps)).rejects.toMatchObject({
      code: 'invalid_params',
    });
    release('confirmed');
    await pending;
    // once it is over, the same proposal can be asked about again
    expect(await confirmWithUser({ proposalId: 'p1' }, setup().deps)).toBe(confirmed);
  });
});

describe('through the real browser wiring', () => {
  it('opens the window, hears Cancel, uses the proposal up and closes the window', async () => {
    const { dispatch } = await import('./agentBridge');
    const { setAskInBrowser } = await import('./agentBridgeSettings');
    const { createProposal, peekProposal } = await import('./proposals');
    await setAskInBrowser(true);
    const proposal = await createProposal({
      kind: 'close',
      tabs: [{ tabId: 5, windowId: 1, title: 'A', url: 'https://a.test/' }],
      includeProtected: false,
    });
    const create = vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 9 } as never);
    const remove = vi.spyOn(fakeBrowser.windows, 'remove').mockResolvedValue(undefined as never);

    const pending = dispatch({ id: 'r', method: 'confirmProposal', params: { proposalId: proposal.id } });
    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect((create.mock.calls[0]![0] as { url: string }).url).toContain(`confirm.html?proposalId=${proposal.id}`);

    await recordDecision(proposal.id, 'cancel'); // what the window does when Cancel is clicked
    const response = await pending;

    expect(response).toMatchObject({ id: 'r', result: { action: 'declined', declined: true, reason: 'cancelled' } });
    expect(await peekProposal(proposal.id)).toBeNull();
    expect(remove).toHaveBeenCalledWith(9);
    expect(await readDecision(proposal.id)).toBeUndefined();
  });

  it('confirms as before when the setting is off, and never opens a window', async () => {
    const { dispatch } = await import('./agentBridge');
    const create = vi.spyOn(fakeBrowser.windows, 'create');
    const response = await dispatch({ id: 'r', method: 'confirmProposal', params: { proposalId: 'missing' } });
    expect(response).toMatchObject({ error: { code: 'proposal_expired' } });
    expect(create).not.toHaveBeenCalled();
  });
});
