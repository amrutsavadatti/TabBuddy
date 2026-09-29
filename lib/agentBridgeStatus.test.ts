import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  classifyDisconnect,
  describeStatus,
  onBridgeStatusChanged,
  readBridgeStatus,
  requestRecheck,
  RECHECK_KEY,
  writeBridgeStatus,
} from './agentBridgeStatus';

beforeEach(() => fakeBrowser.reset());

describe('classifyDisconnect', () => {
  it.each([
    'Specified native messaging host not found.',
    'No such native application com.tabbuddy.bridge',
  ])('reads "%s" as not installed', (message) => {
    expect(classifyDisconnect(message).state).toBe('not_installed');
  });

  it('reads a forbidden host as an error that says to reinstall', () => {
    const result = classifyDisconnect('Access to the specified native messaging host is forbidden.');
    expect(result.state).toBe('error');
    expect(result.detail).toContain('install command again');
  });

  it('reads an exited host as an error that points at doctor', () => {
    const result = classifyDisconnect('Native host has exited.');
    expect(result.state).toBe('error');
    expect(result.detail).toContain('doctor');
  });

  it('keeps the browser\'s words for anything else, and copes with no message at all', () => {
    expect(classifyDisconnect('Something odd')).toMatchObject({ state: 'error', detail: expect.stringContaining('Something odd') });
    expect(classifyDisconnect(undefined)).toMatchObject({ state: 'error' });
  });
});

describe('describeStatus', () => {
  const status = (state: any, detail?: string) => ({ state, since: 1, ...(detail ? { detail } : {}) });

  it('is Off when the bridge is off, whatever the last status said', () => {
    expect(describeStatus(false, status('connected'))).toMatchObject({ state: 'off', label: 'Off', tone: 'off' });
    expect(describeStatus(false, null).state).toBe('off');
  });

  it('is Connecting when it is on but nothing has been reported yet, or the last report was "off"', () => {
    expect(describeStatus(true, null)).toMatchObject({ state: 'connecting', label: 'Connecting…' });
    expect(describeStatus(true, status('off')).state).toBe('connecting');
  });

  it.each([
    ['connected', 'Connected', 'good'],
    ['not_installed', 'Bridge not installed', 'warn'],
    ['error', 'Error', 'bad'],
    ['connecting', 'Connecting…', 'pending'],
  ] as const)('maps %s to "%s"', (state, label, tone) => {
    expect(describeStatus(true, status(state))).toMatchObject({ state, label, tone });
  });

  it('carries the detail through for problems', () => {
    expect(describeStatus(true, status('not_installed', 'nope')).detail).toBe('nope');
    expect(describeStatus(true, status('error', 'broken')).detail).toBe('broken');
  });
});

describe('status in storage', () => {
  it('writes to session storage, not persistent storage, and reads it back', async () => {
    expect(await readBridgeStatus()).toBeNull();
    await writeBridgeStatus('error', 'boom');
    expect(await readBridgeStatus()).toMatchObject({ state: 'error', detail: 'boom' });
    expect(Object.keys(await fakeBrowser.storage.local.get(null))).toEqual([]);
  });

  it('tells a listener about each change, and stops after unsubscribe', async () => {
    const seen: (string | undefined)[] = [];
    const off = onBridgeStatusChanged((s) => seen.push(s?.state));
    await writeBridgeStatus('connecting');
    await writeBridgeStatus('connected');
    await vi.waitFor(() => expect(seen).toEqual(['connecting', 'connected']));
    off();
    await writeBridgeStatus('off');
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toHaveLength(2);
  });

  it('asks for a recheck by touching a session key the background watches', async () => {
    await requestRecheck();
    const stored = await fakeBrowser.storage.session.get(RECHECK_KEY);
    expect(typeof stored[RECHECK_KEY]).toBe('number');
  });
});
