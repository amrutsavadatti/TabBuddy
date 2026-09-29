import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../protocol.js';
import { parseLauncher, runDoctor, type Check } from './doctor.js';
import { buildLauncher, install, launcherPathFor, MANIFEST_FILE } from './install.js';
import { makeHome } from './testHome.js';

const homes: ReturnType<typeof makeHome>[] = [];
const servers: net.Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  homes.splice(0).forEach((h) => h.cleanup());
});

/** Home with Brave + TabBuddy installed. */
function installed() {
  const h = makeHome();
  homes.push(h);
  h.addBrowser('BraveSoftware/Brave-Browser', { id: 'bravebuddy' });
  install(h.env);
  return h;
}

async function listen(h: ReturnType<typeof makeHome>) {
  const server = net.createServer();
  servers.push(server);
  await new Promise<void>((r) => server.listen(path.join(h.env.bridgeDir, 'bridge.sock'), r));
}

const hello = async () => ({ protocol: PROTOCOL_VERSION, extensionVersion: '1.2.3' });
const firstFailure = (checks: Check[]) => checks.find((c) => !c.ok);

describe('doctor', () => {
  it('passes every check when everything is in place', async () => {
    const h = installed();
    await listen(h);
    const checks = await runDoctor(h.env, { hello });
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.name)).toEqual([
      'Launcher',
      'Host manifest', // Chrome's folder, which Brave reads
      'Extension ID',
      'Host manifest', // Brave's own folder
      'Extension ID',
      'Socket',
      'Extension reply',
    ]);
  });

  it('reports a missing launcher first, and stops there', async () => {
    const h = makeHome();
    homes.push(h);
    const checks = await runDoctor(h.env, { hello });
    expect(checks).toHaveLength(1);
    expect(firstFailure(checks)).toMatchObject({ name: 'Launcher', fix: expect.stringContaining('install') });
  });

  it('reports a Node that has gone missing', async () => {
    const h = installed();
    const launcher = launcherPathFor(h.env.bridgeDir);
    fs.writeFileSync(launcher, fs.readFileSync(launcher, 'utf8').replace(process.execPath, '/gone/node'));
    expect(firstFailure(await runDoctor(h.env, { hello }))?.detail).toContain('/gone/node');
  });

  it('reports a bridge build that was moved', async () => {
    const h = installed();
    fs.rmSync(h.env.cliPath);
    expect(firstFailure(await runDoctor(h.env, { hello }))?.fix).toContain('Rebuild');
  });

  it('reports a missing host manifest', async () => {
    const h = installed();
    fs.rmSync(path.join(h.support, 'BraveSoftware/Brave-Browser/NativeMessagingHosts', MANIFEST_FILE));
    expect(firstFailure(await runDoctor(h.env, { hello }))).toMatchObject({ name: 'Host manifest' });
  });

  it("reports a Brave that has no manifest in Chrome's folder, where it actually looks", async () => {
    const h = installed();
    fs.rmSync(path.join(h.support, 'Google/Chrome/NativeMessagingHosts', MANIFEST_FILE));
    const failure = firstFailure(await runDoctor(h.env, { hello }));
    expect(failure).toMatchObject({ name: 'Host manifest' });
    expect(failure?.detail).toContain('Google/Chrome/NativeMessagingHosts');
  });

  it('reports a manifest that points somewhere else', async () => {
    const h = installed();
    const file = path.join(h.support, 'BraveSoftware/Brave-Browser/NativeMessagingHosts', MANIFEST_FILE);
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, JSON.stringify({ ...manifest, path: '/elsewhere' }));
    expect(firstFailure(await runDoctor(h.env, { hello }))?.detail).toContain('/elsewhere');
  });

  it('reports an extension ID the manifest does not allow', async () => {
    const h = installed();
    // TabBuddy is now loaded under a different id, e.g. after moving the folder
    fs.rmSync(path.join(h.support, 'BraveSoftware/Brave-Browser/Default/Secure Preferences'));
    h.addBrowser('BraveSoftware/Brave-Browser', { id: 'newid' });
    const failure = firstFailure(await runDoctor(h.env, { hello }));
    expect(failure).toMatchObject({ name: 'Extension ID' });
    expect(failure?.detail).toContain('newid');
  });

  it('reports a socket nobody is listening on', async () => {
    const h = installed();
    const failure = firstFailure(await runDoctor(h.env, { hello }));
    expect(failure).toMatchObject({ name: 'Socket' });
    expect(failure?.fix).toContain('Agent bridge');
  });

  it('reports a protocol mismatch', async () => {
    const h = installed();
    await listen(h);
    const failure = firstFailure(
      await runDoctor(h.env, { hello: async () => ({ protocol: 99, extensionVersion: '9' }) }),
    );
    expect(failure).toMatchObject({ name: 'Extension reply' });
    expect(failure?.detail).toContain('99');
  });

  it('reports an extension that never answers', async () => {
    const h = installed();
    await listen(h);
    const failure = firstFailure(
      await runDoctor(h.env, {
        hello: async () => {
          throw new Error('No answer from TabBuddy after 3000 ms.');
        },
      }),
    );
    expect(failure).toMatchObject({ name: 'Extension reply' });
    expect(failure?.detail).toContain('No answer');
  });
});

describe('doctor on Linux', () => {
  it('passes with a live socket', async () => {
    const h = makeHome('linux');
    homes.push(h);
    h.addBrowser('google-chrome', { id: 'chromebuddy' });
    install(h.env);
    await listen(h);
    const checks = await runDoctor(h.env, { hello });
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks.map((c) => c.name)).toEqual([
      'Launcher',
      'Host manifest',
      'Extension ID',
      'Socket',
      'Extension reply',
    ]);
  });

  it('names the browser folder that lacks the manifest', async () => {
    const h = makeHome('linux');
    homes.push(h);
    h.addBrowser('google-chrome', { id: 'chromebuddy' });
    install(h.env);
    fs.rmSync(path.join(h.support, 'google-chrome/NativeMessagingHosts', MANIFEST_FILE));
    expect(firstFailure(await runDoctor(h.env, { hello }))).toMatchObject({
      name: 'Host manifest',
      detail: expect.stringContaining('google-chrome'),
    });
  });
});

describe('doctor on Windows', () => {
  const chromeKey = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.tabbuddy.bridge';

  function windowsInstalled() {
    const h = makeHome('win32');
    homes.push(h);
    h.addBrowser('Google/Chrome/User Data', { id: 'chromebuddy' });
    install(h.env);
    return h;
  }

  it('checks the .cmd launcher, the manifest, the registry key and the ID, then the pipe', async () => {
    const h = windowsInstalled();
    const checks = await runDoctor(h.env, { hello });
    // no pipe can be listening here, so it gets as far as the socket step
    expect(checks.map((c) => [c.name, c.ok])).toEqual([
      ['Launcher', true],
      ['Host manifest', true],
      ['Extension ID', true],
      ['Socket', false],
    ]);
    expect(checks[3]!.detail).toContain('\\\\.\\pipe\\tabbuddy-bridge-');
  });

  it('does not ask for an execute bit on a .cmd file', async () => {
    const h = windowsInstalled();
    fs.chmodSync(launcherPathFor(h.env.bridgeDir, 'win32'), 0o644);
    expect((await runDoctor(h.env, { hello }))[0]).toMatchObject({ name: 'Launcher', ok: true });
  });

  it('fails when the registry key is missing', async () => {
    const h = windowsInstalled();
    h.registry.remove(chromeKey);
    expect(firstFailure(await runDoctor(h.env, { hello }))).toMatchObject({
      name: 'Host manifest',
      detail: expect.stringContaining('no registry key'),
      fix: expect.stringContaining('install'),
    });
  });

  it('fails when the registry key points somewhere else', async () => {
    const h = windowsInstalled();
    h.registry.set(chromeKey, 'C:\\elsewhere\\m.json');
    expect(firstFailure(await runDoctor(h.env, { hello }))).toMatchObject({
      name: 'Host manifest',
      detail: expect.stringContaining('C:\\elsewhere\\m.json'),
    });
  });

  it('reads Node and the bridge back out of a .cmd launcher, percent signs included', () => {
    const h = windowsInstalled();
    const file = path.join(h.home, 'l.cmd');
    fs.writeFileSync(file, buildLauncher({ nodePath: 'C:\\Program Files\\n\\node.exe', cliPath: 'C:\\100%\\cli.js' }, 'win32'));
    expect(parseLauncher(file)).toEqual({ nodePath: 'C:\\Program Files\\n\\node.exe', cliPath: 'C:\\100%\\cli.js' });
  });
});
