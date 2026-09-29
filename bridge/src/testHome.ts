import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InstallEnv } from './install.js';

/** A throwaway "home directory" for install and doctor tests. */
export function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tbh-'));
  const support = path.join(home, 'Library', 'Application Support');
  const env: InstallEnv = {
    home,
    bridgeDir: path.join(home, '.tabbuddy'),
    nodePath: process.execPath,
    cliPath: path.join(home, 'cli.js'),
    platform: 'darwin',
  };
  fs.writeFileSync(env.cliPath, '// stand-in for the built CLI\n');

  return {
    home,
    env,
    support,
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
