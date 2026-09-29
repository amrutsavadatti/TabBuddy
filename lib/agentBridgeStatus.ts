export type BridgeState = 'off' | 'connecting' | 'connected' | 'not_installed' | 'error';

export interface BridgeStatus {
  state: BridgeState;
  /** What went wrong, in words the user can act on. */
  detail?: string;
  since: number;
}

const STATUS_KEY = 'agentBridgeStatus';
/** Written by the dashboard's "Check again"; the background reconnects at once. */
export const RECHECK_KEY = 'agentBridgeRecheck';

/** Pure: reads the browser's reason for closing the native connection. Chrome
 * and Firefox word "the host isn't installed" differently, and a host that is
 * installed but not allowed for this extension is a different fix. */
export function classifyDisconnect(message: string | undefined): { state: 'not_installed' | 'error'; detail: string } {
  const text = (message ?? '').toLowerCase();
  if (text.includes('not found') || text.includes('no such native application')) {
    return {
      state: 'not_installed',
      detail: 'The TabBuddy bridge is not installed on this computer yet.',
    };
  }
  if (text.includes('forbidden')) {
    return {
      state: 'error',
      detail:
        "The installed bridge doesn't allow this copy of TabBuddy. Run the install command again so it picks up this extension.",
    };
  }
  if (text.includes('exited')) {
    return {
      state: 'error',
      detail: 'The bridge stopped right after starting. Run "npx tabbuddy-bridge doctor" to see why.',
    };
  }
  return {
    state: 'error',
    detail: message ? `The bridge connection closed: ${message}` : 'The bridge connection closed unexpectedly.',
  };
}

/** What the settings section shows for a status. Pure. */
export interface StatusView {
  state: BridgeState;
  label: string;
  detail: string | null;
  /** How the dot and text are coloured. */
  tone: 'off' | 'pending' | 'good' | 'warn' | 'bad';
}

export function describeStatus(enabled: boolean, status: BridgeStatus | null): StatusView {
  if (!enabled) return { state: 'off', label: 'Off', detail: null, tone: 'off' };
  // Switched on, but the background has not reported yet (just after a browser start).
  const state = status && status.state !== 'off' ? status.state : 'connecting';
  const detail = status?.detail ?? null;
  switch (state) {
    case 'connected':
      return {
        state,
        label: 'Connected',
        detail: 'Your AI agent can reach TabBuddy through the bridge.',
        tone: 'good',
      };
    case 'not_installed':
      return { state, label: 'Bridge not installed', detail, tone: 'warn' };
    case 'error':
      return { state, label: 'Error', detail, tone: 'bad' };
    default:
      return { state: 'connecting', label: 'Connecting…', detail: null, tone: 'pending' };
  }
}

export async function writeBridgeStatus(state: BridgeState, detail?: string): Promise<void> {
  const status: BridgeStatus = { state, since: Date.now(), ...(detail ? { detail } : {}) };
  await browser.storage.session.set({ [STATUS_KEY]: status });
}

export async function readBridgeStatus(): Promise<BridgeStatus | null> {
  const result = await browser.storage.session.get(STATUS_KEY);
  return (result[STATUS_KEY] as BridgeStatus | undefined) ?? null;
}

/** Calls back with the new status whenever it changes; returns an unsubscribe. */
export function onBridgeStatusChanged(callback: (status: BridgeStatus | null) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === 'session' && STATUS_KEY in changes) {
      callback((changes[STATUS_KEY]!.newValue as BridgeStatus | undefined) ?? null);
    }
  };
  browser.storage.onChanged.addListener(listener as never);
  return () => browser.storage.onChanged.removeListener(listener as never);
}

/** Asks the background to try connecting again now instead of at the next retry. */
export async function requestRecheck(): Promise<void> {
  await browser.storage.session.set({ [RECHECK_KEY]: Date.now() });
}
