# TabBuddy Agent Bridge (MCP) — Requirements and Development Plan

Part 1 is the product spec (in the style of [PRD.md](./PRD.md)). Part 2 is the
vertical-slice plan (in the style of [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md)).

---

# Part 1 — Requirements

## 1. Summary

The TabBuddy Agent Bridge is an optional add-on that exposes TabBuddy to AI
agents (Claude Code, Claude Desktop, or any other MCP client) through a local
[Model Context Protocol](https://modelcontextprotocol.io) server.

Generic browser-automation tools can already open and close tabs. What only
TabBuddy has is an organized record of what the user works on: named
snapshots, categories, usage counts, tab staleness, the Archived pile and
visited-site stats. The bridge gives an agent access to that record so it can
switch workspaces by name, clean up tabs with an understanding of context,
search everything the user has saved, and use snapshots as working context for
coding and research tasks.

**Example use cases:**

- "Open my Job Hunt setup." → restores the snapshot, or focuses its window if
  it's already open.
- "Clean up my browser." → the agent groups the open tabs, proposes what to
  archive, and does it after the user agrees.
- "What was that pricing page I had open last week?" → searches the snapshots
  and the Archived snapshot, then reopens the match.
- "Read the docs in my 'Stripe integration' snapshot and implement the
  webhook handler." → the snapshot works as a reading list for a coding agent.
- "Save the sources you found as a snapshot called 'Vector DB research'."
  → the agent's research ends up somewhere the user can see and reopen.

## 2. Goals

- Let an MCP client read TabBuddy data (snapshots, categories, open windows,
  stale tabs, usage) and act on it (restore, save, tag, archive, close).
- Keep the core extension's privacy promise. The bridge is **off by default**,
  talks **only to the local machine**, and sends data only to the MCP client
  the user connects.
- Make destructive actions safe: the agent always proposes first, and nothing
  is closed or removed until the proposal is confirmed.
- Make setup a single command, plus one toggle in the dashboard.
- Keep the extension-side code in the same shape as the rest of `lib/`: pure,
  unit-tested functions with thin browser wiring.

## 3. Non-Goals

- Reading page contents. There's no `executeScript`, no content scripts and
  no DOM access. The agent sees URLs, titles and TabBuddy metadata only.
- Remote access. There's no network listener, no WebSocket and no cloud relay.
- Bundling an LLM or making any AI calls from the extension itself.
- Incognito tabs. They're never included in responses or affected by actions.
- Several browsers or profiles bridged at the same time in v1 (see §8).
- Safari.

## 4. User Stories

1. As a user, I want to ask my agent to open a named snapshot, so I can switch
   work contexts without leaving the terminal or chat.
2. As a user, I want my agent to look at my open tabs and suggest what to
   archive or close based on what I'm working on, not only on how old each
   tab is.
3. As a user, I want to approve any closing or archiving before it happens,
   and I want to be able to undo it.
4. As a user, I want to search every tab I've saved or archived using a vague
   description.
5. As a user, I want my agent to save a set of URLs it found as a snapshot,
   tagged with a category.
6. As a user, I want to see what the agent did through the bridge, so I can
   trust it.
7. As a user, I want to turn the bridge on and off from the dashboard, and see
   whether it's connected.
8. As a privacy-conscious user, I want the bridge to have no effect on my
   install unless I switch it on.

## 5. Functional Requirements

### 5.1 Architecture

Two parents start two different processes, so one binary runs in two modes
and the two meet over a Unix socket.

```
MCP client ──stdio / MCP──▶ tabbuddy-bridge serve
                                  │  Unix socket (~/.tabbuddy/bridge.sock, mode 0600)
                                  ▼
Browser ─stdio / native msg─▶ tabbuddy-bridge host
                                  ▲  runtime.Port (connectNative)
                                  │
                        TabBuddy service worker ──▶ lib/storage, restore, archive…
```

- **`host` mode:** the browser starts it when the extension calls
  `runtime.connectNative('com.tabbuddy.bridge')`. It lives as long as the
  port is open. It listens on the socket and passes requests and responses
  between the socket and native-messaging frames.
- **`serve` mode:** the MCP client starts it. It's a stdio MCP server that
  sends each tool call over the socket and waits for the matching reply.
- **Extension:** `lib/agentBridge.ts` holds a pure `dispatch(request)`
  function backed by a handler table that calls existing `lib/` functions,
  plus `startAgentBridge()`, which manages the port. An open native port keeps
  the MV3 service worker alive, so no keep-alive trick is needed.

### 5.2 Wire protocol

- The envelopes are JSON:
  - Request: `{ id, method, params? }`
  - Response: `{ id, result }` or `{ id, error: { code, message } }`
- **Framing:** native messaging uses a 4-byte little-endian length prefix and
  UTF-8 JSON. The socket uses newline-delimited JSON.
- **Handshake:** a `hello` request returns
  `{ protocol: 1, extensionVersion }`. `serve` refuses to run against an
  unknown protocol version and explains why.
- **Timeouts:** 10 seconds per request in `serve`. Restoring a very large
  snapshot may need a longer, method-specific timeout.
- **Error codes:**

  | Code | Meaning |
  |---|---|
  | `not_found` | No snapshot, tab or window with that id |
  | `invalid_params` | Parameters failed validation |
  | `reserved_name` | The name clashes with the reserved "Archived" snapshot |
  | `proposal_expired` | The proposal expired or was already used |
  | `bridge_disabled` | The user switched the bridge off |
  | `browser_unreachable` | No socket, or a stale one (raised in `serve`) |
  | `internal` | Anything else |

- **Size:** a message from the host to the extension can be at most 1 MB.
  Responses must stay small: favicons are always stripped, list results are
  capped (default 50, with a `truncated: true` flag), and titles are cut at
  200 characters.

### 5.3 Tool catalog

Tool names and descriptions are written for an LLM. Descriptions should say
when to use a tool, not only what it does.

**Read tools**

| Tool | Params | Returns | Backed by |
|---|---|---|---|
| `list_snapshots` | `categoryId?` | id, name, tabCount, categories, usageCount, pinned, isOpen, updatedAt | `getSnapshots`, `getCategories` |
| `get_snapshot` | `id` | The full snapshot without favicons. Tabs are addressed by `index` | `getSnapshots` |
| `list_categories` | none | id, name, snapshotCount | `getCategories` |
| `search_tabs` | `query`, `scope?` (`saved` / `archived` / `open` / `all`) | Matches with where they live (snapshot and index, or window and tab id) | New pure `searchTabs()` |
| `list_open_windows` | none | Windows → tabs with id, title, url, lastAccessed, pinned, audible, linked snapshot name, `managed` | `tabs.query`, `getManagedTabIds` |
| `get_stale_tabs` | `olderThanMinutes?` | Open tabs the nudge logic would flag, with how stale each one is | `findNudgeCandidates`, `scoreTabImportance` |
| `get_usage_stats` | none | Top snapshots by usage, top sites (domains only) | `sort.ts`, `getTopSites` |
| `summarize_window` | `windowId?` | A compact digest of one window: counts, idle buckets, biggest sites with tab ids, duplicates, tabs already saved elsewhere, tabs that may hold unsaved work | `shapeOpenWindows`, `pageKey` |
| `find_duplicate_tabs` | `windowId?` | Groups of tabs on the same page, with the one to keep and the extras | `pageKey` |

**Safe write tools** (these don't close or remove anything)

| Tool | Params | Effect | Backed by |
|---|---|---|---|
| `restore_snapshot` | `id` | Focuses the window if it's open, otherwise opens it (lazy restore follows the user's setting) | `restoreSnapshot` |
| `focus_tab` | `tabId` | Switches to that tab and its window | `tabs.update`, `windows.update` |
| `open_urls` | `urls[]`, `newWindow?` | Opens URLs | `tabs.create` |
| `save_window` | `windowId?`, `name`, `categoryIds?` | Saves a window as a new snapshot (defaults to the last focused window) | `captureWindowTabs`, `addSnapshot` |
| `create_snapshot_from_urls` | `name`, `urls[]` or `{url,title}[]`, `categoryIds?` | Creates a snapshot without opening anything, for reading lists made by an agent | `addSnapshot` |
| `update_snapshot_from_window` | `id` | Re-saves a snapshot from its open window | `updateSnapshotFromLiveWindow` |
| `rename_snapshot` | `id`, `name` | Renames a snapshot (the Archived snapshot is protected) | `renameSnapshot` |
| `tag_snapshots` | `snapshotIds[]`, `categoryNames[]` | Adds categories to snapshots, creating any that are missing | `addCategory`, `addSnapshotsToCategories` |
| `add_tabs_to_snapshot` | `id`, `tabIds[]?`, `urls[]?` | Appends open tabs and/or links to an existing snapshot, skipping pages already in it; never closes a tab | `updateSnapshot`, `pageKey` |

**Destructive tools** (always two steps)

| Tool | Params | Effect |
|---|---|---|
| `propose_archive_tabs` | `tabIds[]` | Returns a proposal (id, tabs, expiry). Nothing changes yet |
| `propose_close_tabs` | `tabIds[]` | Same as above, for closing without archiving |
| `propose_remove_from_snapshot` | `snapshotId`, `indexes[]` | Same as above, for removing tabs from a saved snapshot |
| `confirm_proposal` | `proposalId` | Carries out the proposal and returns what happened plus an `undoId` |
| `undo` | `undoId` | Reverses the last confirmed action: reopens archived or closed tabs, or puts removed tabs back |

Deleting a whole snapshot is deliberately not exposed in v1.

**MCP prompts** (these show up as slash commands in clients such as Claude
Code)

| Prompt | What the agent does |
|---|---|
| `clean_up_browser` | Groups the open tabs, proposes archives and snapshots, and asks before confirming |
| `switch_to` | Restores a named snapshot and summarizes what's in it |
| `what_was_i_doing` | Summarizes open windows and recently updated snapshots |

### 5.4 Confirmation and trust model

- **Proposals:**
  - Kept in memory in the service worker.
  - Expire after 5 minutes.
  - Can be used only once.
  - Become invalid when the service worker restarts.
  - Before confirming, recheck that every tab still exists and still has the
    same URL. If anything changed, report that and change nothing.
- **Tool descriptions** tell the agent to show the proposal to the user and
  call `confirm_proposal` only after explicit agreement.
- **Optional in-browser confirmation** (a setting, off by default). With it
  on, `confirm_proposal` opens a small TabBuddy window listing the tabs, with
  Confirm and Cancel buttons, and reuses the nudge-window code. With this
  setting on, a misbehaving agent can't close anything without a click from
  the user.
- **Activity log:** the extension stores the last 100 bridge actions (time,
  tool, short summary, `undoId`). The dashboard shows them.
- **Undo:**
  - Archive and close are undone by reopening the tabs, and archived entries
    are also removed from the Archived snapshot.
  - Removing tabs from a snapshot is undone by putting them back at their
    original indexes.

### 5.5 Settings and dashboard UI

The settings bar gets a new **Agent bridge** section containing:

- An on/off toggle. Turning it on requests the optional `nativeMessaging`
  permission. Turning it off disconnects the port.
- A status line showing one of four states:
  - Off
  - Connected (with the host's version)
  - Bridge not installed (shows the install command with a copy button)
  - Error
- An option: "Ask me in the browser before the agent closes or archives
  tabs".
- An "Agent activity" link that opens the activity log, with an Undo action
  on each entry that can be undone.

Other UI changes:

- A toast appears for each confirmed destructive action, for example
  "Agent archived 12 tabs", using the existing toast queue.
- An onboarding step and a USER_GUIDE section explain the bridge.

### 5.6 Installer

- `npx tabbuddy-bridge install`:
  - Writes the native-messaging host manifest for each browser it finds.
  - Writes a launcher script with the absolute path to Node, because the
    browser's `PATH` won't include nvm or Homebrew.
  - Prints the command to register the MCP client:
    `claude mcp add tabbuddy -- npx tabbuddy-bridge serve`
- `uninstall` removes everything `install` wrote.
- `doctor` checks, in order:
  1. The manifests exist.
  2. The extension ID matches.
  3. The socket is reachable.
  4. `hello` gets a reply.

  It then prints the first failure it finds, with a fix.
- Host manifest locations:

  | Platform | Browser | Location |
  |---|---|---|
  | macOS | Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
  | macOS | Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` |
  | macOS | Edge | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/` |
  | Linux | Chrome | `~/.config/google-chrome/NativeMessagingHosts/` |
  | Linux | Chromium | `~/.config/chromium/NativeMessagingHosts/` |
  | Linux | Brave | `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` |
  | Windows | any | Registry key under `HKCU\Software\<vendor>\NativeMessagingHosts\` pointing at the manifest |
  | any | Firefox | Mozilla's `NativeMessagingHosts/` directory, using `allowed_extensions` with the gecko ID instead of `allowed_origins` |

## 6. Technical Requirements

- **Extension:**
  - The code lives in `lib/agentBridge.ts` and related files.
  - `nativeMessaging` goes in `optional_permissions` in `wxt.config.ts`.
    Confirm that both Chrome and Firefox allow it as optional. If either
    doesn't, ship an "agent" build flavor instead.
  - Unpacked dev builds pin their extension ID with a `key` in the dev
    manifest, so `allowed_origins` stays stable.
- **Bridge:**
  - A separate Node 22 package in `bridge/`, with its own `package.json`
    and vitest.
  - Uses `@modelcontextprotocol/sdk` and `zod`.
  - Shares `protocol.ts` types with the extension.
- **stdout discipline:** in both bridge modes, stdout is reserved for the
  protocol, and all logs go to stderr or `~/.tabbuddy/bridge.log`.
- **Socket safety:**
  - The socket directory is created with mode 0700 and the socket itself
    with mode 0600.
  - `host` replaces a stale socket only after confirming nothing is
    listening on it.
  - A second live host exits with a clear error.
- **Packaging:** the Firefox sources zip must exclude `bridge/**`.
- **Privacy docs:** README, PRD and USER_GUIDE state exactly what the bridge
  exposes, and that it's off by default.

## 7. Distribution

- **v1:** publish the bridge to npm as `tabbuddy-bridge`, so it runs with
  `npx`. The extension ships the toggle in its normal store builds.
- **Later:** a single-file binary (`bun build --compile`) per platform. It
  removes the dependency on Node and avoids the Node-path problem.

## 8. Open Questions and Future Work

- **Several browsers or profiles at once:** use a socket per instance
  (`~/.tabbuddy/sockets/<id>.sock`) plus a `list_browsers` tool and a
  `browser` parameter on every tool.
- **MCP resources:** expose snapshots as `tabbuddy://snapshot/<id>`
  resources so clients can attach them as context.
- **Change notifications:** push updates from the extension, such as "a
  snapshot changed" or "a window closed", to a long-running agent.
- **"Tab importance" as a tool:** expose the scoring in `importance.ts`
  directly, so agents can explain why a tab was flagged.

---

# Part 2 — Vertical Slice Plan

Same rules as the main plan. Each slice can be built on its own, tested by
hand in a real browser (and with unit tests wherever the logic is pure), and
committed on its own. No slice depends on a later one.

A slice isn't done until it passes its manual test and has a commit scoped to
just that slice.

**Manual-test tools:**

- The service worker console (`chrome://extensions` → TabBuddy → "service
  worker").
- A `tabbuddy-bridge ping` / `call <method> <json>` debug CLI, from P3
  onward.
- [MCP Inspector](https://github.com/modelcontextprotocol/inspector)
  (`npx @modelcontextprotocol/inspector`), from P5 onward.
- Claude Code itself, from P5 onward.

---

## Track P — Plumbing: one request, end to end

**Goal:** a single `list_snapshots` call from Claude Code returns real data.
Every later track only adds handlers and tools.

### ✅ Slice P1 — Protocol and dispatcher
**Build:**
- `bridge/protocol.ts` with the request, response and error types, and the
  method names.
- `lib/agentBridge.ts` with a pure `dispatch(request, handlers)` function
  and two handlers:
  - `hello`
  - `listSnapshots`, returning the summary shape from §5.3 without favicons.
- No browser wiring yet.

**Test:** Unit tests covering:
- An unknown method returns `unknown_method`.
- A handler that throws is mapped to an error code.
- `listSnapshots` strips favicons and computes `tabCount` and `isOpen`.
- `hello` returns the protocol version.

**Commit:** `feat(bridge): add the agent bridge protocol and dispatcher`

### ✅ Slice P2 — Opt-in toggle and port lifecycle
**Build:**
- `nativeMessaging` added to `optional_permissions`.
- An `agentBridgeEnabled` storage key.
- `startAgentBridge()`:
  - Connects only when the bridge is enabled.
  - Answers port messages with `dispatch`.
  - On disconnect, retries with exponential backoff (5 seconds up to a
    10-minute cap).
  - Reconnects or disconnects when the setting changes.
- `background.ts` calls `startAgentBridge()`.
- A temporary settings-bar chip requests the permission and flips the flag.
  The real UI arrives in S1.

**Test:**
- Unit tests for the backoff schedule and the enabled/disabled transitions,
  using a fake port.
- Manual: switch the bridge on without a host installed and confirm:
  - No crash.
  - One `onDisconnect` log line per backoff step.
  - Switching it off stops the retries.
- Manual: with the bridge off, confirm the install behaves exactly as before
  (no permission prompt, no connection attempts).

**Commit:** `feat(bridge): opt-in native messaging connection with backoff`

### ✅ Slice P3 — Bridge package, `host` mode and the ping CLI
**Build:**
- The `bridge/` package scaffold (TypeScript, vitest, `bin: tabbuddy-bridge`).
- Native-messaging framing (read and write).
- `host` mode:
  - Listens on the socket (mode 0600).
  - Forwards requests to the extension and routes replies back by `id`.
  - Exits when stdin closes.
  - Refuses to run if another live host holds the socket.
- Debug commands:
  - `tabbuddy-bridge ping` sends `hello` over the socket.
  - `tabbuddy-bridge call <method> [json]` sends any request.
- A hand-written host manifest plus a launcher script, documented in
  `bridge/README.md` for now.

**Test:**
- Unit tests for framing: split chunks, several messages in one chunk, and a
  message at exactly the 1 MB limit.
- A unit test for routing replies back by id.
- Manual:
  - Install the manifest by hand, then turn the bridge on.
  - `tabbuddy-bridge ping` prints the extension version.
  - `call listSnapshots` prints your snapshots.
  - Quitting the browser removes the socket, and `ping` then fails cleanly.

**Commit:** `feat(bridge): add native messaging host mode and debug CLI`

### ✅ Slice P4 — Installer and `doctor`
**Build:**
- `tabbuddy-bridge install`, `uninstall` and `doctor` for macOS
  Chrome/Brave/Edge.
- Writes the manifests and a launcher script with an absolute Node path.
- Finds the extension ID by reading each browser's profiles for an unpacked
  build named "TabBuddy", and takes extra IDs with `--extension-id`.
  *(Changed while building: a pinned `key` would change the ID Chrome derives
  from the folder path and orphan the user's saved snapshots, which are stored
  per ID.)*
- Brave on macOS reads host manifests only from Chrome's `NativeMessagingHosts`
  folder, so for Brave `install` writes both folders and Chrome and Brave share
  one manifest allowing both IDs. *(Found by testing.)*

**Test:**
- Unit tests for manifest generation and per-browser paths, using a fake
  home directory.
- Manual:
  - Remove the hand-installed manifest from P3.
  - Run `install`, restart the browser, and confirm `doctor` is all green.
  - Run `uninstall` and confirm `doctor` reports the first missing piece.

**Commit:** `feat(bridge): add install, uninstall and doctor commands`

### ✅ Slice P5 — `serve` mode with `list_snapshots` and `get_snapshot`
**Build:**
- The `serve` command, a stdio MCP server built with
  `@modelcontextprotocol/sdk`:
  - Performs the protocol handshake on the first call.
  - Registers two tools, `list_snapshots` and `get_snapshot`, with a
    `getSnapshot` handler in the extension.
  - Reports `browser_unreachable` with a message that tells the user what to
    do.
- `install` prints the `claude mcp add` line.

**Test:**
- Unit tests for `get_snapshot`: tabs addressed by index, and `not_found`.
- A unit test for mapping a socket failure to `browser_unreachable`.
- Manual:
  - MCP Inspector lists both tools, and calls return real data.
  - In Claude Code, "what snapshots do I have?" answers correctly.
  - With the browser closed, the agent gets the "open your browser" message.

**Commit:** `feat(bridge): serve TabBuddy snapshots over MCP`

---

## Track R — Read tools

### ✅ Slice R1 — Categories and open windows
**Build:**
- `list_categories`.
- `list_open_windows`, which lists tabs with:
  - lastAccessed, pinned and audible
  - linked snapshot name
  - `managed`
- `list_snapshots` accepts a `categoryId` filter.
- Incognito windows are excluded.

**Test:**
- Unit tests for the pure shaping functions: the incognito filter, attaching
  the linked snapshot, and title truncation.
- Manual (Claude Code): "what windows do I have open and which snapshot is
  each?"

**Commit:** `feat(bridge): add categories and open-window tools`

### ✅ Slice R2 — Search
**Build:**
- A pure `searchTabs(query, sources, scope)` function:
  - Matches case-insensitive tokens against title, URL and domain.
  - Ranks results by how many tokens match, then by recency.
  - Caps results at 50, with a `truncated` flag.
- The `search_tabs` tool, whose `scope` covers saved, archived, open or all.

**Test:**
- Unit tests for matching, ranking, the scope filter, the Archived snapshot
  counting as "archived", and truncation.
- Manual: "find the pricing page I archived" finds it.

**Commit:** `feat(bridge): search saved, archived and open tabs`

### ✅ Slice R3 — Stale tabs and usage stats
**Build:**
- `get_stale_tabs`:
  - Reuses `scoreTabImportance` and `findNudgeCandidates`.
  - The threshold defaults to the user's nudge setting.
  - Includes minutes since last use.
  - Leaves out managed and snoozed tabs, matching how nudges behave.
- `get_usage_stats` returns the top snapshots by usage and the top sites
  (domains only).

**Test:**
- Unit tests for the stale-tab shaping and threshold defaulting.
- Manual: with `olderThanMinutes: 1`, idle tabs show up, and tabs from a
  restored snapshot don't.

**Commit:** `feat(bridge): expose stale tabs and usage stats`

---

## Track W — Safe writes

### ✅ Slice W1 — Restore, focus and open
**Build:**
- `restore_snapshot`, which reuses `restoreSnapshot`, so usage count and lazy
  restore behave as they do in the dashboard.
- `focus_tab`.
- `open_urls`, with `newWindow`. Only http and https URLs are allowed.

**Test:**
- Unit tests for URL validation (rejects `javascript:`, `file:`,
  `chrome:`).
- Manual:
  - "Open my Job Hunt snapshot" opens it, or focuses it if it's already open.
  - Its usage count goes up in the dashboard.

**Commit:** `feat(bridge): restore snapshots and open tabs from an agent`

### ✅ Slice W2 — Save a window
**Build:**
- Refactor `createSnapshotFromCurrentWindow` into
  `createSnapshotFromWindow(windowId, name)`. The popup keeps its current
  behaviour.
- `save_window`:
  - Defaults to the last focused window.
  - Uses a unique name from `names.ts`.
  - Rejects the reserved name.
  - Applies any `categoryIds` passed in.

**Test:**
- Unit tests for the refactored capture, and for the reserved-name and
  unique-name handling.
- Manual: "save this window as Research". The snapshot appears in the
  dashboard, linked to the window, and its tabs are managed (so they aren't
  nudged).

**Commit:** `feat(bridge): save a window as a snapshot from an agent`

### ✅ Slice W3 — Agent-made snapshots, update, rename and tag
**Build:**
- `create_snapshot_from_urls`, which saves a snapshot without opening
  anything.
- `update_snapshot_from_window`.
- `rename_snapshot`, which reuses `renameSnapshot`.
- `tag_snapshots`, which creates any missing categories by name
  (case-insensitive) and adds them.

**Test:**
- Unit tests for building a snapshot from URLs (titles fall back to the
  domain, and invalid URLs are dropped) and for tag de-duplication.
- Manual: ask Claude Code to research a topic and save its sources as a
  tagged snapshot. The snapshot shows up in Categories view.

**Commit:** `feat(bridge): let agents create, update, rename and tag snapshots`

---

## Track T — Triage a big window (agent recommends, user decides)

**Goal:** an agent looks at a window with many tabs, summarises the situation,
recommends what to close, what to file into an existing snapshot and what into
a new one, and the user agrees, customises or disagrees. Tabs the agent is
unsure about go to TabBuddy's one-by-one screen. The reading and filing half
is built; closing needs Track X.

### ✅ Slice T1 — Duplicate tabs
**Build:** `find_duplicate_tabs` and a shared `pageKey` (ignores `www`, http vs
https, a trailing slash, tracking parameters, parameter order and a plain
`#fragment`; route-style fragments stay distinct). Each group names the tab to
keep and the extras.
**Commit:** `feat(bridge): add duplicate-tab detection and a window summary`

### ✅ Slice T2 — Window summary
**Build:** `summarize_window`, a digest that stays small for a window with
hundreds of tabs: counts, idle buckets, the biggest sites with sample titles
and tab ids, duplicates, tabs already saved in another snapshot, and tabs that
may hold unsaved work (guessed from address and title only).
**Commit:** same as T1.

### ✅ Slice T3 — Add to an existing snapshot
**Build:** `add_tabs_to_snapshot`, the append tool "add this to my X snapshot"
needs. It skips duplicates and reports every skip.
**Commit:** `feat(bridge): add tabs and links to an existing snapshot`

### ✅ Slice T4 — One confirmed triage plan
**Build:** `propose_triage_plan` takes up to four buckets (close, archive, file
into existing snapshots by id, save as new snapshots with optional categories),
each tab in exactly one, up to 300 tabs in all. Tabs not listed stay open.
Confirming goes through the same `confirm_proposal`:
- every tab is checked again, and the snapshots to file into must still exist;
  if anything changed, nothing is touched;
- phase one saves everything (new snapshots, tabs added to existing ones, the
  archive) and is rolled back if any write fails, with nothing closed yet;
- phase two closes every tab;
- one activity entry, and one undo, covers the whole plan.

Undo reopens the tabs and takes back only what the plan saved, and only for tabs
that really came back. A new snapshot the plan made is deleted only if nobody has
touched it since and all its tabs are back; otherwise it is kept and reported.
The shared per-tab checks moved into `proposalChecks.ts` so single-tab and triage
proposals use the same rules.

**Test:** unit tests for validation, proposing, the save-before-close order, the
rollback, and each undo case; live with throwaway tabs (propose changes nothing,
confirm, undo, back to the start).
**Commit:** `feat(bridge): plan a whole cleanup in one confirmed triage plan`

### ✅ Slice T5 — Manual triage for the unsure tabs
**Build:** `start_manual_triage(tabIds)` opens the existing one-by-one sorting screen
for just those tabs, in the window they are in, and brings it forward. The user
decides each tab; the tool closes and saves nothing. Tabs must be in one window;
closed, private and TabBuddy tabs are left out and reported; pinned and playing
tabs are included because a person, not the agent, decides. It is logged, without
an undo.

The screen (`dashboard.html?triage=<window>&tabs=1,2,3`) changed in three ways:
- it shows only the handed-over tabs, in the order given, with a banner saying why;
- it closes the window at the end only for a whole-window session, never for a
  handed-over list, which would have closed tabs the user never saw;
- a malformed `tabs=` value reads as an empty list, never as the whole window.

*(Found while testing: undo on this screen broke closing. The browser gives a
restored tab a new id, but the screen kept the old one, so closing the card again
failed with "may already be closed", and filing it again left the restored tab
open. Yesterday's change that made filing really close the tab exposed it for
filed tabs; for plain closes it had been latent since the screen was written. The
screen now takes the new id from the restored session, whether a tab or a whole
window. Confirmed in a real browser: a restored throwaway tab changed id.)*

**Test:** unit tests for the address, the parsing and the handler; render tests of
the real screen in both modes, including that a handed-over list never closes the
window and that undo-then-close, twice in a row, works; live with throwaway tabs.
**Commit:** `feat(bridge): hand unsure tabs to the one-by-one sorting screen`

### ✅ Slice T6 — The `triage_window` prompt
**Build:** an MCP prompt that scripts the conversation: ask what the window is
for, propose by cluster, ask once, act. It asks once for the agent's own
recommendations and does not re-ask when the user named the tabs, and it always
asks for large batches (more than 10 tabs). Optional arguments: `windowId` (a
malformed one falls back to the window used last) and `purpose` (skips the
"what is it for?" question). Prompts live in `bridge/src/prompts.ts`.
*(Found while testing: the SDK rejects a prompt that has arguments if the client
sends no `arguments` object at all; clients that list the arguments send one.)*
**Commit:** `feat(bridge): add MCP prompts and tune tool descriptions` (shared with S2)

---

## Track X — Destructive actions (proposal → confirm → undo)

### ✅ Slice X1 — Proposal store and archiving
**Build:**
- A pure proposal store: create, get, consume, expire after 5 minutes.
- `propose_archive_tabs` and `confirm_proposal`:
  - Confirm rechecks that each tab still exists, shows the same page and is
    not now pinned, playing sound or part of a snapshot window. If any check
    fails, nothing at all is changed and the proposal is used up
    (`tabs_changed`).
  - Confirm archives through a new batch `archiveTabs`: one write to the
    Archived snapshot, then the tabs are closed one by one, so a failed save
    closes nothing.
  - Pinned tabs, tabs playing sound and tabs in a snapshot's live window are
    left out of a proposal unless the caller sets `includeProtected`, which
    the tool description limits to tabs the user explicitly named.
  - `propose_archive_tabs` is marked read-only (it changes nothing in the
    browser) and `confirm_proposal` is marked destructive, so a client such as
    Claude Code asks the user before running it.
- *(Changed while building: proposals live in `storage.session`, not in memory,
  so a service-worker restart between "propose" and "confirm" cannot void an
  approved proposal; they still expire after 5 minutes and are cleared when the
  browser restarts. The "Agent archived N tabs" toast moves to X3: the toast
  queue lives in the dashboard page, which the background cannot call, and X3's
  activity log, which the dashboard watches in storage, is the natural channel.)*

**Test:**
- Unit tests for the proposal store: expiry, single use, unknown id.
- A unit test for the tab-changed check.
- Manual: "clean up my stale tabs".
  - The agent shows the list and waits.
  - After you agree, the tabs are archived and closed, and they show up in
    the Archived snapshot.
  - Confirming the same proposal twice fails.

**Commit:** `feat(bridge): archive tabs through a confirmed proposal`

### ✅ Slice X2 — Close and remove-from-snapshot
**Build:**
- `propose_close_tabs`.
- `propose_remove_from_snapshot`, which addresses tabs by index and checks
  the snapshot's `updatedAt` at confirm time.
- Both run through the same `confirm_proposal`.

**Test:**
- Unit tests for removing by index, and for rejecting the confirm when the
  snapshot changed after the proposal.
- Manual: close proposal flow; remove two tabs from a snapshot and confirm
  in the dashboard.

**Commit:** `feat(bridge): close tabs and edit snapshots through proposals`

### ✅ Slice X3a — Activity log and undo (backend)
**Build:**
- An activity log in storage: the newest 100 entries, one sentence each, written
  by every tool that changes something (not `focus_tab`, the reads or the
  `propose_` tools; adding nothing new to a snapshot is not logged either). The
  data needed to undo is kept only for the 20 most recent undoable entries, so
  the log cannot crowd out the user's snapshots.
- `confirm_proposal` returns an `undoId`.
- An `undo` tool, once per entry:
  - Archive → reopen the tabs, and remove only the entries it added from the
    Archived snapshot, only for tabs that really came back.
  - Close → reopen the tabs.
  - Remove → put the saved tabs back at their original positions, clamped if
    the snapshot has since shrunk, with `snapshotChangedSince` in the result.
- Tabs are brought back through the browser's recently-closed list where it
  still remembers them (history and scroll position kept, closed windows
  restored whole); anything else opens fresh from its saved address, and the
  result counts each kind.
- A `get_agent_activity` read tool, so the agent can say what it did and find
  an `undoId`.

**Test:**
- Unit tests for the log (cap, order, undo-data allowance), the reopening logic
  and each undo step; manual against a real browser with throwaway tabs.

**Commit:** `feat(bridge): log agent activity and undo confirmed actions`

### ✅ Slice X3b — Dashboard: the Agent activity panel and toasts
**Build:**
- An "Agent activity" panel in the dashboard listing the log, newest first,
  with an Undo button on each entry that can still be undone. Undo runs in the
  dashboard itself, through the same code the `undo` tool uses.
- A toast for each new log entry ("Agent archived 12 tabs"), using the existing
  toast queue: the dashboard watches the log in storage. *(Moved here from X1:
  the toast queue lives in the dashboard page, which the background cannot
  call.)*
- The panel is reached from a temporary chip in the settings bar; slice S1
  gives it its proper place in the Agent bridge section.
- *(Added while building: the log is sorted by what the user asked for. Every
  tool that changes something takes an optional `request` phrase, and the server
  instructions tell the model to pass the same phrase on every call for one
  request. A proposal remembers its phrase so the confirmed action lands in the
  same group, and an undo takes its original's. The panel groups entries with the
  same phrase that follow each other within an hour, and entries with no phrase
  into bursts within fifteen minutes under "No request noted".)*
- *(Open: how long the log is kept. Today entries have no age limit, only the
  newest 100, and undo data is kept for the 20 most recent undoable entries.)*

**Test:**
- Unit tests for turning log changes into toasts and for the panel's state;
  manual: archive tabs through the agent, see the toast, undo from the panel.

**Commit:** `feat(bridge): show agent activity in the dashboard with undo`

### ✅ Slice X4 — Optional confirmation in the browser
**Build:**
- The setting "Ask me in the browser before the agent closes or archives
  tabs".
- When it's on, `confirm_proposal` opens a small TabBuddy window (reusing
  the nudge window) listing the tabs, with Confirm and Cancel.
- The tool waits for the user's answer, up to 2 minutes, and returns
  `declined` on Cancel or timeout.

*(Built as: the window is a new `confirm.html` page listing the proposal (any kind,
including a whole triage plan, bucket by bucket). It leaves its answer in session
storage and the background, which the open native port keeps alive, waits for it.
Closing the window counts as Cancel, and an answer written just before the close
wins. The wait is two minutes or the time the proposal has left, whichever is
shorter. Cancel and timeout use the proposal up and return `declined: true` with
`reason` `cancelled` or `timeout`, as a result rather than an error, so the agent
reads it as the user's answer. If the window cannot open, nothing is changed and
the proposal still works. Asking twice for one proposal is refused while its
window is open. The bridge's per-call timeout for `confirmProposal` is
`CONFIRM_WAIT_MS` plus 30 seconds, since the default 10 would fire first.)*

**Test:**
- A unit test for the pending-confirmation state (confirm, cancel, timeout).
- Manual with the setting on:
  - Cancel in the browser: the agent reports it was declined, and nothing
    closes.
  - Confirm: the action runs.

**Commit:** `feat(bridge): optionally confirm agent actions in the browser`

---

## Track S — Ship it

### ✅ Slice S1 — Real settings UI and status
**Build:**
- The "Agent bridge" settings section:
  - The toggle.
  - Live status (Off / Connected vX / Not installed / Error).
  - The install command with a copy button.
  - The in-browser confirmation option.
  - A link to the activity panel.
- Replaces the temporary P2 chip. Status comes from the port state plus the
  `hello` reply.

*(Built as: the "Agent bridge" chip in the Automation group now opens a dialog
with all of the above, and the two temporary chips (bridge toggle, Agent activity)
are gone; the activity panel is reached from the dialog. The background writes the
connection state to session storage and the dialog watches it. "Connected" means
the native port stayed open 1.5 seconds or the host has sent a request: a missing
host makes the browser close the port at once. The host's version is not shown,
because the host never sends it to the extension. "Not installed" and "Error" come
from the browser's own disconnect message (host not found; not allowed for this
extension; host exited). "Check again" reconnects at once and restarts the
backoff. The install line is `npx tabbuddy-bridge install`, which works once S4
publishes the package.)*

**Test:**
- A unit test for mapping port state to status.
- Manual: check each state — off, not installed, connected, and the browser
  restarted while connected.

**Commit:** `feat(bridge): add the Agent bridge settings section`

### ✅ Slice S2 — MCP prompts and tool-description pass
**Build:**
- The `clean_up_browser`, `switch_to` and `what_was_i_doing` prompts.
- A review of every tool description:
  - Say when to use each tool.
  - Remind the agent to always propose before destructive actions.
  - Don't dump raw ids to the user.

*(Done: the four prompts, and the server instructions plus the search, list and
open-window descriptions now say to talk about tabs by title and snapshots by
name, and that closing takes a propose step first. Unit tests cover the prompt
list, arguments and scripts. Still to do by hand: run each as a slash command on
a messy real profile and adjust the wording.)*

**Test:** Manual in Claude Code:
- Run each prompt as a slash command on a messy real profile.
- Note any bad tool choices and adjust the descriptions.

**Commit:** `feat(bridge): add MCP prompts and tune tool descriptions`

### ✅ Slice S3 — Linux and Windows install (Firefox dropped)
**Build:**
- `install`, `uninstall` and `doctor` support Linux paths, Windows (registry
  entries and a named pipe in place of the Unix socket) and Firefox
  (`allowed_extensions` and the gecko ID).
- Verify `nativeMessaging` works as an optional permission on Firefox.

*(Decided: Firefox is out of scope for now, so the `allowed_extensions` /
gecko-ID work is not done, and the optional `nativeMessaging` permission is now
declared for Chromium builds only, leaving the Firefox package unchanged.
Built as: Linux Chrome, Brave, Edge and Chromium read `NativeMessagingHosts`
inside their own data folder; Windows Chrome, Brave and Edge get one shared
manifest in `~/.tabbuddy` and a per-browser `HKCU` registry key (written with
`reg.exe`) pointing to it, plus a `.cmd` launcher. The Windows socket is a named
pipe whose name carries a hash of the bridge folder. `uninstall` removes only
registry keys that still point at our manifest, and `doctor` checks the key.
**Not yet verified on a real Linux or Windows machine:** everything is
unit-tested with a fake home, a fake registry and an injected platform, and the
Brave-on-Linux/Windows folder and key are assumed to follow each browser's own
folder, unlike macOS. The pipe's access rights are the operating system's default
for a pipe its owner creates, also unchecked.)*

**Test:** Manual on each platform and browser available to test on. `doctor`
passes, and `ping` and `list_snapshots` work.

**Commit:** `feat(bridge): support Linux, Windows and Firefox`

### ✅ Slice S4 — Docs, onboarding and release (not yet published)
**Build:**
- README: an "Use TabBuddy with AI agents" section, plus the privacy
  statement.
- USER_GUIDE: a walkthrough.
- PRD: a link to this document.
- An onboarding step, a CHANGELOG entry and `excludeSources: ['bridge/**']`.
- Publish `tabbuddy-bridge` to npm, and bump the extension version.

*(Done: README section and privacy statement, USER_GUIDE walkthrough, PRD and
CONTRIBUTING links, the welcome-tour step, a 1.1.0 changelog entry, the version
bump to 1.1.0, and a package ready to publish (`private` removed, metadata,
`prepublishOnly`; `npm pack` was installed into a scratch prefix and its `serve`
answered `initialize` and listed the prompts). **Not done, on purpose: `npm
publish`, a git tag and pushing.** Two changes to the plan: `excludeSources`
keeps `bridge/protocol.ts`, because the extension imports it, so Firefox
reviewers can still build; and the docs and the settings dialog tell people to
`npm install -g tabbuddy-bridge` rather than use `npx`, because `install`
records the bridge's own path and npx runs it from a cache that npm empties
(`install` now warns when it sees that).)*

**Test:**
- Manual: a fresh machine or profile follows only the README and reaches a
  working `list_snapshots` in Claude Code.
- The Firefox sources zip contains no `bridge/` files.

**Commit:** `docs: document the agent bridge and release it`

---

## Suggested order and milestones

| Milestone | Slices | What you can demo |
|---|---|---|
| ✅ **M1 — "Hello, tabs"** | P1–P5 | Claude Code lists your snapshots |
| ✅ **M2 — Useful read-only agent** | R1–R3 | "What am I working on?" and "find that page" |
| ✅ **M3 — Workspace switching** | W1–W3 | "Open Job Hunt", "save this as Research" |
| ✅ **M3b — Triage assistant, reading and filing** | T1–T3 | "Summarise this window and recommend a cleanup"; file tabs into new or existing snapshots (closing is still manual) |
| **M4 — Safe cleanup** | X1–X3 | "Clean up my browser" with approval and undo |
| ✅ **M4b — Agentic triage** | T4–T6 | The full loop: recommend, user decides, one confirmation, unsure tabs go to manual triage |
| **M5 — Release** | X4, S1–S4 (built; publishing pending) | A one-command install for other users |

## Notes from building

Things the tests and real use showed that the spec above did not predict:

- **MV3 service workers sleep**, dropping `setTimeout` retries. Waits of 30
  seconds or more use `alarms`, which wake the worker.
- **An answer can arrive before the request write returns**, so the host
  registers the waiting caller before writing.
- **Brave reads Chrome's `NativeMessagingHosts` folder**, not its own (see P4).
- **`open_urls` avoids snapshot windows**: tabs added to a window that belongs
  to a snapshot would be saved into it by the next Update, so it opens a new
  window instead.
- **`save_window` on a window that already has a snapshot** saves an unlinked
  copy rather than stealing the link.
- **`update_snapshot_from_window` replaces the saved tabs**, so it is marked
  destructive, reports the tab count before and after, and the description
  tells the model to confirm first.
- **`add_tabs_to_snapshot` warns via `snapshotIsOpen`** that updating an open
  snapshot from its window would drop what was added.
- **Search ranks by how rare each word is** among the tabs searched, and
  ignores words about looking for a tab ("page", "tab", "open"), after a
  sentence-style query pulled in unrelated recent tabs.
- **The fake browser gaps**: it never creates tabs from a `url` list and has no
  `tabGroups.query`, so tests mock them the way Chrome behaves.
