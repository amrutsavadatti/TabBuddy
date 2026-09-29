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
  const READ_ONLY = [
    'get_snapshot',
    'get_stale_tabs',
    'get_usage_stats',
    'list_categories',
    'list_open_windows',
    'list_snapshots',
    'search_tabs',
  ];
  const WRITES = ['focus_tab', 'open_urls', 'restore_snapshot'];

  it('offers seven read-only tools and three that change the browser', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_ONLY, ...WRITES].sort());
    for (const tool of tools) expect(tool.description!.length).toBeGreaterThan(80);
    for (const tool of tools.filter((t) => READ_ONLY.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('marks the write tools as not read-only and not destructive', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    for (const tool of tools.filter((t) => WRITES.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(false);
      expect(tool.annotations?.destructiveHint).toBe(false);
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

  it('list_snapshots forwards a category filter, and sends no params without one', async () => {
    const send = vi.fn(async () => []);
    const client = await connect(send);
    await client.callTool({ name: 'list_snapshots', arguments: { categoryId: 'c1' } });
    expect(send).toHaveBeenLastCalledWith('listSnapshots', { categoryId: 'c1' });
    await client.callTool({ name: 'list_snapshots', arguments: {} });
    expect(send).toHaveBeenLastCalledWith('listSnapshots', undefined);
  });

  it('list_categories and list_open_windows call their extension methods', async () => {
    const send = vi.fn(async (method: string) =>
      method === 'listCategories' ? [{ id: 'c1', name: 'Work', snapshotCount: 2 }] : { windows: [], tabCount: 0, truncated: false },
    );
    const client = await connect(send);
    const cats = await client.callTool({ name: 'list_categories', arguments: {} });
    expect(send).toHaveBeenLastCalledWith('listCategories', undefined);
    expect(JSON.parse(textOf(cats))).toEqual([{ id: 'c1', name: 'Work', snapshotCount: 2 }]);
    const wins = await client.callTool({ name: 'list_open_windows', arguments: {} });
    expect(send).toHaveBeenLastCalledWith('listOpenWindows', undefined);
    expect(JSON.parse(textOf(wins))).toEqual({ windows: [], tabCount: 0, truncated: false });
  });

  it('search_tabs forwards the query, scope and limit', async () => {
    const send = vi.fn(async () => ({ matches: [], total: 0, truncated: false }));
    const client = await connect(send);
    await client.callTool({
      name: 'search_tabs',
      arguments: { query: 'pricing page', scope: 'archived', limit: 5 },
    });
    expect(send).toHaveBeenCalledWith('searchTabs', { query: 'pricing page', scope: 'archived', limit: 5 });
  });

  it('rejects search_tabs arguments that break the schema, without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    for (const args of [{}, { query: '' }, { query: 'a', scope: 'everywhere' }, { query: 'a', limit: 51 }]) {
      const result = await client.callTool({ name: 'search_tabs', arguments: args }).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('get_stale_tabs forwards a threshold, and sends no params without one', async () => {
    const send = vi.fn(async () => ({ tabs: [] }));
    const client = await connect(send);
    await client.callTool({ name: 'get_stale_tabs', arguments: { olderThanMinutes: 90 } });
    expect(send).toHaveBeenLastCalledWith('getStaleTabs', { olderThanMinutes: 90 });
    await client.callTool({ name: 'get_stale_tabs', arguments: {} });
    expect(send).toHaveBeenLastCalledWith('getStaleTabs', undefined);
  });

  it('get_usage_stats forwards a limit, and sends no params without one', async () => {
    const send = vi.fn(async () => ({ topSnapshots: [], topSites: [], siteTrackingEnabled: true }));
    const client = await connect(send);
    await client.callTool({ name: 'get_usage_stats', arguments: { limit: 3 } });
    expect(send).toHaveBeenLastCalledWith('getUsageStats', { limit: 3 });
    await client.callTool({ name: 'get_usage_stats', arguments: {} });
    expect(send).toHaveBeenLastCalledWith('getUsageStats', undefined);
  });

  it('rejects out-of-range stale and usage arguments without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    const attempts = [
      { name: 'get_stale_tabs', arguments: { olderThanMinutes: 0 } },
      { name: 'get_stale_tabs', arguments: { olderThanMinutes: -1 } },
      { name: 'get_usage_stats', arguments: { limit: 0 } },
      { name: 'get_usage_stats', arguments: { limit: 21 } },
    ];
    for (const attempt of attempts) {
      const result = await client.callTool(attempt).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('restore_snapshot, focus_tab and open_urls forward their arguments', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const client = await connect(send);
    await client.callTool({ name: 'restore_snapshot', arguments: { id: 'abc' } });
    expect(send).toHaveBeenLastCalledWith('restoreSnapshot', { id: 'abc' });
    await client.callTool({ name: 'focus_tab', arguments: { tabId: 42 } });
    expect(send).toHaveBeenLastCalledWith('focusTab', { tabId: 42 });
    await client.callTool({ name: 'open_urls', arguments: { urls: ['https://a.test/'], newWindow: true } });
    expect(send).toHaveBeenLastCalledWith('openUrls', { urls: ['https://a.test/'], newWindow: true });
  });

  it('rejects malformed write arguments without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    const attempts = [
      { name: 'restore_snapshot', arguments: {} },
      { name: 'restore_snapshot', arguments: { id: '' } },
      { name: 'focus_tab', arguments: { tabId: '12' } },
      { name: 'focus_tab', arguments: { tabId: 1.5 } },
      { name: 'open_urls', arguments: { urls: [] } },
      { name: 'open_urls', arguments: { urls: 'https://a.test/' } },
      { name: 'open_urls', arguments: { urls: Array(26).fill('https://a.test/') } },
      { name: 'open_urls', arguments: { urls: ['https://a.test/'], newWindow: 'yes' } },
    ];
    for (const attempt of attempts) {
      const result = await client.callTool(attempt).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('shows the extension\'s refusal of a bad address to the agent', async () => {
    const client = await connect(async () => {
      throw new BridgeCallError({
        code: 'invalid_params',
        message: 'Only http and https addresses can be opened. Nothing was opened. Not valid: javascript:x',
      });
    });
    const result = await client.callTool({ name: 'open_urls', arguments: { urls: ['javascript:x'] } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Nothing was opened');
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
