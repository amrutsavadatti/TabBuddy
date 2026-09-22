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

## Testing

`lib/` has a unit test suite (Vitest + WXT's `fakeBrowser`, an in-memory
mock of the `chrome`/`browser` APIs) covering the framework-agnostic
logic: storage, capture/restore/update, sorting, naming, export/import,
auto-grouping, and the small UI-preference helpers (vibes, hover-peek,
onboarding).

```bash
npm test         # run once
npm run test:watch   # watch mode while developing
```

Two things worth knowing if you're adding tests that touch the `browser`
API:

- `fakeBrowser` doesn't implement every API. Notably `tabGroups.*`,
  `sessions.*`, and `tabs.group`/`ungroup` are stubs that throw if called
  for real — mock them directly with `vi.spyOn` instead (see
  `lib/capture.test.ts` or `lib/restore.test.ts` for examples). Because
  these are WebExtension APIs with overloaded (promise + callback)
  signatures, `vi.spyOn` sometimes infers the wrong overload — casting the
  spied object to `any` (`vi.spyOn(browser.tabGroups as any, 'update')`)
  sidesteps it.
- `fakeBrowser`'s fidelity isn't perfect: e.g. `windows.get()` resolves
  `undefined` for a missing window instead of rejecting like real Chrome
  does. Where our code relies on real Chrome's rejection behavior, mock
  it explicitly rather than trusting the fake's default.
- `test/setup.ts` resets `fakeBrowser` state and restores all mocks before
  every test — don't skip that if you add a new setup file.

Entrypoints (`entrypoints/popup/App.tsx`, `entrypoints/dashboard/App.tsx`,
`TriageView.tsx`) aren't unit tested — they're UI/drag-and-drop heavy and
better covered by manually loading the extension and clicking through the
change.

## Before submitting a PR

- `npm run compile` should pass with no type errors.
- `npm test` should pass.
- `npm run build` should succeed.
- Manually test the change by loading the built extension in a real
  browser, especially anything UI-facing that isn't covered by the unit
  tests.
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
