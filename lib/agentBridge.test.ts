import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_SNAPSHOT_TABS_PER_CALL, MAX_TITLE_LENGTH, PROTOCOL_VERSION } from '../bridge/protocol';
import {
  BridgeFailure,
  describeSnapshot,
  dispatch,
  parseGetSnapshotParams,
  summarizeSnapshot,
} from './agentBridge';
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

describe('describeSnapshot', () => {
  it('addresses tabs by index and resolves group names, without favicons', () => {
    const snapshot = makeSnapshot({
      tabs: [
        makeTab({ url: 'https://a.test/', title: 'A', favIconUrl: 'data:image/png;base64,AAAA', groupIndex: 1 }),
        makeTab({ url: 'https://b.test/', title: 'B', pinned: true, groupIndex: null }),
        makeTab({ url: 'https://c.test/', title: 'C', groupIndex: 7 }), // dangling group
      ],
      tabGroups: [
        { title: 'Unused', color: 'red' },
        { title: 'Research', color: 'blue' },
      ],
    });
    const detail = describeSnapshot(snapshot, { offset: 0, limit: 50 });
    expect(detail.tabs).toEqual([
      { index: 0, url: 'https://a.test/', title: 'A', pinned: false, group: 'Research' },
      { index: 1, url: 'https://b.test/', title: 'B', pinned: true, group: null },
      { index: 2, url: 'https://c.test/', title: 'C', pinned: false, group: null },
    ]);
    expect(detail.truncated).toBe(false);
    expect(detail.tabCount).toBe(3);
    expect(JSON.stringify(detail)).not.toContain('data:image');
  });

  it('pages through the tabs and keeps original indexes', () => {
    const snapshot = makeSnapshot({ tabs: Array.from({ length: 5 }, () => makeTab()) });
    const first = describeSnapshot(snapshot, { offset: 0, limit: 2 });
    expect(first.tabs.map((t) => t.index)).toEqual([0, 1]);
    expect(first.truncated).toBe(true);
    const last = describeSnapshot(snapshot, { offset: 4, limit: 2 });
    expect(last.tabs.map((t) => t.index)).toEqual([4]);
    expect(last.truncated).toBe(false);
    expect(describeSnapshot(snapshot, { offset: 9, limit: 2 }).tabs).toEqual([]);
  });

  it('cuts very long titles', () => {
    const snapshot = makeSnapshot({ tabs: [makeTab({ title: 'x'.repeat(500) })] });
    const title = describeSnapshot(snapshot, { offset: 0, limit: 10 }).tabs[0]!.title;
    expect(title).toHaveLength(MAX_TITLE_LENGTH);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('parseGetSnapshotParams', () => {
  it('fills in defaults and caps the limit', () => {
    expect(parseGetSnapshotParams({ id: 'a' })).toEqual({ id: 'a', offset: 0, limit: MAX_SNAPSHOT_TABS_PER_CALL });
    expect(parseGetSnapshotParams({ id: 'a', limit: 99999 }).limit).toBe(MAX_SNAPSHOT_TABS_PER_CALL);
  });

  it.each([
    [undefined],
    [{}],
    [{ id: '' }],
    [{ id: 5 }],
    [{ id: 'a', offset: -1 }],
    [{ id: 'a', offset: 1.5 }],
    [{ id: 'a', limit: 0 }],
    [{ id: 'a', limit: '3' }],
  ])('rejects %j as invalid_params', (params) => {
    expect(() => parseGetSnapshotParams(params)).toThrow(BridgeFailure);
    try {
      parseGetSnapshotParams(params);
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
    }
  });
});

describe('getSnapshot', () => {
  it('returns the snapshot detail for a known id', async () => {
    const snapshot = makeSnapshot({ name: 'Research', tabs: [makeTab({ title: 'Docs' })] });
    await addSnapshot(snapshot);
    const response = await dispatch({ id: 'g', method: 'getSnapshot', params: { id: snapshot.id } });
    expect(response).toMatchObject({
      id: 'g',
      result: { name: 'Research', tabCount: 1, tabs: [{ index: 0, title: 'Docs' }], truncated: false },
    });
  });

  it('answers not_found for an unknown id', async () => {
    const response = await dispatch({ id: 'g', method: 'getSnapshot', params: { id: 'missing' } });
    expect(response).toMatchObject({ id: 'g', error: { code: 'not_found' } });
  });

  it('answers invalid_params without an id', async () => {
    const response = await dispatch({ id: 'g', method: 'getSnapshot' });
    expect(response).toMatchObject({ id: 'g', error: { code: 'invalid_params' } });
  });
});
