#!/usr/bin/env node
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import type { HelloResult } from '../protocol.js';
import { BridgeCallError, BrowserUnreachableError, callBridge } from './client.js';
import { HostAlreadyRunningError, startHost } from './host.js';
import { runDoctor } from './doctor.js';
import {
  install,
  uninstall,
  UnsupportedPlatformError,
  type BrowserId,
  type InstallEnv,
} from './install.js';
import { fileLogger } from './logger.js';
import { bridgeDir, logPath, socketPath } from './paths.js';
import { runServe } from './serve.js';

const USAGE = `tabbuddy-bridge — connects AI agents to the TabBuddy extension

Usage:
  tabbuddy-bridge serve             MCP server over stdio (your AI client starts this)
  tabbuddy-bridge host              Native messaging host (the browser starts this)
  tabbuddy-bridge ping              Ask the extension for its version
  tabbuddy-bridge call <method> [json]
                                    Send any request and print the result
  tabbuddy-bridge install [--extension-id ID]... [--browser chrome|brave|edge]...
                                    Register the host with your browsers (macOS)
  tabbuddy-bridge uninstall         Remove what install wrote
  tabbuddy-bridge doctor            Check the setup, stopping at the first problem
`;

async function runHost(): Promise<void> {
  const log = fileLogger(logPath());
  try {
    const host = await startHost({
      input: process.stdin,
      output: process.stdout,
      socketPath: socketPath(),
      log,
    });
    await host.closed;
  } catch (error) {
    log(`Host failed: ${(error as Error).message}`);
    if (error instanceof HostAlreadyRunningError) process.exitCode = 1;
    else throw error;
  }
}

async function runCall(method: string, rawParams: string | undefined): Promise<void> {
  const params = rawParams === undefined ? undefined : JSON.parse(rawParams);
  const result = await callBridge(method, params, { socketPath: socketPath() });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function installEnv(): InstallEnv {
  return {
    home: os.homedir(),
    bridgeDir: bridgeDir(),
    nodePath: process.execPath,
    cliPath: fileURLToPath(import.meta.url),
  };
}

function collect(args: string[], flag: string): string[] {
  const values: string[] = [];
  args.forEach((arg, i) => {
    if (arg === flag) {
      const value = args[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value.`);
      values.push(value);
    }
  });
  return values;
}

function runInstall(args: string[]): void {
  const browsers = collect(args, '--browser') as BrowserId[];
  for (const b of browsers) {
    if (!['chrome', 'brave', 'edge'].includes(b)) throw new Error(`Unknown browser: ${b}`);
  }
  const report = install(installEnv(), {
    extensionIds: collect(args, '--extension-id'),
    browsers: browsers.length > 0 ? browsers : undefined,
  });
  const out = (line: string) => process.stdout.write(`${line}\n`);
  out(`Launcher: ${report.launcherPath}`);
  for (const outcome of report.outcomes) {
    if (outcome.status === 'written') {
      out(`✓ ${outcome.browser}: allowed ${outcome.extensionIds.join(', ')}`);
    } else if (outcome.status === 'not-installed') {
      out(`- ${outcome.browser}: not installed, skipped`);
    } else {
      out(
        `- ${outcome.browser}: TabBuddy isn't loaded there, skipped (load it first, or pass --extension-id <id>)`,
      );
    }
  }
  if (!report.outcomes.some((o) => o.status === 'written')) {
    out('\nNothing was registered: TabBuddy is not loaded in any installed browser.');
    process.exitCode = 1;
    return;
  }
  out('\nNext: restart your browser, then switch on Agent bridge in TabBuddy (Settings → Automation).');
  out('Then run `tabbuddy-bridge doctor` to check everything.');
  const env = installEnv();
  const quote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;
  out('\nTo give Claude Code access, run:');
  out(`  claude mcp add tabbuddy -- ${quote(env.nodePath)} ${quote(env.cliPath)} serve`);
}

function runUninstall(): void {
  const removed = uninstall(installEnv());
  if (removed.length === 0) process.stdout.write('Nothing to remove.\n');
  for (const file of removed) process.stdout.write(`Removed ${file}\n`);
}

async function runDoctorCommand(): Promise<void> {
  const env = installEnv();
  const checks = await runDoctor(env, {
    hello: () =>
      callBridge('hello', undefined, { socketPath: socketPath(), timeoutMs: 3_000 }) as Promise<HelloResult>,
  });
  for (const check of checks) {
    process.stdout.write(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}\n`);
    if (!check.ok && check.fix) process.stdout.write(`  Fix: ${check.fix}\n`);
  }
  if (checks.some((c) => !c.ok)) process.exitCode = 1;
  else process.stdout.write('\nAll good.\n');
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'serve':
      return runServe();
    case 'host':
      return runHost();
    case 'ping':
      return runCall('hello', undefined);
    case 'install':
      return runInstall(rest);
    case 'uninstall':
      return runUninstall();
    case 'doctor':
      return runDoctorCommand();
    case 'call':
      if (!rest[0]) throw new Error('Usage: tabbuddy-bridge call <method> [json]');
      return runCall(rest[0], rest[1]);
    default:
      process.stderr.write(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((error) => {
  if (error instanceof UnsupportedPlatformError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof BrowserUnreachableError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof BridgeCallError) {
    process.stderr.write(`${error.error.code}: ${error.message}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
