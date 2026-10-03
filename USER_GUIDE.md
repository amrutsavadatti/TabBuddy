# TabBuddy — User Guide

A walkthrough of everything TabBuddy can do, for people using the
extension day-to-day. (Looking to build or contribute instead? See
[README.md](./README.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).)

## Contents

- [The basics: saving a window](#the-basics-saving-a-window)
- [Naming your snapshots](#naming-your-snapshots)
- [Most used snapshots in the popup](#most-used-snapshots-in-the-popup)
- [Opening a saved snapshot](#opening-a-saved-snapshot)
- [Lazy-loaded tabs](#lazy-loaded-tabs)
- [Native Chrome tab groups](#native-chrome-tab-groups)
- [Updating a snapshot](#updating-a-snapshot)
- [The dashboard](#the-dashboard)
- [Editing a snapshot](#editing-a-snapshot)
- [Pinning and reordering](#pinning-and-reordering)
- [Search and sort](#search-and-sort)
- [Finding the tab that's playing sound](#finding-the-tab-thats-playing-sound)
- [Quick links](#quick-links)
- [Categories](#categories)
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

## Most used snapshots in the popup

Once you've opened a snapshot a few times, the toolbar popup shows a short
**Most used** list below the Save/Update box — your top 3 by how often you
open them, each with its tab count. Click one to open it straight away,
without going to the dashboard. It's empty until you've opened at least one
snapshot, and never shows the Archived snapshot or the one already linked to
your current window (that one has its own Update button above).

### Searching from the popup

Once you have at least one snapshot, a **Search snapshots** box appears above
that list. Type part of a name (case doesn't matter) and the list switches to
the snapshots that match, with names starting with what you typed first, then
the ones you open most. Click one, or press **Enter** to open the top result;
the popup closes as it opens. It searches every snapshot, including the
Archived one and the one linked to your current window, so you can find
things the Most used list leaves out. **Esc** or the **×** clears the box and
brings the Most used list back.

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

The real page loads only when you click **Load this page** on the
placeholder. Nothing loads by itself, on any operating system, so tabs you
never open never cost you memory.

Things to know:

- The address bar shows a TabBuddy page (not the site's address) until the
  tab loads. The full URL is shown on the page itself.
- Saving, updating, grouping by site, and sorting tabs all use the real
  page, never the placeholder, so your snapshots stay correct.
- `chrome://` and `file://` tabs can't be opened by a placeholder, so they
  always load normally.
- Prefer everything loaded up front? Turn off **Lazy loading** in the
  settings bar (click the gear at the top right of the dashboard, then the
  **Dashboard** icon). It only
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

The gear at the top right opens the **settings bar**: a row of icons for
Dashboard, Automation, Quick links, Your data and Help. Click an icon to see
the settings inside it, and click it again (or another icon) to close or switch.

Open the dashboard by clicking **Open dashboard** in the popup, or with
the [keyboard shortcut](#keyboard-shortcut). It opens in a window of its own,
so it doesn't add a tab to the window you're working in; ask for it again
and TabBuddy brings that window to the front instead of opening a second one.
It shows every saved
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

## Finding the tab that's playing sound

Can't tell which tab is playing music, a video or a call? Click the
TabBuddy icon. When any tab is making sound, a **Playing now** section
appears at the top of the popup, listing each one with its icon and title.
Click a row to jump straight to that tab (in whatever window it lives in), or
click the speaker to mute or unmute it.

The dashboard has the same thing: a green **playing** pill appears in its
header while any tab is making sound. Click it for the list, then jump to a
tab or mute it. It disappears when the sound stops.

TabBuddy only knows about tabs that have made sound in the last couple of
seconds. While any tab is making sound, the TabBuddy icon in the toolbar also
shows a small green badge with how many, and hovering the icon says so, so you
can tell at a glance without opening anything. It clears when the sound stops.

A paused video, or a call where nobody is talking at that moment,
won't be listed, and neither will a call that only uses the camera or
microphone.

## Quick links

At the top of the dashboard is a row of six circles:

- **The first three** are your most visited sites, found automatically. They
  start empty and fill in as you browse. "Most visited" favours what you
  use lately, so a site you stop using slowly fades out.
- **The last three** are yours. Click a **+** to add a site: type its
  address, or tap one of your most visited sites. A full address like
  `https://mail.google.com/mail/u/1/` opens that exact page.

Click a circle to jump to a tab you already have open on that site, or to
open it in a new tab if there isn't one. Hover a circle for a small button:
on the automatic ones it **hides that site** (handy for a search engine),
and on yours it lets you **change or remove** it. A site you chose never
appears twice.

**What TabBuddy keeps, and where**

- For each site you visit: its domain (like `github.com`), a score, when
  you last visited, and its icon. Never the page address, title or content.
- For the sites you add yourself: the exact address you typed.
- All of it stays on your device, and nothing is sent anywhere.
- Incognito windows, browser pages and TabBuddy's own pages are never counted.
- Snapshot exports do not include any of this.

Open the settings bar (the gear), then the **Quick links** icon, to manage them:

- **Hidden sites** (shown once you've hidden something) lists every site you
  hid, each with an **Unhide** button. Its visit score was kept, so it
  can come straight back.
- **Quick links** turns the feature off, which stops counting and hides the
  row. What was already collected is kept.
- **Clear visit history** makes TabBuddy forget everything it learned about
  your visits, including scores and hidden sites. Use Hidden sites instead
  if you only want one site back.

## Categories

Group related snapshots with categories — like "Job Hunt", "Research" or
"Reading list". A snapshot can be in **several** categories, or none.

**Tagging a snapshot**

- Click the **tag icon** on a card, tick the categories you want, or type a
  name and click **Add** to create a new one on the spot.
- Tagged categories show as small colored chips on the card (three at
  most, then "+2").
- To tag many at once, use [Select mode](#selecting-multiple-snapshots) and
  click **Add to category**.

**Categories view**

Use the **Simple | Categories** switch next to the search box (Simple is
the default, and TabBuddy remembers your choice).

- Each category is a **stack of cards** showing its name, how many
  snapshots it holds, and the first few of them. Snapshots with no
  category sit in a grey **Uncategorized** stack.
- Click a stack to **open** it. Every card inside works as usual, and the
  folder-minus button removes just that category from a card. Click
  **← All** to go back.
- While inside a category, drag a card by its grip handle (⠿) onto one of
  the categories in the strip above to add it there too — dropping never
  removes its other categories.
- Click the **⋯** on a stack to rename it, pick a color, or delete it.
  Deleting a category never deletes the snapshots in it.

The Archived snapshot is not part of any category. Exporting snapshots
also exports their categories, and importing matches them by name
(creating any that are missing).

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
- **Everything:** open the gear's settings bar, click the **Your data** icon, and choose
  **Export all**.

This is how you back up your snapshots, move them to another computer, or
**share a specific saved window with a friend** — just send them the
downloaded file.

## Importing

Open the gear's settings bar, click the **Your data** icon, click **Import**,
and choose a `.json` file
(one you exported yourself, or one someone shared with you). TabBuddy
adds each snapshot in the file as new entries — it never overwrites or
merges with existing snapshots. Personal stats like usage count, pin
status, and linked window are reset to a clean slate on import, since
those don't mean anything on a different device or for someone else's
saved snapshot.

## Hover to peek

Toggle **Hover peek** in the dashboard's settings bar (gear, then the **Dashboard**
icon; on by default) to preview
a snapshot's tabs just by hovering over its card — no need to click
"Show tabs". While hovering, everything else on the page softly blurs out
to keep your focus on the card you're peeking at. This turns off
automatically while you're in [selection mode](#selecting-multiple-snapshots),
since it would otherwise fight with checkbox clicking.

## Tab hoarder nudges

On a schedule you pick, TabBuddy quietly checks your open tabs for ones
you haven't touched for as long as you say (pinned and audible tabs are never nudged)
and points you at one: TabBuddy switches to that tab, puts a **?** on its toolbar
icon, and opens the extension popup asking what to do with it (if the popup can't
open by itself, click the icon):

- **Close** — closes the tab, nothing saved.
- **Archive** — saves the tab into a reserved **Archived**
  snapshot (created automatically, pinned by default, and can't be
  deleted), then closes it.
- **Keep** — snoozes that page for 2 days before it can be nudged again.
  The snooze is remembered by the page's address, so it survives a browser
  restart and also covers any other tab open on the same page.

If you ignore the popup, the question stays put and the icon keeps its **?**.
Click the question in the popup to jump to that tab, even if it's in another
window. The dashboard also shows a small pulsing tab on its right edge while a
question is waiting; click it to slide the card out, then jump to the tab or
decide right there.

Only one question is ever waiting at a time. While a nudge is unanswered,
no new one appears — TabBuddy only moves on once you pick an option. If you
close the tab yourself, the question goes away. Nudges then come at most one per check, so several
stale tabs are asked about one at a time. A tab you dismissed goes to the
back of the line rather than coming straight back.

Nudges also wait for you. Nothing pops up while you're away (no keyboard
or mouse for about five minutes, or the screen is locked), and after you
come back, or wake the computer, TabBuddy stays quiet for one full check
interval before the first nudge.

Open the gear's settings bar, click the **Automation** icon, then **Nudges** to open the nudge
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
browser to open the dashboard in its own window — or jump straight to it
if it's already open.

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
