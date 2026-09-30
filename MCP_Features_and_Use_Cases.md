# TabBuddy Agent Bridge: features and use cases

The agent bridge is an optional add-on that lets an AI agent (Claude Code, Claude
Desktop, or any [MCP](https://modelcontextprotocol.io) client) use TabBuddy. It is
off by default and talks only to your own computer. For the design and build
history see [MCP_Development_Plan.md](./MCP_Development_Plan.md).

## What we built

26 tools and 4 prompts, plus the safety and UI around them.

### Read tools (look, never change)

| Tool | What it does |
|---|---|
| `list_snapshots` | Lists your snapshots (tab count, categories, times opened, whether open now). It can filter by category. |
| `get_snapshot` | Reads the tabs inside one snapshot. |
| `list_categories` | Lists your categories and how many snapshots each holds. |
| `list_open_windows` | Lists open windows and tabs, and which snapshot each window came from. |
| `search_tabs` | Keyword search across saved, archived and open tabs. |
| `get_stale_tabs` | Finds tabs you haven't touched for a while, using the same rules as the nudges. |
| `get_usage_stats` | Shows your most-opened snapshots and most-visited sites. |
| `summarize_window` | Gives a compact digest of a crowded window: clusters, idle time, duplicates, tabs already saved, and tabs that may hold unsaved work. |
| `find_duplicate_tabs` | Finds tabs showing the same page and says which to keep. |
| `get_agent_activity` | Lists what the agent has done. |

### Safe write tools (open or save, never close)

| Tool | What it does |
|---|---|
| `restore_snapshot` | Opens a snapshot, or brings its window forward if it's already open. |
| `focus_tab` | Jumps to an open tab. |
| `open_urls` | Opens web pages. |
| `save_window` | Saves a window as a snapshot. |
| `create_snapshot_from_urls` | Saves a list of links as a snapshot, for example an agent's research sources. |
| `add_tabs_to_snapshot` | Adds tabs or links to an existing snapshot, skipping duplicates. |
| `rename_snapshot` | Renames a snapshot. |
| `tag_snapshots` | Adds categories to snapshots, creating any that don't exist. |
| `update_snapshot_from_window` | Re-saves a snapshot from its open window. This replaces the saved tabs, so it is marked destructive. |
| `start_manual_triage` | Hands tabs the agent is unsure about to your one-by-one sorting screen. |

### Destructive actions (always two steps)

- `propose_archive_tabs`, `propose_close_tabs`, `propose_remove_from_snapshot` and
  `propose_triage_plan` change nothing. They only work out what would happen. The
  triage plan covers a whole window: close, archive, file into an existing
  snapshot, or save as a new one.
- `confirm_proposal` carries a proposal out. Before acting it re-checks every tab
  and changes nothing if any tab has changed.
- `undo` reverses an archive, a close, a removal or a whole triage plan.

### Prompts (slash commands in Claude Code)

`triage_window`, `clean_up_browser`, `switch_to` and `what_was_i_doing`.

### Around the tools

- **Off by default:** the extension only requests the `nativeMessaging` permission
  when you turn the bridge on. It talks only to your own computer.
- **"Ask me in the browser first":** a window lists what would be closed and waits
  for your click.
- **Agent activity panel:** groups what the agent did by what you asked for, with
  undo and toasts.
- **Agent bridge settings:** a live status (Off, Connecting, Connected, Bridge not
  installed, Error), commands to copy, and "Check again".
- **Install tooling:** `tabbuddy-bridge install`, `uninstall` and `doctor` for
  macOS, Linux and Windows. Only macOS has been tested on a real machine.

## Use cases

### Switching context

- "Open my Job Hunt setup." It opens the snapshot, or focuses its window if it's
  already open.
- "Switch to my Research workspace and tell me where I left off." It opens the
  snapshot and summarizes what's in it.
- "What was I working on yesterday?" It reviews open windows and recently used
  snapshots.
- "What do I open most?" It answers from usage stats and suggests pinning those
  snapshots.

### Finding things

- "Find that pricing page I had open last week." It searches saved, archived and
  open tabs.
- "Is the Stripe docs page already open somewhere?" It searches open tabs and
  focuses the match.
- "Do I have anything saved about vector databases?" It searches every snapshot.
- "Which snapshot has my flight booking?" It searches saved tabs.

### Cleanup

- "Clean up my browser." It looks at every window, groups what could go, and asks
  once.
- "This window has 150 tabs, help me sort it out." It summarizes, asks what the
  window is for, proposes a plan by cluster, and you confirm once.
- "Close my duplicate tabs." It finds them and proposes closing only the extras.
- "Archive everything I haven't touched in a week." It proposes archiving and waits
  for your yes.
- "Close tabs I already saved in a snapshot." Closing those loses nothing.
- "Just show me the tabs you're unsure about." It hands them to the one-by-one
  screen so you decide each one.
- "I didn't mean that, put them back." It undoes the last cleanup.

### Saving and organizing

- "Save this window as 'Trip planning'." It saves the window as a snapshot.
- "Save my open Figma and Notion tabs as 'Design sprint'." It saves a chosen subset
  as a new snapshot.
- "Add these tabs to my Research snapshot." It appends them and skips duplicates.
- "Tag my job snapshots with 'Work' and rename 'Untitled 3' to 'Taxes 2026'." It
  tags and renames.
- "Which of my snapshots aren't in a category?" It lists them and can tag them.

### Agents doing work with your context

- "Read the docs in my 'Stripe integration' snapshot and implement the webhook
  handler." The snapshot works as a reading list for a coding agent.
- "Research 10 good sources on X and save them as a snapshot called 'X research'."
  The result lands somewhere you can see and reopen.
- "Open the three tabs I need for standup." It uses `open_urls` or a snapshot.
- "Summarize the pages in my 'Reading list' snapshot." It reads the titles and
  links, though not the page contents.

### Trust and oversight

- "What did you just do to my browser?" It reads the activity log.
- "Ask me before closing anything." The in-browser confirmation window does this.
- "Undo the last thing you did." It undoes the most recent action.
- Everything is grouped by what you asked for, so you can review it later in the
  dashboard.

## Limits to keep in mind

- **No page contents:** an agent only sees titles and URLs. It can't read what's on
  a page, so "summarize this article" needs a different tool.
- **No snapshot deletion:** an agent can't delete a whole snapshot. It can remove
  individual saved tabs, after a confirmed proposal.
- **Incognito tabs** are never included or touched.

## Trying it (testers)

You need two files: the extension zip and the bridge tarball.

1. Unzip `tabbuddy-1.1.0-chrome.zip`, open `chrome://extensions`, turn on Developer
   mode, and choose **Load unpacked** on the unzipped folder.
2. In a terminal: `npm install -g ./tabbuddy-bridge-0.1.0.tgz`, then
   `tabbuddy-bridge install`. Load the extension first, because `install` finds it
   by reading the browser's profiles. Restart the browser afterwards.
3. In TabBuddy: gear, **Automation**, **Agent bridge**, and switch it on.
4. Connect your agent. For Claude Code:
   `claude mcp add tabbuddy -- tabbuddy-bridge serve`.
5. Run `tabbuddy-bridge doctor`. It checks each step and says how to fix the first
   problem. Then ask your agent "what snapshots do I have?".

Notes: the dialog and README say `npm install -g tabbuddy-bridge`, which only works
once the package is published, so use the tarball for now. Moving the unzipped
extension folder changes its ID, so run `tabbuddy-bridge install` again. macOS is the
only platform tested on a real machine; on Linux or Windows please send the output
of `tabbuddy-bridge doctor` if something fails.
