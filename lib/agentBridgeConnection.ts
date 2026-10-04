import type { BridgeRequest, BridgeResponse } from '../bridge/protocol';
import { dispatch } from './agentBridge';
import { AGENT_BRIDGE_ENABLED_KEY, getAgentBridgeEnabled } from './agentBridgeSettings';
import {
  classifyDisconnect,
  RECHECK_KEY,
  writeBridgeStatus,
  type BridgeState,
} from './agentBridgeStatus';

export const NATIVE_HOST_NAME = 'com.tabbuddy.bridge';
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 10 * 60_000;
/** A port that is still open after this long is taken to be talking to a real host. */
export const SETTLE_MS = 1_500;

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
  /** Tells whoever shows the bridge's status what state the connection is in. */
  report: (state: BridgeState, detail?: string) => void;
}

export interface BridgeConnection {
  /** Brings the connection in line with the current setting and permission:
   * connects when both allow it, and disconnects (and stops retrying) when
   * either is gone. Safe to call as often as you like. */
  sync(): Promise<void>;
  /** Tries again now, without waiting for the next retry. Does nothing while connected. */
  recheck(): Promise<void>;
}

export function createBridgeConnection(deps: ConnectionDeps): BridgeConnection {
  let port: NativePort | null = null;
  let retryTimer: unknown = null;
  let failures = 0;
  let queue: Promise<void> = Promise.resolve();
  let settleTimer: unknown = null;

  const clearSettle = () => {
    if (settleTimer !== null) deps.clearTimer(settleTimer);
    settleTimer = null;
  };

  const clearRetry = () => {
    if (retryTimer !== null) deps.clearTimer(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = (reason: string, state: 'not_installed' | 'error', detail: string) => {
    deps.report(state, detail);
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
      scheduleRetry(`Agent bridge could not connect (${detail})`, 'error', `Could not start the bridge connection (${detail}).`);
      return;
    }
    port = opened;
    deps.report('connecting');
    // A missing host makes the browser close the port at once. One that is
    // still open a moment later is a live host.
    settleTimer = deps.setTimer(() => {
      settleTimer = null;
      if (port === opened) deps.report('connected');
    }, SETTLE_MS);
    opened.onMessage.addListener(async (message) => {
      failures = 0; // the host answered, so the link works
      clearSettle();
      deps.report('connected');
      opened.postMessage(await deps.handle(message as BridgeRequest));
    });
    opened.onDisconnect.addListener(() => {
      if (port !== opened) return; // we closed it ourselves
      port = null;
      clearSettle();
      const reason = deps.takeLastError();
      const { state, detail } = classifyDisconnect(reason);
      scheduleRetry(reason ? `Agent bridge disconnected (${reason})` : 'Agent bridge disconnected', state, detail);
    });
  };

  const run = async () => {
    const enabled = await deps.isEnabled();
    const shouldRun = enabled && (await deps.hasPermission());
    if (!shouldRun) {
      clearRetry();
      clearSettle();
      failures = 0;
      if (enabled) {
        deps.report('error', 'TabBuddy no longer has the native messaging permission. Turn the bridge off and on again.');
      } else {
        deps.report('off');
      }
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
    recheck() {
      const again = async () => {
        if (port) return;
        clearRetry();
        failures = 0;
        await run();
      };
      queue = queue.then(again, again);
      return queue;
    },
  };
  return connection;
}

export const RETRY_ALARM_NAME = 'tabbuddy-bridge-retry';
/** Chrome won't fire an alarm sooner than this. */
export const MIN_ALARM_DELAY_MS = 30_000;

export interface TimerApi {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  createAlarm: (name: string, whenMs: number) => void;
  clearAlarm: (name: string) => void;
  now: () => number;
}

/** Retry timers that survive the MV3 service worker going to sleep. A worker
 * with no open port is shut down after ~30 seconds, taking any setTimeout
 * with it, so waits of 30s or more use an alarm, which wakes the worker. */
export function createRetryTimers(api: TimerApi) {
  let alarmCallback: (() => void) | null = null;
  const ALARM = Symbol('alarm');
  return {
    setTimer(callback: () => void, ms: number): unknown {
      if (ms < MIN_ALARM_DELAY_MS) return api.setTimeout(callback, ms);
      alarmCallback = callback;
      api.createAlarm(RETRY_ALARM_NAME, api.now() + ms);
      return ALARM;
    },
    clearTimer(handle: unknown): void {
      if (handle === ALARM) {
        alarmCallback = null;
        api.clearAlarm(RETRY_ALARM_NAME);
      } else {
        api.clearTimeout(handle);
      }
    },
    /** Call from alarms.onAlarm. Returns the pending callback, or null if the
     * worker was restarted in between (the caller should just sync). */
    takeAlarmCallback(name: string): (() => void) | null | undefined {
      if (name !== RETRY_ALARM_NAME) return undefined;
      const callback = alarmCallback;
      alarmCallback = null;
      return callback;
    },
  };
}

const NATIVE_MESSAGING_PERMISSION = { permissions: ['nativeMessaging' as const] };

/** Wires the bridge to the real browser. Does nothing until the user turns
 * it on and grants the optional native messaging permission. */
export function startAgentBridge(): void {
  const timers = createRetryTimers({
    setTimeout: (callback, ms) => setTimeout(callback, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    createAlarm: (name, when) => void browser.alarms.create(name, { when }),
    clearAlarm: (name) => void browser.alarms.clear(name),
    now: () => Date.now(),
  });
  const connection = createBridgeConnection({
    isEnabled: getAgentBridgeEnabled,
    hasPermission: () => browser.permissions.contains(NATIVE_MESSAGING_PERMISSION),
    connect: () => chrome.runtime.connectNative(NATIVE_HOST_NAME) as unknown as NativePort,
    handle: dispatch,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    takeLastError: () => browser.runtime.lastError?.message,
    log: (message) => console.info(`[TabBuddy] ${message}`),
    report: (state, detail) => {
      writeBridgeStatus(state, detail).catch(() => {});
    },
  });
  const sync = () => {
    connection.sync().catch((error) => console.warn('[TabBuddy] Agent bridge sync failed', error));
  };

  sync();
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && AGENT_BRIDGE_ENABLED_KEY in changes) sync();
    if (areaName === 'session' && RECHECK_KEY in changes) {
      connection.recheck().catch((error) => console.warn('[TabBuddy] Agent bridge recheck failed', error));
    }
  });
  browser.permissions.onAdded.addListener(sync);
  browser.permissions.onRemoved.addListener(sync);
  browser.alarms.onAlarm.addListener((alarm) => {
    const callback = timers.takeAlarmCallback(alarm.name);
    if (callback === undefined) return; // someone else's alarm
    // A live worker resumes its own retry; a restarted one has nothing pending
    // and startAgentBridge's first sync() already reconnected.
    if (callback) callback();
    else sync();
  });
}
