import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const HOST_NAME = 'com.tabbuddy.bridge';
export const MANIFEST_FILE = `${HOST_NAME}.json`;
export const LAUNCHER_FILE = 'tabbuddy-bridge-host';
/** Windows can only run a script it can tell is one. */
export const WINDOWS_LAUNCHER_FILE = `${LAUNCHER_FILE}.cmd`;
/** Store-listing IDs, added at release time. Unpacked builds are detected. */
export const KNOWN_EXTENSION_IDS: string[] = [];

export const BROWSER_IDS = ['chrome', 'brave', 'edge', 'chromium'] as const;
export type BrowserId = (typeof BROWSER_IDS)[number];

export interface BrowserTarget {
  id: BrowserId;
  name: string;
  /** The browser's user data directory; it exists only if the browser has run. */
  dataDir: string;
  /** Every folder the browser reads host manifests from; install writes all of
   * them. Empty on Windows, where a registry key names the manifest instead. */
  manifestDirs: string[];
  /** Windows only: the key (under HKCU) whose default value is the manifest's path. */
  registryKey?: string;
}

/** The per-user Windows registry, reduced to the three things install needs. */
export interface Registry {
  set(key: string, value: string): void;
  read(key: string): string | null;
  remove(key: string): void;
}

/** The real registry, through reg.exe (present on every Windows install). */
export function systemRegistry(run: typeof execFileSync = execFileSync): Registry {
  return {
    set: (key, value) => void run('reg', ['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f'], { stdio: 'ignore' }),
    read: (key) => {
      try {
        const out = run('reg', ['query', key, '/ve'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
        // "(Default)" is translated on other Windows languages; REG_SZ is not
        return /REG_SZ\s+(.+?)\s*$/m.exec(out)?.[1] ?? null;
      } catch {
        return null;
      }
    },
    remove: (key) => {
      try {
        run('reg', ['delete', key, '/f'], { stdio: 'ignore' });
      } catch {
        // already gone
      }
    },
  };
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`Installing the bridge on ${platform} isn't supported (macOS, Linux and Windows are).`);
  }
}

export function browserTargets(
  home: string,
  platform: string = process.platform,
  localAppData: string = path.join(home, 'AppData', 'Local'),
): BrowserTarget[] {
  if (platform === 'darwin') {
    const support = path.join(home, 'Library', 'Application Support');
    const hostsDir = (dir: string) => path.join(support, dir, 'NativeMessagingHosts');
    const chrome = path.join('Google', 'Chrome');
    const brave = path.join('BraveSoftware', 'Brave-Browser');
    const edge = 'Microsoft Edge';
    return [
      { id: 'chrome', name: 'Chrome', dataDir: path.join(support, chrome), manifestDirs: [hostsDir(chrome)] },
      {
        id: 'brave',
        name: 'Brave',
        dataDir: path.join(support, brave),
        // Verified on macOS: Brave finds a host only in Chrome's folder, even
        // though it has a NativeMessagingHosts folder of its own.
        manifestDirs: [hostsDir(chrome), hostsDir(brave)],
      },
      { id: 'edge', name: 'Edge', dataDir: path.join(support, edge), manifestDirs: [hostsDir(edge)] },
    ];
  }

  if (platform === 'linux') {
    // On Linux a Chromium browser reads NativeMessagingHosts inside its own
    // user data folder. Not yet verified on a real Linux install.
    const config = path.join(home, '.config');
    const target = (id: BrowserId, name: string, dir: string): BrowserTarget => ({
      id,
      name,
      dataDir: path.join(config, dir),
      manifestDirs: [path.join(config, dir, 'NativeMessagingHosts')],
    });
    return [
      target('chrome', 'Chrome', 'google-chrome'),
      target('brave', 'Brave', path.join('BraveSoftware', 'Brave-Browser')),
      target('edge', 'Edge', 'microsoft-edge'),
      target('chromium', 'Chromium', 'chromium'),
    ];
  }

  if (platform === 'win32') {
    // A Windows browser finds the host through a registry key under its vendor
    // name; the key's value is the manifest's path. Not yet verified on a real
    // Windows install.
    const target = (id: BrowserId, name: string, vendor: string, dataDir: string): BrowserTarget => ({
      id,
      name,
      dataDir: path.join(localAppData, dataDir, 'User Data'),
      manifestDirs: [],
      registryKey: `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${HOST_NAME}`,
    });
    return [
      target('chrome', 'Chrome', 'Google\\Chrome', path.join('Google', 'Chrome')),
      target('brave', 'Brave', 'BraveSoftware\\Brave-Browser', path.join('BraveSoftware', 'Brave-Browser')),
      target('edge', 'Edge', 'Microsoft\\Edge', path.join('Microsoft', 'Edge')),
    ];
  }

  throw new UnsupportedPlatformError(platform);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The browser doesn't use your shell's PATH (nvm, Volta and Homebrew Node
 * aren't on it), so the launcher names Node by absolute path. On Windows it is
 * a .cmd script (a % in a path must be doubled there). */
export function buildLauncher(
  { nodePath, cliPath }: { nodePath: string; cliPath: string },
  platform: string = process.platform,
): string {
  if (platform === 'win32') {
    const quote = (value: string) => `"${value.replaceAll('%', '%%')}"`;
    return `@echo off\r\n${quote(nodePath)} ${quote(cliPath)} host %*\r\n`;
  }
  return `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(cliPath)} host "$@"\n`;
}

export function buildManifest({
  launcherPath,
  extensionIds,
}: {
  launcherPath: string;
  extensionIds: string[];
}) {
  return {
    name: HOST_NAME,
    description: 'TabBuddy agent bridge',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: extensionIds.map((id) => `chrome-extension://${id}/`),
  };
}

function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** IDs of TabBuddy builds loaded in a browser: unpacked extensions whose
 * folder holds a manifest named "TabBuddy", found in every profile's
 * preferences. */
export function detectExtensionIds(dataDir: string): string[] {
  const ids = new Set<string>();
  let entries: string[];
  try {
    entries = fs.readdirSync(dataDir);
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (entry !== 'Default' && !/^Profile \d+$/.test(entry)) continue;
    for (const prefsFile of ['Secure Preferences', 'Preferences']) {
      const prefs = readJson(path.join(dataDir, entry, prefsFile));
      const settings = prefs?.extensions?.settings;
      if (!settings || typeof settings !== 'object') continue;
      for (const [id, setting] of Object.entries<any>(settings)) {
        const folder = setting?.path;
        if (typeof folder !== 'string' || !path.isAbsolute(folder)) continue;
        if (readJson(path.join(folder, 'manifest.json'))?.name === 'TabBuddy') ids.add(id);
      }
    }
  }
  return [...ids];
}

export interface InstallEnv {
  home: string;
  /** ~/.tabbuddy */
  bridgeDir: string;
  nodePath: string;
  cliPath: string;
  platform?: string;
  /** Windows: %LOCALAPPDATA%, where browsers keep their data. */
  localAppData?: string;
  /** Windows: the registry to write to (default: the real one). */
  registry?: Registry;
}

export interface InstallOptions {
  /** Extra IDs to allow, on top of the ones detected. */
  extensionIds?: string[];
  /** Limit to these browsers; default is every installed one. */
  browsers?: BrowserId[];
}

export function targetsFor(env: InstallEnv): BrowserTarget[] {
  return browserTargets(env.home, env.platform, env.localAppData);
}

/** The manifest files a browser reads. On Windows one shared file in the bridge
 * folder, which the registry keys point to. */
export function manifestFilesFor(target: BrowserTarget, env: InstallEnv): string[] {
  return target.registryKey
    ? [path.join(env.bridgeDir, MANIFEST_FILE)]
    : target.manifestDirs.map((dir) => path.join(dir, MANIFEST_FILE));
}

export type BrowserOutcome =
  | { browser: string; status: 'written'; extensionIds: string[]; files: string[]; registryKey?: string }
  | { browser: string; status: 'not-installed' }
  | { browser: string; status: 'no-extension' };

export interface InstallReport {
  launcherPath: string;
  outcomes: BrowserOutcome[];
}

export function launcherPathFor(bridgeDir: string, platform: string = process.platform): string {
  return path.join(bridgeDir, platform === 'win32' ? WINDOWS_LAUNCHER_FILE : LAUNCHER_FILE);
}

export function install(env: InstallEnv, options: InstallOptions = {}): InstallReport {
  const platform = env.platform ?? process.platform;
  const windows = platform === 'win32';
  const targets = targetsFor(env).filter((t) => !options.browsers || options.browsers.includes(t.id));
  const launcherPath = launcherPathFor(env.bridgeDir, platform);
  fs.mkdirSync(env.bridgeDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(launcherPath, buildLauncher(env, platform), { mode: 0o755 });
  if (!windows) fs.chmodSync(launcherPath, 0o755);

  // Browsers can share a manifest file (Brave reads Chrome's folder on macOS;
  // on Windows every browser points at the one file), so collect the allowed
  // IDs per file first and write each file once with the union.
  const idsByFile = new Map<string, Set<string>>();
  const perBrowser = targets.map((target) => {
    if (!fs.existsSync(target.dataDir)) return { target, extensionIds: null };
    const extensionIds = [
      ...new Set([
        ...detectExtensionIds(target.dataDir),
        ...KNOWN_EXTENSION_IDS,
        ...(options.extensionIds ?? []),
      ]),
    ];
    if (extensionIds.length > 0) {
      for (const file of manifestFilesFor(target, env)) {
        const ids = idsByFile.get(file) ?? new Set<string>();
        extensionIds.forEach((id) => ids.add(id));
        idsByFile.set(file, ids);
      }
    }
    return { target, extensionIds };
  });

  for (const [file, ids] of idsByFile) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const manifest = buildManifest({ launcherPath, extensionIds: [...ids] });
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  const registry = env.registry ?? (windows ? systemRegistry() : undefined);
  const outcomes: BrowserOutcome[] = perBrowser.map(({ target, extensionIds }) => {
    if (extensionIds === null) return { browser: target.name, status: 'not-installed' };
    if (extensionIds.length === 0) return { browser: target.name, status: 'no-extension' };
    const [file] = manifestFilesFor(target, env);
    if (target.registryKey && registry && file) registry.set(target.registryKey, file);
    return {
      browser: target.name,
      status: 'written',
      extensionIds,
      files: manifestFilesFor(target, env),
      ...(target.registryKey ? { registryKey: target.registryKey } : {}),
    };
  });
  return { launcherPath, outcomes };
}

/** Removes only what install wrote. Returns what was deleted (files, and
 * registry keys on Windows, the latter written as "registry: <key>"). */
export function uninstall(env: InstallEnv): string[] {
  const platform = env.platform ?? process.platform;
  const targets = targetsFor(env);
  const removed: string[] = [];

  const registry = env.registry ?? (platform === 'win32' ? systemRegistry() : undefined);
  for (const target of targets) {
    if (!target.registryKey || !registry) continue;
    const [file] = manifestFilesFor(target, env);
    // only a key that points at our manifest is ours to remove
    if (registry.read(target.registryKey) === file) {
      registry.remove(target.registryKey);
      removed.push(`registry: ${target.registryKey}`);
    }
  }

  const candidates = [
    ...new Set([
      ...targets.flatMap((t) => manifestFilesFor(t, env)),
      launcherPathFor(env.bridgeDir, platform),
    ]),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    fs.rmSync(file);
    removed.push(file);
  }
  return removed;
}

/** The line that registers the MCP server with Claude Code, quoted for the
 * shell the user is most likely typing into. */
export function mcpAddCommand(
  env: Pick<InstallEnv, 'nodePath' | 'cliPath'>,
  platform: string = process.platform,
): string {
  const quote =
    platform === 'win32'
      ? (v: string) => `"${v}"`
      : (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
  return `claude mcp add tabbuddy -- ${quote(env.nodePath)} ${quote(env.cliPath)} serve`;
}

/** npx unpacks packages into a cache that npm may empty later. */
export function isTemporaryInstall(cliPath: string): boolean {
  return /[\\/]_npx[\\/]/.test(cliPath);
}
