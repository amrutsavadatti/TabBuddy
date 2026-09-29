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
    'find_duplicate_tabs',
    'get_snapshot',
    'get_stale_tabs',
    'get_usage_stats',
    'list_categories',
    'list_open_windows',
    'list_snapshots',
    'propose_archive_tabs',
    'propose_close_tabs',
    'propose_remove_from_snapshot',
    'search_tabs',
    'summarize_window',
  ];
  // the tools that can lose something: they replace saved tabs, or close tabs
  const DESTRUCTIVE = ['confirm_proposal', 'update_snapshot_from_window'];
  const WRITES = [
    'add_tabs_to_snapshot',
    'confirm_proposal',
    'create_snapshot_from_urls',
    'focus_tab',
    'open_urls',
    'rename_snapshot',
    'restore_snapshot',
    'save_window',
    'tag_snapshots',
    'update_snapshot_from_window',
  ];

  it('offers twelve read-only tools and ten that change things', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_ONLY, ...WRITES].sort());
    for (const tool of tools) expect(tool.description!.length).toBeGreaterThan(80);
    for (const tool of tools.filter((t) => READ_ONLY.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it('marks every write tool as not read-only, and only the two that can lose something as destructive', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    for (const tool of tools.filter((t) => WRITES.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(false);
      expect(tool.annotations?.destructiveHint).toBe(DESTRUCTIVE.includes(tool.name));
    }
  });

  it('proposing is safe to auto-approve, but confirming asks the client for permission', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    const propose = tools.find((t) => t.name === 'propose_archive_tabs')!;
    const confirm = tools.find((t) => t.name === 'confirm_proposal')!;
    expect(propose.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(propose.description).toContain('changes NOTHING');
    expect(confirm.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    expect(confirm.description).toContain('ARCHIVES AND CLOSES');
    expect(confirm.description).toContain('tabs_changed');
    expect(confirm.description).toContain('proposal_expired');
  });

  it('tells the model to show titles and get a yes before confirming', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    const propose = tools.find((t) => t.name === 'propose_archive_tabs')!.description!;
    expect(propose).toContain('never raw ids');
    expect(propose).toContain('clear yes');
    expect(propose).toContain('more than 10 tabs, always ask');
    expect(propose).toContain('includeProtected');
  });

  it('makes clear that closing saves nothing, and that removal is permanent', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    const description = (name: string) => tools.find((t) => t.name === name)!.description!;
    const close = description('propose_close_tabs');
    expect(close).toContain('WITHOUT saving');
    expect(close).toContain('prefer propose_archive_tabs');
    expect(close).toContain('extraTabIds');
    expect(close).toContain('savedElsewhere');
    expect(close).toContain('changes NOTHING');
    expect(close).toContain('more than 10 tabs, always ask');
    const remove = description('propose_remove_from_snapshot');
    expect(remove).toContain('permanent');
    expect(remove).toContain('changes NOTHING');
    expect(remove).toContain('tabs_changed');
    // one confirmation tool covers all three kinds
    const confirm = description('confirm_proposal');
    for (const phrase of ['ARCHIVES AND CLOSES', 'CLOSES them WITHOUT saving', 'REMOVES saved tabs']) {
      expect(confirm).toContain(phrase);
    }
  });

  it('forwards the close and remove proposals\' arguments', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const client = await connect(send);
    await client.callTool({ name: 'propose_close_tabs', arguments: { tabIds: [3, 4], includeProtected: true } });
    expect(send).toHaveBeenLastCalledWith('proposeCloseTabs', { tabIds: [3, 4], includeProtected: true });
    await client.callTool({ name: 'propose_remove_from_snapshot', arguments: { id: 's1', indexes: [0, 2] } });
    expect(send).toHaveBeenLastCalledWith('proposeRemoveFromSnapshot', { id: 's1', indexes: [0, 2] });
  });

  it('rejects malformed close and remove proposals without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    const attempts = [
      { name: 'propose_close_tabs', arguments: {} },
      { name: 'propose_close_tabs', arguments: { tabIds: [] } },
      { name: 'propose_close_tabs', arguments: { tabIds: ['1'] } },
      { name: 'propose_close_tabs', arguments: { tabIds: Array.from({ length: 101 }, (_, i) => i) } },
      { name: 'propose_remove_from_snapshot', arguments: { id: 's1' } },
      { name: 'propose_remove_from_snapshot', arguments: { id: '', indexes: [0] } },
      { name: 'propose_remove_from_snapshot', arguments: { id: 's1', indexes: [] } },
      { name: 'propose_remove_from_snapshot', arguments: { id: 's1', indexes: [1.5] } },
    ];
    for (const attempt of attempts) {
      const result = await client.callTool(attempt).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('forwards propose and confirm arguments', async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const client = await connect(send);
    await client.callTool({ name: 'propose_archive_tabs', arguments: { tabIds: [1, 2], includeProtected: true } });
    expect(send).toHaveBeenLastCalledWith('proposeArchiveTabs', { tabIds: [1, 2], includeProtected: true });
    await client.callTool({ name: 'confirm_proposal', arguments: { proposalId: 'abc' } });
    expect(send).toHaveBeenLastCalledWith('confirmProposal', { proposalId: 'abc' });
  });

  it('rejects malformed propose and confirm arguments without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    const attempts = [
      { name: 'propose_archive_tabs', arguments: {} },
      { name: 'propose_archive_tabs', arguments: { tabIds: [] } },
      { name: 'propose_archive_tabs', arguments: { tabIds: ['1'] } },
      { name: 'propose_archive_tabs', arguments: { tabIds: [1.5] } },
      { name: 'propose_archive_tabs', arguments: { tabIds: Array.from({ length: 101 }, (_, i) => i) } },
      { name: 'propose_archive_tabs', arguments: { tabIds: [1], includeProtected: 'yes' } },
      { name: 'confirm_proposal', arguments: {} },
      { name: 'confirm_proposal', arguments: { proposalId: '' } },
    ];
    for (const attempt of attempts) {
      const result = await client.callTool(attempt).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('shows the agent why a confirmation was refused', async () => {
    const client = await connect(async () => {
      throw new BridgeCallError({
        code: 'tabs_changed',
        message: 'Nothing was archived or closed: 1 of the 3 tabs changed since the proposal. Propose again with fresh tab ids.',
      });
    });
    const result = await client.callTool({ name: 'confirm_proposal', arguments: { proposalId: 'p' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^tabs_changed: Nothing was archived or closed/);
  });

  it('marks update_snapshot_from_window as destructive, since it replaces saved tabs', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    const update = tools.find((t) => t.name === 'update_snapshot_from_window')!;
    expect(update.annotations?.destructiveHint).toBe(true);
    expect(update.description).toContain('REPLACES');
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

  it('save_window forwards its arguments', async () => {
    const send = vi.fn(async () => ({ snapshotId: 's1' }));
    const client = await connect(send);
    await client.callTool({
      name: 'save_window',
      arguments: { name: 'Research', windowId: 12, categoryIds: ['c1'] },
    });
    expect(send).toHaveBeenLastCalledWith('saveWindow', { name: 'Research', windowId: 12, categoryIds: ['c1'] });
  });

  it("forwards the snapshot-editing tools' arguments", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    const client = await connect(send);
    await client.callTool({
      name: 'create_snapshot_from_urls',
      arguments: {
        name: 'Reading',
        urls: ['https://a.test/', { url: 'https://b.test/', title: 'B' }],
        categoryNames: ['Learning'],
      },
    });
    expect(send).toHaveBeenLastCalledWith('createSnapshotFromUrls', {
      name: 'Reading',
      urls: ['https://a.test/', { url: 'https://b.test/', title: 'B' }],
      categoryNames: ['Learning'],
    });
    await client.callTool({ name: 'update_snapshot_from_window', arguments: { id: 's1' } });
    expect(send).toHaveBeenLastCalledWith('updateSnapshotFromWindow', { id: 's1' });
    await client.callTool({ name: 'rename_snapshot', arguments: { id: 's1', name: 'New' } });
    expect(send).toHaveBeenLastCalledWith('renameSnapshot', { id: 's1', name: 'New' });
    await client.callTool({
      name: 'tag_snapshots',
      arguments: { snapshotIds: ['s1', 's2'], categoryNames: ['Work'] },
    });
    expect(send).toHaveBeenLastCalledWith('tagSnapshots', { snapshotIds: ['s1', 's2'], categoryNames: ['Work'] });
  });

  it('rejects malformed snapshot-editing arguments without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    const attempts = [
      { name: 'create_snapshot_from_urls', arguments: { name: 'X', urls: [] } },
      { name: 'create_snapshot_from_urls', arguments: { name: 'X', urls: Array(51).fill('https://a.test/') } },
      { name: 'create_snapshot_from_urls', arguments: { name: 'X', urls: [{ title: 'no url' }] } },
      { name: 'create_snapshot_from_urls', arguments: { name: 'X', urls: ['https://a.test/'], categoryNames: Array(11).fill('c') } },
      { name: 'update_snapshot_from_window', arguments: {} },
      { name: 'rename_snapshot', arguments: { id: 's1' } },
      { name: 'rename_snapshot', arguments: { id: 's1', name: 'x'.repeat(101) } },
      { name: 'tag_snapshots', arguments: { snapshotIds: [], categoryNames: ['A'] } },
      { name: 'tag_snapshots', arguments: { snapshotIds: ['s1'], categoryNames: [] } },
    ];
    for (const attempt of attempts) {
      const result = await client.callTool(attempt).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('summarize_window and find_duplicate_tabs forward a window id, and send no params without one', async () => {
    const send = vi.fn(async () => ({}));
    const client = await connect(send);
    await client.callTool({ name: 'summarize_window', arguments: { windowId: 7 } });
    expect(send).toHaveBeenLastCalledWith('summarizeWindow', { windowId: 7 });
    await client.callTool({ name: 'summarize_window', arguments: {} });
    expect(send).toHaveBeenLastCalledWith('summarizeWindow', undefined);
    await client.callTool({ name: 'find_duplicate_tabs', arguments: { windowId: 9 } });
    expect(send).toHaveBeenLastCalledWith('findDuplicateTabs', { windowId: 9 });
    await client.callTool({ name: 'find_duplicate_tabs', arguments: {} });
    expect(send).toHaveBeenLastCalledWith('findDuplicateTabs', undefined);
  });

  it('rejects a non-integer window id without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    for (const name of ['summarize_window', 'find_duplicate_tabs']) {
      for (const windowId of [1.5, '7']) {
        const result = await client.callTool({ name, arguments: { windowId } }).catch((e) => e);
        expect(result instanceof Error || result.isError === true).toBe(true);
      }
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('tells the model that summarize_window only sees titles and addresses', async () => {
    const client = await connect(async () => null);
    const { tools } = await client.listTools();
    const description = tools.find((t) => t.name === 'summarize_window')!.description!;
    expect(description).toContain('never page contents');
    expect(description).toContain('ask what the window');
  });

  it('add_tabs_to_snapshot forwards open tabs and links, and warns about updating an open snapshot', async () => {
    const send = vi.fn(async () => ({ added: [] }));
    const client = await connect(send);
    await client.callTool({
      name: 'add_tabs_to_snapshot',
      arguments: { id: 's1', tabIds: [4, 5], urls: ['https://a.test/', { url: 'https://b.test/', title: 'B' }] },
    });
    expect(send).toHaveBeenLastCalledWith('addTabsToSnapshot', {
      id: 's1',
      tabIds: [4, 5],
      urls: ['https://a.test/', { url: 'https://b.test/', title: 'B' }],
    });
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'add_tabs_to_snapshot')!;
    expect(tool.description).toContain('snapshotIsOpen');
    expect(tool.description).toContain('does NOT close');
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  it('rejects malformed add_tabs_to_snapshot arguments without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    const attempts = [
      { name: 'add_tabs_to_snapshot', arguments: {} },
      { name: 'add_tabs_to_snapshot', arguments: { id: '' } },
      { name: 'add_tabs_to_snapshot', arguments: { id: 's1', tabIds: ['4'] } },
      { name: 'add_tabs_to_snapshot', arguments: { id: 's1', tabIds: [1.5] } },
      { name: 'add_tabs_to_snapshot', arguments: { id: 's1', tabIds: Array.from({ length: 51 }, (_, i) => i) } },
      { name: 'add_tabs_to_snapshot', arguments: { id: 's1', urls: [{ title: 'no url' }] } },
      { name: 'add_tabs_to_snapshot', arguments: { id: 's1', urls: Array(51).fill('https://a.test/') } },
    ];
    for (const attempt of attempts) {
      const result = await client.callTool(attempt).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects malformed save_window arguments without calling the browser', async () => {
    const send = vi.fn(async () => null);
    const client = await connect(send);
    const attempts = [
      { name: 'save_window', arguments: {} },
      { name: 'save_window', arguments: { name: '' } },
      { name: 'save_window', arguments: { name: 'x'.repeat(101) } },
      { name: 'save_window', arguments: { name: 'X', windowId: 1.5 } },
      { name: 'save_window', arguments: { name: 'X', categoryIds: Array(11).fill('c') } },
    ];
    for (const attempt of attempts) {
      const result = await client.callTool(attempt).catch((e) => e);
      expect(result instanceof Error || result.isError === true).toBe(true);
    }
    expect(send).not.toHaveBeenCalled();
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
