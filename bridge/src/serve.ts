import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  MAX_OPEN_TABS,
  MAX_SEARCH_RESULTS,
  MAX_SNAPSHOT_TABS_PER_CALL,
  PROTOCOL_VERSION,
  type HelloResult,
} from '../protocol.js';
import { BridgeCallError, callBridge } from './client.js';
import { socketPath } from './paths.js';

/** Keep in step with package.json (a test checks). */
export const SERVER_VERSION = '0.1.0';

export type Send = (method: string, params?: unknown) => Promise<unknown>;

export class ProtocolMismatchError extends Error {
  constructor(theirs: number) {
    super(
      `TabBuddy speaks bridge protocol ${theirs}, but this bridge speaks ${PROTOCOL_VERSION}. ` +
        'Update TabBuddy and tabbuddy-bridge to matching versions.',
    );
  }
}

/** Wraps a raw sender so the first call is preceded by a `hello` that checks
 * the extension speaks our protocol version. A failed hello isn't remembered,
 * so the next call tries again (the browser may simply not be running yet). */
export function withHandshake(send: Send): Send {
  let verified = false;
  return async (method, params) => {
    if (!verified) {
      const hello = (await send('hello')) as HelloResult;
      if (hello.protocol !== PROTOCOL_VERSION) throw new ProtocolMismatchError(hello.protocol);
      verified = true;
    }
    return send(method, params);
  };
}

export function socketSender(path: string = socketPath()): Send {
  return (method, params) => callBridge(method, params, { socketPath: path });
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], ...(isError ? { isError: true } : {}) };
}

/** Runs one bridge call and shapes the outcome for an MCP client. Failures
 * become error results (which the agent can read and react to), not protocol
 * errors. */
async function runTool(send: Send, method: string, params?: unknown) {
  try {
    return textResult(JSON.stringify(await send(method, params), null, 2));
  } catch (error) {
    if (error instanceof BridgeCallError) {
      return textResult(`${error.error.code}: ${error.message}`, true);
    }
    return textResult(error instanceof Error ? error.message : String(error), true);
  }
}

export function createServer(send: Send): McpServer {
  const server = new McpServer({ name: 'tabbuddy', version: SERVER_VERSION });

  server.registerTool(
    'list_snapshots',
    {
      title: 'List TabBuddy snapshots',
      description:
        "List the user's saved TabBuddy snapshots: named groups of browser tabs (like \"Job Hunt\" or " +
        '"Research") that the user can reopen with one click. Use this first to see what exists and to ' +
        "get snapshot ids. Returns each snapshot's id, name, tab count, category names, how often it has " +
        'been opened (usageCount), whether it is pinned, and whether its window is open right now. Pass ' +
        'categoryId to list only one category (ids come from list_categories). Read-only.',
      inputSchema: {
        categoryId: z
          .string()
          .min(1)
          .optional()
          .describe('Only snapshots in this category. Get ids from list_categories.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ categoryId }) => runTool(send, 'listSnapshots', categoryId === undefined ? undefined : { categoryId }),
  );

  server.registerTool(
    'list_categories',
    {
      title: 'List snapshot categories',
      description:
        'List the categories (tags) the user has organised their snapshots into, such as "Work" or ' +
        '"Learning", with how many snapshots each holds. Use it to understand how the user groups ' +
        'their snapshots, or to get a category id to filter list_snapshots. A snapshot can be in ' +
        'several categories. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => runTool(send, 'listCategories'),
  );

  server.registerTool(
    'list_open_windows',
    {
      title: 'List open browser windows and tabs',
      description:
        'List the browser windows and tabs that are open right now, as opposed to saved snapshots. Use ' +
        'it to see what the user is working on. Each window says which saved snapshot it was opened from ' +
        '(if any); each tab has its id, title, real URL, whether it is active, pinned or playing sound, ' +
        'when the user last looked at it (lastAccessed, ms since epoch), and "managed" (it belongs to a ' +
        "snapshot's live window). A tab with lazy: true is a TabBuddy placeholder that has not loaded " +
        'yet; url is the page it will open. Incognito windows and TabBuddy\'s own pages are never ' +
        `listed. At most ${MAX_OPEN_TABS} tabs are returned; "truncated" says if more were left out. ` +
        'Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => runTool(send, 'listOpenWindows'),
  );

  server.registerTool(
    'search_tabs',
    {
      title: 'Search saved, archived and open tabs',
      description:
        "Search the user's tabs by keyword: tabs saved in snapshots, tabs in the Archived snapshot (tabs " +
        'the user filed away with TabBuddy), and tabs open right now. Use it to find "that page I had ' +
        'open" when you do not know where it is. Pass a few distinctive keywords, not a sentence: each ' +
        'word is matched, case-insensitively, against the tab title and URL (domain included), and ' +
        'filler words (like "page", "tab", "open") are ignored. A tab matches if it contains any word; ' +
        'tabs matching more of the rarer words come first, then more recently used ones. Each result says where the tab lives: a saved ' +
        'or archived match has snapshotId, snapshotName and the tab index (as get_snapshot shows it); ' +
        `an open match has windowId and tabId. scope limits the search; the default is all. At most ` +
        `${MAX_SEARCH_RESULTS} matches are returned; total and truncated say if there were more, in ` +
        'which case use more specific keywords. Read-only.',
      inputSchema: {
        query: z.string().min(1).describe('Keywords to look for, e.g. "vector database pricing".'),
        scope: z
          .enum(['saved', 'archived', 'open', 'all'])
          .optional()
          .describe(
            'saved = snapshots except Archived; archived = the Archived snapshot; open = open tabs; all = everything (default).',
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SEARCH_RESULTS)
          .optional()
          .describe(`Maximum matches to return. Default and maximum ${MAX_SEARCH_RESULTS}.`),
      },
      annotations: { readOnlyHint: true },
    },
    ({ query, scope, limit }) => runTool(send, 'searchTabs', { query, scope, limit }),
  );

  server.registerTool(
    'get_snapshot',
    {
      title: 'Get the tabs in a snapshot',
      description:
        "Get the tabs inside one saved snapshot: each tab's index, URL, title, whether it is pinned, and " +
        'the name of its tab group. Use it to see what a snapshot contains or to read its links. Get ' +
        `snapshot ids from list_snapshots. Snapshots are returned ${MAX_SNAPSHOT_TABS_PER_CALL} tabs at a ` +
        'time: if "truncated" is true, call again with a larger offset. Read-only.',
      inputSchema: {
        id: z.string().min(1).describe('Snapshot id, from list_snapshots.'),
        offset: z.number().int().min(0).optional().describe('Index of the first tab to return. Default 0.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_SNAPSHOT_TABS_PER_CALL)
          .optional()
          .describe(`How many tabs to return. Default and maximum ${MAX_SNAPSHOT_TABS_PER_CALL}.`),
      },
      annotations: { readOnlyHint: true },
    },
    ({ id, offset, limit }) => runTool(send, 'getSnapshot', { id, offset, limit }),
  );

  return server;
}

/** Serves MCP over stdio until the client disconnects. stdout carries the
 * protocol, so nothing else may write to it. */
export async function runServe(): Promise<void> {
  const server = createServer(withHandshake(socketSender()));
  await server.connect(new StdioServerTransport());
}
