# Contributing to TabBuddy

Thanks for considering a contribution! TabBuddy is a small, permission-light
extension by design — the goal is to keep it easy for anyone to read the
whole codebase and understand what it does.

## Getting set up

1. Install Node.js 22+ (see `.nvmrc`; `nvm use` if you use nvm).
2. `npm install`
3. `npm run dev` to start WXT's dev server, or `npm run build` for a
   production build.
4. Load `.output/chrome-mv3` as an unpacked extension in
   `chrome://extensions` (enable Developer mode first).

See [README.md](./README.md) for more detail on the build/load steps.

## Project structure

- `entrypoints/popup/` — the toolbar popup (save a window, quick update)
- `entrypoints/dashboard/` — the full-page dashboard (manage snapshots)
- `entrypoints/background.ts` — the extension's background service worker
- `lib/` — shared logic: capture, restore, storage, sorting, naming, etc.
  (framework-agnostic, no React)
- `components/ui/` — hand-built shadcn/ui-style primitives (Button,
  Dialog, AlertDialog)

[PRD.md](./PRD.md) has the full product spec and data model.
[DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) shows how the project was
built as a sequence of vertical slices — useful context for how features
were scoped and tested.

## Before submitting a PR

- `npm run compile` should pass with no type errors.
- `npm run build` should succeed.
- Manually test the change by loading the built extension in a real
  browser — this project doesn't have an automated test suite yet, so
  manual verification is the bar.
- Keep changes scoped. A small, focused PR is much easier to review than
  one that touches unrelated areas.

## Design principles to keep in mind

- **No new permissions without a good reason.** TabBuddy intentionally
  avoids host permissions and content scripts. If a feature seems to need
  one, look for an alternative approach first, or open an issue to discuss
  it.
- **No network calls.** Everything runs on-device. Don't introduce calls
  to external APIs or services.
- **Snapshots are frozen, not live-synced.** Don't add background listeners
  that silently mutate a saved snapshot — updates should always be an
  explicit user action.

## Reporting bugs / requesting features

Open a GitHub issue with as much detail as you can: browser + version,
steps to reproduce, and what you expected to happen.
