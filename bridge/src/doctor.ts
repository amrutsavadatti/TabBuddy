import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { PROTOCOL_VERSION, type HelloResult } from '../protocol.js';
import { BrowserUnreachableError } from './client.js';
import {
  browserTargets,
  detectExtensionIds,
  launcherPathFor,
  MANIFEST_FILE,
  type InstallEnv,
} from './install.js';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** What to do about it; only on failures. */
  fix?: string;
}

export interface DoctorDeps {
  /** Sends `hello` through the socket. */
  hello: () => Promise<HelloResult>;
}

function canConnect(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}

function parseLauncher(file: string): { nodePath: string; cliPath: string } | null {
  const match = /^exec '((?:[^']|'\\'')*)' '((?:[^']|'\\'')*)' host/m.exec(fs.readFileSync(file, 'utf8'));
  if (!match) return null;
  const unquote = (s: string) => s.replaceAll(`'\\''`, "'");
  return { nodePath: unquote(match[1]!), cliPath: unquote(match[2]!) };
}

/** Runs the checks in dependency order and stops at the first failure, since
 * later ones can't pass without it. */
export async function runDoctor(env: InstallEnv, deps: DoctorDeps): Promise<Check[]> {
  const checks: Check[] = [];
  const fail = (check: Check) => {
    checks.push({ ...check, ok: false });
    return checks;
  };
  const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });
  const reinstall = 'Run `tabbuddy-bridge install` again.';

  // 1. Launcher
  const launcherPath = launcherPathFor(env.bridgeDir);
  if (!fs.existsSync(launcherPath)) {
    return fail({
      name: 'Launcher',
      ok: false,
      detail: `${launcherPath} is missing.`,
      fix: 'Run `tabbuddy-bridge install`.',
    });
  }
  const launcher = parseLauncher(launcherPath);
  if (!launcher) {
    return fail({ name: 'Launcher', ok: false, detail: 'The launcher is not in the expected format.', fix: reinstall });
  }
  if (!fs.existsSync(launcher.nodePath)) {
    return fail({
      name: 'Launcher',
      ok: false,
      detail: `Node is missing at ${launcher.nodePath} (was it upgraded or removed?).`,
      fix: reinstall,
    });
  }
  if (!fs.existsSync(launcher.cliPath)) {
    return fail({
      name: 'Launcher',
      ok: false,
      detail: `The bridge is missing at ${launcher.cliPath} (was it moved, or not built?).`,
      fix: 'Rebuild the bridge (`npm run build` in bridge/), then run `tabbuddy-bridge install` again.',
    });
  }
  try {
    fs.accessSync(launcherPath, fs.constants.X_OK);
  } catch {
    return fail({ name: 'Launcher', ok: false, detail: 'The launcher is not executable.', fix: reinstall });
  }
  pass('Launcher', `${launcherPath} runs ${path.basename(launcher.nodePath)} with the bridge`);

  // 2. Host manifests. A browser with TabBuddy loaded needs a manifest in
  // every folder it reads (Brave reads Chrome's); if none has it loaded, at
  // least one manifest must exist somewhere.
  const targets = browserTargets(env.home, env.platform).filter((t) => fs.existsSync(t.dataDir));
  const loadedIds = new Map(targets.map((t) => [t.id, detectExtensionIds(t.dataDir)]));
  const inUse = targets.filter((t) => (loadedIds.get(t.id) ?? []).length > 0);
  const required = inUse.length > 0 ? inUse : targets;
  const files: { target: (typeof targets)[number]; file: string }[] = [];
  for (const target of required) {
    for (const dir of target.manifestDirs) {
      const file = path.join(dir, MANIFEST_FILE);
      if (fs.existsSync(file)) {
        files.push({ target, file });
      } else if (inUse.length > 0) {
        return fail({
          name: 'Host manifest',
          ok: false,
          detail: `${target.name} reads ${dir}, which has no ${MANIFEST_FILE}.`,
          fix: 'Run `tabbuddy-bridge install`.',
        });
      }
    }
  }
  if (files.length === 0) {
    return fail({
      name: 'Host manifest',
      ok: false,
      detail: `No ${MANIFEST_FILE} found for ${targets.map((t) => t.name).join(', ') || 'any browser'}.`,
      fix: 'Run `tabbuddy-bridge install`.',
    });
  }
  const checkedIds = new Set<string>();
  for (const { target, file } of files) {
    let manifest: any;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fail({ name: 'Host manifest', ok: false, detail: `${file} is not valid JSON.`, fix: reinstall });
    }
    if (manifest.path !== launcherPath) {
      return fail({
        name: 'Host manifest',
        ok: false,
        detail: `${target.name}'s manifest points at ${manifest.path}, not ${launcherPath}.`,
        fix: reinstall,
      });
    }
    pass('Host manifest', `${target.name}: ${file}`);

    // 3. Extension ID
    const allowed: string[] = (manifest.allowed_origins ?? []).map((o: string) =>
      o.replace(/^chrome-extension:\/\//, '').replace(/\/$/, ''),
    );
    const loaded = loadedIds.get(target.id) ?? [];
    const missing = loaded.filter((id) => !allowed.includes(id));
    if (missing.length > 0) {
      return fail({
        name: 'Extension ID',
        ok: false,
        detail: `${target.name} has TabBuddy loaded as ${missing.join(', ')}, which ${file} does not allow.`,
        fix: 'Run `tabbuddy-bridge install` again so it picks up the current ID.',
      });
    }
    const key = `${target.id}:${file}`;
    if (!checkedIds.has(key)) {
      checkedIds.add(key);
      pass(
        'Extension ID',
        loaded.length > 0
          ? `${target.name}: ${loaded.join(', ')} is allowed`
          : `${target.name}: allows ${allowed.join(', ')} (no unpacked TabBuddy found to compare)`,
      );
    }
  }

  // 4. Socket
  const socketPath = path.join(env.bridgeDir, 'bridge.sock');
  if (!(await canConnect(socketPath))) {
    return fail({
      name: 'Socket',
      ok: false,
      detail: `Nothing is listening on ${socketPath}.`,
      fix: "Open your browser (restart it if you just installed), then switch on TabBuddy's Agent bridge under Settings → Automation.",
    });
  }
  pass('Socket', `${socketPath} is accepting connections`);

  // 5. Round trip
  try {
    const hello = await deps.hello();
    if (hello.protocol !== PROTOCOL_VERSION) {
      return fail({
        name: 'Extension reply',
        ok: false,
        detail: `The extension speaks protocol ${hello.protocol}; this bridge speaks ${PROTOCOL_VERSION}.`,
        fix: 'Update TabBuddy and the bridge to matching versions.',
      });
    }
    pass('Extension reply', `TabBuddy ${hello.extensionVersion} answered (protocol ${hello.protocol})`);
  } catch (error) {
    return fail({
      name: 'Extension reply',
      ok: false,
      detail:
        error instanceof BrowserUnreachableError
          ? 'The socket vanished before the extension answered.'
          : `No answer from the extension: ${(error as Error).message}`,
      fix: "In the browser, switch TabBuddy's Agent bridge off and on, then try again.",
    });
  }
  return checks;
}
