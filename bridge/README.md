# tabbuddy

Connects AI agents (Claude Code, Claude Desktop, any
[MCP](https://modelcontextprotocol.io) client) to the
[TabBuddy](https://github.com/amrutsavadatti/TabBuddy) browser extension, so an
agent can open your snapshots, search what you've saved, and help clean up your
tabs, with your say-so before anything is closed.

It is optional and **off by default**. It talks only to your own computer.

---

## Setup

### 1. Install TabBuddy

Load the TabBuddy Chrome extension (unpacked from the repo, or from the Chrome Web Store once available).

### 2. Install the bridge

Requires **Node 20 or later** and **Chrome** (macOS tested; Linux and Windows support is written but not yet verified on real machines).

```bash
npm install -g tabbuddy
tabbuddy install
```

`install` detects which browsers have TabBuddy loaded and registers the native messaging host for each one. It writes a launcher at `~/.tabbuddy/tabbuddy-bridge-host`.

> **Tip:** always use a global install, not `npx`. The install records the exact path to the bridge, and npx keeps files in a cache that npm cleans out over time — after which the browser can no longer start the bridge.

### 3. Restart your browser

Chrome only reads the host manifest at startup. Restart it after running `install`.

### 4. Turn on the Agent bridge in TabBuddy

Open TabBuddy → **Settings** (gear icon) → **Automation** → **Agent bridge** → toggle it **On**.

The status should change to **Connected** within a few seconds.

### 5. Connect your AI client

**Claude Code:**
```bash
claude mcp add tabbuddy -- tabbuddy serve
```

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "tabbuddy": {
      "command": "tabbuddy",
      "args": ["serve"]
    }
  }
}
```

**Any other MCP client:** run `tabbuddy serve` as a stdio MCP server.

### 6. Verify everything

```bash
tabbuddy doctor
```

This checks each step in order and prints a fix for the first problem it finds.

---

## How it works

One program, two modes, meeting over a local socket:

```
MCP client ──stdio / MCP──▶ tabbuddy serve
                                  │  Unix socket ~/.tabbuddy/bridge.sock (owner only)
                                  ▼  (a named pipe on Windows)
Browser ─stdio / native msg─▶ tabbuddy host
                                  ▲
                                  │  runtime.Port (connectNative)
                        TabBuddy service worker
```

- **`host`** — the native messaging host. The **browser** starts it when the Agent bridge is switched on.
- **`serve`** — the MCP server. The **AI client** starts it when it launches.

Both need to be running for tools to work. If Chrome is closed or the bridge is off, `serve` exits immediately and your AI client will report a connection error.

---

## Commands

```
tabbuddy serve             MCP server over stdio (your AI client starts this)
tabbuddy host              Native messaging host (the browser starts this)
tabbuddy install [--extension-id ID]... [--browser chrome|brave|edge|chromium]...
                           Register the host with your browsers
tabbuddy uninstall         Remove what install wrote
tabbuddy doctor            Check the setup, stopping at the first problem
tabbuddy ping              Ask the extension for its version
tabbuddy call <method> [json]
                           Send any request and print the result
```

### What `install` writes

- A launcher at `~/.tabbuddy/tabbuddy-bridge-host` (`.cmd` on Windows) that runs Node by absolute path — the browser doesn't use your shell's PATH, so nvm, Volta and Homebrew Node won't be found otherwise.
- For each installed browser that has TabBuddy loaded, a host manifest that allows exactly that extension's ID:

  | Platform | Where |
  |---|---|
  | macOS | `~/Library/Application Support/<browser>/NativeMessagingHosts/`. Brave reads Chrome's folder there (tested), so for Brave both are written. |
  | Linux | `~/.config/<browser>/NativeMessagingHosts/` |
  | Windows | one manifest at `~/.tabbuddy/com.tabbuddy.bridge.json`, and a per-browser registry key under `HKCU\Software\<vendor>\NativeMessagingHosts\` pointing to it |

Options: `--browser` (repeatable) limits which browsers are configured; `--extension-id <id>` (repeatable) adds an ID the installer can't auto-detect, such as a store install.

Moving the TabBuddy folder gives an unpacked extension a new ID. Run `tabbuddy install` again; `tabbuddy doctor` tells you when the ID no longer matches.

### What `doctor` checks

In order, stopping at the first problem:

1. The launcher exists, is executable, and its Node and bridge paths exist
2. Each installed browser has a host manifest (and registry key on Windows) pointing at the launcher
3. The manifest allows the extension ID the browser has loaded
4. Something is listening on the socket (the browser started the host)
5. The extension answers `hello` with a matching protocol version

---

## Troubleshooting

**`CONNECTION_CLOSED` in your AI client**
Chrome is not open, or the Agent bridge is off. Open Chrome, make sure TabBuddy is loaded, turn the bridge on in Settings → Automation → Agent bridge, then start a new session in your AI client.

**`Bridge not installed` in TabBuddy / `Specified native messaging host not found` in the service worker console**
Run `tabbuddy install`, then restart your browser.

**`Access to the specified native messaging host is forbidden`**
The extension ID in the manifest doesn't match the loaded extension. Run `tabbuddy install` again.

**`Native host has exited`**
The launcher's Node path is stale (Node was updated or moved). Run `tabbuddy install` again.

**`Another TabBuddy bridge host is already running`** (in `~/.tabbuddy/bridge.log`)
A second browser profile has the bridge on. Only one at a time is supported for now.

The host's full log is at `~/.tabbuddy/bridge.log`.

---

## Requirements

- Node 20+
- Chrome (macOS and Linux) or Chrome / Edge / Brave (Windows)
- Firefox is not supported

---

## Development

```bash
cd bridge
npm install
npm run build      # writes dist/
npm test
```

To try the built CLI without installing:
```bash
node dist/src/cli.js install
node dist/src/cli.js doctor
node dist/src/cli.js call listSnapshots '{}'
```

### Publishing

`npm publish` runs `prepublishOnly` (build + tests). Bump `version` in `package.json` and `SERVER_VERSION` in `src/serve.ts` together — a test checks they match.
