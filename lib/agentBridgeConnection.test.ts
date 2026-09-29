import { describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_MAX_MS,
  createBridgeConnection,
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
      timers.set(handle, { callback, ms });
      return handle;
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    takeLastError: () => state.lastError,
    log: vi.fn(),
  };
  const connection = createBridgeConnection(deps);
  const fireTimer = () => {
    const [handle, timer] = [...timers.entries()][0]!;
    timers.delete(handle);
    timer.callback();
  };
  return { state, ports, timers, deps, connection, fireTimer };
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

describe('agent bridge setting', () => {
  it('is off by default and reads what was stored', async () => {
    expect(await getAgentBridgeEnabled()).toBe(false);
    await fakeBrowser.storage.local.set({ [AGENT_BRIDGE_ENABLED_KEY]: true });
    expect(await getAgentBridgeEnabled()).toBe(true);
  });
});
