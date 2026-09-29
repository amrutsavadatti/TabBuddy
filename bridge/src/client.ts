import net from 'node:net';
import { randomUUID } from 'node:crypto';
import type { BridgeError, BridgeResponse } from '../protocol.js';
import { LineDecoder } from './framing.js';

export const DEFAULT_TIMEOUT_MS = 10_000;

/** The socket is missing or nobody is listening on it. */
export class BrowserUnreachableError extends Error {
  readonly code = 'browser_unreachable';
  constructor() {
    super("Can't reach TabBuddy. Open your browser and turn on TabBuddy's Agent bridge.");
  }
}

/** The extension answered with an error. */
export class BridgeCallError extends Error {
  constructor(readonly error: BridgeError) {
    super(error.message);
  }
}

export interface CallOptions {
  socketPath: string;
  timeoutMs?: number;
}

/** Sends one request to the host over the socket and resolves with the result. */
export function callBridge(
  method: string,
  params: unknown,
  { socketPath, timeoutMs = DEFAULT_TIMEOUT_MS }: CallOptions,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const socket = net.createConnection(socketPath);
    const lines = new LineDecoder();
    let settled = false;

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      action();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`No answer from TabBuddy after ${timeoutMs} ms.`))),
      timeoutMs,
    );

    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    socket.on('data', (chunk) => {
      for (const line of lines.push(chunk)) {
        let response: BridgeResponse;
        try {
          response = JSON.parse(line) as BridgeResponse;
        } catch {
          continue;
        }
        if (response.id !== id) continue;
        if ('error' in response) {
          finish(() => reject(new BridgeCallError(response.error)));
        } else {
          finish(() => resolve(response.result));
        }
      }
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      finish(() =>
        reject(
          error.code === 'ENOENT' || error.code === 'ECONNREFUSED'
            ? new BrowserUnreachableError()
            : error,
        ),
      );
    });
    socket.on('close', () => {
      finish(() => reject(new Error('The connection to TabBuddy closed before it answered.')));
    });
  });
}
