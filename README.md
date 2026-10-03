# TabBuddy

TabBuddy is an open-source browser extension for Chrome, Brave, Edge, Opera,
and other Chromium-based browsers that lets you snapshot a window's tabs and
save them as a named, reusable group — then restore, update, or manage them
from a dashboard.

Save your "Job Hunt" window, your "Entertainment" window, your "Research"
window — whatever groups of tabs you find yourself recreating every day —
and get them back with one click.

## Features

- **Save a window as a snapshot.** Captures every tab's URL, title,
  favicon, pinned state, and native Chrome tab groups.
- **Restore with smart-detect.** Reopening a snapshot focuses its window if
  it's still open, instead of creating a duplicate.
- **Update in place.** Add or close tabs in a snapshot's live window, then
  re-save over the existing snapshot.
- **Dashboard management.** Rename, reorder tabs, remove individual tabs,
  pin snapshots to a fixed position, and delete — all without needing the
  window open.
- **Search, sort, and pin.** Search snapshots by name, sort by most
  frequently used / recently updated / recently created, and pin your
  most important ones to a fixed position at the top.
- **Export / import.** Back up a single snapshot, a selection, or
  everything as a JSON file — or share one with a friend.
- **Hover to peek.** Hover a snapshot to preview its tabs (with a focus
  blur on everything else) without opening it.
- **Quick links.** A row of circles at the top of the dashboard: your
  three most visited sites (counted on your device, by domain only) and
  three you choose. One click jumps to an open tab or opens the site.
- **Most used and search in the popup.** The toolbar popup shows your top 3 most-opened snapshots, one click away, and a search box that finds any snapshot by name.
- **Categories.** Tag snapshots with any number of categories, then switch
  the dashboard to **Categories** view to see each category as a stack of
  cards. Click a stack to open it, drag cards onto other categories, or
  bulk-tag a selection. Categories travel with exports and imports.
- **Lazy-loaded restore.** Opening a big snapshot loads only the first
  tab; the rest open as light placeholders showing `domain – page title`
  and the full URL, and load only when you click Load. Toggle it from the
  dashboard's settings bar.
- **Tab hoarder nudges.** TabBuddy checks on a schedule you set for tabs
  you've left untouched (you choose what "stale" means), and nudges you to
  Close, Archive (into a reserved, pinned "Archived" snapshot), or
  Keep (snoozes for 2 days). Set how often and how old is stale, in
  minutes, hours, or days, from the dashboard's settings bar.
- **Keyboard shortcut.** `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac) opens the
  dashboard from anywhere — or focuses it if it's already open.
  Customizable at `chrome://extensions/shortcuts`.
- **Agent bridge (optional, off by default).** Let an AI agent such as
  Claude Code open your snapshots by name, search what you've saved, and
  help clean up a crowded window, with your say-so before anything is
  closed. See [Use TabBuddy with AI agents](#use-tabbuddy-with-ai-agents).
- **Privacy-respecting by design.** Runs entirely on-device
  (`chrome.storage.local`), no network calls, no host permissions, no
  content scripts. The one optional exception, the agent bridge, is off
  until you turn it on. See [PRD.md](./PRD.md) for the full permission
  rationale.

See [USER_GUIDE.md](./USER_GUIDE.md) for a full walkthrough of every
feature. See [PRD.md](./PRD.md) for the full product spec and
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for how the project was built,
slice by slice.

## Use TabBuddy with AI agents

The optional **agent bridge** lets an AI agent that speaks the
[Model Context Protocol](https://modelcontextprotocol.io) (Claude Code,
Claude Desktop, and others) use TabBuddy: "open my Job Hunt setup", "find the
pricing page I archived", "clean up this window". Browser-automation tools can
already click around; what only TabBuddy has is your organised record of what
you work on.

**Set it up** (macOS, Chrome, Brave or Edge; Linux and Windows support is
written but not yet tested on real machines):

1. Load TabBuddy in your browser (see below).
2. In a terminal: `npm install -g tabbuddy-bridge && tabbuddy-bridge install`,
   then restart the browser.
3. In TabBuddy, open the gear, **Automation**, **Agent bridge**, and turn it on.
   The dialog shows whether the bridge is connected, and has the commands to copy.
4. Connect your agent, for Claude Code: `claude mcp add tabbuddy -- tabbuddy-bridge serve`
   (`install` prints the same line with full paths).
5. Check it: `tabbuddy-bridge doctor`, then ask your agent "what snapshots do I have?".

**What it can do:** list and search your snapshots, open one, save a window or
a list of links as a snapshot, rename and tag, look over a window and suggest a
cleanup, and hand tabs it is unsure about to TabBuddy's one-by-one sorting
screen. Closing, archiving and removing always take two steps: the agent
proposes, you agree, then it acts. Everything can be undone, and the dashboard
lists what the agent did. There are ready-made prompts too: `triage_window`,
`clean_up_browser`, `switch_to` and `what_was_i_doing`.

**Privacy, exactly:**

- It is **off by default**. Until you switch it on, the extension makes no
  connection and does not even hold the `nativeMessaging` permission (it is
  requested only when you turn the bridge on).
- It talks **only to your own computer**, through a private local socket (a named
  pipe on Windows). There is no network listener, and TabBuddy sends nothing
  anywhere.
- An agent can see: snapshot names, tab titles and URLs, categories, your open
  windows and tabs (title, URL, when you last used it, pinned, playing sound),
  usage counts, and the domains you visit most (only if Quick links counting is on).
- An agent **cannot** see page contents (TabBuddy has no content scripts and no
  access to pages), and incognito tabs are never included or touched.
- What your agent does with that information is up to the agent and its
  provider: for example, an AI assistant sends what it reads to its model. Turn the
  bridge off, or uninstall it with `tabbuddy-bridge uninstall`, whenever you like.
- Optionally, TabBuddy can ask you in the browser, with a window listing the tabs,
  before an agent closes or archives anything.

Details: [USER_GUIDE.md](./USER_GUIDE.md#using-tabbuddy-with-ai-agents),
[bridge/README.md](./bridge/README.md) and the design in
[MCP_Development_Plan.md](./MCP_Development_Plan.md).

## Tech stack

- [WXT](https://wxt.dev) (Manifest V3 scaffolding) + React + TypeScript
- Tailwind CSS + hand-built [shadcn/ui](https://ui.shadcn.com)-style
  components
- [`webextension-polyfill`](https://github.com/mozilla/webextension-polyfill)
  (via WXT's built-in `browser` API) for future cross-browser support

## Getting started

### Prerequisites

- Node.js **22 or later** (a `.nvmrc` is included — run `nvm use` if you
  use nvm)

### Build and load the extension

```bash
npm install
npm run build
```

Then, in Chrome (or any Chromium-based browser):

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `.output/chrome-mv3` folder produced by the build

The TabBuddy icon should appear in your toolbar. Click it to save your
current window, or open the dashboard to manage saved snapshots.

### Development

```bash
npm run dev
```

This starts WXT's dev server with hot-reload. Load the `.output/chrome-mv3`
folder as above once, and it'll keep updating as you edit.

Other useful scripts:

```bash
npm run compile   # TypeScript type-check, no emit
npm run build     # production build
npm run zip       # package a distributable .zip
```

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./CONTRIBUTING.md) for
how to get set up and what to expect.

## License

[MIT](./LICENSE)
