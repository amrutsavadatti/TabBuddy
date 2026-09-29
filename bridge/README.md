# tabbuddy-bridge

Connects AI agents to the TabBuddy browser extension. The package runs in two
modes (see [MCP_Development_Plan.md](../MCP_Development_Plan.md)):

- `host` — the native messaging host. The **browser** starts it.
- `serve` — the MCP server. The **MCP client** starts it. *(Coming in slice P5.)*

They meet over a Unix socket at `~/.tabbuddy/bridge.sock` (owner-only).

## Build

```bash
cd bridge
npm install
npm run build      # writes dist/
npm test           # unit tests
```

`bridge/.npmrc` sets `legacy-peer-deps`, which works around an npm 10 bug
("Cannot read properties of null (reading 'edgesOut')") on the vitest peers.

## Debug commands

With the browser running and TabBuddy's Agent bridge switched on:

```bash
node dist/src/cli.js ping                       # the extension's version
node dist/src/cli.js call listSnapshots '{}'    # any request, any params
```

## Install

Until the package is published, run the built CLI directly (from `bridge/`):

```bash
node dist/src/cli.js install     # registers the host with your browsers (macOS)
node dist/src/cli.js doctor      # checks the whole chain
node dist/src/cli.js uninstall   # removes what install wrote
```

`install`:

- writes a launcher, `~/.tabbuddy/tabbuddy-bridge-host`, that runs Node **by
  absolute path** (the browser does not use your shell's `PATH`, so nvm, Volta
  and Homebrew Node aren't found otherwise);
- finds TabBuddy in each installed browser (Chrome, Brave, Edge) by reading its
  profiles, and writes a host manifest that allows exactly that extension ID.
  Brave on macOS only looks in **Chrome's** `NativeMessagingHosts` folder (tested;
  its own folder is ignored), so for Brave `install` writes both. Chrome and
  Brave then share one manifest that allows both extension IDs.

Options: `--browser chrome|brave|edge` (repeatable) to limit it, and
`--extension-id <id>` (repeatable) to allow an ID it can't detect, such as a
store install or a browser it isn't scanning.

Then **restart the browser** and switch on *Settings → Automation → Agent
bridge* in TabBuddy. The extension connects within a few seconds; run `doctor`
to confirm.

Moving the TabBuddy folder, or loading it from a different path, gives the
unpacked extension a new ID. Run `install` again afterwards; `doctor` will tell
you when the ID no longer matches.

### What `doctor` checks

In order, stopping at the first problem and printing a fix for it:

1. the launcher exists, is executable, and its Node and bridge paths exist;
2. each installed browser has a host manifest pointing at the launcher;
3. the manifest allows the extension ID the browser has loaded;
4. something is listening on the socket (the browser started the host);
5. the extension answers `hello` with a matching protocol version.

## Troubleshooting

- **The host's log** is `~/.tabbuddy/bridge.log`. stdout is reserved for the
  browser, and the browser hides stderr, so nothing else is written anywhere.
- **`Specified native messaging host not found`** in the extension's service
  worker console: run `doctor`. Usually the manifest is missing, or the browser
  wasn't restarted after `install`.
- **`Access to the specified native messaging host is forbidden`**: the ID in
  `allowed_origins` doesn't match the extension's ID; run `install` again.
- **`Native host has exited`**: the launcher's Node path is wrong (`doctor`
  checks this). Run the launcher by hand; it should sit waiting for input.
- **`Another TabBuddy bridge host is already running`** in the log: a second
  browser or profile has the bridge on. Only one at a time for now.
