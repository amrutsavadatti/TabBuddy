import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** ~/.tabbuddy, or TABBUDDY_HOME (used by tests). Created private (0700). */
export function bridgeDir(): string {
  const dir = process.env.TABBUDDY_HOME ?? path.join(os.homedir(), '.tabbuddy');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function socketPath(): string {
  return path.join(bridgeDir(), 'bridge.sock');
}

export function logPath(): string {
  return path.join(bridgeDir(), 'bridge.log');
}
