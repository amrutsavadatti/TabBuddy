import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  CONFIRM_WAIT_MS,
  MAX_ADD_TABS,
  MAX_REQUEST_LENGTH,
  MAX_PROPOSAL_TABS,
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
  MAX_TRIAGE_TABS,
  MAX_STALE_TABS,
  MAX_USAGE_ITEMS,
  MAX_SNAPSHOT_TABS_PER_CALL,
  PROTOCOL_VERSION,
  type HelloResult,
} from '../protocol.js';
import { BridgeCallError, callBridge } from './client.js';
import { registerPrompts } from './prompts.js';
import { socketPath } from './paths.js';

/** Keep in step with package.json (a test checks). */
export const SERVER_VERSION = '0.1.0';

/** Shown to the model when it connects. */
export const SERVER_INSTRUCTIONS =
  'TabBuddy keeps an activity log that the user reviews in their dashboard, sorted by what they asked ' +
  'you for. Whenever you act on a request from the user (anything that opens, saves, renames, tags, ' +
  'archives, closes or removes), pass the same short `request` phrase, in the user\'s words, on every ' +
  'tool call for that request. Ask before closing, archiving or removing tabs unless the user has ' +
  'already told you exactly which ones. Ids are for your tool calls only: talk to the user about tabs ' +
  'by title and snapshots by name, never by raw id. Closing, archiving and removing take two steps: ' +
  'use a propose_ tool, show what would happen, and call confirm_proposal only after the user agrees.';

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

/** Calls that may wait on a person: with "ask me in the browser" on,
 * confirm_proposal waits up to CONFIRM_WAIT_MS for a click, so it gets that
 * long plus room to carry the action out. */
export const METHOD_TIMEOUTS_MS: Record<string, number> = {
  confirmProposal: CONFIRM_WAIT_MS + 30_000,
};

export function socketSender(path: string = socketPath()): Send {
  return (method, params) =>
    callBridge(method, params, { socketPath: path, timeoutMs: METHOD_TIMEOUTS_MS[method] });
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
  const server = new McpServer(
    { name: 'tabbuddy', version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );

  const requestField = z
    .string()
    .max(MAX_REQUEST_LENGTH)
    .optional()
    .describe(
      'A short phrase (under 120 characters) for what the user asked you to do, in their words, for ' +
        'example "clean up my Job Hunt window". Pass the same phrase on every call that belongs to that ' +
        'request: it groups your actions in the activity log the user reviews.',
    );

  server.registerTool(
    'list_snapshots',
    {
      title: 'List TabBuddy snapshots',
      description:
        "List the user's saved TabBuddy snapshots: named groups of browser tabs (like \"Job Hunt\" or " +
        '"Research") that the user can reopen with one click. Use this first to see what exists and to ' +
        "get snapshot ids. Returns each snapshot's id, name, tab count, category names, how often it has " +
        'been opened (usageCount), whether it is pinned, and whether its window is open right now. Pass ' +
        'categoryId to list only one category (ids come from list_categories). Ids are for your later calls: ' +
        'tell the user snapshots by name. Read-only.',
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
        'For a crowded window prefer summarize_window, which stays small. Tell the user about tabs by ' +
        'title, never by id. Read-only.',
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
        'which case use more specific keywords. Tell the user about matches by title, never by id or ' +
        'index. Read-only.',
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
      inputSchema: { id: z.string().min(1).describe('Snapshot id, from list_snapshots.'), request: requestField },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ id, request }) => runTool(send, 'restoreSnapshot', { id, request }),
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
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    ({ urls, newWindow, request }) => runTool(send, 'openUrls', { urls, newWindow, request }),
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
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ name, windowId, categoryIds, request }) => runTool(send, 'saveWindow', { name, windowId, categoryIds, request }),
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

  const tabIdList = (what: string) =>
    z.array(z.number().int()).min(1).max(MAX_TRIAGE_TABS).describe(`${what} Tab ids from list_open_windows, search_tabs or summarize_window.`);

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
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    ({ name, urls, categoryNames, request }) =>
      runTool(send, 'createSnapshotFromUrls', { name, urls, categoryNames, request }),
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
      inputSchema: {
        id: z.string().min(1).describe('Snapshot id, from list_snapshots. It must be open.'),
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    ({ id, request }) => runTool(send, 'updateSnapshotFromWindow', { id, request }),
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
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, name, request }) => runTool(send, 'renameSnapshot', { id, name, request }),
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
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ snapshotIds, categoryNames, request }) =>
      runTool(send, 'tagSnapshots', { snapshotIds, categoryNames, request }),
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
    'add_tabs_to_snapshot',
    {
      title: 'Add tabs or links to an existing snapshot',
      description:
        'Append tabs to a snapshot that already exists, without changing what is in it. Give tabIds ' +
        '(open tabs, from list_open_windows, search_tabs or summarize_window) and/or urls (links, as ' +
        `a URL or {url, title}); ${MAX_ADD_TABS} in total at most. Use it when the user says "add this to ` +
        'my X snapshot" or wants to grow a reading list. Pages already in the snapshot are skipped, ' +
        'matched the way find_duplicate_tabs matches (so a link that differs only by tracking ' +
        'parameters counts as the same); closed or private tabs and non-web pages are skipped too. ' +
        'Every skip is listed with its reason, so tell the user about them; adding nothing new is a ' +
        'normal result, not an error. New tabs go at the end, and "added" gives their positions. It ' +
        'does NOT close the open tabs. Check snapshotIsOpen in the result: if true, the snapshot is ' +
        'open in a window, and pressing Update on it later (or update_snapshot_from_window) would ' +
        'replace its saved tabs with that window\'s and drop what you added, so mention that to the ' +
        'user. The reserved "Archived" snapshot cannot be added to. To make a new snapshot instead, ' +
        'use create_snapshot_from_urls or save_window.',
      inputSchema: {
        id: z.string().min(1).describe('Snapshot id, from list_snapshots.'),
        tabIds: z
          .array(z.number().int())
          .max(MAX_ADD_TABS)
          .optional()
          .describe('Open tabs to add, from list_open_windows, search_tabs or summarize_window.'),
        urls: z
          .array(z.union([z.string().min(1), z.object({ url: z.string().min(1), title: z.string().optional() })]))
          .max(MAX_ADD_TABS)
          .optional()
          .describe('Links to add: web addresses, or {url, title} pairs.'),
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ id, tabIds, urls, request }) => runTool(send, 'addTabsToSnapshot', { id, tabIds, urls, request }),
  );

  server.registerTool(
    'propose_archive_tabs',
    {
      title: 'Propose archiving tabs (step 1 of 2)',
      description:
        'Step 1 of 2 for archiving tabs: works out what archiving these open tabs would do and changes ' +
        'NOTHING. Archiving saves the tabs into TabBuddy\'s reserved "Archived" snapshot, a safe place ' +
        'the user can browse and reopen from, and then closes them. Get tab ids from list_open_windows, ' +
        'search_tabs, summarize_window, find_duplicate_tabs or get_stale_tabs. It returns a proposalId, ' +
        'a summary, the exact tabs (titles and pages) that would be archived, and "skipped": tabs left ' +
        'out and why. Pinned tabs, tabs playing sound and tabs in a snapshot\'s open window are left ' +
        'alone unless includeProtected is true; set that only when the user explicitly asked for those ' +
        'very tabs. Show the user the list by title (never raw ids) and get a clear yes before calling ' +
        'confirm_proposal. You may skip asking only if the user has already told you to archive these ' +
        'specific tabs; for more than 10 tabs, always ask. A proposal lasts 5 minutes and works once, so ' +
        `confirm promptly after they agree, and propose again if it expires. Up to ${MAX_PROPOSAL_TABS} ` +
        'tabs per proposal.',
      inputSchema: {
        tabIds: z
          .array(z.number().int())
          .min(1)
          .max(MAX_PROPOSAL_TABS)
          .describe('Open tabs to archive, from list_open_windows, search_tabs or summarize_window.'),
        includeProtected: z
          .boolean()
          .optional()
          .describe('Also propose pinned tabs, tabs playing sound and snapshot-owned tabs. Only if the user explicitly asked for those tabs.'),
        request: requestField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ tabIds, includeProtected, request }) =>
      runTool(send, 'proposeArchiveTabs', { tabIds, includeProtected, request }),
  );

  server.registerTool(
    'propose_close_tabs',
    {
      title: 'Propose closing tabs (step 1 of 2)',
      description:
        'Step 1 of 2 for closing tabs WITHOUT saving them: works out what closing these open tabs would do ' +
        'and changes NOTHING. Closed tabs are not saved anywhere, so when the user might want a page again ' +
        'prefer propose_archive_tabs. Closing is the right choice for tabs that lose nothing: the extras ' +
        'from find_duplicate_tabs (extraTabIds), blank "new tab" pages, and pages summarize_window lists ' +
        'under savedElsewhere (already saved in a snapshot). Get tab ids from list_open_windows, ' +
        'search_tabs, summarize_window or find_duplicate_tabs. It returns a proposalId, a summary, the ' +
        'exact tabs that would be closed, and "skipped": tabs left out and why. Pinned tabs, tabs playing ' +
        'sound and tabs in a snapshot\'s open window are left alone unless includeProtected is true (only ' +
        'when the user explicitly asked for those very tabs), and TabBuddy\'s own pages are never ' +
        'closed. Show the user the list by title (never raw ids) and get a clear yes before calling ' +
        'confirm_proposal, unless they already told you to close these specific tabs; for more than 10 ' +
        `tabs, always ask. A proposal lasts 5 minutes and works once. Up to ${MAX_PROPOSAL_TABS} tabs.`,
      inputSchema: {
        tabIds: z
          .array(z.number().int())
          .min(1)
          .max(MAX_PROPOSAL_TABS)
          .describe('Open tabs to close, from list_open_windows, search_tabs, summarize_window or find_duplicate_tabs.'),
        includeProtected: z
          .boolean()
          .optional()
          .describe('Also propose pinned tabs, tabs playing sound and snapshot-owned tabs. Only if the user explicitly asked for those tabs.'),
        request: requestField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ tabIds, includeProtected, request }) =>
      runTool(send, 'proposeCloseTabs', { tabIds, includeProtected, request }),
  );

  server.registerTool(
    'propose_remove_from_snapshot',
    {
      title: 'Propose removing saved tabs from a snapshot (step 1 of 2)',
      description:
        'Step 1 of 2 for removing tabs from a SAVED snapshot: works out what would be removed and changes ' +
        'NOTHING. Tabs are addressed by position (index) as get_snapshot and search_tabs report them. ' +
        'Removal is permanent: the saved tabs are not archived anywhere, and it does not touch tabs open in ' +
        'the browser. It also works on the reserved "Archived" snapshot, which is how the archive is ' +
        'cleared. It returns a proposalId, a summary, the exact saved tabs that would go (by title), what ' +
        'the snapshot would hold afterwards, and "skipped": positions that do not exist. snapshotIsOpen ' +
        'tells you the snapshot is open in a window. Show the user the list by title and get a clear yes ' +
        'before calling confirm_proposal; always ask when removing more than a few tabs, or when the ' +
        'snapshot would end up empty. Positions shift whenever a snapshot changes, so if anything ' +
        'changed it since, confirming fails with tabs_changed: call get_snapshot and propose again. A ' +
        `proposal lasts 5 minutes and works once. Up to ${MAX_PROPOSAL_TABS} tabs.`,
      inputSchema: {
        id: z.string().min(1).describe('Snapshot id, from list_snapshots.'),
        indexes: z
          .array(z.number().int())
          .min(1)
          .max(MAX_PROPOSAL_TABS)
          .describe('Positions of the saved tabs to remove, from get_snapshot or search_tabs.'),
        request: requestField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ id, indexes, request }) => runTool(send, 'proposeRemoveFromSnapshot', { id, indexes, request }),
  );

  server.registerTool(
    'propose_triage_plan',
    {
      title: 'Propose a whole cleanup of a window (step 1 of 2)',
      description:
        'Plan the cleanup of a window with many tabs in one go, and confirm it once: better than proposing ' +
        'each kind of change separately. Use it after summarize_window and find_duplicate_tabs when the ' +
        'user wants a window sorted out. Put each tab in exactly ONE bucket. "close" closes WITHOUT saving ' +
        '(duplicate extras, blank pages, pages summarize_window lists under savedElsewhere). "archive" ' +
        'saves to the Archived snapshot and then closes: the safe default for "probably do not need it". ' +
        '"fileInto" adds to an EXISTING snapshot (by id from list_snapshots) and then closes: for tabs ' +
        'that belong with something the user already saved. "newSnapshots" saves a group together under ' +
        'a new name, optionally with categories, and then closes: for a set worth keeping. Tabs you do ' +
        'not list stay open, which is the right place for tabs you are unsure about: leave them, and ' +
        'tell the user which ones so they can decide (or sort them one by one in TabBuddy). Pass ' +
        'windowId to learn how many tabs stay open. It changes NOTHING. It returns a proposalId, a ' +
        'summary, the steps bucket by bucket with each tab\'s title and page, totals, leftOpen, and ' +
        '"skipped": tabs left out and why (pinned, playing sound, in a snapshot\'s open window, private, ' +
        'or TabBuddy\'s own; includeProtected overrides the first three, only when the user explicitly ' +
        'asked for those very tabs). Show the user the plan bucket by bucket, by title (never raw ids), ' +
        'and get a clear yes before calling confirm_proposal; if they want tabs moved between buckets, ' +
        'propose again. Always ask for a plan of more than a few tabs. Confirming saves everything first ' +
        'and only then closes the tabs, checks every tab again, and changes nothing if any has changed; ' +
        `the whole plan can be undone with undo. A plan lasts 5 minutes and works once; up to ${MAX_TRIAGE_TABS} tabs.`,
      inputSchema: {
        close: tabIdList('Tabs to close without saving them.').optional(),
        archive: tabIdList('Tabs to archive (save to the Archived snapshot, then close).').optional(),
        fileInto: z
          .array(z.object({ id: z.string().min(1).describe('Snapshot id, from list_snapshots.'), tabIds: tabIdList('Tabs to add to it, then close.') }))
          .optional()
          .describe('Tabs to add to existing snapshots, then close, one entry per snapshot.'),
        newSnapshots: z
          .array(
            z.object({
              name: z.string().min(1).max(MAX_SNAPSHOT_NAME_LENGTH).describe('What to call the new snapshot.'),
              tabIds: tabIdList('Tabs to save in it, then close.'),
              categoryNames: categoryNames('Categories to file the new snapshot under.').optional(),
            }),
          )
          .optional()
          .describe('Tabs to save together as new snapshots, then close, one entry per snapshot.'),
        windowId: z.number().int().optional().describe('The window the plan is about, from list_open_windows. Only used to say how many of its tabs stay open.'),
        includeProtected: z
          .boolean()
          .optional()
          .describe('Also plan pinned tabs, tabs playing sound and snapshot-owned tabs. Only if the user explicitly asked for those tabs.'),
        request: requestField,
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    (plan) => runTool(send, 'proposeTriagePlan', plan),
  );

  server.registerTool(
    'confirm_proposal',
    {
      title: 'Carry out a proposal (step 2 of 2)',
      description:
        'Step 2 of 2: carries out a proposal from a propose_ tool. For propose_archive_tabs this ARCHIVES ' +
        'AND CLOSES the tabs; for propose_close_tabs it CLOSES them WITHOUT saving them; for ' +
        'propose_remove_from_snapshot it REMOVES saved tabs from a snapshot for good; for ' +
        'propose_triage_plan it SAVES everything the plan files away and then CLOSES all its tabs. Only ' +
        'call it after ' +
        'the user has agreed to the exact list you showed them (see propose_archive_tabs for when asking ' +
        'can be skipped). A proposal works once and for five minutes only. Before acting, everything is ' +
        'checked again: if an open tab has been closed, now shows a different page, or has become pinned ' +
        'or started playing sound, or if the snapshot has changed since (its tab positions may have ' +
        'moved), NOTHING is changed and you get tabs_changed. Tell the user and propose again with fresh ' +
        'ids. proposal_expired means the proposal timed out or was already used. On success it says how ' +
        'many tabs were archived, closed or removed. Archived tabs are then in the reserved Archived ' +
        'snapshot (find them with search_tabs, scope archived), and the user can reopen them from it in ' +
        'the TabBuddy dashboard. Closed tabs are not saved anywhere, and removed saved tabs are gone, ' +
        'but the result includes an undoId: tell the user the action can be undone, and call undo with ' +
        'it if they ask. If the user turned on "ask me in the browser", a TabBuddy window opens and this ' +
        'call waits (up to 2 minutes) for them to click Confirm or Cancel: tell the user to look at their ' +
        'browser. If they cancel or do not answer, you get declined: true and NOTHING was changed; the ' +
        'proposal is used up, so do not retry unless the user asks, and propose again if they do.',
      inputSchema: {
        proposalId: z.string().min(1).describe('The proposalId returned by a propose_ tool.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ proposalId }) => runTool(send, 'confirmProposal', { proposalId }),
  );

  server.registerTool(
    'start_manual_triage',
    {
      title: 'Hand tabs to the user to sort one by one',
      description:
        'Hand tabs you are unsure about to the user: opens TabBuddy\'s one-by-one sorting screen in the ' +
        'browser, showing just these tabs, and brings that window forward. The user then decides each ' +
        'tab themselves (close it, or file it into a snapshot) and can stop at any time. Use it for the ' +
        'tabs you left out of propose_triage_plan because you could not tell whether they matter, and ' +
        'tell the user which tabs and why before you do. It does not close or save anything itself, ' +
        'every other tab in the window stays exactly as it is, and the window is never closed. The ' +
        'tabs must all be in one window. Closed and private tabs and TabBuddy\'s own pages are left ' +
        'out (see "skipped"); pinned tabs and tabs playing sound are included, because the user, not ' +
        'you, makes each call. You get no report of what the user decides: list the open windows ' +
        `again later to see what is left. Up to ${MAX_TRIAGE_TABS} tabs.`,
      inputSchema: {
        tabIds: z
          .array(z.number().int())
          .min(1)
          .max(MAX_TRIAGE_TABS)
          .describe('The tabs you are unsure about, all in one window, from list_open_windows or summarize_window.'),
        request: requestField,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ tabIds, request }) => runTool(send, 'startManualTriage', { tabIds, request }),
  );

  server.registerTool(
    'get_agent_activity',
    {
      title: 'What the agent has done',
      description:
        "List what has been done to the user's browser and snapshots through TabBuddy, newest first: " +
        'opened, saved, created, renamed, tagged, added to, archived, closed, removed and undone. Each ' +
        'entry has an id, a time (ms since epoch), the tool that did it, a one-sentence summary, and ' +
        'whether it can still be undone (only archiving, closing and removing saved tabs can be, and ' +
        'only the 20 most recent such actions). Use it when the user asks what you did, or to find an ' +
        'undoId (the id of an undoable entry). Shows 20 entries by default and at most 100. Read-only.',
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe('How many entries to list. Default 20.'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ limit }) => runTool(send, 'getAgentActivity', limit === undefined ? undefined : { limit }),
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo an archive, close or removal',
      description:
        'Reverse one earlier archive, close or removal of saved tabs, using the undoId from ' +
        'confirm_proposal or the id of an undoable entry from get_agent_activity. Archive: reopens the ' +
        'tabs and takes them back out of the Archived snapshot. Close: reopens the tabs. Triage plan: ' +
        'reopens the tabs, takes back what the plan saved, and deletes the new snapshots it made if ' +
        'nobody has touched them since ("kept" says which were left). Remove from a ' +
        'snapshot: puts the saved tabs back at their original positions (snapshotChangedSince says if the ' +
        'snapshot changed meanwhile, so positions may differ). A closed tab the browser still remembers ' +
        '(its last 25) is restored with its history and scroll position; any other opens fresh from its ' +
        'saved address, and "reopen" in the result counts each kind, plus any that could not come back. ' +
        'Each entry can be undone once. If nothing can be reopened, nothing is changed and the entry stays ' +
        'undoable, so it can be tried again. Use it when the user says they did not mean it or wants ' +
        'the tabs back. Tell them what came back, and that a tab opened fresh will not have its scroll ' +
        'position or anything typed into a form.',
      inputSchema: {
        undoId: z.string().min(1).describe('The undoId from confirm_proposal, or an id from get_agent_activity.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ undoId }) => runTool(send, 'undo', { undoId }),
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

  registerPrompts(server);

  return server;
}

/** Serves MCP over stdio until the client disconnects. stdout carries the
 * protocol, so nothing else may write to it. */
export async function runServe(): Promise<void> {
  const server = createServer(withHandshake(socketSender()));
  await server.connect(new StdioServerTransport());
}
