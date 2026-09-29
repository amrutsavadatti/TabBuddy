import type { BridgeRequest, BridgeResponse } from '../bridge/protocol';
import { dispatch } from './agentBridge';
import { AGENT_BRIDGE_ENABLED_KEY, getAgentBridgeEnabled } from './agentBridgeSettings';

export const NATIVE_HOST_NAME = 'com.tabbuddy.bridge';
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 10 * 60_000;

/** Retry delay after `attempt` failed connections in a row (0 = the first
 * retry): 5s, 10s, 20s ... capped at 10 minutes. */
export function nextBackoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
}

/** The slice of a runtime.Port the bridge uses. */
export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface ConnectionDeps {
  isEnabled: () => Promise<boolean>;
  hasPermission: () => Promise<boolean>;
  connect: () => NativePort;
  handle: (request: BridgeRequest) => Promise<BridgeResponse>;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Reads (and so acknowledges) the browser's last runtime error, if any.
   * Chrome prints "Unchecked runtime.lastError" unless this is read. */
  takeLastError: () => string | undefined;
  log: (message: string) => void;
}

export interface BridgeConnection {
  /** Brings the connection in line with the current setting and permission:
   * connects when both allow it, and disconnects (and stops retrying) when
   * either is gone. Safe to call as often as you like. */
  sync(): Promise<void>;
}

export function createBridgeConnection(deps: ConnectionDeps): BridgeConnection {
  let port: NativePort | null = null;
  let retryTimer: unknown = null;
  let failures = 0;
  let queue: Promise<void> = Promise.resolve();

  const clearRetry = () => {
    if (retryTimer !== null) deps.clearTimer(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = (reason: string) => {
    const delay = nextBackoffMs(failures);
    failures += 1;
    deps.log(`${reason}; retrying in ${Math.round(delay / 1000)}s`);
    clearRetry();
    retryTimer = deps.setTimer(() => {
      retryTimer = null;
      void connection.sync();
    }, delay);
  };

  const open = () => {
    let opened: NativePort;
    try {
      opened = deps.connect();
    } catch (error) {
      // e.g. connectNative isn't available yet right after the permission is
      // granted. Treat it like any other failed attempt.
      const detail = error instanceof Error ? error.message : String(error);
      scheduleRetry(`Agent bridge could not connect (${detail})`);
      return;
    }
    port = opened;
    opened.onMessage.addListener(async (message) => {
      failures = 0; // the host answered, so the link works
      opened.postMessage(await deps.handle(message as BridgeRequest));
    });
    opened.onDisconnect.addListener(() => {
      if (port !== opened) return; // we closed it ourselves
      port = null;
      const reason = deps.takeLastError();
      scheduleRetry(reason ? `Agent bridge disconnected (${reason})` : 'Agent bridge disconnected');
    });
  };

  const run = async () => {
    const shouldRun = (await deps.isEnabled()) && (await deps.hasPermission());
    if (!shouldRun) {
      clearRetry();
      failures = 0;
      if (port) {
        const closing = port;
        port = null;
        closing.disconnect();
      }
      return;
    }
    if (port || retryTimer !== null) return;
    open();
  };

  const connection: BridgeConnection = {
    // Serialised: two overlapping syncs must not both open a port.
    sync() {
      queue = queue.then(run, run);
      return queue;
    },
  };
  return connection;
}

const NATIVE_MESSAGING_PERMISSION = { permissions: ['nativeMessaging' as const] };

/** Wires the bridge to the real browser. Does nothing until the user turns
 * it on and grants the optional native messaging permission. */
export function startAgentBridge(): void {
  const connection = createBridgeConnection({
    isEnabled: getAgentBridgeEnabled,
    hasPermission: () => browser.permissions.contains(NATIVE_MESSAGING_PERMISSION),
    connect: () => browser.runtime.connectNative(NATIVE_HOST_NAME) as unknown as NativePort,
    handle: dispatch,
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    takeLastError: () => browser.runtime.lastError?.message,
    log: (message) => console.info(`[TabBuddy] ${message}`),
  });
  const sync = () => {
    connection.sync().catch((error) => console.warn('[TabBuddy] Agent bridge sync failed', error));
  };

  sync();
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && AGENT_BRIDGE_ENABLED_KEY in changes) sync();
  });
  browser.permissions.onAdded.addListener(sync);
  browser.permissions.onRemoved.addListener(sync);
}
