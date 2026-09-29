import { CONFIRM_WAIT_MS, type ConfirmDeclinedResult, type ConfirmProposalResult } from '../bridge/protocol';
import { getAskInBrowser } from './agentBridgeSettings';
import { confirmProposal } from './agentProposals';
import { BridgeFailure } from './bridgeFailure';
import { peekProposal, takeProposal, type Proposal } from './proposals';

export type Decision = 'confirm' | 'cancel';
export type Outcome = 'confirmed' | 'cancelled' | 'timeout';

const DECISIONS_KEY = 'agentConfirmDecisions';

type DecisionMap = Record<string, Decision>;

/** The answers the confirmation window leaves for the background to pick up.
 * They live in session storage: a window that outlives a worker restart can
 * still be heard. */
async function readMap(): Promise<DecisionMap> {
  const result = await browser.storage.session.get(DECISIONS_KEY);
  return (result[DECISIONS_KEY] as DecisionMap | undefined) ?? {};
}

export async function recordDecision(proposalId: string, decision: Decision): Promise<void> {
  await browser.storage.session.set({ [DECISIONS_KEY]: { ...(await readMap()), [proposalId]: decision } });
}

export async function readDecision(proposalId: string): Promise<Decision | undefined> {
  return (await readMap())[proposalId];
}

export async function clearDecision(proposalId: string): Promise<void> {
  const map = await readMap();
  delete map[proposalId];
  await browser.storage.session.set({ [DECISIONS_KEY]: map });
}

/** Calls back whenever the stored decisions change; returns an unsubscribe. */
export function onDecisionsChanged(callback: () => void): () => void {
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area === 'session' && DECISIONS_KEY in changes) callback();
  };
  browser.storage.onChanged.addListener(listener as never);
  return () => browser.storage.onChanged.removeListener(listener as never);
}

export interface WaitDeps {
  readDecision: () => Promise<Decision | undefined>;
  /** Subscribes to "a decision may have been written". Returns an unsubscribe. */
  onDecisionChange: (callback: () => void) => () => void;
  /** Subscribes to "the confirmation window was closed". Returns an unsubscribe. */
  onWindowClosed: (callback: () => void) => () => void;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

/** Waits for the user's answer: Confirm, Cancel, closing the window (a Cancel),
 * or running out of time. Settles exactly once. An answer written before the
 * window closed wins over the close. */
export function waitForDecision(deps: WaitDeps, timeoutMs: number): Promise<Outcome> {
  return new Promise((resolve) => {
    let settled = false;
    const unsubscribes: (() => void)[] = [];
    let timer: unknown;

    const finish = (outcome: Outcome) => {
      if (settled) return;
      settled = true;
      unsubscribes.forEach((off) => off());
      deps.clearTimer(timer);
      resolve(outcome);
    };
    const check = async (closed: boolean) => {
      const decision = await deps.readDecision();
      if (decision === 'confirm') finish('confirmed');
      else if (decision === 'cancel' || closed) finish('cancelled');
    };

    unsubscribes.push(deps.onDecisionChange(() => void check(false)));
    unsubscribes.push(deps.onWindowClosed(() => void check(true)));
    timer = deps.setTimer(() => finish('timeout'), Math.max(0, timeoutMs));
    void check(false); // an answer may already be there
  });
}

export interface ConfirmDeps {
  askInBrowser: () => Promise<boolean>;
  peek: (proposalId: string) => Promise<Proposal | null>;
  /** Opens the confirmation window; returns its id. */
  openWindow: (proposalId: string) => Promise<number | undefined>;
  wait: (proposalId: string, windowId: number | undefined, timeoutMs: number) => Promise<Outcome>;
  closeWindow: (windowId: number) => Promise<void>;
  clearDecision: (proposalId: string) => Promise<void>;
  /** Uses the proposal up without carrying it out. */
  discard: (proposalId: string) => Promise<void>;
  confirm: (params: unknown) => Promise<ConfirmProposalResult>;
  now: () => number;
}

/** Proposals whose window is open right now, so the same proposal cannot open two. */
const waiting = new Set<string>();

/** confirm_proposal with the optional "ask me in the browser" step. With the
 * setting off, or for a proposal that is unknown or expired, this is exactly
 * confirmProposal. With it on, a window lists what would happen and nothing is
 * carried out until the user clicks Confirm; Cancel, closing the window or
 * waiting too long uses the proposal up and changes nothing. */
export async function confirmWithUser(
  params: unknown,
  deps: ConfirmDeps,
): Promise<ConfirmProposalResult | ConfirmDeclinedResult> {
  const { proposalId } = (params ?? {}) as { proposalId?: unknown };
  if (typeof proposalId !== 'string' || proposalId === '' || !(await deps.askInBrowser())) {
    return deps.confirm(params);
  }
  const proposal = await deps.peek(proposalId);
  const timeoutMs = proposal ? Math.min(CONFIRM_WAIT_MS, proposal.expiresAt - deps.now()) : 0;
  if (!proposal || timeoutMs <= 0) return deps.confirm(params); // reports proposal_expired
  if (waiting.has(proposalId)) {
    throw new BridgeFailure(
      'invalid_params',
      "This proposal is already waiting for the user's answer in the browser.",
    );
  }

  waiting.add(proposalId);
  let windowId: number | undefined;
  try {
    try {
      windowId = await deps.openWindow(proposalId);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : '';
      throw new BridgeFailure(
        'internal',
        `Could not open TabBuddy's confirmation window${detail}. Nothing was changed and the proposal still works.`,
      );
    }
    const outcome = await deps.wait(proposalId, windowId, timeoutMs);
    if (outcome === 'confirmed') return await deps.confirm(params);
    await deps.discard(proposalId);
    return {
      action: 'declined',
      declined: true,
      reason: outcome === 'timeout' ? 'timeout' : 'cancelled',
      message:
        outcome === 'timeout'
          ? 'The user did not answer in the browser in time. Nothing was changed. Ask the user what they want, and propose again if they still want it.'
          : 'The user said no in the browser. Nothing was changed. Do not try again unless the user asks you to.',
    };
  } finally {
    waiting.delete(proposalId);
    await deps.clearDecision(proposalId).catch(() => {});
    if (windowId !== undefined) await deps.closeWindow(windowId).catch(() => {});
  }
}

const CONFIRM_PAGE = '/confirm.html';
const WIDTH = 460;
const HEIGHT = 620;

/** Opens the small confirmation window, centred over the window the user used last. */
async function openConfirmWindow(proposalId: string): Promise<number | undefined> {
  const url = browser.runtime.getURL(`${CONFIRM_PAGE}?proposalId=${encodeURIComponent(proposalId)}` as never);
  let left = 100;
  let top = 100;
  try {
    const parent = await browser.windows.getLastFocused();
    left = Math.max(0, (parent.left ?? 0) + Math.round(((parent.width ?? 1280) - WIDTH) / 2));
    top = Math.max(0, (parent.top ?? 0) + Math.round(((parent.height ?? 800) - HEIGHT) / 2));
  } catch {
    // no window to centre on: use the defaults
  }
  const win = await browser.windows.create({
    type: 'popup',
    url,
    width: WIDTH,
    height: HEIGHT,
    left,
    top,
    focused: true,
    state: 'normal',
  });
  return win?.id;
}

const browserDeps: ConfirmDeps = {
  askInBrowser: getAskInBrowser,
  peek: peekProposal,
  openWindow: openConfirmWindow,
  wait: (proposalId, windowId, timeoutMs) =>
    waitForDecision(
      {
        readDecision: () => readDecision(proposalId),
        onDecisionChange: onDecisionsChanged,
        onWindowClosed: (callback) => {
          const listener = (closedId: number) => {
            if (closedId === windowId) callback();
          };
          browser.windows.onRemoved.addListener(listener);
          return () => browser.windows.onRemoved.removeListener(listener);
        },
        setTimer: (callback, ms) => setTimeout(callback, ms),
        clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      },
      timeoutMs,
    ),
  closeWindow: (windowId) => browser.windows.remove(windowId),
  clearDecision,
  discard: async (proposalId) => {
    try {
      await takeProposal(proposalId);
    } catch {
      // already expired or used: nothing left to discard
    }
  },
  confirm: confirmProposal,
  now: () => Date.now(),
};

export const confirmProposalWithUser = (params: unknown) => confirmWithUser(params, browserDeps);
