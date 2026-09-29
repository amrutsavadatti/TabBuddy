# tabbuddy-bridge

Connects AI agents (Claude Code, Claude Desktop, any
[MCP](https://modelcontextprotocol.io) client) to the
[TabBuddy](https://github.com/amrutsavadatti/TabBuddy) browser extension, so an
agent can open your snapshots, search what you've saved, and help clean up your
tabs, with your say-so before anything is closed.

It is optional and **off by default**. It talks only to your own computer. What
an agent can see, and what it can't, is in
[the main README](../README.md#use-tabbuddy-with-ai-agents).

## Use it

```bash
npm install -g tabbuddy-bridge
tabbuddy-bridge install     # registers the host with your browsers
```

Restart the browser, then in TabBuddy: gear → **Automation** → **Agent bridge** →
turn it on. Connect your agent, for Claude Code:

```bash
claude mcp add tabbuddy -- tabbuddy-bridge serve
tabbuddy-bridge doctor      # checks the whole chain
```

Prefer a global install over `npx`: `install` records where the bridge lives, and
npx keeps it in a cache that npm cleans out from time to time, after which the
browser could no longer start it. (`install` warns if you run it from that cache.)

Requires Node 20 or later. macOS is tested. Linux (Chrome, Brave, Edge, Chromium)
and Windows (Chrome, Brave, Edge) support is written and unit-tested but has not yet
been tried on real machines; `doctor` will tell you where it breaks, and reports are
welcome. Firefox is not supported.

## How it works

One program, two modes, meeting over a local socket:

```
MCP client ──stdio / MCP──▶ tabbuddy-bridge serve
                                  │  Unix socket ~/.tabbuddy/bridge.sock (owner only)
                                  ▼  (a named pipe on Windows)
Browser ─stdio / native msg─▶ tabbuddy-bridge host
                                  ▲
                                  │  runtime.Port (connectNative)
                        TabBuddy service worker
```

- `host`: the native messaging host. The **browser** starts it when TabBuddy's
  Agent bridge is switched on.
- `serve`: the MCP server. The **MCP client** starts it.

The full design, tool catalogue and build history are in
[MCP_Development_Plan.md](../MCP_Development_Plan.md).

## Commands

```
tabbuddy-bridge serve             MCP server over stdio (your AI client starts this)
tabbuddy-bridge host              Native messaging host (the browser starts this)
tabbuddy-bridge install [--extension-id ID]... [--browser chrome|brave|edge|chromium]...
tabbuddy-bridge uninstall         Remove what install wrote
tabbuddy-bridge doctor            Check the setup, stopping at the first problem
tabbuddy-bridge ping              Ask the extension for its version
tabbuddy-bridge call <method> [json]
                                  Send any request and print the result
```

### What `install` writes

- A launcher, `~/.tabbuddy/tabbuddy-bridge-host` (`.cmd` on Windows), that runs
  Node **by absolute path**. The browser does not use your shell's `PATH`, so nvm,
  Volta and Homebrew Node aren't found otherwise.
- For each installed browser that has TabBuddy loaded (found by reading its
  profiles), a host manifest that allows exactly that extension ID:

  | Platform | Where |
  |---|---|
  | macOS | `~/Library/Application Support/<browser>/NativeMessagingHosts/`. Brave only reads **Chrome's** folder there (tested), so for Brave both are written. |
  | Linux | `~/.config/<browser>/NativeMessagingHosts/` |
  | Windows | one manifest, `~/.tabbuddy/com.tabbuddy.bridge.json`, and a per-browser registry key under `HKCU\Software\<vendor>\NativeMessagingHosts\` that points to it |

Options: `--browser` (repeatable) limits it, and `--extension-id <id>` (repeatable)
allows an ID it can't detect, such as a store install. `uninstall` removes only
what `install` wrote, and on Windows only registry keys that still point at
TabBuddy's manifest.

Moving the TabBuddy folder, or loading it from a different path, gives an
unpacked extension a new ID. Run `install` again; `doctor` says when the ID no
longer matches.

### What `doctor` checks

In order, stopping at the first problem and printing a fix for it:

1. the launcher exists, is executable (not checked on Windows), and its Node and bridge paths exist;
2. each installed browser has a host manifest (on Windows, a registry key too) pointing at the launcher;
3. the manifest allows the extension ID the browser has loaded;
4. something is listening on the socket (the browser started the host);
5. the extension answers `hello` with a matching protocol version.

## Troubleshooting

- **The host's log** is `~/.tabbuddy/bridge.log`. stdout is reserved for the
  browser, and the browser hides stderr, so nothing else is written anywhere.
- **`Specified native messaging host not found`** in the extension's service
  worker console (TabBuddy shows it as "Bridge not installed"): run `doctor`.
  Usually the manifest is missing, or the browser wasn't restarted after `install`.
- **`Access to the specified native messaging host is forbidden`**: the ID in
  `allowed_origins` doesn't match the extension's ID; run `install` again.
- **`Native host has exited`**: the launcher's Node path is wrong (`doctor`
  checks this). Run the launcher by hand; it should sit waiting for input.
- **`Another TabBuddy bridge host is already running`** in the log: a second
  browser or profile has the bridge on. Only one at a time for now.

## Development

```bash
cd bridge
npm install
npm run build      # writes dist/
npm test           # unit tests
```

`bridge/.npmrc` sets `legacy-peer-deps`, which works around an npm 10 bug
("Cannot read properties of null (reading 'edgesOut')") on the vitest peers.

To try the built CLI without publishing, from `bridge/`:

```bash
node dist/src/cli.js install
node dist/src/cli.js doctor
node dist/src/cli.js call listSnapshots '{}'
```

### Publishing (maintainers)

`npm publish` runs `prepublishOnly` (build and tests). The package ships only
`dist/`, this README and the license. Bump `version` here and `SERVER_VERSION` in
`src/serve.ts` together (a test checks they match).
