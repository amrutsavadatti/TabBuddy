import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { createServer, SERVER_INSTRUCTIONS } from './serve.js';

async function connect() {
  const server = createServer(async () => null);
  const client = new Client({ name: 'test', version: '0' });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return client;
}

async function textOf(client: Client, name: string, args: Record<string, string> = {}) {
  const result = await client.getPrompt({ name, arguments: args });
  const [message] = result.messages;
  expect(result.messages).toHaveLength(1);
  expect(message!.role).toBe('user');
  return (message!.content as { text: string }).text;
}

describe('prompts', () => {
  it('offers the four prompts', async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'clean_up_browser',
      'switch_to',
      'triage_window',
      'what_was_i_doing',
    ]);
    for (const prompt of prompts) expect(prompt.description!.length).toBeGreaterThan(30);
  });

  it('makes switch_to require a name and puts it in the script', async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    const args = prompts.find((p) => p.name === 'switch_to')!.arguments!;
    expect(args).toEqual([expect.objectContaining({ name: 'name', required: true })]);
    const text = await textOf(client, 'switch_to', { name: 'Job Hunt' });
    expect(text).toContain('"Job Hunt"');
    expect(text).toContain('restore_snapshot');
    expect(text).toContain('nothing is closed');
  });

  describe('triage_window', () => {
    it('asks what the window is for when the user did not say', async () => {
      const text = await textOf(await connect(), 'triage_window');
      expect(text).toContain('the browser window I used last');
      expect(text).toContain('ask me that');
      expect(text).toContain('Ask me ONCE');
      for (const tool of ['summarize_window', 'find_duplicate_tabs', 'propose_triage_plan', 'start_manual_triage', 'confirm_proposal']) {
        expect(text).toContain(tool);
      }
    });

    it('does not re-ask when the user gave the purpose', async () => {
      const text = await textOf(await connect(), 'triage_window', { purpose: 'job search' });
      expect(text).toContain('"job search"');
      expect(text).toContain('Do not ask me that again');
      expect(text).not.toContain('ask me that (one short question)');
    });

    it('always asks for large batches', async () => {
      const text = await textOf(await connect(), 'triage_window', { purpose: 'x' });
      expect(text).toContain('more than 10 tabs, always ask');
    });

    it('targets a given window, and ignores a malformed id', async () => {
      const client = await connect();
      expect(await textOf(client, 'triage_window', { windowId: '42' })).toContain('window with id 42');
      for (const bad of ['abc', '4.5', '']) {
        expect(await textOf(client, 'triage_window', { windowId: bad })).toContain('window I used last');
      }
    });
  });

  it('cleans up with a propose-then-confirm script', async () => {
    const text = await textOf(await connect(), 'clean_up_browser');
    expect(text).toContain('get_stale_tabs');
    expect(text).toContain('only confirm_proposal after I agree');
  });

  it('keeps what_was_i_doing read-only', async () => {
    const text = await textOf(await connect(), 'what_was_i_doing');
    expect(text).toContain('read-only');
    expect(text).not.toContain('confirm_proposal');
  });

  it('gives every prompt that can close tabs the same ground rules', async () => {
    const client = await connect();
    for (const name of ['triage_window', 'clean_up_browser']) {
      const text = await textOf(client, name);
      expect(text).toContain('`request` phrase');
      expect(text).toContain('never by raw id');
      expect(text).toContain('can be undone');
    }
  });
});

describe('server instructions', () => {
  it('tell the model to use names, not ids, and to propose before closing', () => {
    expect(SERVER_INSTRUCTIONS).toContain('never by raw id');
    expect(SERVER_INSTRUCTIONS).toContain('propose_');
  });
});
