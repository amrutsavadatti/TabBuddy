import { describe, expect, it } from 'vitest';
import { isPipeAddress, socketAddress } from './paths.js';

describe('socketAddress', () => {
  it('is a socket file in the bridge folder on macOS and Linux', () => {
    expect(socketAddress('/home/me/.tabbuddy', 'linux')).toBe('/home/me/.tabbuddy/bridge.sock');
    expect(socketAddress('/Users/me/.tabbuddy', 'darwin')).toBe('/Users/me/.tabbuddy/bridge.sock');
  });

  it('is a named pipe on Windows, named after the bridge folder so users never share one', () => {
    const mine = socketAddress('C:\\Users\\me\\.tabbuddy', 'win32');
    const theirs = socketAddress('C:\\Users\\you\\.tabbuddy', 'win32');
    expect(mine).toMatch(/^\\\\\.\\pipe\\tabbuddy-bridge-[0-9a-f]{12}$/);
    expect(mine).not.toBe(theirs);
    expect(socketAddress('C:\\Users\\me\\.tabbuddy', 'win32')).toBe(mine); // stable
  });
});

describe('isPipeAddress', () => {
  it('tells a pipe from a file path', () => {
    expect(isPipeAddress('\\\\.\\pipe\\tabbuddy-bridge-abc')).toBe(true);
    expect(isPipeAddress('/home/me/.tabbuddy/bridge.sock')).toBe(false);
    expect(isPipeAddress('C:\\Users\\me\\bridge.sock')).toBe(false);
  });
});
