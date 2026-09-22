# TabBuddy — Vertical Slice Development Plan

Each slice below is a thin, end-to-end feature (touches manifest,
background/service worker, storage, and UI together) that is independently
**buildable, manually testable in a real browser, and commit-able** before
moving to the next slice. No slice depends on unfinished work from a later
slice. This lets us validate the whole pipeline (build → load-unpacked →
click through → inspect storage) early and often, instead of discovering
integration problems at the end.

Each slice ends with:
1. A manual test in Chrome (`load unpacked`) confirming the behavior works.
2. A git commit scoped to just that slice.

---

## Slice 0 — Project scaffold
**Build:** WXT + React + TypeScript project init. Manifest V3 config with
`tabs`, `tabGroups`, `windows`, `storage` permissions declared. Empty popup
page and empty dashboard page, each just rendering a placeholder heading.
Wire in `webextension-polyfill` now (foundational, cheapest to add before
any Chrome-API code exists).
**Test:** `npm run build`, load-unpacked in Chrome, confirm the toolbar
icon appears, popup opens showing placeholder text, and the dashboard page
opens via a manual URL/link showing its placeholder text.
**Commit:** `chore: scaffold WXT extension with popup and dashboard shells`

## Slice 1 — Capture and save a snapshot (no naming UI yet)
**Build:** Popup has a single "Save this window" button. On click, query
`chrome.tabs` for the current window, build a Snapshot object (hardcoded
name like "Untitled" for now), write it to `chrome.storage.local`.
**Test:** Open a window with 3–4 tabs (mix of pinned/unpinned), click Save,
inspect `chrome.storage.local` via DevTools Application panel, confirm the
tab URLs/titles/favicons/pinned-state were captured correctly.
**Commit:** `feat: capture and save current window's tabs on popup click`

## Slice 2 — List snapshots on the dashboard (read-only)
**Build:** Dashboard reads all snapshots from storage and renders a plain
list (name + tab count, no styling/grid yet).
**Test:** Save 2–3 different windows, open dashboard, confirm all appear
with correct tab counts.
**Commit:** `feat: list saved snapshots on dashboard`

## Slice 3 — Restore a snapshot into a new window
**Build:** Dashboard "Open" button on each snapshot opens a brand-new
window and creates a tab for each saved URL, restoring pinned-state.
**Test:** Click Open on a saved snapshot, confirm a new window appears with
all tabs in the right order, pinned tabs pinned.
**Commit:** `feat: restore a snapshot into a new window`

## Slice 4 — Smart-detect existing window
**Build:** Track `linkedWindowId` on the snapshot when opened. "Open" first
checks if that window still exists (`chrome.windows.get`); if so, focus it
instead of creating a duplicate.
**Test:** Open a snapshot, click Open again — same window should focus, no
duplicate created. Close the window, click Open — a new window should be
created.
**Commit:** `feat: smart-detect and focus existing window on restore`

## Slice 5 — Native tab group capture/restore
**Build:** On save, also query `chrome.tabGroups` for the window and store
group name/color per tab. On restore, recreate the groups via
`chrome.tabGroups.update` after creating the tabs.
**Test:** Create a native Chrome tab group with a custom name/color in a
window, save it, restore it, confirm the group reappears with the same
name/color and tab membership.
**Commit:** `feat: capture and restore native Chrome tab groups`

## Slice 6 — Update snapshot from live window
**Build:** Dashboard "Update" button, enabled when `linkedWindowId` points
to a currently-open window; re-runs the same capture logic as Slice 1/5 and
overwrites that snapshot's `tabs`/`tabGroups`.
**Test:** Open a snapshot, add/close a few tabs in the live window, click
Update, reload the dashboard, confirm the snapshot reflects the new tab
set.
**Commit:** `feat: update snapshot from its live window`

## Slice 7 — Delete with confirmation
**Build:** Dashboard "Delete" button triggers a confirm step (plain
`window.confirm` is fine at this stage — swapped for a proper dialog in the
polish slice) before removing the snapshot from storage.
**Test:** Delete a snapshot, confirm it disappears from the dashboard and
from storage; cancel a delete, confirm it remains.
**Commit:** `feat: delete snapshot with confirmation`

## Slice 8 — Dashboard-only editing (rename, remove tab, reorder tabs)
**Build:** Expand a snapshot in the dashboard to rename it, remove an
individual tab row, and reorder tabs within it — all persisted directly to
storage, no live window required.
**Test:** Rename a snapshot and reload — name persists. Remove a tab row
and reload — it's gone. Reorder tabs and reload — new order persists.
**Commit:** `feat: rename, remove tabs, and reorder tabs from dashboard`

## Slice 9 — Placeholder name generator
**Build:** Bundle the static adjective/noun wordlist; wire it into the
popup's Save flow so the name field is pre-filled with a random combo
(e.g. "grumpy-caffeinated-badger") if the user doesn't type one.
**Test:** Click Save without typing a name — confirm a generated name is
used and saved. Type a custom name — confirm it's used instead.
**Commit:** `feat: auto-generate placeholder snapshot names`

## Slice 10 — Usage tracking and MFU default sort
**Build:** Increment `usageCount` each time a snapshot is opened (Slice
3/4's Open action). Dashboard list defaults to sorting by `usageCount`
descending.
**Test:** Open one snapshot several times, others fewer times; reload
dashboard, confirm the most-opened one sorts first.
**Commit:** `feat: track usage count and default-sort by most-frequently-used`

## Slice 11 — Pin to fixed position
**Build:** Pin toggle per snapshot; pinned snapshots hold a fixed
`pinnedPosition` and are excluded from MFU re-sorting; unpinned ones sort
by usage around them.
**Test:** Pin one snapshot, then generate more usage on an unpinned one
that would otherwise outrank it — confirm the pinned one stays put and
others reflow around it.
**Commit:** `feat: pin snapshots to a fixed dashboard position`

## Slice 12 — Drag-and-drop reorder
**Build:** Add drag-and-drop reordering to the dashboard grid for unpinned
tiles (a small dnd library, e.g. `@dnd-kit/core`), persisting order.
**Test:** Drag an unpinned tile to a new position, reload, confirm the
order persisted; confirm pinned tiles are unaffected/undraggable-into.
**Commit:** `feat: drag-and-drop reorder for dashboard tiles`

## Slice 13 — Visual polish (Material 3 / Pixel-inspired UI)
**Build:** Introduce Tailwind CSS + shadcn/ui. Replace plain list/buttons
with the tile grid (responsive 4×N), rounded-2xl cards, soft shadows,
proper `AlertDialog` for delete (replacing `window.confirm` from Slice 7),
light/dark theme via `prefers-color-scheme`.
**Test:** Resize the dashboard window across breakpoints and confirm the
grid reflows; toggle OS light/dark mode and confirm the UI follows.
**Commit:** `style: apply Material 3-inspired UI with Tailwind and shadcn/ui`

## Slice 14 — Docs and repo hygiene
**Build:** README (features, screenshots, `npm install && npm run build` +
load-unpacked instructions), CONTRIBUTING.md, LICENSE (MIT).
**Test:** Follow the README from a clean clone/checkout to confirm the
build and load-unpacked steps work exactly as written.
**Commit:** `docs: add README, CONTRIBUTING, and MIT license`

---

## Notes

- Slices 0–8 form the functional core (save → list → restore → update →
  delete → edit) and should be validated thoroughly before layering on
  naming/sorting/pinning/polish (9–13), since those depend on the core data
  model being solid.
- Each commit should leave the extension in a loadable, non-broken state —
  no slice should be committed half-finished.
- If a slice turns out to need splitting further once we're in it (e.g.
  Slice 5's tab-group logic turning out gnarlier than expected), split it
  into 5a/5b rather than cramming an untested chunk into one commit.
