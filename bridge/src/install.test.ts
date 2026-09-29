import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  browserTargets,
  buildLauncher,
  buildManifest,
  detectExtensionIds,
  install,
  launcherPathFor,
  MANIFEST_FILE,
  uninstall,
  UnsupportedPlatformError,
} from './install.js';
import { makeHome } from './testHome.js';
import { isTemporaryInstall, mcpAddCommand, systemRegistry, WINDOWS_LAUNCHER_FILE } from './install.js';

const homes: ReturnType<typeof makeHome>[] = [];
function home() {
  const h = makeHome();
  homes.push(h);
  return h;
}
afterEach(() => homes.splice(0).forEach((h) => h.cleanup()));

describe('browserTargets', () => {
  it('lists the macOS data and manifest folders', () => {
    const targets = browserTargets('/Users/me', 'darwin');
    expect(targets.map((t) => t.id)).toEqual(['chrome', 'brave', 'edge']);
    // Brave only finds hosts in Chrome's folder (verified), so both are written.
    expect(targets[1]!.manifestDirs).toEqual([
      '/Users/me/Library/Application Support/Google/Chrome/NativeMessagingHosts',
      '/Users/me/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts',
    ]);
  });

  it('lists the Linux data folders, each with its own NativeMessagingHosts', () => {
    const targets = browserTargets('/home/me', 'linux');
    expect(targets.map((t) => [t.id, t.dataDir, t.manifestDirs])).toEqual([
      ['chrome', '/home/me/.config/google-chrome', ['/home/me/.config/google-chrome/NativeMessagingHosts']],
      [
        'brave',
        '/home/me/.config/BraveSoftware/Brave-Browser',
        ['/home/me/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts'],
      ],
      ['edge', '/home/me/.config/microsoft-edge', ['/home/me/.config/microsoft-edge/NativeMessagingHosts']],
      ['chromium', '/home/me/.config/chromium', ['/home/me/.config/chromium/NativeMessagingHosts']],
    ]);
  });

  it('lists Windows browsers by registry key, with no manifest folders', () => {
    const targets = browserTargets('C:/Users/me', 'win32', 'C:/Users/me/AppData/Local');
    expect(targets.map((t) => [t.id, t.registryKey, t.manifestDirs])).toEqual([
      ['chrome', 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.tabbuddy.bridge', []],
      ['brave', 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.tabbuddy.bridge', []],
      ['edge', 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.tabbuddy.bridge', []],
    ]);
    expect(targets[0]!.dataDir).toBe(path.join('C:/Users/me/AppData/Local', 'Google', 'Chrome', 'User Data'));
  });

  it('refuses platforms it does not know', () => {
    expect(() => browserTargets('/home/me', 'freebsd')).toThrow(UnsupportedPlatformError);
  });
});

describe('buildLauncher', () => {
  it('runs Node by absolute path and forwards the browser arguments', () => {
    const h = home();
    // spaces and an apostrophe in the paths must survive shell quoting
    const dir = path.join(h.home, "it's a dir");
    fs.mkdirSync(dir);
    const cli = path.join(dir, 'echo args.js');
    fs.writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');
    const launcher = path.join(dir, 'launcher');
    fs.writeFileSync(launcher, buildLauncher({ nodePath: process.execPath, cliPath: cli }), { mode: 0o755 });

    const out = execFileSync(launcher, ['chrome-extension://abc/'], { env: { PATH: '/usr/bin:/bin' } });
    expect(JSON.parse(out.toString())).toEqual(['host', 'chrome-extension://abc/']);
  });
});

describe('buildManifest', () => {
  it('allows each extension id with the trailing slash the browser requires', () => {
    expect(buildManifest({ launcherPath: '/l', extensionIds: ['aaa', 'bbb'] })).toEqual({
      name: 'com.tabbuddy.bridge',
      description: 'TabBuddy agent bridge',
      path: '/l',
      type: 'stdio',
      allowed_origins: ['chrome-extension://aaa/', 'chrome-extension://bbb/'],
    });
  });
});

describe('detectExtensionIds', () => {
  it('finds TabBuddy in any profile and ignores other extensions', () => {
    const h = home();
    const dir = h.addBrowser('Google/Chrome', { id: 'tabbuddyid', profile: 'Profile 2' });
    h.addBrowser('Google/Chrome', { id: 'otherid', name: 'Some Other Extension' });
    expect(detectExtensionIds(dir)).toEqual(['tabbuddyid']);
  });

  it('skips store-style relative paths and missing folders', () => {
    const h = home();
    const dir = h.addBrowser('Google/Chrome', { id: 'relid', relative: true });
    expect(detectExtensionIds(dir)).toEqual([]);
    expect(detectExtensionIds(path.join(h.home, 'nope'))).toEqual([]);
  });
});

describe('install', () => {
  it('writes Brave a manifest in Chrome\'s folder too, even when Chrome is not installed', () => {
    const h = home();
    h.addBrowser('BraveSoftware/Brave-Browser', { id: 'bravebuddy' });
    const report = install(h.env);
    const chromeFile = path.join(h.support, 'Google/Chrome/NativeMessagingHosts', MANIFEST_FILE);
    expect(JSON.parse(fs.readFileSync(chromeFile, 'utf8')).allowed_origins).toEqual([
      'chrome-extension://bravebuddy/',
    ]);
    expect(report.outcomes.find((o) => o.browser === 'Brave')).toMatchObject({
      status: 'written',
      files: [chromeFile, expect.stringContaining('Brave-Browser')],
    });
    expect(report.outcomes.find((o) => o.browser === 'Chrome')).toMatchObject({
      status: 'not-installed',
    });
  });

  it('lets Chrome and Brave share one manifest by allowing both extension IDs', () => {
    const h = home();
    h.addBrowser('Google/Chrome', { id: 'chromebuddy' });
    h.addBrowser('BraveSoftware/Brave-Browser', { id: 'bravebuddy' });
    install(h.env);
    const shared = path.join(h.support, 'Google/Chrome/NativeMessagingHosts', MANIFEST_FILE);
    expect(JSON.parse(fs.readFileSync(shared, 'utf8')).allowed_origins.sort()).toEqual([
      'chrome-extension://bravebuddy/',
      'chrome-extension://chromebuddy/',
    ]);
  });

  it('writes an executable launcher and a manifest for each browser with TabBuddy loaded', () => {
    const h = home();
    h.addBrowser('BraveSoftware/Brave-Browser', { id: 'bravebuddy' });
    h.addBrowser('Google/Chrome', { id: 'chromebuddy' });

    const report = install(h.env);
    const launcher = launcherPathFor(h.env.bridgeDir);
    expect(report.launcherPath).toBe(launcher);
    expect(fs.statSync(launcher).mode & 0o777).toBe(0o755);

    const brave = JSON.parse(
      fs.readFileSync(
        path.join(h.support, 'BraveSoftware/Brave-Browser/NativeMessagingHosts', MANIFEST_FILE),
        'utf8',
      ),
    );
    expect(brave.path).toBe(launcher);
    expect(brave.allowed_origins).toEqual(['chrome-extension://bravebuddy/']);
    expect(report.outcomes.filter((o) => o.status === 'written')).toHaveLength(2);
  });

  it('skips browsers that are not installed or do not have TabBuddy loaded', () => {
    const h = home();
    h.addBrowser('Google/Chrome'); // installed, no TabBuddy
    const report = install(h.env);
    expect(report.outcomes.map((o) => [o.browser, o.status])).toEqual([
      ['Chrome', 'no-extension'],
      ['Brave', 'not-installed'],
      ['Edge', 'not-installed'],
    ]);
    expect(fs.existsSync(path.join(h.support, 'Google/Chrome/NativeMessagingHosts'))).toBe(false);
  });

  it('adds ids passed by hand, and limits to the chosen browsers', () => {
    const h = home();
    h.addBrowser('Google/Chrome');
    h.addBrowser('BraveSoftware/Brave-Browser', { id: 'bravebuddy' });
    const report = install(h.env, { extensionIds: ['storeid'], browsers: ['chrome'] });
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0]).toMatchObject({ status: 'written', extensionIds: ['storeid'] });
  });

  it('is safe to run twice', () => {
    const h = home();
    h.addBrowser('Google/Chrome', { id: 'chromebuddy' });
    install(h.env);
    expect(() => install(h.env)).not.toThrow();
  });
});

describe('uninstall', () => {
  it('removes the launcher and manifests, and leaves everything else alone', () => {
    const h = home();
    h.addBrowser('Google/Chrome', { id: 'chromebuddy' });
    install(h.env);
    const other = path.join(h.support, 'Google/Chrome/NativeMessagingHosts/com.other.json');
    fs.writeFileSync(other, '{}');
    fs.writeFileSync(path.join(h.env.bridgeDir, 'bridge.log'), 'log');

    const removed = uninstall(h.env);
    expect(removed).toHaveLength(2);
    expect(fs.existsSync(launcherPathFor(h.env.bridgeDir))).toBe(false);
    expect(fs.existsSync(other)).toBe(true);
    expect(fs.existsSync(path.join(h.env.bridgeDir, 'bridge.log'))).toBe(true);
  });

  it('reports nothing to remove on a clean machine', () => {
    expect(uninstall(home().env)).toEqual([]);
  });
});

describe('install on Linux', () => {
  it('writes the manifest inside each browser\'s own folder, with an executable launcher', () => {
    const h = makeHome('linux');
    homes.push(h);
    h.addBrowser('google-chrome', { id: 'chromebuddy' });
    h.addBrowser('BraveSoftware/Brave-Browser', { id: 'bravebuddy' });
    h.addBrowser('chromium'); // installed, no TabBuddy
    const report = install(h.env);

    for (const [dir, id] of [
      ['google-chrome', 'chromebuddy'],
      ['BraveSoftware/Brave-Browser', 'bravebuddy'],
    ] as const) {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(h.support, dir, 'NativeMessagingHosts', MANIFEST_FILE), 'utf8'),
      );
      expect(manifest.allowed_origins).toEqual([`chrome-extension://${id}/`]);
      expect(manifest.path).toBe(launcherPathFor(h.env.bridgeDir, 'linux'));
    }
    expect(fs.statSync(report.launcherPath).mode & 0o777).toBe(0o755);
    expect(report.outcomes.map((o) => [o.browser, o.status])).toEqual([
      ['Chrome', 'written'],
      ['Brave', 'written'],
      ['Edge', 'not-installed'],
      ['Chromium', 'no-extension'],
    ]);
  });

  it('uninstalls what it wrote and nothing else', () => {
    const h = makeHome('linux');
    homes.push(h);
    h.addBrowser('google-chrome', { id: 'chromebuddy' });
    install(h.env);
    expect(uninstall(h.env)).toHaveLength(2);
    expect(uninstall(h.env)).toEqual([]);
  });
});

describe('install on Windows', () => {
  const chromeKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.tabbuddy.bridge';
  const braveKey = 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts\\com.tabbuddy.bridge';

  it('writes one shared manifest, a .cmd launcher, and a registry key per browser', () => {
    const h = makeHome('win32');
    homes.push(h);
    h.addBrowser('Google/Chrome/User Data', { id: 'chromebuddy' });
    h.addBrowser('BraveSoftware/Brave-Browser/User Data', { id: 'bravebuddy' });
    const report = install(h.env);

    const manifestFile = path.join(h.env.bridgeDir, MANIFEST_FILE);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    expect(manifest.allowed_origins.sort()).toEqual([
      'chrome-extension://bravebuddy/',
      'chrome-extension://chromebuddy/',
    ]);
    expect(manifest.path).toBe(path.join(h.env.bridgeDir, WINDOWS_LAUNCHER_FILE));
    expect(report.launcherPath).toBe(manifest.path);
    expect(fs.readFileSync(report.launcherPath, 'utf8')).toMatch(/^@echo off\r\n"/);
    expect(h.registry.keys.get(chromeKey)).toBe(manifestFile);
    expect(h.registry.keys.get(braveKey)).toBe(manifestFile);
    expect(report.outcomes.find((o) => o.browser === 'Brave')).toMatchObject({ registryKey: braveKey });
  });

  it('leaves the registry alone for a browser without TabBuddy', () => {
    const h = makeHome('win32');
    homes.push(h);
    h.addBrowser('Google/Chrome/User Data'); // installed, no TabBuddy
    h.addBrowser('Microsoft/Edge/User Data', { id: 'edgebuddy' });
    install(h.env);
    expect([...h.registry.keys.keys()]).toEqual([
      'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.tabbuddy.bridge',
    ]);
  });

  it('uninstall removes its keys, its files, and a key that points somewhere else stays', () => {
    const h = makeHome('win32');
    homes.push(h);
    h.addBrowser('Google/Chrome/User Data', { id: 'chromebuddy' });
    h.addBrowser('BraveSoftware/Brave-Browser/User Data', { id: 'bravebuddy' });
    install(h.env);
    h.registry.set(braveKey, 'C:\\somebody-else\\host.json'); // not ours any more

    const removed = uninstall(h.env);
    expect(removed).toContain(`registry: ${chromeKey}`);
    expect(removed).not.toContain(`registry: ${braveKey}`);
    expect(h.registry.keys.has(chromeKey)).toBe(false);
    expect(h.registry.keys.get(braveKey)).toBe('C:\\somebody-else\\host.json');
    expect(fs.existsSync(path.join(h.env.bridgeDir, MANIFEST_FILE))).toBe(false);
    expect(fs.existsSync(path.join(h.env.bridgeDir, WINDOWS_LAUNCHER_FILE))).toBe(false);
  });
});

describe('buildLauncher on Windows', () => {
  it('is a .cmd that runs Node by absolute path and forwards the arguments', () => {
    expect(buildLauncher({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', cliPath: 'C:\\b\\cli.js' }, 'win32')).toBe(
      '@echo off\r\n"C:\\Program Files\\nodejs\\node.exe" "C:\\b\\cli.js" host %*\r\n',
    );
  });

  it('doubles a percent sign, which cmd would otherwise expand', () => {
    expect(buildLauncher({ nodePath: 'C:\\n\\node.exe', cliPath: 'C:\\100%\\cli.js' }, 'win32')).toContain('"C:\\100%%\\cli.js"');
  });
});

describe('systemRegistry', () => {
  const fakeRun = (calls: string[][], output = '') =>
    ((command: string, args: string[]) => {
      calls.push([command, ...args]);
      return Buffer.from(output);
    }) as unknown as typeof execFileSync;

  it('writes the default value of a key with reg add', () => {
    const calls: string[][] = [];
    systemRegistry(fakeRun(calls)).set('HKCU\\Software\\X', 'C:\\m.json');
    expect(calls).toEqual([['reg', 'add', 'HKCU\\Software\\X', '/ve', '/t', 'REG_SZ', '/d', 'C:\\m.json', '/f']]);
  });

  it('reads the value out of reg query output, whatever language "(Default)" is in', () => {
    const output = '\r\nHKEY_CURRENT_USER\\Software\\X\r\n    (Par défaut)    REG_SZ    C:\\Users\\me\\.tabbuddy\\m.json\r\n\r\n';
    expect(systemRegistry(fakeRun([], output)).read('HKCU\\Software\\X')).toBe('C:\\Users\\me\\.tabbuddy\\m.json');
  });

  it('reads null when the key does not exist, and does not throw when deleting one that is gone', () => {
    const failing = (() => {
      throw new Error('ERROR: The system was unable to find the specified registry key or value.');
    }) as unknown as typeof execFileSync;
    expect(systemRegistry(failing).read('HKCU\\Software\\X')).toBeNull();
    expect(() => systemRegistry(failing).remove('HKCU\\Software\\X')).not.toThrow();
  });
});

describe('mcpAddCommand and isTemporaryInstall', () => {
  it('quotes for a POSIX shell, including an apostrophe', () => {
    expect(mcpAddCommand({ nodePath: '/usr/bin/node', cliPath: "/home/o'neil/cli.js" }, 'linux')).toBe(
      "claude mcp add tabbuddy -- '/usr/bin/node' '/home/o'\\''neil/cli.js' serve",
    );
  });

  it('quotes with double quotes on Windows', () => {
    expect(mcpAddCommand({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', cliPath: 'C:\\b\\cli.js' }, 'win32')).toBe(
      'claude mcp add tabbuddy -- "C:\\Program Files\\nodejs\\node.exe" "C:\\b\\cli.js" serve',
    );
  });

  it('spots a bridge that lives in the npx cache', () => {
    expect(isTemporaryInstall('/Users/me/.npm/_npx/abc123/node_modules/tabbuddy-bridge/dist/src/cli.js')).toBe(true);
    expect(isTemporaryInstall('C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\1\\cli.js')).toBe(true);
    expect(isTemporaryInstall('/usr/local/lib/node_modules/tabbuddy-bridge/dist/src/cli.js')).toBe(false);
  });
});
