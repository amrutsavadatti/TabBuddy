import fs from 'node:fs';

export type Logger = (message: string) => void;

/** Appends to a file. stdout belongs to the native messaging protocol, and
 * the browser hides stderr, so a file is the only place logs are visible. */
export function fileLogger(file: string): Logger {
  return (message) => {
    try {
      fs.appendFileSync(file, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
    } catch {
      // logging must never break the bridge
    }
  };
}

export const noopLogger: Logger = () => {};
