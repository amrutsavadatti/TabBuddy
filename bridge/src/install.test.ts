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

  it('refuses other platforms for now', () => {
    expect(() => browserTargets('/home/me', 'linux')).toThrow(UnsupportedPlatformError);
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
