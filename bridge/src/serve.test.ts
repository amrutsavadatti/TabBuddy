import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '../protocol.js';
import { BridgeCallError, BrowserUnreachableError } from './client.js';
import { encodeFrame, FrameDecoder } from './framing.js';
import { startHost, type RunningHost } from './host.js';
import {
  createServer,
  ProtocolMismatchError,
  SERVER_VERSION,
  socketSender,
  withHandshake,
  type Send,
} from './serve.js';

async function connect(send: Send) {
  const server = createServer(send);
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

const textOf = (result: any) => result.content[0].text as string;

describe('tools', () => {
  it('offers list_snapshots and get_snapshot, both read-only', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['get_snapshot', 'list_snapshots']);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.description!.length).toBeGreaterThan(80);
    }
  });

  it('list_snapshots returns the extension result as JSON text', async () => {
    const send = vi.fn(async () => [{ id: 's1', name: 'Job Hunt', tabCount: 4 }]);
    const client = await connect(send);
    const result = await client.callTool({ name: 'list_snapshots', arguments: {} });
    expect(send).toHaveBeenCalledWith('listSnapshots', undefined);
    expect(JSON.parse(textOf(result))).toEqual([{ id: 's1', name: 'Job Hunt', tabCount: 4 }]);
    expect(result.isError).toBeUndefined();
  });

  it('get_snapshot forwards its arguments', async () => {
    const send = vi.fn(async () => ({ name: 'Research', tabs: [] }));
    const client = await connect(send);
    await client.callTool({ name: 'get_snapshot', arguments: { id: 'abc', offset: 10, limit: 5 } });
    expect(send).toHaveBeenCalledWith('getSnapshot', { id: 'abc', offset: 10, limit: 5 });
  });

  it('rejects get_snapshot arguments that break the schema, without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    for (const args of [{}, { id: '' }, { id: 'a', limit: 500 }, { id: 'a', offset: -1 }]) {
      const result = await client.callTool({ name: 'get_snapshot', arguments: args }).catch((e) => e);
      const failed = result instanceof Error || result.isError === true;
      expect(failed).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('tells the agent what to do when the browser is unreachable', async () => {
    const client = await connect(async () => {
      throw new BrowserUnreachableError();
    });
    const result = await client.callTool({ name: 'list_snapshots', arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Open your browser');
  });

  it('reports an extension error with its code', async () => {
    const client = await connect(async () => {
      throw new BridgeCallError({ code: 'not_found', message: 'No snapshot with that id.' });
    });
    const result = await client.callTool({ name: 'get_snapshot', arguments: { id: 'nope' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('not_found: No snapshot with that id.');
  });
});

describe('withHandshake', () => {
  const hello = (protocol: number) => ({ protocol, extensionVersion: '1.0.4' });

  it('checks the protocol once, before the first real call', async () => {
    const calls: string[] = [];
    const send = withHandshake(async (method) => {
      calls.push(method);
      return method === 'hello' ? hello(PROTOCOL_VERSION) : 'ok';
    });
    expect(await send('listSnapshots')).toBe('ok');
    expect(await send('listSnapshots')).toBe('ok');
    expect(calls).toEqual(['hello', 'listSnapshots', 'listSnapshots']);
  });

  it('refuses to talk to an extension with a different protocol', async () => {
    const real = vi.fn(async (method: string) => (method === 'hello' ? hello(99) : 'ok'));
    const send = withHandshake(real);
    await expect(send('listSnapshots')).rejects.toBeInstanceOf(ProtocolMismatchError);
    expect(real).toHaveBeenCalledTimes(1); // never sent the real request
  });

  it('does not remember a failed handshake, so it retries once the browser is up', async () => {
    let up = false;
    const send = withHandshake(async (method) => {
      if (!up) throw new BrowserUnreachableError();
      return method === 'hello' ? hello(PROTOCOL_VERSION) : 'ok';
    });
    await expect(send('listSnapshots')).rejects.toBeInstanceOf(BrowserUnreachableError);
    up = true;
    expect(await send('listSnapshots')).toBe('ok');
  });
});

describe('through a real host', () => {
  let dir: string;
  let host: RunningHost | undefined;
  afterEach(async () => {
    await host?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('answers a tool call by relaying it to the (fake) browser and back', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-'));
    const sock = path.join(dir, 'b.sock');
    const input = new PassThrough();
    const output = new PassThrough();
    host = await startHost({ input, output, socketPath: sock, log: () => {} });

    // the fake browser: TabBuddy's side of the conversation
    const decoder = new FrameDecoder();
    const seen: string[] = [];
    output.on('data', (chunk: Buffer) => {
      for (const request of decoder.push(chunk) as any[]) {
        seen.push(request.method);
        const result =
          request.method === 'hello'
            ? { protocol: PROTOCOL_VERSION, extensionVersion: '1.0.4' }
            : [{ id: 's1', name: 'Job Hunt', tabCount: 4 }];
        input.write(encodeFrame({ id: request.id, result }));
      }
    });

    const client = await connect(withHandshake(socketSender(sock)));
    const result = await client.callTool({ name: 'list_snapshots', arguments: {} });
    expect(JSON.parse(textOf(result))).toEqual([{ id: 's1', name: 'Job Hunt', tabCount: 4 }]);
    expect(seen).toEqual(['hello', 'listSnapshots']);
  });
});

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
