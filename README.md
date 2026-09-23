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
- **Tab hoarder nudges.** TabBuddy checks on a schedule you set for tabs
  you've left untouched (you choose what "stale" means), and nudges you to
  Close, Archive & Close (into a reserved, pinned "Archived" snapshot), or
  Keep (snoozes for 2 days). Set how often and how old is stale, in
  minutes, hours, or days, from the yellow bell button in the dashboard.
- **Keyboard shortcut.** `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac) opens the
  dashboard from anywhere — or focuses it if it's already open.
  Customizable at `chrome://extensions/shortcuts`.
- **Privacy-respecting by design.** Runs entirely on-device
  (`chrome.storage.local`), no network calls, no host permissions, no
  content scripts. See [PRD.md](./PRD.md) for the full permission
  rationale.

See [USER_GUIDE.md](./USER_GUIDE.md) for a full walkthrough of every
feature. See [PRD.md](./PRD.md) for the full product spec and
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) for how the project was built,
slice by slice.

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
