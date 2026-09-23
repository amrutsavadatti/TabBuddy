# TabBuddy — User Guide

A walkthrough of everything TabBuddy can do, for people using the
extension day-to-day. (Looking to build or contribute instead? See
[README.md](./README.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).)

## Contents

- [The basics: saving a window](#the-basics-saving-a-window)
- [Naming your snapshots](#naming-your-snapshots)
- [Opening a saved snapshot](#opening-a-saved-snapshot)
- [Lazy-loaded tabs](#lazy-loaded-tabs)
- [Native Chrome tab groups](#native-chrome-tab-groups)
- [Updating a snapshot](#updating-a-snapshot)
- [The dashboard](#the-dashboard)
- [Editing a snapshot](#editing-a-snapshot)
- [Pinning and reordering](#pinning-and-reordering)
- [Search and sort](#search-and-sort)
- [Selecting multiple snapshots](#selecting-multiple-snapshots)
- [Exporting and sharing](#exporting-and-sharing)
- [Importing](#importing)
- [Hover to peek](#hover-to-peek)
- [Tab hoarder nudges](#tab-hoarder-nudges)
- [Background vibes](#background-vibes)
- [Keyboard shortcut](#keyboard-shortcut)
- [Tips and things to know](#tips-and-things-to-know)

---

## The basics: saving a window

Say you've got a browser window open with a bunch of tabs for a specific
task — job applications, a research project, your daily "entertainment"
tabs, whatever. TabBuddy lets you save that exact set of tabs as a
**snapshot**, so you can close the window and bring it all back later.

1. Click the TabBuddy icon in your toolbar.
2. Click **Save this window**.

That's it — every open tab in that window (URLs, titles, favicons, pinned
state, and any native Chrome tab groups) is captured and saved.

## Naming your snapshots

Before you click Save, the popup shows a name field pre-filled with a
randomly generated placeholder like `grumpy-caffeinated-badger`. You can:

- Leave it as-is and save immediately — zero typing required.
- Clear it and type your own name, like "Job Hunt" or "Research".

If you save two windows with the same name, TabBuddy automatically
appends a number so they stay distinct — e.g. a second "Job Hunt" becomes
"Job Hunt (2)". This also applies when importing a file whose snapshot
names collide with ones you already have.

## Opening a saved snapshot

From the dashboard, click **Open** on any snapshot.

- If that snapshot's window is already open somewhere, TabBuddy **focuses
  it** instead of opening a duplicate.
- Otherwise, it opens a brand-new window with every tab restored in
  order, pinned tabs still pinned, and tab groups recreated. By default
  only the first tab loads right away — see [Lazy-loaded
  tabs](#lazy-loaded-tabs).

Because restored tabs load fresh, things like login sessions, scroll
position, and form contents aren't preserved — only the tab list itself
is. Think of it as restoring a bookmark list, not a browser session.

## Lazy-loaded tabs

Opening a snapshot with dozens of tabs would normally load every page at
once and eat your memory. So by default TabBuddy loads **only the first
tab** and opens the rest as light placeholder pages. Each placeholder
shows:

- the tab name as `domain – page title` (for example
  `linkedin.com – Senior Engineer Jobs`),
- the saved favicon, and
- the full saved URL.

The real page loads the moment you **switch to that tab** — or click
**Load now** on the placeholder. Tabs you never touch never load.

Things to know:

- The address bar shows a TabBuddy page (not the site's address) until the
  tab loads. The full URL is shown on the page itself.
- Saving, updating, grouping by site, and sorting tabs all use the real
  page, never the placeholder, so your snapshots stay correct.
- `chrome://` and `file://` tabs can't be opened by a placeholder, so they
  always load normally.
- Prefer everything loaded up front? Click the **leaf** button in the
  dashboard header to turn lazy tabs off (it's filled when on). It only
  affects snapshots you open afterward.

## Native Chrome tab groups

If you've organized tabs into Chrome's built-in tab groups (right-click a
tab → "Add tab to new group") before saving, TabBuddy remembers:

- Which tabs belong to which group
- The group's name
- The group's color

When you restore the snapshot, those groups are recreated exactly as they
were.

## Updating a snapshot

Snapshots are **frozen** — saving a window doesn't mean TabBuddy keeps
watching it. If you open more tabs or close some in a snapshot's window,
the saved copy won't change until you tell it to.

Two ways to update:

- **From the popup:** if the window you currently have open is linked to
  a snapshot, the popup shows that snapshot's name and an **Update**
  button right there — no need to go to the dashboard.
- **From the dashboard:** click **Update** on any snapshot whose window
  is currently open. (If it isn't open, TabBuddy will tell you to open it
  first.)

Either way, this re-captures the window's current tabs and groups and
overwrites the saved snapshot.

## The dashboard

Open the dashboard by clicking **Open dashboard** in the popup, or with
the [keyboard shortcut](#keyboard-shortcut). It shows every saved
snapshot as a card, organized into:

- **📌 Pinned** — snapshots you've explicitly pinned, always at the top
  in the order you arranged them.
- **All snapshots** — everything else, sorted by your chosen [sort
  option](#search-and-sort).

## Editing a snapshot

You don't need to reopen a window to make small edits — click directly
on a dashboard card:

- **Rename:** click the snapshot's name, type a new one, click Save.
- **Show tabs:** click the chevron icon to open a modal with the
  snapshot's full details (tab/group counts, created/updated dates) and
  every tab with its favicon.
- **Reorder or remove tabs:** inside that modal, use the ↑/↓ buttons to
  reorder tabs, or the trash icon to remove one — both save immediately.
- **Delete the whole snapshot:** click the trash icon on the card, then
  confirm.

If you want to add a tab instead of removing one, that requires the live
window: open the snapshot, browse to add the tab, then click Update.

## Pinning and reordering

Click the pin icon on any card to move it into the **Pinned** section at
the top. Pinned snapshots:

- Stay in a fixed position — they don't get reshuffled by usage.
- Can be manually reordered within the Pinned section by dragging the
  grip handle (⠿) on each card.

Click the pin icon again (now showing "unpin") to send it back to the
regular sorted list.

## Search and sort

Above the snapshot grid:

- **Search box** filters snapshots by name as you type, across both the
  Pinned and All snapshots sections.
- **Sort dropdown** controls how the *All snapshots* section orders
  itself:
  - **Most frequently used** — snapshots you open the most, first.
  - **Recently updated** — most recently saved/updated, first.
  - **Recently created** — most recently created, first.

(Pinned snapshots always keep their manually-set position regardless of
the sort option — that's the point of pinning.)

## Selecting multiple snapshots

Click **Select** in the dashboard header to enter selection mode:

- Click the checkbox on any card to select it.
- **Select all** / **Deselect all** toggles everything at once.
- **Export selected** downloads just the checked snapshots as one file.
- **Delete selected** removes all checked snapshots, after a
  confirmation.
- **Cancel** exits selection mode without changing anything.

## Exporting and sharing

TabBuddy can export snapshots as a `.json` file, three ways:

- **Single snapshot:** click the download icon on any card.
- **Multiple snapshots:** use [Select mode](#selecting-multiple-snapshots)
  and click "Export selected".
- **Everything:** click "Export all" in the header.

This is how you back up your snapshots, move them to another computer, or
**share a specific saved window with a friend** — just send them the
downloaded file.

## Importing

Click **Import** in the dashboard header and choose a `.json` file
(one you exported yourself, or one someone shared with you). TabBuddy
adds each snapshot in the file as new entries — it never overwrites or
merges with existing snapshots. Personal stats like usage count, pin
status, and linked window are reset to a clean slate on import, since
those don't mean anything on a different device or for someone else's
saved snapshot.

## Hover to peek

Toggle **Hover peek** in the dashboard header (on by default) to preview
a snapshot's tabs just by hovering over its card — no need to click
"Show tabs". While hovering, everything else on the page softly blurs out
to keep your focus on the card you're peeking at. This turns off
automatically while you're in [selection mode](#selecting-multiple-snapshots),
since it would otherwise fight with checkbox clicking.

## Tab hoarder nudges

On a schedule you pick, TabBuddy quietly checks your open tabs for ones
you haven't touched for as long as you say (pinned and audible tabs are never nudged)
and shows a small popup asking what to do with one of them:

- **Close** — closes the tab, nothing saved.
- **Archive & Close** — saves the tab into a reserved **Archived**
  snapshot (created automatically, pinned by default, and can't be
  deleted), then closes it.
- **Keep** — snoozes that tab for 2 days before it can be nudged again.

Only one popup shows at a time, and at most one per check — if several
tabs qualify, they're nudged one at a time across later checks rather
than all at once.

Click the yellow bell button in the dashboard header to open the nudge
settings. There are two tabs, each taking a number plus a unit (minutes,
hours, or days):

- **How often** — how often TabBuddy checks and nudges you (default 20
  minutes).
- **How old is stale** — how long a tab must go unopened before it can be
  nudged (default 24 hours).

You can also switch nudges on or off from the same window. New settings
take effect on the next check.

## Background vibes

Click one of the small colored circles in the dashboard header to change
the background gradient: **Aurora**, **Sunset**, **Ocean**, or
**Meadow** (the default). It's purely cosmetic and saved as a
preference, so it stays your pick across sessions.

## Keyboard shortcut

Press **Ctrl+Shift+K** (**Cmd+Shift+K** on Mac) from anywhere in the
browser to open the dashboard — or jump straight to it if it's already
open in another tab.

Want a different key combo? Go to `chrome://extensions/shortcuts` and
change it there.

## Tips and things to know

- Snapshots are stored entirely on your device (nothing is sent over the
  network) — see [PRD.md](./PRD.md) if you're curious about the
  permissions TabBuddy uses and why.
- Because storage is local, snapshots don't automatically sync between
  computers — use [export/import](#exporting-and-sharing) to move them
  manually.
- Deleting a snapshot is permanent — there's a confirmation step, but no
  undo, so double-check before confirming.
