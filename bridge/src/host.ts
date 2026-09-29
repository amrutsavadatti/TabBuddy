import fs from 'node:fs';
import net from 'node:net';
import type { Readable, Writable } from 'node:stream';
import type { BridgeResponse } from '../protocol.js';
import { encodeFrame, FrameDecoder, LineDecoder } from './framing.js';
import type { Logger } from './logger.js';

/** Another host already owns the socket, so a second one must not start. */
export class HostAlreadyRunningError extends Error {
  constructor(readonly socketPath: string) {
    super(`Another TabBuddy bridge host is already running (${socketPath}).`);
  }
}

export interface HostOptions {
  /** Native messaging stdin: frames from the browser. */
  input: Readable;
  /** Native messaging stdout: frames to the browser. Nothing else may write here. */
  output: Writable;
  socketPath: string;
  log: Logger;
}

export interface RunningHost {
  /** Resolves once the host has shut down (browser closed the port, or close() was called). */
  closed: Promise<void>;
  close(): Promise<void>;
}

/** Removes a leftover socket file, but only if nobody is listening on it. */
async function claimSocket(socketPath: string): Promise<void> {
  if (!fs.existsSync(socketPath)) return;
  const alive = await new Promise<boolean>((resolve) => {
    const probe = net.createConnection(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
  if (alive) throw new HostAlreadyRunningError(socketPath);
  fs.rmSync(socketPath, { force: true });
}

interface Pending {
  socket: net.Socket;
  originalId: string;
}

/** Bridges the local socket (MCP server, debug CLI) and the browser's native
 * messaging pipe. Socket clients pick their own request ids, so each request
 * gets a host-unique id on the way to the browser and its own id back. */
export async function startHost({ input, output, socketPath, log }: HostOptions): Promise<RunningHost> {
  await claimSocket(socketPath);

  const pending = new Map<string, Pending>();
  const sockets = new Set<net.Socket>();
  let nextId = 1;
  let closing: Promise<void> | null = null;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => (resolveClosed = resolve));

  const reply = (socket: net.Socket, response: BridgeResponse) => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
  };

  const server = net.createServer((socket) => {
    sockets.add(socket);
    const lines = new LineDecoder();

    socket.on('data', (chunk) => {
      for (const line of lines.push(chunk)) {
        let request: { id?: unknown; method?: unknown; params?: unknown };
        try {
          request = JSON.parse(line);
        } catch {
          log('Ignored a socket line that is not JSON');
          continue;
        }
        if (typeof request.id !== 'string' || typeof request.method !== 'string') {
          log('Ignored a socket request without a string id and method');
          continue;
        }
        const hostId = `h${nextId++}`;
        try {
          output.write(encodeFrame({ id: hostId, method: request.method, params: request.params }));
        } catch (error) {
          reply(socket, {
            id: request.id,
            error: { code: 'invalid_params', message: (error as Error).message },
          });
          continue;
        }
        pending.set(hostId, { socket, originalId: request.id });
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      sockets.delete(socket);
      for (const [hostId, entry] of pending) {
        if (entry.socket === socket) pending.delete(hostId);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      resolve();
    });
  });
  fs.chmodSync(socketPath, 0o600);
  log(`Host listening on ${socketPath}`);

  const close = (): Promise<void> => {
    closing ??= new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => {
        fs.rmSync(socketPath, { force: true });
        log('Host closed');
        resolve();
        resolveClosed();
      });
    });
    return closing;
  };

  const frames = new FrameDecoder();
  input.on('data', (chunk: Buffer) => {
    let messages: unknown[];
    try {
      messages = frames.push(chunk);
    } catch (error) {
      log(`Bad frame from the browser: ${(error as Error).message}`);
      void close();
      return;
    }
    for (const message of messages) {
      const response = message as BridgeResponse;
      const entry = typeof response?.id === 'string' ? pending.get(response.id) : undefined;
      if (!entry) continue; // unknown or already-abandoned request
      pending.delete(response.id);
      reply(entry.socket, { ...response, id: entry.originalId });
    }
  });
  input.on('end', () => void close());
  input.on('close', () => void close());

  return { closed, close };
}
