import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  MAX_DUPLICATE_GROUPS,
  MAX_SUMMARY_FLAGGED,
  MAX_SUMMARY_SITES,
  MAX_OPEN_TABS,
  MAX_OPEN_URLS,
  MAX_SEARCH_RESULTS,
  MAX_CATEGORY_NAME_LENGTH,
  MAX_CATEGORY_NAMES,
  MAX_SNAPSHOT_NAME_LENGTH,
  MAX_SNAPSHOT_URLS,
  MAX_TAG_TARGETS,
  MAX_STALE_TABS,
  MAX_USAGE_ITEMS,
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
    'get_stale_tabs',
    {
      title: 'Find stale open tabs',
      description:
        'List open tabs the user has left untouched for a long time, the most stale first: candidates ' +
        'for cleanup. It applies the same rules as TabBuddy\'s own "tab hoarder" nudges: pinned tabs, tabs ' +
        "playing sound, tabs that belong to a snapshot's live window, and tabs the user chose to Keep are " +
        'never listed. Each tab has its windowId, tabId, title, url and minutesSinceLastUse. By default ' +
        'a tab is stale after the time the user set in TabBuddy\'s settings; pass olderThanMinutes to ' +
        'override. "skipped" counts old tabs that were left out because they belong to a snapshot or ' +
        'were kept, so you can explain a short list. This only finds tabs; it never closes anything, and ' +
        `you should ask the user before doing so. At most ${MAX_STALE_TABS} tabs are returned. Read-only.`,
      inputSchema: {
        olderThanMinutes: z
          .number()
          .positive()
          .optional()
          .describe("Stale means untouched this many minutes. Default: the user's own setting."),
      },
      annotations: { readOnlyHint: true },
    },
    ({ olderThanMinutes }) =>
      runTool(send, 'getStaleTabs', olderThanMinutes === undefined ? undefined : { olderThanMinutes }),
  );

  server.registerTool(
    'get_usage_stats',
    {
      title: 'What the user opens and visits most',
      description:
        'Show which snapshots the user opens most (with how many times) and which sites they visit most. ' +
        'Use it to understand their habits: which workspaces matter to them, what to suggest first, or ' +
        'which snapshots they never touch. Sites are domains only (no pages), with a relative score that ' +
        'favours recent visits. topSites is empty and siteTrackingEnabled is false if the user turned ' +
        'visit counting off, so do not treat an empty list as "visits nothing". Read-only.',
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_USAGE_ITEMS)
          .optional()
          .describe(`How many snapshots and sites to list. Default 5, maximum ${MAX_USAGE_ITEMS}.`),
      },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) => runTool(send, 'getUsageStats', limit === undefined ? undefined : { limit }),
  );

  server.registerTool(
    'restore_snapshot',
    {
      title: 'Open a saved snapshot',
      description:
        "Open one of the user's saved snapshots (get the id from list_snapshots). Its tabs open together in " +
        'a new browser window, with pinned tabs and tab groups restored, and the window comes to the front. ' +
        'If the snapshot is already open, its existing window is brought to the front instead, so no ' +
        'duplicate is made (reusedExistingWindow says which happened). It counts as a use of the snapshot. ' +
        "Depending on the user's lazy-loading setting, only the first tab may load at once and the rest " +
        'load when the user clicks them. Use it when the user asks to open or switch to a workspace. ' +
        'Nothing is closed or changed in the snapshot.',
      inputSchema: { id: z.string().min(1).describe('Snapshot id, from list_snapshots.') },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ id }) => runTool(send, 'restoreSnapshot', { id }),
  );

  server.registerTool(
    'focus_tab',
    {
      title: 'Switch to an open tab',
      description:
        'Switch to one open tab and bring its window to the front. Get tab ids from list_open_windows or ' +
        'search_tabs. Use it when the user asks to go to a page that is already open. Fails with ' +
        'not_found if the tab has been closed since you listed it, in which case list again. ' +
        'Nothing is closed or changed.',
      inputSchema: {
        tabId: z.number().int().describe('Tab id, from list_open_windows or search_tabs.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ tabId }) => runTool(send, 'focusTab', { tabId }),
  );

  server.registerTool(
    'open_urls',
    {
      title: 'Open web pages',
      description:
        "Open web pages in the user's browser: as new tabs in the window they used last (the first comes " +
        'to the front, the rest open behind it), or all together in a new window with newWindow. If the ' +
        'window they used last belongs to a saved snapshot, a new window is used instead so the pages ' +
        'are not saved into that snapshot by accident (openedInNewWindow tells you). Only ' +
        `http and https addresses are allowed, up to ${MAX_OPEN_URLS} at a time; if any address is not ` +
        'valid, nothing is opened and the error names it. It does not check whether a page is already ' +
        'open (use list_open_windows or search_tabs and focus_tab for that) and does not save anything. ' +
        'Only open pages the user asked for.',
      inputSchema: {
        urls: z
          .array(z.string().min(1))
          .min(1)
          .max(MAX_OPEN_URLS)
          .describe('Full web addresses starting with http:// or https://.'),
        newWindow: z.boolean().optional().describe('Open in a new window instead of the current one. Default false.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ urls, newWindow }) => runTool(send, 'openUrls', { urls, newWindow }),
  );

  server.registerTool(
    'save_window',
    {
      title: 'Save a browser window as a snapshot',
      description:
        'Save the tabs of one open browser window as a new named snapshot, so the user can reopen it later. ' +
        'By default it saves the window the user used last; pass windowId (from list_open_windows) to save ' +
        'a specific one. The snapshot is tied to the window and its tabs are protected from cleanup nudges. ' +
        'If the window already belongs to a snapshot, a separate, unlinked copy is saved instead and ' +
        'windowAlreadySavedAs names the original (nothing about the original changes). If the name is ' +
        'already taken, "(2)" is added and the result shows the name used. "Archived" is reserved and ' +
        'refused. Optionally file it under categories (ids from list_categories). Saving never closes ' +
        'anything. Pick a short, descriptive name that fits how the user names their snapshots ' +
        '(list_snapshots shows them); do not guess if the window is unclear, ask.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(MAX_SNAPSHOT_NAME_LENGTH)
          .describe('What to call the snapshot, e.g. "Vector DB research".'),
        windowId: z
          .number()
          .int()
          .optional()
          .describe('Window to save, from list_open_windows. Default: the window used last.'),
        categoryIds: z
          .array(z.string().min(1))
          .max(10)
          .optional()
          .describe('Categories to file it under, from list_categories.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ name, windowId, categoryIds }) => runTool(send, 'saveWindow', { name, windowId, categoryIds }),
  );

  const categoryNames = (what: string) =>
    z
      .array(z.string().min(1).max(MAX_CATEGORY_NAME_LENGTH))
      .max(MAX_CATEGORY_NAMES)
      .describe(
        `${what} Names are matched case-insensitively against the user's existing categories ` +
          '(see list_categories) and a name that does not exist yet is created, so reuse an existing ' +
          'category when one fits rather than inventing a near-duplicate.',
      );

  server.registerTool(
    'create_snapshot_from_urls',
    {
      title: 'Save a list of links as a snapshot',
      description:
        'Save a list of web pages as a new named snapshot without opening anything: a reading list or ' +
        'set of sources the user can reopen later with one click. Use it to keep what you found or ' +
        'researched. Each entry is a URL, or {url, title} to give it a readable title (otherwise the ' +
        `site name is used). Only http and https addresses are kept, up to ${MAX_SNAPSHOT_URLS}; ` +
        'repeats and anything unusable are left out and listed in "skipped", so tell the user if any ' +
        'were. If the name is taken, "(2)" is added and the result shows the name used. "Archived" is ' +
        'reserved. Optionally file it under categories by name. Check that links are real before saving ' +
        'them; do not save addresses you have not verified.',
      inputSchema: {
        name: z
          .string()
          .min(1)
          .max(MAX_SNAPSHOT_NAME_LENGTH)
          .describe('What to call the snapshot, e.g. "System Design & DSA".'),
        urls: z
          .array(z.union([z.string().min(1), z.object({ url: z.string().min(1), title: z.string().optional() })]))
          .min(1)
          .max(MAX_SNAPSHOT_URLS)
          .describe('Web addresses, or {url, title} pairs.'),
        categoryNames: categoryNames('Categories to file the snapshot under.').optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ name, urls, categoryNames }) => runTool(send, 'createSnapshotFromUrls', { name, urls, categoryNames }),
  );

  server.registerTool(
    'update_snapshot_from_window',
    {
      title: "Re-save a snapshot from its open window",
      description:
        "Update a snapshot so it matches what is open in its window right now. This REPLACES the " +
        "snapshot's saved tabs: tabs that were closed in that window since it was saved are dropped from " +
        'the snapshot, and new ones are added. The result gives previousTabCount and tabCount so you can ' +
        'tell the user what changed. It only works for a snapshot that is currently open in a window ' +
        '(list_snapshots shows isOpen; restore_snapshot opens it), and never for "Archived". Use it only ' +
        'when the user wants the saved snapshot to reflect their current window; confirm first if the ' +
        'tab count would drop noticeably.',
      inputSchema: { id: z.string().min(1).describe('Snapshot id, from list_snapshots. It must be open.') },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ id }) => runTool(send, 'updateSnapshotFromWindow', { id }),
  );

  server.registerTool(
    'rename_snapshot',
    {
      title: 'Rename a snapshot',
      description:
        'Rename a saved snapshot. Its tabs, categories and usage are unchanged. If another snapshot ' +
        'already has the name, "(2)" is added and the result shows the name used. The reserved ' +
        '"Archived" snapshot cannot be renamed and no other snapshot can take that name.',
      inputSchema: {
        id: z.string().min(1).describe('Snapshot id, from list_snapshots.'),
        name: z.string().min(1).max(MAX_SNAPSHOT_NAME_LENGTH).describe('The new name.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, name }) => runTool(send, 'renameSnapshot', { id, name }),
  );

  server.registerTool(
    'tag_snapshots',
    {
      title: 'Add categories to snapshots',
      description:
        'Add one or more categories (tags) to one or more snapshots. Existing categories on a snapshot ' +
        'are kept; this only adds. Snapshots are checked first, so a wrong id changes nothing. The ' +
        `"Archived" snapshot cannot be categorised. At most ${MAX_TAG_TARGETS} snapshots per call. The ` +
        'result says which categories were created new.',
      inputSchema: {
        snapshotIds: z.array(z.string().min(1)).min(1).max(MAX_TAG_TARGETS).describe('Snapshot ids, from list_snapshots.'),
        categoryNames: categoryNames('Categories to add.').min(1),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ snapshotIds, categoryNames }) => runTool(send, 'tagSnapshots', { snapshotIds, categoryNames }),
  );

  server.registerTool(
    'summarize_window',
    {
      title: 'Summarize a browser window',
      description:
        'Get a compact digest of ONE browser window, for when the user asks you to look over a window, ' +
        'work out what is going on in it, or recommend a cleanup. Use this first, before ' +
        'list_open_windows: it stays small even for a window with hundreds of tabs. It returns the tab ' +
        'count and how many are pinned, playing sound, in a snapshot\'s live window, unloaded ' +
        '(lazy) or blank; how long since the user looked at each tab (idle buckets); the biggest sites ' +
        `(up to ${MAX_SUMMARY_SITES}) with tab counts, a few sample titles and the tab ids to act on; how ` +
        'many duplicate tabs there are; which tabs are already saved in another snapshot (closing those ' +
        'loses nothing); and tabs that might hold unsaved work such as an email being written, a form, or ' +
        `a checkout (mayHaveUnsavedWork, at most ${MAX_SUMMARY_FLAGGED} listed). It sees only titles and ` +
        'addresses, never page contents, so it cannot know what a tab means to the user and the ' +
        'unsaved-work flags are guesses. Summarize what you see, propose a plan, and ask what the window ' +
        'is for before recommending closures; treat flagged tabs with extra care. By default it looks at ' +
        'the window the user used last; pass windowId (from list_open_windows) for another. Read-only.',
      inputSchema: {
        windowId: z
          .number()
          .int()
          .optional()
          .describe('Window to summarize, from list_open_windows. Default: the window used last.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ windowId }) => runTool(send, 'summarizeWindow', windowId === undefined ? undefined : { windowId }),
  );

  server.registerTool(
    'find_duplicate_tabs',
    {
      title: 'Find duplicate tabs',
      description:
        'Find open tabs that show the same page. Two tabs count as the same page when they differ only in ' +
        'a leading "www.", http vs https, a trailing slash, tracking parameters (utm_*, fbclid, gclid and ' +
        'similar) or a #fragment (a route-style #/inbox is kept apart). Each group names the tab worth ' +
        'keeping (the one being looked at, else pinned, else owned by a snapshot, else playing sound, ' +
        'else the most recently used) as keepTabId, and lists extraTabIds: the ones that could be ' +
        'closed. extraTabCount is the total that could go. By default it looks across all open windows; ' +
        `pass windowId to look inside one. At most ${MAX_DUPLICATE_GROUPS} groups are returned, biggest ` +
        'pile first; groupCount says how many there were. This only finds duplicates; it never closes ' +
        'anything, and you should ask the user before closing any. Read-only.',
      inputSchema: {
        windowId: z
          .number()
          .int()
          .optional()
          .describe('Only look inside this window (from list_open_windows). Default: all windows.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ windowId }) => runTool(send, 'findDuplicateTabs', windowId === undefined ? undefined : { windowId }),
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
