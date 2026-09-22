# TabBuddy — Product Requirements Document (MVP)

## 1. Summary

TabBuddy is an open-source browser extension for Chromium-based browsers
(Chrome, Brave, Edge, Opera, Vivaldi) that lets users snapshot all the tabs
in a window and save them as a named, reusable group. A dashboard lists all
saved snapshots and lets the user open, update, rename, reorder, pin, and
delete them.

**Example use case:** A user runs three windows daily — "Job Hunt" (job
postings, application forms), "Entertainment" (YouTube, Spotify), and
"Research" (docs, articles) — and wants to save/restore each as a group
instead of manually reopening dozens of tabs every day.

## 2. Goals

- Let a user capture the current state of a browser window's tabs as a
  named snapshot, with one click.
- Let a user restore a snapshot into a window at any time.
- Let a user manage (rename, reorder, pin, update, delete) their saved
  snapshots from a dedicated dashboard.
- Ship as a permission-light, privacy-respecting extension (no host
  permissions, no content scripts, no external network calls, local-only
  storage).
- Be a clean, forkable open-source starting point for others to build on.

## 3. Non-Goals (deferred to future work)

- Cross-device sync of snapshots (planned: manual export/import of a
  config file).
- Live/auto-syncing snapshots (snapshots are frozen until manually
  re-saved).
- Full session restore (login state, scroll position, form contents).
- Firefox or Safari support (architected to make Firefox cheap later via
  `webextension-polyfill`, but not tested/shipped in MVP).
- Chrome Web Store / other store listings (GitHub source only for MVP).
- Soft-delete / undo for deleted snapshots.

## 4. User Stories

1. As a user, I want to save all tabs in my current window as a named
   group, so I can close the window and restore it later without manually
   reopening each tab.
2. As a user, I want a dashboard showing all my saved snapshots, so I can
   see everything I've saved at a glance.
3. As a user, I want to open a saved snapshot and have it either focus the
   window it's already open in, or launch a new window if it isn't open,
   so I don't end up with duplicate windows for the same group.
4. As a user, I want to update a snapshot after adding or removing tabs in
   its window, so my saved group stays current without deleting and
   recreating it.
5. As a user, I want to rename a snapshot, remove an individual tab from
   it, or reorder its tabs directly from the dashboard, without needing to
   reopen the window.
6. As a user, I want to pin specific snapshots to a fixed position in the
   dashboard grid, so my most important groups don't move around as usage
   patterns change.
7. As a user, I want unpinned snapshots to automatically sort by how often
   I use them, so my most-used groups surface without manual upkeep.
8. As a user, I want to delete a snapshot I no longer need, with a
   confirmation step so I don't lose it by accident.
9. As a fork/contributor, I want a permission-light, dependency-light
   codebase I can understand and extend quickly.

## 5. Functional Requirements

### 5.1 Data Model

A **Snapshot** consists of:

| Field | Type | Notes |
|---|---|---|
| `id` | string (UUID) | Stable identity, independent of name |
| `name` | string | User-editable; auto-filled with a random placeholder (e.g. "grumpy-caffeinated-badger") from a bundled static wordlist if the user doesn't type one. Duplicate names allowed. |
| `tabs` | Tab[] | Ordered list (see below) |
| `tabGroups` | TabGroupMeta[] | Native Chrome tab-group membership/name/color, if any tabs were grouped at capture time |
| `pinned` | boolean | Freezes grid position when true |
| `pinnedPosition` | number \| null | Grid index, set when pinned |
| `usageCount` | number | Incremented each time the snapshot is opened; drives MFU sort |
| `linkedWindowId` | number \| null | Last window ID this snapshot was opened into, for smart-detect. Not persisted across browser restarts (window IDs are ephemeral) — treated as stale/null after restart. |
| `createdAt` / `updatedAt` | timestamp | For reference/debugging, not used for default sort |

A **Tab** consists of: `url`, `title`, `favIconUrl`, `pinned` (browser
pinned-tab state), `groupId` (reference to a TabGroupMeta, if any).

### 5.2 Save Flow

- Clicking the toolbar icon opens a **popup** with:
  - A "💾 Save this window" button/input, pre-filled with a randomly
    generated placeholder name, editable before confirming.
  - A "📂 Open dashboard" link.
- Saving captures every tab in the current window via `chrome.tabs.query`
  and `chrome.tabGroups.query`, and writes a new Snapshot to
  `chrome.storage.local`.
- A name is always required, but the user is never blocked — the
  placeholder satisfies that requirement if they don't type their own.

### 5.3 Restore ("Open") Flow

- Triggered from the dashboard.
- **Smart-detect:** if `linkedWindowId` refers to a window that still
  exists, focus it instead of opening a duplicate.
- Otherwise, open a new browser window and recreate:
  - Each tab's URL (loaded fresh — no session/login state).
  - Pinned-tab state.
  - Native Chrome tab groups (name + color), via `chrome.tabGroups`.
- On successful open, store the new window's ID as `linkedWindowId` and
  increment `usageCount`.

### 5.4 Update Flow

- From the dashboard, "Update" on a snapshot whose window is currently
  open (via `linkedWindowId`) re-captures that window's current tab state
  and overwrites the snapshot's `tabs`/`tabGroups`.
- If the window isn't currently open, "Update" first performs a Restore,
  then the user edits the live window (add tabs by navigating normally,
  close tabs they don't want) and re-triggers "Update" to save.
- No auto-sync — the snapshot never changes until the user explicitly
  updates it.

### 5.5 Dashboard

- A dedicated extension page (not a popup, not a new-tab override).
- Displays snapshots as a responsive tile grid (4 columns on wide
  viewports, fewer on narrower ones).
- Default sort: most-frequently-used first (`usageCount` descending)
  among unpinned tiles; pinned tiles hold their fixed `pinnedPosition` and
  never move due to usage.
- Manual drag-and-reorder: dragging an unpinned tile pins it implicitly?
  **No** — dragging only reorders within the current pinned/unpinned
  layout; to permanently fix a tile's position, the user must explicitly
  pin it via a pin toggle on the tile. (See open question in §8 if this
  needs revisiting during implementation.)
- Per-tile actions: Open, Update, Rename, Pin/Unpin, Delete, and an
  expandable tab list (remove individual tab rows, drag-reorder tabs
  within the snapshot).
- Delete requires a confirmation dialog (shadcn `AlertDialog`); no undo.
- Empty state: friendly placeholder + call-to-action when no snapshots
  exist yet.

### 5.6 Visual Design

- Material 3 / "Pixel-inspired" look: rounded-2xl tiles, soft elevation
  shadows on hover, generous whitespace, Google Sans/Roboto-adjacent font
  stack with system fallback.
- Built with Tailwind CSS + shadcn/ui components (no separate Material
  Web Components library).
- Light and dark themes, automatically following system preference
  (`prefers-color-scheme`); no manual toggle in MVP.

## 6. Technical Requirements

- **Framework:** WXT (Manifest V3 scaffolding, dev hot-reload, build).
- **Language/UI:** TypeScript + React.
- **Styling:** Tailwind CSS + shadcn/ui.
- **Cross-browser layer:** `webextension-polyfill`, wired in from the
  start so Firefox support is a smaller lift later (not shipped/tested in
  MVP).
- **Permissions requested:** `tabs`, `tabGroups`, `windows`, `storage`.
  No host permissions, no content scripts, no `<all_urls>`.
- **Storage:** `chrome.storage.local` only. No network calls, no external
  services (e.g. no third-party favicon fetching).
- **Target browsers:** Chrome, Brave, Edge, Opera, Vivaldi (Chromium
  Manifest V3).

## 7. Distribution

- GitHub repository only for MVP; README documents `npm install && npm
  run build` and manual "load unpacked" instructions.
- License: MIT.
- Chrome Web Store (and other store) publishing deferred until the
  project is stable post-MVP.

## 8. Open Questions / Future Work

- Export/import of full snapshot config for manual cross-device setup.
- Whether dragging a tile in the dashboard should implicitly pin it, or
  remain purely cosmetic until the user explicitly pins — needs a decision
  during implementation/UX polish.
- Soft-delete with undo toast.
- Firefox/Safari builds.
- Handling of snapshots whose saved URLs 404 or are no longer valid at
  restore time.
- Chrome Web Store listing once stable.

## 9. Milestones (suggested)

1. **Scaffold:** WXT + React + TS project, manifest, permissions, basic
   popup shell, basic dashboard shell.
2. **Save flow:** capture window tabs/groups → write Snapshot to storage.
3. **Dashboard list + Open (restore) flow**, including smart-detect.
4. **Update flow** (re-capture from live window).
5. **Dashboard editing:** rename, remove tab row, reorder tabs, delete
   with confirm.
6. **Sorting/pinning:** MFU default sort, pin/unpin, drag-reorder.
7. **Visual polish:** Material 3/Pixel styling, light/dark theme,
   responsive grid.
8. **Docs:** README, CONTRIBUTING, LICENSE (MIT), load-unpacked
   instructions.
