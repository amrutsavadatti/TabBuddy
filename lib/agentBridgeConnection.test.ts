import { describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MAX_MS,
  createBridgeConnection,
  createRetryTimers,
  MIN_ALARM_DELAY_MS,
  SETTLE_MS,
  RETRY_ALARM_NAME,
  nextBackoffMs,
  type ConnectionDeps,
  type NativePort,
} from './agentBridgeConnection';
import { AGENT_BRIDGE_ENABLED_KEY, getAgentBridgeEnabled } from './agentBridgeSettings';
import { fakeBrowser } from 'wxt/testing/fake-browser';

class FakePort implements NativePort {
  messageListeners: ((message: unknown) => void)[] = [];
  disconnectListeners: (() => void)[] = [];
  posted: unknown[] = [];
  disconnected = false;
  onMessage = { addListener: (l: (message: unknown) => void) => void this.messageListeners.push(l) };
  onDisconnect = { addListener: (l: () => void) => void this.disconnectListeners.push(l) };
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  disconnect() {
    this.disconnected = true; // like the real API, this does not fire onDisconnect
  }
  /** The browser or host closing the port. */
  drop() {
    this.disconnectListeners.forEach((l) => l());
  }
  receive(message: unknown) {
    return Promise.all(this.messageListeners.map((l) => l(message)));
  }
}

function setup(initial: { enabled?: boolean; permission?: boolean } = {}) {
  const state = {
    enabled: initial.enabled ?? true,
    permission: initial.permission ?? true,
    lastError: undefined as string | undefined,
  };
  const ports: FakePort[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  // the short "is the host really there?" timer is kept apart from retry timers
  const settleTimers = new Map<number, { callback: () => void; ms: number }>();
  const reports: { state: string; detail?: string }[] = [];
  let nextTimer = 1;
  const deps: ConnectionDeps = {
    isEnabled: async () => state.enabled,
    hasPermission: async () => state.permission,
    connect: () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    handle: async (request) => ({ id: request.id, result: 'ok' }),
    setTimer: (callback, ms) => {
      const handle = nextTimer++;
      (ms === SETTLE_MS ? settleTimers : timers).set(handle, { callback, ms });
      return handle;
    },
    clearTimer: (handle) => {
      timers.delete(handle as number);
      settleTimers.delete(handle as number);
    },
    takeLastError: () => state.lastError,
    log: vi.fn(),
    report: (state, detail) => void reports.push({ state, ...(detail ? { detail } : {}) }),
  };
  const connection = createBridgeConnection(deps);
  const fireTimer = () => {
    const [handle, timer] = [...timers.entries()][0]!;
    timers.delete(handle);
    timer.callback();
  };
  const settle = () => {
    const [handle, timer] = [...settleTimers.entries()][0]!;
    settleTimers.delete(handle);
    timer.callback();
  };
  return { state, ports, timers, settleTimers, reports, deps, connection, fireTimer, settle };
}

describe('nextBackoffMs', () => {
  it('doubles from 5 seconds and caps at 10 minutes', () => {
    expect([0, 1, 2, 3].map(nextBackoffMs)).toEqual([5_000, 10_000, 20_000, 40_000]);
    expect(nextBackoffMs(7)).toBe(BACKOFF_MAX_MS);
    expect(nextBackoffMs(50)).toBe(BACKOFF_MAX_MS);
  });
});

describe('bridge connection', () => {
  it('does nothing while the bridge is off', async () => {
    const { connection, ports } = setup({ enabled: false });
    await connection.sync();
    expect(ports).toHaveLength(0);
  });

  it('does nothing without the native messaging permission', async () => {
    const { connection, ports } = setup({ permission: false });
    await connection.sync();
    expect(ports).toHaveLength(0);
  });

  it('connects once even when synced repeatedly or concurrently', async () => {
    const { connection, ports } = setup();
    await Promise.all([connection.sync(), connection.sync(), connection.sync()]);
    await connection.sync();
    expect(ports).toHaveLength(1);
  });

  it('answers requests from the host with the dispatcher result', async () => {
    const { connection, ports } = setup();
    await connection.sync();
    await ports[0]!.receive({ id: 'r1', method: 'hello' });
    expect(ports[0]!.posted).toEqual([{ id: 'r1', result: 'ok' }]);
  });

  it('retries after a disconnect with growing delays', async () => {
    const { connection, ports, timers, fireTimer } = setup();
    await connection.sync();

    ports[0]!.drop();
    expect([...timers.values()].map((t) => t.ms)).toEqual([5_000]);
    fireTimer();
    await vi.waitFor(() => expect(ports).toHaveLength(2));

    ports[1]!.drop();
    expect([...timers.values()].map((t) => t.ms)).toEqual([10_000]);
  });

  it('retries when connecting throws, and works once the API appears', async () => {
    const { connection, ports, timers, deps, fireTimer } = setup();
    const realConnect = deps.connect;
    let available = false;
    deps.connect = () => {
      if (!available) throw new TypeError('connectNative is not a function');
      return realConnect();
    };

    await connection.sync();
    expect(ports).toHaveLength(0);
    expect([...timers.values()].map((t) => t.ms)).toEqual([5_000]);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('connectNative is not a function'));

    available = true;
    fireTimer();
    await vi.waitFor(() => expect(ports).toHaveLength(1));
  });

  it('includes the browser\'s error in the disconnect log', async () => {
    const { connection, ports, state, deps } = setup();
    await connection.sync();
    state.lastError = 'Specified native messaging host not found.';
    ports[0]!.drop();
    expect(deps.log).toHaveBeenCalledWith(
      'Agent bridge disconnected (Specified native messaging host not found.); retrying in 5s',
    );
  });

  it('does not open a second port while a retry is pending', async () => {
    const { connection, ports, timers } = setup();
    await connection.sync();
    ports[0]!.drop();
    await connection.sync();
    expect(ports).toHaveLength(1);
    expect(timers.size).toBe(1);
  });

  it('starts the backoff over once the host has answered', async () => {
    const { connection, ports, timers, fireTimer } = setup();
    await connection.sync();
    ports[0]!.drop();
    fireTimer();
    await vi.waitFor(() => expect(ports).toHaveLength(2));
    ports[1]!.drop();
    fireTimer();
    await vi.waitFor(() => expect(ports).toHaveLength(3));

    await ports[2]!.receive({ id: 'r', method: 'hello' });
    ports[2]!.drop();
    expect([...timers.values()].map((t) => t.ms)).toEqual([5_000]);
  });

  it('disconnects and stays quiet when the bridge is switched off', async () => {
    const { connection, ports, timers, state, deps } = setup();
    await connection.sync();

    state.enabled = false;
    await connection.sync();
    expect(ports[0]!.disconnected).toBe(true);

    ports[0]!.drop(); // a late event for the port we closed
    expect(timers.size).toBe(0);
    expect(deps.log).not.toHaveBeenCalled();
    expect(ports).toHaveLength(1);
  });

  it('cancels a pending retry when the bridge is switched off', async () => {
    const { connection, ports, timers, state } = setup();
    await connection.sync();
    ports[0]!.drop();
    expect(timers.size).toBe(1);

    state.enabled = false;
    await connection.sync();
    expect(timers.size).toBe(0);
  });

  it('connects again when switched back on', async () => {
    const { connection, ports, state } = setup();
    await connection.sync();
    state.enabled = false;
    await connection.sync();
    state.enabled = true;
    await connection.sync();
    expect(ports).toHaveLength(2);
  });

  it('stops when the permission is revoked', async () => {
    const { connection, ports, state } = setup();
    await connection.sync();
    state.permission = false;
    await connection.sync();
    expect(ports[0]!.disconnected).toBe(true);
  });
});

describe('bridge status reports', () => {
  const last = (reports: { state: string }[]) => reports[reports.length - 1]!.state;

  it('reports off while the bridge is off', async () => {
    const { connection, reports } = setup({ enabled: false });
    await connection.sync();
    expect(reports).toEqual([{ state: 'off' }]);
  });

  it('reports an error when it is on but the permission is gone', async () => {
    const { connection, reports } = setup({ permission: false });
    await connection.sync();
    expect(reports[0]!.state).toBe('error');
    expect(reports[0]!.detail).toContain('permission');
  });

  it('is connecting at first, and connected once the port has stayed open a moment', async () => {
    const { connection, reports, settle } = setup();
    await connection.sync();
    expect(last(reports)).toBe('connecting');
    settle();
    expect(last(reports)).toBe('connected');
  });

  it('is connected at once when the host sends a request', async () => {
    const { connection, ports, reports, settleTimers } = setup();
    await connection.sync();
    await ports[0]!.receive({ id: 'r1', method: 'hello' });
    expect(last(reports)).toBe('connected');
    expect(settleTimers.size).toBe(0);
  });

  it('says the bridge is not installed when the browser cannot find the host', async () => {
    const { connection, ports, state, reports } = setup();
    await connection.sync();
    state.lastError = 'Specified native messaging host not found.';
    ports[0]!.drop();
    expect(reports[reports.length - 1]).toMatchObject({ state: 'not_installed' });
  });

  it('does not call a port that closed at once connected', async () => {
    const { connection, ports, reports, settleTimers } = setup();
    await connection.sync();
    ports[0]!.drop();
    expect(settleTimers.size).toBe(0);
    expect(reports.map((r) => r.state)).not.toContain('connected');
  });

  it('reports an error for a host that exits or is forbidden', async () => {
    const { connection, ports, state, reports } = setup();
    await connection.sync();
    state.lastError = 'Access to the specified native messaging host is forbidden.';
    ports[0]!.drop();
    expect(reports[reports.length - 1]).toMatchObject({ state: 'error' });
  });

  it('reports an error when connecting throws', async () => {
    const { connection, deps, reports } = setup();
    deps.connect = () => {
      throw new TypeError('connectNative is not a function');
    };
    await connection.sync();
    expect(reports[reports.length - 1]).toMatchObject({ state: 'error' });
  });

  it('reports off when switched off, and never connected after that', async () => {
    const { connection, state, reports, settle } = setup();
    await connection.sync();
    state.enabled = false;
    await connection.sync();
    expect(last(reports)).toBe('off');
    expect(() => settle()).toThrow(); // its timer was cleared
  });

  it('recheck tries again straight away instead of waiting for the backoff', async () => {
    const { connection, ports, state, timers } = setup();
    await connection.sync();
    state.lastError = 'Specified native messaging host not found.';
    ports[0]!.drop();
    expect(timers.size).toBe(1);

    await connection.recheck();
    expect(ports).toHaveLength(2);
    expect(timers.size).toBe(0); // the pending retry was cancelled
  });

  it('recheck does nothing while a port is open', async () => {
    const { connection, ports } = setup();
    await connection.sync();
    await connection.recheck();
    expect(ports).toHaveLength(1);
  });

  it('recheck starts the backoff over', async () => {
    const { connection, ports, timers, fireTimer } = setup();
    await connection.sync();
    for (let i = 0; i < 3; i++) {
      ports[ports.length - 1]!.drop();
      fireTimer();
      await vi.waitFor(() => expect(ports).toHaveLength(i + 2));
    }
    ports[ports.length - 1]!.drop();
    expect([...timers.values()][0]!.ms).toBe(40_000);
    await connection.recheck();
    ports[ports.length - 1]!.drop();
    expect([...timers.values()].map((t) => t.ms)).toEqual([5_000]);
  });
});

describe('agent bridge setting', () => {
  it('is off by default and reads what was stored', async () => {
    expect(await getAgentBridgeEnabled()).toBe(false);
    await fakeBrowser.storage.local.set({ [AGENT_BRIDGE_ENABLED_KEY]: true });
    expect(await getAgentBridgeEnabled()).toBe(true);
  });
});

describe('retry timers', () => {
  function setupTimers() {
    const calls = {
      timeouts: [] as { ms: number }[],
      clearedTimeouts: [] as unknown[],
      alarms: [] as { name: string; when: number }[],
      clearedAlarms: [] as string[],
    };
    const timers = createRetryTimers({
      setTimeout: (_cb, ms) => {
        calls.timeouts.push({ ms });
        return `timeout-${calls.timeouts.length}`;
      },
      clearTimeout: (handle) => void calls.clearedTimeouts.push(handle),
      createAlarm: (name, when) => void calls.alarms.push({ name, when }),
      clearAlarm: (name) => void calls.clearedAlarms.push(name),
      now: () => 1_000,
    });
    return { timers, calls };
  }

  it('uses a plain timeout for short waits', () => {
    const { timers, calls } = setupTimers();
    const handle = timers.setTimer(() => {}, MIN_ALARM_DELAY_MS - 1);
    expect(calls.timeouts).toEqual([{ ms: MIN_ALARM_DELAY_MS - 1 }]);
    expect(calls.alarms).toEqual([]);
    timers.clearTimer(handle);
    expect(calls.clearedTimeouts).toEqual([handle]);
  });

  it('uses an alarm for waits the worker might not survive', () => {
    const { timers, calls } = setupTimers();
    timers.setTimer(() => {}, 40_000);
    expect(calls.timeouts).toEqual([]);
    expect(calls.alarms).toEqual([{ name: RETRY_ALARM_NAME, when: 41_000 }]);
  });

  it('hands the pending callback to the alarm handler exactly once', () => {
    const { timers } = setupTimers();
    const callback = () => {};
    timers.setTimer(callback, 60_000);
    expect(timers.takeAlarmCallback(RETRY_ALARM_NAME)).toBe(callback);
    expect(timers.takeAlarmCallback(RETRY_ALARM_NAME)).toBeNull();
  });

  it('returns null after a worker restart, and ignores other alarms', () => {
    const { timers } = setupTimers();
    expect(timers.takeAlarmCallback(RETRY_ALARM_NAME)).toBeNull();
    expect(timers.takeAlarmCallback('tabbuddy-nudge-scan')).toBeUndefined();
  });

  it('clears the alarm when the retry is cancelled', () => {
    const { timers, calls } = setupTimers();
    const handle = timers.setTimer(() => {}, 80_000);
    timers.clearTimer(handle);
    expect(calls.clearedAlarms).toEqual([RETRY_ALARM_NAME]);
    expect(timers.takeAlarmCallback(RETRY_ALARM_NAME)).toBeNull();
  });
});

describe('enabling the bridge', () => {
  it('reports a refused or unsupported permission request as not enabled, without throwing', async () => {
    const { enableAgentBridge } = await import('./agentBridgeSettings');
    const request = vi.spyOn(fakeBrowser.permissions, 'request');
    request.mockResolvedValueOnce(false as never);
    expect(await enableAgentBridge()).toBe(false);
    request.mockRejectedValueOnce(new Error('Permission is not in the manifest'));
    expect(await enableAgentBridge()).toBe(false);
    expect(await getAgentBridgeEnabled()).toBe(false);
    request.mockResolvedValueOnce(true as never);
    expect(await enableAgentBridge()).toBe(true);
    expect(await getAgentBridgeEnabled()).toBe(true);
  });
});
