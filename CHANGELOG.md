# Changelog

All notable changes to TabBuddy are listed here, newest first.

## 1.1.0

### Added
- **Agent bridge (optional, off by default).** Let an AI agent that speaks the
  Model Context Protocol, such as Claude Code, use TabBuddy: open a snapshot by
  name, search what you've saved and archived, save a window or a list of links
  as a snapshot, rename and tag, and look over a crowded window and suggest a
  cleanup. It needs a small helper installed with
  `npm install -g tabbuddy-bridge && tabbuddy-bridge install`, and talks only to
  your own computer. See the README and the User Guide.
- **You stay in control.** Closing, archiving and removing saved tabs always
  take two steps (the agent proposes, you agree), can be undone, and are listed
  in **Agent activity**. An optional **Ask me in the browser first** setting opens a
  window that lists exactly what would happen and waits for your click.
- **Agent bridge settings.** Gear, then Automation, then Agent bridge: the
  on/off switch, a live status (Off, Connecting, Connected, Bridge not installed,
  Error) with **Check again**, the commands to copy, and a link to the activity list.
- **Ready-made agent prompts:** `triage_window`, `clean_up_browser`, `switch_to`
  and `what_was_i_doing`.
- **An "Agent bridge" step in the welcome tour.**

### Changed
- TabBuddy now declares one **optional** permission, `nativeMessaging`. It is
  requested only when you turn the agent bridge on; if you never do, nothing
  changes.

## 1.0.6

### Added
- **Export & import: quick links included.** "Export All" now saves your 3
  manual quick-link slots alongside snapshots. Importing a file that contains
  them restores all three at once.

### Changed
- **Tab nudges: see the tab, then decide.** When a nudge fires, TabBuddy
  switches to the stale tab first so you can see it, then shows the nudge
  card in the bottom-right corner on top of it.
- **Nudges move on if ignored.** If a nudge goes unanswered for a full nudge
  interval, TabBuddy clears it on the next cycle and moves on to the next
  stale tab. The ignored tab goes to the back of the queue.
- **Export & import: pinned snapshots stay pinned.** Snapshots marked as
  pinned are no longer reset to unpinned when exported and re-imported.
- **Hover peek is off by default** for new installs and users who haven't
  explicitly set the preference.

### Fixed
- **Nudge settings dialog showed defaults after a page refresh.** Opening the
  dialog now always reflects your actual saved frequency and stale-time
  values, not the factory defaults.

## 1.0.5

### Added
- **Nudges point at the tab and ask in the toolbar popup.** When a stale tab
  is due a decision, TabBuddy switches to it, puts a **?** on the toolbar
  icon, and opens the extension popup with Close, Archive, and Keep. The
  separate nudge window is gone. (Chrome only opens the popup by itself while
  a browser window is focused; otherwise click the icon and the question is
  waiting.)
- **Click the nudge to jump to its tab.** The question in the popup takes you
  to the tab it's about, even if it's in another window.
- **A pending nudge shows on the dashboard.** While a question is waiting, a
  small pulsing tab sits on the dashboard's right edge. Click it to slide out
  the card, then jump to the tab or decide right there, so an ignored nudge
  can't go unnoticed.
- **Skip a tab in Sort tabs one by one.** A **Skip** button (or the **S** key)
  leaves a tab open and untouched and moves on. Undo steps back over a skip,
  and the window is only closed at the end if nothing was skipped.
- **Search snapshots from the popup.** A search box finds any snapshot by
  name; **Enter** opens the top result and **Esc** clears the box. The
  dashboard search uses the same filter.

### Changed
- **The dashboard opens in its own window** instead of adding a tab to the
  window you're working in. Asking for it again brings that window to the
  front rather than opening a second one.

## 1.0.4

### Added
- **Most used snapshots in the popup.** Below Save/Update, the toolbar popup
  now shows your top 3 most-opened snapshots, each one click away — useful
  even when you have nothing to save right now.
- **Toast acknowledgements.** Deleting a snapshot or selection, removing a
  tab, deleting a category, exporting, and importing now show a small
  confirmation instead of happening silently.
- **A "Playing now" step in the onboarding tour** (it was missing after the
  feature shipped in 1.0.3).

### Changed
- **Sort tabs one by one** is easier to understand: a heading and a short
  explainer of what the screen is for, a green **Finish** button that ends
  the session and leaves whatever you haven't sorted untouched, and renaming
  the snapshot you're building as you go.

### Fixed
- **A real bug:** filing a tab into a snapshot (in Sort tabs one by one)
  saved a copy of it but never closed the actual tab. It now closes the tab,
  and undo reopens it.
- **Creating a category** from the tag picker or bulk "Add to category"
  could show it twice in the list, though only one copy was ever saved.

## 1.0.3

### Added
- **Quick links.** A centred row of six circles at the top of the dashboard.
  The first three are your most visited sites, found automatically; the last
  three are sites you choose with the + button. One click jumps to a tab you
  already have open on that site, or opens it in a new tab. A full address
  (like a specific inbox) opens that exact page.
  - Visits are counted on your device, by domain only. TabBuddy keeps the
    domain, a score, the last visit and the site's icon, never the page
    address, title or content. Incognito and browser pages are never counted.
  - "Most visited" follows your recent habits: scores halve every two weeks.
  - Hide a site from the automatic row, see and unhide hidden sites from
    **Hidden sites**, turn the whole feature off, or **Clear visit history**.
- **Playing now.** Find the tab that is making noise.
  - The toolbar popup lists tabs playing sound, with a click to jump to the
    tab and a button to mute or unmute it.
  - The toolbar icon shows a small green badge with how many tabs are playing.
  - The dashboard header shows a green "playing" pill with the same list.
  - Muted tabs are included. Paused videos, silent calls, and calls that only
    use the camera or microphone can't be detected by the browser.

### Changed
- **The settings bar is now a row of icons.** Dashboard, Automation, Quick
  links, Your data and Help each open their own settings, instead of one long
  row of buttons.

## 1.0.2

### Fixed
- **Nudges no longer pile up.** Only one nudge popup is ever open. While one is
  waiting, no new one appears, even if the browser restarts in between. A popup
  closes on its own if you close or open the tab it asks about, and a tab you
  dismiss goes to the back of the line.
- **No nudges while you're away.** Nothing pops up while the computer is idle
  or locked, and after you return or wake it TabBuddy waits one full interval
  before the first nudge. (Adds the `idle` permission, which shows no install
  warning.)
- **"Keep" survives a browser restart.** Snoozes are remembered by page
  address, not by Chrome's tab number, so they stay with the right page and
  cover other tabs open on the same page.
- **Lazy-loaded tabs behave the same on every OS.** Opening a snapshot loads the
  first tab; the rest wait until you click **Load this page**. Before, some
  Linux setups loaded every tab at once.
- **The dashboard updates live.** A snapshot saved from the popup, or a tab
  archived by a nudge, appears without a refresh.
- **Sort tabs one by one:** dropping a card anywhere on the left strip now
  closes the tab, and the trash icon reacts as you drag.
- **The hover preview** is a floating panel that stays on screen, never moves
  the layout, and can't cover a dialog.

## 1.0.1

### Fixed
- The reserved **Archived** snapshot can no longer be renamed, and no other
  snapshot can take that name.

## 1.0.0

First public release.

- Save a window as a snapshot and restore it with one click, with pinned tabs
  and native tab groups. Reopening a snapshot focuses its window if it is open.
- Update a snapshot in place, rename, reorder or remove its tabs, pin and
  search snapshots, and sort them by use or date.
- Categories: tag snapshots with any number of categories, browse them as
  stacks of cards, and drag cards between categories.
- Lazy-loaded restore, so a large snapshot doesn't load every tab at once.
- Tab nudges: TabBuddy notices tabs you've left alone and asks whether to
  close, archive or keep them, on a schedule you set.
- Sort tabs one by one, one-click group by site, hover to peek, export and
  import, and a keyboard shortcut for the dashboard.
- Everything runs on your device: no account, no server, no tracking.
