import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MAX_SNAPSHOT_NAME_LENGTH } from '../protocol.js';

/** How many tabs a plan may touch before the agent must always ask first. */
const ASK_ALWAYS_ABOVE = 10;

function userMessage(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

/** Lines shared by every prompt that can end in closing or archiving tabs. */
const SAFETY_RULES = [
  'Ground rules:',
  '- Pass one short `request` phrase, in the user\'s words, on every tool call that changes something, so the activity log groups them.',
  '- Refer to tabs and snapshots by title or name, never by raw id.',
  '- Nothing is closed, archived or removed until the user has agreed to the exact list; propose first, confirm after.',
  '- Leave pinned tabs, tabs playing sound and tabs in a snapshot\'s open window alone unless the user named them.',
  '- After anything is confirmed, say what was done and that it can be undone.',
];

export function triageWindowText(args: { windowId?: number; purpose?: string }): string {
  const target =
    args.windowId === undefined
      ? 'the browser window I used last'
      : 'the browser window with id ' + args.windowId + ' (use it as windowId; do not show me the number)';
  const purpose = args.purpose?.trim();
  return [
    `Help me sort out ${target}: it has a lot of tabs.`,
    purpose
      ? `What the window is for, in my words: "${purpose}". Do not ask me that again.`
      : 'You do not know what the window is for yet, so ask me that (one short question) once you have looked at it.',
    '',
    'Steps:',
    '1. Look first, change nothing: call summarize_window, find_duplicate_tabs and list_snapshots (and list_categories if it helps).',
    '2. Tell me in a few sentences what you see: how many tabs, the biggest clusters of sites, how many are duplicates, how many are already saved elsewhere, and any that might hold unsaved work.',
    purpose
      ? '3. Use my stated purpose to decide what matters.'
      : '3. Ask what the window is for, and wait for my answer.',
    '4. Propose the plan by cluster, not tab by tab. Put each tab in one bucket: close (duplicate extras, blank pages, pages already saved in a snapshot), archive (probably not needed, but keep a copy), file into one of my existing snapshots, or save together as a new snapshot with a fitting name and category. Prefer archive over close whenever I might want the page again.',
    '5. Tabs you cannot judge: leave them out of the plan, tell me which ones and why, and offer to hand them to me to sort one by one (start_manual_triage).',
    '6. Ask me ONCE for a verdict on the whole plan. If I named specific tabs or clusters myself, act on my words and do not re-ask about those. If I want changes, adjust and show the updated plan.',
    `7. Call propose_triage_plan with the agreed plan and ask for my go-ahead before confirm_proposal, unless I already told you to close or archive exactly those tabs. If the plan touches more than ${ASK_ALWAYS_ABOVE} tabs, always ask, even if I sounded sure earlier.`,
    '8. Then confirm_proposal, report what happened, and offer start_manual_triage for the tabs you left open.',
    '',
    ...SAFETY_RULES,
  ].join('\n');
}

export function cleanUpBrowserText(): string {
  return [
    'Help me clean up my browser: all my open windows, not just one.',
    '',
    'Steps:',
    '1. Look first, change nothing: call list_open_windows, get_stale_tabs, find_duplicate_tabs and list_snapshots.',
    '2. Give me a short picture: how many windows and tabs, which windows already belong to a snapshot (leave those alone), how many tabs are stale, how many are duplicates.',
    '3. Suggest what to do by group, not tab by tab: duplicates to close, stale tabs to archive, loose tabs that belong in an existing snapshot or deserve a new one. Prefer archive over close whenever I might want the page again.',
    '4. Ask me once whether that is what I want, and adjust if I say otherwise. If one window is the real mess, offer to work through that window as a triage (propose_triage_plan) instead.',
    `5. Propose with propose_archive_tabs, propose_close_tabs or propose_triage_plan, show me the exact list by title, and only confirm_proposal after I agree. Always ask when it is more than ${ASK_ALWAYS_ABOVE} tabs.`,
    '6. Report what was done and mention that it can be undone.',
    '',
    ...SAFETY_RULES,
  ].join('\n');
}

export function switchToText(name: string): string {
  return [
    `Switch me to my "${name}" workspace.`,
    '',
    'Steps:',
    `1. Call list_snapshots and find the snapshot that best matches "${name}" (names may differ slightly in case or wording).`,
    '2. If several are close, list them by name and ask me which; if none match, say so and offer to search my tabs with search_tabs. Do not open something else without asking.',
    '3. Call restore_snapshot. If it was already open, say that its window was brought to the front.',
    '4. Then call get_snapshot and tell me in a few lines what is in it: the main sites and pages, and anything that looks like the thing I was in the middle of.',
    '',
    'This only opens things: nothing is closed or changed. Pass one short `request` phrase (for example "switch to ' + name + '") on the calls that change something. Refer to snapshots and tabs by name, never by id.',
  ].join('\n');
}

export function whatWasIDoingText(): string {
  return [
    'Remind me what I was working on.',
    '',
    'Steps:',
    '1. Call list_open_windows and list_snapshots (newest updates and most-used ones matter most), and get_usage_stats if it helps.',
    '2. Summarize in a short list: what each open window seems to be about (say which saved snapshot it belongs to, if any), and which snapshots were updated or opened most recently.',
    '3. Say what you think the main thread of my work is, and how sure you are; you only see titles and addresses, never page contents.',
    '4. Offer a next step (focus a tab, open a snapshot), but do not do anything yet.',
    '',
    'This is read-only. Refer to windows, tabs and snapshots by name or title, never by id.',
  ].join('\n');
}

/** MCP prompts: ready-made conversations that clients show as slash commands. */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'triage_window',
    {
      title: 'Triage a window with lots of tabs',
      description:
        'Look over one crowded browser window, recommend what to close, archive or file into snapshots, ' +
        'and carry out the plan after one confirmation. Tabs it is unsure about go to TabBuddy\'s ' +
        'one-by-one sorting screen.',
      argsSchema: {
        windowId: z.string().optional().describe('Window to triage, if not the one used last.'),
        purpose: z.string().optional().describe('What the window is for, so the agent need not ask.'),
      },
    },
    ({ windowId, purpose }) => {
      const parsed = windowId === undefined || windowId.trim() === '' ? undefined : Number(windowId);
      const id = parsed !== undefined && Number.isInteger(parsed) ? parsed : undefined;
      return userMessage(triageWindowText({ windowId: id, purpose }));
    },
  );

  server.registerPrompt(
    'clean_up_browser',
    {
      title: 'Clean up my browser',
      description:
        'Look at every open window, group what could go, and archive or close it after asking. ' +
        'Nothing is closed until you agree.',
    },
    () => userMessage(cleanUpBrowserText()),
  );

  server.registerPrompt(
    'switch_to',
    {
      title: 'Switch to a workspace',
      description: 'Open a saved snapshot by name and summarize what is in it.',
      argsSchema: {
        name: z
          .string()
          .min(1)
          .max(MAX_SNAPSHOT_NAME_LENGTH)
          .describe('Name of the snapshot to open, e.g. "Job Hunt".'),
      },
    },
    ({ name }) => userMessage(switchToText(name.trim())),
  );

  server.registerPrompt(
    'what_was_i_doing',
    {
      title: 'What was I doing?',
      description: 'Summarize the open windows and recently used snapshots to remind you what you were working on.',
    },
    () => userMessage(whatWasIDoingText()),
  );
}
