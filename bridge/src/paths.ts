import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ~/.tabbuddy, or TABBUDDY_HOME (used by tests). Created private (0700). */
export function bridgeDir(): string {
  const dir = process.env.TABBUDDY_HOME ?? path.join(os.homedir(), '.tabbuddy');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

const PIPE_PREFIX = '\\\\.\\pipe\\';

/** True for a Windows named-pipe address, which is not a file: it cannot be
 * stat'ed, chmod'ed or deleted, and vanishes when its server closes. */
export function isPipeAddress(address: string): boolean {
  return address.startsWith(PIPE_PREFIX);
}

/** Where the host listens and the MCP server connects: a Unix socket in the
 * bridge folder, or on Windows a named pipe. The pipe's name carries a hash of
 * the bridge folder, which lives in the user's own profile, so two users on one
 * machine (or a test using TABBUDDY_HOME) never share a pipe. */
export function socketAddress(dir: string, platform: string = process.platform): string {
  if (platform === 'win32') {
    return `${PIPE_PREFIX}tabbuddy-bridge-${createHash('sha1').update(dir).digest('hex').slice(0, 12)}`;
  }
  return path.join(dir, 'bridge.sock');
}

export function socketPath(): string {
  return socketAddress(bridgeDir());
}

export function logPath(): string {
  return path.join(bridgeDir(), 'bridge.log');
}
