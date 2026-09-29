import fs from 'node:fs';
import path from 'node:path';

export const HOST_NAME = 'com.tabbuddy.bridge';
export const MANIFEST_FILE = `${HOST_NAME}.json`;
export const LAUNCHER_FILE = 'tabbuddy-bridge-host';
/** Store-listing IDs, added at release time. Unpacked builds are detected. */
export const KNOWN_EXTENSION_IDS: string[] = [];

export type BrowserId = 'chrome' | 'brave' | 'edge';

export interface BrowserTarget {
  id: BrowserId;
  name: string;
  /** The browser's user data directory; it exists only if the browser has run. */
  dataDir: string;
  /** Every folder the browser reads host manifests from; install writes all of them. */
  manifestDirs: string[];
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`Installing the bridge on ${platform} isn't supported yet (macOS only for now).`);
  }
}

export function browserTargets(home: string, platform: string = process.platform): BrowserTarget[] {
  if (platform !== 'darwin') throw new UnsupportedPlatformError(platform);
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

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The browser doesn't use your shell's PATH (nvm, Volta and Homebrew Node
 * aren't on it), so the launcher names Node by absolute path. */
export function buildLauncher({ nodePath, cliPath }: { nodePath: string; cliPath: string }): string {
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
}

export interface InstallOptions {
  /** Extra IDs to allow, on top of the ones detected. */
  extensionIds?: string[];
  /** Limit to these browsers; default is every installed one. */
  browsers?: BrowserId[];
}

export type BrowserOutcome =
  | { browser: string; status: 'written'; extensionIds: string[]; files: string[] }
  | { browser: string; status: 'not-installed' }
  | { browser: string; status: 'no-extension' };

export interface InstallReport {
  launcherPath: string;
  outcomes: BrowserOutcome[];
}

export function launcherPathFor(bridgeDir: string): string {
  return path.join(bridgeDir, LAUNCHER_FILE);
}

export function install(env: InstallEnv, options: InstallOptions = {}): InstallReport {
  const targets = browserTargets(env.home, env.platform).filter(
    (t) => !options.browsers || options.browsers.includes(t.id),
  );
  const launcherPath = launcherPathFor(env.bridgeDir);
  fs.mkdirSync(env.bridgeDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(launcherPath, buildLauncher(env), { mode: 0o755 });
  fs.chmodSync(launcherPath, 0o755);

  // Browsers can share a manifest folder (Brave reads Chrome's), so collect
  // the allowed IDs per folder first and write each file once with the union.
  const idsByDir = new Map<string, Set<string>>();
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
      for (const dir of target.manifestDirs) {
        const ids = idsByDir.get(dir) ?? new Set<string>();
        extensionIds.forEach((id) => ids.add(id));
        idsByDir.set(dir, ids);
      }
    }
    return { target, extensionIds };
  });

  const written = new Map<string, string>();
  for (const [dir, ids] of idsByDir) {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, MANIFEST_FILE);
    const manifest = buildManifest({ launcherPath, extensionIds: [...ids] });
    fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    written.set(dir, file);
  }

  const outcomes: BrowserOutcome[] = perBrowser.map(({ target, extensionIds }) => {
    if (extensionIds === null) return { browser: target.name, status: 'not-installed' };
    if (extensionIds.length === 0) return { browser: target.name, status: 'no-extension' };
    return {
      browser: target.name,
      status: 'written',
      extensionIds,
      files: target.manifestDirs.map((dir) => written.get(dir)!),
    };
  });
  return { launcherPath, outcomes };
}

/** Removes only what install wrote. Returns the files that were deleted. */
export function uninstall(env: InstallEnv): string[] {
  const candidates = [
    ...browserTargets(env.home, env.platform).flatMap((t) =>
      t.manifestDirs.map((dir) => path.join(dir, MANIFEST_FILE)),
    ),
    launcherPathFor(env.bridgeDir),
  ];
  return candidates.filter((file) => {
    if (!fs.existsSync(file)) return false;
    fs.rmSync(file);
    return true;
  });
}
