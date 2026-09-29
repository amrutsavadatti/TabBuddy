import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BridgeCallError, BrowserUnreachableError, callBridge } from './client.js';
import { encodeFrame, FrameDecoder, LineDecoder } from './framing.js';
import { HostAlreadyRunningError, startHost, type RunningHost } from './host.js';

let dir: string;
let sock: string;
const hosts: RunningHost[] = [];

beforeEach(() => {
  // Unix socket paths are limited to ~100 characters, so keep this short.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbb-'));
  sock = path.join(dir, 'b.sock');
});

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  fs.rmSync(dir, { recursive: true, force: true });
});

/** A host wired to in-memory streams standing in for the browser. */
async function startTestHost() {
  const input = new PassThrough();
  const output = new PassThrough();
  const host = await startHost({ input, output, socketPath: sock, log: () => {} });
  hosts.push(host);

  const toBrowser: any[] = [];
  const decoder = new FrameDecoder();
  output.on('data', (chunk: Buffer) => toBrowser.push(...decoder.push(chunk)));
  const browserSends = (message: unknown) => input.write(encodeFrame(message));
  const nextToBrowser = async (count = 1) => {
    await waitFor(() => toBrowser.length >= count);
    return toBrowser;
  };
  return { host, input, output, toBrowser, browserSends, nextToBrowser };
}

async function waitFor(condition: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > ms) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('host routing', () => {
  it('forwards a socket request to the browser and routes the answer back', async () => {
    const { toBrowser, browserSends, nextToBrowser } = await startTestHost();
    const call = callBridge('hello', { x: 1 }, { socketPath: sock });

    await nextToBrowser();
    expect(toBrowser[0]).toMatchObject({ method: 'hello', params: { x: 1 } });
    browserSends({ id: toBrowser[0].id, result: { protocol: 1 } });

    expect(await call).toEqual({ protocol: 1 });
  });

  it('keeps two clients that use the same request id apart', async () => {
    const { toBrowser, browserSends, nextToBrowser } = await startTestHost();
    const clients = [net.createConnection(sock), net.createConnection(sock)];
    await Promise.all(clients.map((c) => new Promise((r) => c.once('connect', r))));
    const received: string[][] = [[], []];
    clients.forEach((c, i) => {
      const lines = new LineDecoder();
      c.on('data', (d) => received[i]!.push(...lines.push(d)));
      c.write(`${JSON.stringify({ id: 'same', method: `m${i}` })}\n`);
    });

    await nextToBrowser(2);
    // answer in reverse order to prove routing is by request, not by arrival
    for (const req of [...toBrowser].reverse()) {
      browserSends({ id: req.id, result: `answer-${req.method}` });
    }
    await waitFor(() => received.every((r) => r.length === 1));
    expect(JSON.parse(received[0]![0]!)).toEqual({ id: 'same', result: 'answer-m0' });
    expect(JSON.parse(received[1]![0]!)).toEqual({ id: 'same', result: 'answer-m1' });
    clients.forEach((c) => c.destroy());
  });

  it('passes an error response through to the caller', async () => {
    const { toBrowser, browserSends, nextToBrowser } = await startTestHost();
    const call = callBridge('getSnapshot', { id: 'nope' }, { socketPath: sock });
    await nextToBrowser();
    browserSends({ id: toBrowser[0].id, error: { code: 'not_found', message: 'No snapshot.' } });
    await expect(call).rejects.toMatchObject({
      error: { code: 'not_found', message: 'No snapshot.' },
    });
    await expect(call).rejects.toBeInstanceOf(BridgeCallError);
  });

  it('ignores answers to requests nobody is waiting for', async () => {
    const { browserSends } = await startTestHost();
    browserSends({ id: 'h999', result: 'stray' });
    // still healthy afterwards
    const call = callBridge('hello', undefined, { socketPath: sock, timeoutMs: 100 });
    await expect(call).rejects.toThrow(/No answer/);
  });

  it('answers with invalid_params when a request is too large for the browser', async () => {
    await startTestHost();
    const call = callBridge('big', { s: 'z'.repeat(1024 * 1024) }, { socketPath: sock });
    await expect(call).rejects.toMatchObject({ error: { code: 'invalid_params' } });
  });

  it('creates the socket with owner-only permissions', async () => {
    await startTestHost();
    expect(fs.statSync(sock).mode & 0o777).toBe(0o600);
  });
});

describe('host lifecycle', () => {
  it('shuts down and removes the socket when the browser closes stdin', async () => {
    const { host, input } = await startTestHost();
    input.end();
    await host.closed;
    expect(fs.existsSync(sock)).toBe(false);
    await expect(callBridge('hello', undefined, { socketPath: sock })).rejects.toBeInstanceOf(
      BrowserUnreachableError,
    );
  });

  it('replaces a stale socket file that nobody is listening on', async () => {
    // A host that is killed leaves its socket file behind.
    const crashed = spawn(process.execPath, [
      '-e',
      `require('net').createServer().listen(${JSON.stringify(sock)}, () => process.kill(process.pid, 'SIGKILL'))`,
    ]);
    await new Promise((r) => crashed.once('exit', r));
    expect(fs.existsSync(sock)).toBe(true);

    await startTestHost();
    const call = callBridge('hello', undefined, { socketPath: sock, timeoutMs: 100 });
    // reachable again: the request gets as far as waiting for the browser
    await expect(call).rejects.toThrow(/No answer/);
  });

  it('refuses to start while another host is alive', async () => {
    await startTestHost();
    await expect(
      startHost({ input: new PassThrough(), output: new PassThrough(), socketPath: sock, log: () => {} }),
    ).rejects.toBeInstanceOf(HostAlreadyRunningError);
    // and the first host still owns the socket
    expect(fs.existsSync(sock)).toBe(true);
  });

  it('closes the host on a corrupt frame', async () => {
    const { host, input } = await startTestHost();
    const header = Buffer.alloc(4);
    header.writeUInt32LE(0xffffffff, 0);
    input.write(header);
    await host.closed;
    expect(fs.existsSync(sock)).toBe(false);
  });
});

describe('client', () => {
  it('reports an unreachable browser when there is no socket', async () => {
    await expect(callBridge('hello', undefined, { socketPath: sock })).rejects.toBeInstanceOf(
      BrowserUnreachableError,
    );
  });

  it('times out when the browser never answers', async () => {
    await startTestHost();
    await expect(
      callBridge('hello', undefined, { socketPath: sock, timeoutMs: 50 }),
    ).rejects.toThrow(/No answer from TabBuddy after 50 ms/);
  });
});
