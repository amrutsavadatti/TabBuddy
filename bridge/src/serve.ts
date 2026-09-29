import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { MAX_SNAPSHOT_TABS_PER_CALL, PROTOCOL_VERSION, type HelloResult } from '../protocol.js';
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
        "get snapshot ids. Returns each snapshot's id, name, tab count, how often it has been opened " +
        '(usageCount), whether it is pinned, and whether its window is open right now. Read-only.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => runTool(send, 'listSnapshots'),
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
