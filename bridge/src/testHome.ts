import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InstallEnv, Registry } from './install.js';

/** The Windows registry, in memory. */
export function fakeRegistry(): Registry & { keys: Map<string, string> } {
  const keys = new Map<string, string>();
  return {
    keys,
    set: (key, value) => void keys.set(key, value),
    read: (key) => keys.get(key) ?? null,
    remove: (key) => void keys.delete(key),
  };
}

/** A throwaway "home directory" for install and doctor tests, laid out the way
 * the given platform does it (the code under test is told the platform, so
 * this runs the same on any machine). */
export function makeHome(platform: 'darwin' | 'linux' | 'win32' = 'darwin') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tbh-'));
  const support =
    platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : platform === 'linux'
        ? path.join(home, '.config')
        : path.join(home, 'AppData', 'Local');
  const registry = fakeRegistry();
  const env: InstallEnv = {
    home,
    bridgeDir: path.join(home, '.tabbuddy'),
    nodePath: process.execPath,
    cliPath: path.join(home, 'cli.js'),
    platform,
    ...(platform === 'win32' ? { localAppData: support, registry } : {}),
  };
  fs.writeFileSync(env.cliPath, '// stand-in for the built CLI\n');

  return {
    home,
    env,
    support,
    registry,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
    /** A browser that has run (has a data dir), optionally with TabBuddy
     * loaded unpacked under the given extension id. */
    addBrowser(dataDirName: string, loaded?: { id: string; profile?: string; name?: string; relative?: boolean }) {
      const dataDir = path.join(support, dataDirName);
      fs.mkdirSync(dataDir, { recursive: true });
      if (loaded) {
        const extDir = path.join(home, `ext-${loaded.id}`);
        fs.mkdirSync(extDir, { recursive: true });
        fs.writeFileSync(
          path.join(extDir, 'manifest.json'),
          JSON.stringify({ name: loaded.name ?? 'TabBuddy' }),
        );
        const profileDir = path.join(dataDir, loaded.profile ?? 'Default');
        fs.mkdirSync(profileDir, { recursive: true });
        fs.writeFileSync(
          path.join(profileDir, 'Secure Preferences'),
          JSON.stringify({
            extensions: { settings: { [loaded.id]: { path: loaded.relative ? `ext-${loaded.id}` : extDir } } },
          }),
        );
      }
      return dataDir;
    },
  };
}
