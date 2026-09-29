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

## Installing the host by hand (until `install` arrives in slice P4)

1. **Find the extension ID** at `chrome://extensions` (turn on Developer mode).

2. **Create a launcher.** The browser does not use your shell's `PATH`, so it
   must name Node by absolute path (`which node`):

   ```sh
   mkdir -p ~/.tabbuddy && cat > ~/.tabbuddy/tabbuddy-bridge-host <<'SH'
   #!/bin/sh
   exec /ABSOLUTE/PATH/TO/node /ABSOLUTE/PATH/TO/TabBuddy/bridge/dist/src/cli.js host "$@"
   SH
   chmod +x ~/.tabbuddy/tabbuddy-bridge-host
   ```

3. **Register the host** with the browser. Save this as
   `com.tabbuddy.bridge.json` in the browser's `NativeMessagingHosts` folder:

   ```json
   {
     "name": "com.tabbuddy.bridge",
     "description": "TabBuddy agent bridge",
     "path": "/Users/YOU/.tabbuddy/tabbuddy-bridge-host",
     "type": "stdio",
     "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID/"]
   }
   ```

   | Browser (macOS) | Folder |
   |---|---|
   | Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
   | Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` |
   | Edge | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/` |

   The trailing slash in `allowed_origins` is required.

4. **Restart the browser**, then in TabBuddy's dashboard turn on
   *Settings → Automation → Agent bridge*. The extension connects within a few
   seconds (the retry delays are 5s, 10s, 20s ...). Run `ping` to check.

## Troubleshooting

- **The host's log** is `~/.tabbuddy/bridge.log`. stdout is reserved for the
  browser, and the browser hides stderr, so nothing else is written anywhere.
- **`Specified native messaging host not found`** in the extension's service
  worker console: the manifest is in the wrong folder, has the wrong `name`, or
  the browser wasn't restarted.
- **`Access to the specified native messaging host is forbidden`**: the ID in
  `allowed_origins` doesn't match the extension's ID.
- **`Native host has exited`**: the launcher's Node path is wrong. Run the
  launcher by hand; it should sit waiting for input.
- **`Another TabBuddy bridge host is already running`** in the log: a second
  browser or profile has the bridge on. Only one at a time for now.
