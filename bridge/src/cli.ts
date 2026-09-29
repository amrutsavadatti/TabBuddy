#!/usr/bin/env node
import { BridgeCallError, BrowserUnreachableError, callBridge } from './client.js';
import { HostAlreadyRunningError, startHost } from './host.js';
import { fileLogger } from './logger.js';
import { logPath, socketPath } from './paths.js';

const USAGE = `tabbuddy-bridge — connects AI agents to the TabBuddy extension

Usage:
  tabbuddy-bridge host              Native messaging host (the browser starts this)
  tabbuddy-bridge ping              Ask the extension for its version
  tabbuddy-bridge call <method> [json]
                                    Send any request and print the result
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

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  switch (command) {
    case 'host':
      return runHost();
    case 'ping':
      return runCall('hello', undefined);
    case 'call':
      if (!rest[0]) throw new Error('Usage: tabbuddy-bridge call <method> [json]');
      return runCall(rest[0], rest[1]);
    default:
      process.stderr.write(USAGE);
      process.exitCode = command ? 1 : 0;
  }
}

main(process.argv.slice(2)).catch((error) => {
  if (error instanceof BrowserUnreachableError) {
    process.stderr.write(`${error.message}\n`);
  } else if (error instanceof BridgeCallError) {
    process.stderr.write(`${error.error.code}: ${error.message}\n`);
  } else {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  }
  process.exitCode = 1;
});
