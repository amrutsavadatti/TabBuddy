import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { PROTOCOL_VERSION } from '../bridge/protocol';
import { BridgeFailure, dispatch, summarizeSnapshot } from './agentBridge';
import { addSnapshot } from './storage';
import { makeSnapshot, makeTab } from '@/test/factories';

describe('dispatch', () => {
  it('reports an unknown method', async () => {
    const response = await dispatch({ id: 'a', method: 'nope' });
    expect(response).toEqual({
      id: 'a',
      error: { code: 'unknown_method', message: 'Unknown method: nope' },
    });
  });

  it('does not treat inherited object keys as methods', async () => {
    const response = await dispatch({ id: 'a', method: 'toString' });
    expect(response).toMatchObject({ error: { code: 'unknown_method' } });
  });

  it('returns the handler result under the request id', async () => {
    const response = await dispatch(
      { id: 'r1', method: 'echo', params: 5 },
      { echo: async (params) => params },
    );
    expect(response).toEqual({ id: 'r1', result: 5 });
  });

  it('keeps a BridgeFailure code', async () => {
    const response = await dispatch(
      { id: 'x', method: 'fail' },
      {
        fail: async () => {
          throw new BridgeFailure('not_found', 'No such snapshot.');
        },
      },
    );
    expect(response).toEqual({
      id: 'x',
      error: { code: 'not_found', message: 'No such snapshot.' },
    });
  });

  it('maps any other thrown error to internal', async () => {
    const response = await dispatch(
      { id: 'x', method: 'boom' },
      {
        boom: async () => {
          throw new Error('kaput');
        },
      },
    );
    expect(response).toEqual({ id: 'x', error: { code: 'internal', message: 'kaput' } });
  });
});

describe('hello', () => {
  it('returns the protocol version and extension version', async () => {
    vi.spyOn(fakeBrowser.runtime, 'getManifest').mockReturnValue({
      version: '1.2.3',
    } as ReturnType<typeof fakeBrowser.runtime.getManifest>);
    const response = await dispatch({ id: 'h', method: 'hello' });
    expect(response).toEqual({
      id: 'h',
      result: { protocol: PROTOCOL_VERSION, extensionVersion: '1.2.3' },
    });
  });
});

describe('summarizeSnapshot', () => {
  it('counts tabs, flags open snapshots and drops tab details and favicons', () => {
    const snapshot = makeSnapshot({
      name: 'Job Hunt',
      tabs: [
        makeTab({ favIconUrl: 'data:image/png;base64,AAAA' }),
        makeTab(),
      ],
      linkedWindowId: 7,
      categoryIds: ['c1'],
      usageCount: 3,
      pinned: true,
    });
    const summary = summarizeSnapshot(snapshot);
    expect(summary).toEqual({
      id: snapshot.id,
      name: 'Job Hunt',
      tabCount: 2,
      categoryIds: ['c1'],
      usageCount: 3,
      pinned: true,
      isOpen: true,
      updatedAt: snapshot.updatedAt,
    });
    expect(JSON.stringify(summary)).not.toContain('data:image');
  });

  it('marks a snapshot with no linked window as not open', () => {
    expect(summarizeSnapshot(makeSnapshot({ linkedWindowId: null })).isOpen).toBe(false);
  });
});

describe('listSnapshots', () => {
  it('returns a summary for every stored snapshot', async () => {
    const a = makeSnapshot({ name: 'A' });
    const b = makeSnapshot({ name: 'B', linkedWindowId: 2 });
    await addSnapshot(a);
    await addSnapshot(b);

    const response = await dispatch({ id: 'l', method: 'listSnapshots' });
    expect(response).toMatchObject({ id: 'l' });
    const result = (response as { result: { name: string; isOpen: boolean }[] }).result;
    expect(result.map((s) => [s.name, s.isOpen])).toEqual([
      ['A', false],
      ['B', true],
    ]);
  });

  it('returns an empty list when nothing is saved', async () => {
    expect(await dispatch({ id: 'l', method: 'listSnapshots' })).toEqual({ id: 'l', result: [] });
  });
});
