import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_PROPOSAL_TABS, type ConfirmCloseResult, type ConfirmRemoveFromSnapshotResult } from '../bridge/protocol';
import { dispatch } from './agentBridge';
import {
  confirmProposal,
  parseProposeRemoveParams,
  proposeCloseTabs,
  proposeRemoveFromSnapshot,
} from './agentProposals';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { setManagedTabs } from './managedTabs';
import { addSnapshot, getSnapshots, updateSnapshot } from './storage';
import { makeSnapshot, makeTab } from '@/test/factories';

type TabSpec = Record<string, unknown>;

function mockTabs(table: Record<number, TabSpec>) {
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((async (id: number) => {
    if (!(id in table)) throw new Error(`No tab with id: ${id}`);
    return { id, windowId: 1, incognito: false, pinned: false, audible: false, ...table[id] };
  }) as never);
  return table;
}
const web = (n: number, extra: TabSpec = {}): TabSpec => ({ url: `https://site${n}.test/page`, title: `Site ${n}`, ...extra });
const closeAll = () => vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as BridgeFailure;
  }
  throw new Error('expected a failure');
};

describe('proposeCloseTabs', () => {
  it('says the tabs would be closed without being saved, and changes nothing', async () => {
    mockTabs({ 1: web(1), 2: web(2) });
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove');

    const result = await proposeCloseTabs({ tabIds: [1, 2] });

    expect(result).toMatchObject({
      action: 'close',
      summary: 'Close 2 tabs WITHOUT saving them anywhere.',
      expiresInSeconds: 300,
      skipped: [],
    });
    expect(result.tabs.map((t) => t.tabId)).toEqual([1, 2]);
    expect(remove).not.toHaveBeenCalled();
    expect(await getSnapshots()).toEqual([]);
  });

  it('uses the singular for one tab', async () => {
    mockTabs({ 1: web(1) });
    expect((await proposeCloseTabs({ tabIds: [1] })).summary).toBe('Close 1 tab WITHOUT saving it anywhere.');
  });

  it('can close blank and other browser pages, which cannot be archived', async () => {
    mockTabs({
      1: { url: 'chrome://newtab/', title: 'New Tab' },
      2: { url: '', title: '' },
      3: { url: 'chrome://settings', title: 'Settings' },
    });
    const result = await proposeCloseTabs({ tabIds: [1, 2, 3] });
    expect(result.tabs.map((t) => t.tabId)).toEqual([1, 2, 3]);
    expect(result.tabs[1]!.title).toBe('Untitled tab');
  });

  it("never proposes closing one of TabBuddy's own pages", async () => {
    mockTabs({ 1: web(1), 2: { url: fakeBrowser.runtime.getURL('/dashboard.html' as never), title: 'TabBuddy' } });
    const result = await proposeCloseTabs({ tabIds: [1, 2] });
    expect(result.tabs.map((t) => t.tabId)).toEqual([1]);
    expect(result.skipped).toEqual([{ tabId: 2, reason: "one of TabBuddy's own pages" }]);
  });

  it('leaves pinned, playing and snapshot-owned tabs alone unless asked', async () => {
    const snapshot = makeSnapshot({ name: 'Job Hunt', linkedWindowId: 1 });
    await addSnapshot(snapshot);
    await setManagedTabs(snapshot.id, [3]);
    mockTabs({ 1: web(1, { pinned: true }), 2: web(2, { audible: true }), 3: web(3), 4: web(4) });

    const result = await proposeCloseTabs({ tabIds: [1, 2, 3, 4] });
    expect(result.tabs.map((t) => t.tabId)).toEqual([4]);
    expect(result.skipped.map((s) => s.tabId)).toEqual([1, 2, 3]);

    const asked = await proposeCloseTabs({ tabIds: [1, 2, 3], includeProtected: true });
    expect(asked.tabs.map((t) => t.tabId)).toEqual([1, 2, 3]);
  });

  it('refuses, naming every reason, when nothing can be closed', async () => {
    mockTabs({ 1: web(1, { pinned: true }) });
    const error = await failure(proposeCloseTabs({ tabIds: [1, 99] }));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('None of those tabs can be closed');
    expect(error.message).toContain('tab 99');
  });

  it('never reveals a private tab', async () => {
    mockTabs({ 1: web(1), 2: web(2, { incognito: true, url: 'https://secret.test/' }) });
    const result = await proposeCloseTabs({ tabIds: [1, 2] });
    expect(JSON.stringify(result)).not.toContain('secret.test');
    expect(result.skipped[0]!.reason).toContain('no open tab');
  });
});

describe('confirming a close proposal', () => {
  async function proposed(table: Record<number, TabSpec>, ids: number[], extra: Record<string, unknown> = {}) {
    mockTabs(table);
    return (await proposeCloseTabs({ tabIds: ids, ...extra })).proposalId;
  }

  it('closes the tabs and saves nothing anywhere', async () => {
    const proposalId = await proposed({ 1: web(1), 2: web(2) }, [1, 2]);
    const remove = closeAll();

    const result = (await confirmProposal({ proposalId })) as ConfirmCloseResult;

    expect(result).toEqual({ action: 'close', closed: 2 });
    expect(remove.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    expect(await getSnapshots()).toEqual([]); // no Archived snapshot was even created
  });

  it('closes a blank tab, whose address is empty', async () => {
    const proposalId = await proposed({ 1: { url: '', title: '' } }, [1]);
    const remove = closeAll();
    expect(await confirmProposal({ proposalId })).toMatchObject({ closed: 1 });
    expect(remove).toHaveBeenCalledWith(1);
  });

  it('can be confirmed once only', async () => {
    const proposalId = await proposed({ 1: web(1) }, [1]);
    const remove = closeAll();
    await confirmProposal({ proposalId });
    expect((await failure(confirmProposal({ proposalId }))).code).toBe('proposal_expired');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('changes nothing if a tab was closed, moved on, or became protected, and says "closed" only', async () => {
    const cases: [string, (t: Record<number, TabSpec>) => void][] = [
      ['was closed', (t) => delete t[1]],
      ['now shows a different page', (t) => (t[1] = web(1, { url: 'https://elsewhere.test/' }))],
      ['is now pinned', (t) => (t[1] = web(1, { pinned: true }))],
      ['is now playing sound', (t) => (t[1] = web(1, { audible: true }))],
    ];
    for (const [phrase, change] of cases) {
      const table: Record<number, TabSpec> = { 1: web(1), 2: web(2) };
      const proposalId = await proposed(table, [1, 2]);
      change(table);
      const remove = closeAll();

      const error = await failure(confirmProposal({ proposalId }));

      expect(error.code).toBe('tabs_changed');
      expect(error.message).toContain(phrase);
      expect(error.message).toContain('Nothing was closed:');
      expect(error.message).not.toContain('archived');
      expect(remove).not.toHaveBeenCalled();
    }
  });

  it('does not re-check protection for a proposal that deliberately included protected tabs', async () => {
    const proposalId = await proposed({ 1: web(1, { pinned: true }) }, [1], { includeProtected: true });
    closeAll();
    await expect(confirmProposal({ proposalId })).resolves.toMatchObject({ closed: 1 });
  });

  it('counts only the tabs that really closed', async () => {
    const proposalId = await proposed({ 1: web(1), 2: web(2) }, [1, 2]);
    vi.spyOn(fakeBrowser.tabs, 'remove').mockImplementation((async (id: number) => {
      if (id === 1) throw new Error('No tab with id: 1');
    }) as never);
    expect(await confirmProposal({ proposalId })).toMatchObject({ closed: 1 });
  });
});

describe('parseProposeRemoveParams', () => {
  it('removes repeated positions', () => {
    expect(parseProposeRemoveParams({ id: 's', indexes: [2, 0, 2] })).toEqual({ id: 's', indexes: [2, 0] });
  });

  it.each([
    [undefined],
    [{}],
    [{ id: '', indexes: [0] }],
    [{ id: 's' }],
    [{ id: 's', indexes: [] }],
    [{ id: 's', indexes: ['0'] }],
    [{ id: 's', indexes: [1.5] }],
    [{ id: 's', indexes: Array.from({ length: MAX_PROPOSAL_TABS + 1 }, (_, i) => i) }],
  ])('rejects %j as invalid_params', (params) => {
    try {
      parseProposeRemoveParams(params);
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
    }
  });
});

/** A snapshot with recognisable tabs and an old updatedAt, so any later write differs. */
function snapshotOf(count: number, extra: Record<string, unknown> = {}) {
  return makeSnapshot({
    name: 'Reading',
    updatedAt: 1000,
    tabs: Array.from({ length: count }, (_, i) => makeTab({ url: `https://saved${i}.test/`, title: `Saved ${i}` })),
    ...extra,
  });
}

describe('proposeRemoveFromSnapshot', () => {
  it('lists the saved tabs that would go, in order, and changes nothing', async () => {
    const snapshot = snapshotOf(5);
    await addSnapshot(snapshot);

    const result = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [3, 1] });

    expect(result).toMatchObject({
      action: 'removeFromSnapshot',
      summary: 'Remove 2 saved tabs from "Reading" for good (it will hold 3 tabs).',
      expiresInSeconds: 300,
      snapshot: { id: snapshot.id, name: 'Reading', tabCount: 5 },
      skipped: [],
      snapshotIsOpen: false,
    });
    expect(result.tabs).toEqual([
      { index: 1, title: 'Saved 1', url: 'https://saved1.test/' },
      { index: 3, title: 'Saved 3', url: 'https://saved3.test/' },
    ]);
    expect((await getSnapshots())[0]).toEqual(snapshot);
  });

  it('skips positions that do not exist, saying so', async () => {
    const snapshot = snapshotOf(3);
    await addSnapshot(snapshot);
    const result = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [0, 7, -1] });
    expect(result.tabs.map((t) => t.index)).toEqual([0]);
    expect(result.skipped).toEqual([
      { index: -1, reason: 'no tab at that position (it holds 3 tabs)' },
      { index: 7, reason: 'no tab at that position (it holds 3 tabs)' },
    ]);
  });

  it('refuses when no position is valid', async () => {
    const snapshot = snapshotOf(2);
    await addSnapshot(snapshot);
    const error = await failure(proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [5, 6] }));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('Nothing to remove from "Reading"');
  });

  it('answers not_found for an unknown snapshot', async () => {
    expect((await failure(proposeRemoveFromSnapshot({ id: 'missing', indexes: [0] }))).code).toBe('not_found');
  });

  it('says so when it would empty the snapshot, and when the snapshot is open', async () => {
    const snapshot = snapshotOf(2, { linkedWindowId: 9 });
    await addSnapshot(snapshot);
    const result = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [0, 1] });
    expect(result.summary).toContain('so it will be empty');
    expect(result.snapshotIsOpen).toBe(true);
  });

  it('works on the Archived snapshot, which is how the archive gets cleared', async () => {
    const archived = snapshotOf(3, { name: ARCHIVED_SNAPSHOT_NAME });
    await addSnapshot(archived);
    const result = await proposeRemoveFromSnapshot({ id: archived.id, indexes: [0] });
    expect(result.snapshot.name).toBe(ARCHIVED_SNAPSHOT_NAME);
  });
});

describe('confirming a removal from a snapshot', () => {
  const removeConfirm = (r: unknown) => r as ConfirmRemoveFromSnapshotResult;

  it('removes exactly those positions, keeps the rest in order, and never touches open tabs', async () => {
    const snapshot = snapshotOf(5);
    await addSnapshot(snapshot);
    const { proposalId } = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [1, 3] });
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove');

    const result = removeConfirm(await confirmProposal({ proposalId }));

    expect(result).toEqual({
      action: 'removeFromSnapshot',
      removed: 2,
      snapshot: { id: snapshot.id, name: 'Reading', tabCount: 3 },
    });
    const [stored] = await getSnapshots();
    expect(stored!.tabs.map((t) => t.title)).toEqual(['Saved 0', 'Saved 2', 'Saved 4']);
    expect(stored!.updatedAt).toBeGreaterThan(1000);
    expect(stored!.name).toBe('Reading');
    expect(remove).not.toHaveBeenCalled();
  });

  it('can be confirmed once only', async () => {
    const snapshot = snapshotOf(3);
    await addSnapshot(snapshot);
    const { proposalId } = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [0] });
    await confirmProposal({ proposalId });
    expect((await failure(confirmProposal({ proposalId }))).code).toBe('proposal_expired');
    expect((await getSnapshots())[0]!.tabs).toHaveLength(2); // not removed twice
  });

  it('refuses if the snapshot changed after the proposal, and removes nothing', async () => {
    const snapshot = snapshotOf(3);
    await addSnapshot(snapshot);
    const { proposalId } = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [0] });
    await updateSnapshot(snapshot.id, { tabs: [makeTab({ title: 'Inserted first' }), ...snapshot.tabs], updatedAt: 5000 });

    const error = await failure(confirmProposal({ proposalId }));

    expect(error.code).toBe('tabs_changed');
    expect(error.message).toContain('positions may have moved');
    expect(error.message).toContain('Nothing was removed');
    expect((await getSnapshots())[0]!.tabs).toHaveLength(4);
  });

  it('refuses if the snapshot was deleted', async () => {
    const snapshot = snapshotOf(2);
    await addSnapshot(snapshot);
    const { proposalId } = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [0] });
    await fakeBrowser.storage.local.set({ snapshots: [] });
    const error = await failure(confirmProposal({ proposalId }));
    expect(error.code).toBe('tabs_changed');
    expect(error.message).toContain('no longer exists');
  });

  it('invalidates a second proposal made against the same snapshot once the first is confirmed', async () => {
    const snapshot = snapshotOf(4);
    await addSnapshot(snapshot);
    const first = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [0] });
    const second = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [1] });

    await confirmProposal({ proposalId: first.proposalId });
    // position 1 now holds a different tab, so the second proposal must not run
    expect((await failure(confirmProposal({ proposalId: second.proposalId }))).code).toBe('tabs_changed');
    expect((await getSnapshots())[0]!.tabs.map((t) => t.title)).toEqual(['Saved 1', 'Saved 2', 'Saved 3']);
  });

  it('can empty a snapshot', async () => {
    const snapshot = snapshotOf(2);
    await addSnapshot(snapshot);
    const { proposalId } = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes: [0, 1] });
    expect(removeConfirm(await confirmProposal({ proposalId })).snapshot.tabCount).toBe(0);
  });
});

describe('through the dispatcher', () => {
  it('closes tabs: propose, then confirm', async () => {
    mockTabs({ 1: web(1) });
    closeAll();
    const proposal = (await dispatch({ id: 'p', method: 'proposeCloseTabs', params: { tabIds: [1] } })) as any;
    expect(proposal.result.action).toBe('close');
    const done = (await dispatch({
      id: 'c',
      method: 'confirmProposal',
      params: { proposalId: proposal.result.proposalId },
    })) as any;
    expect(done.result).toEqual({ action: 'close', closed: 1 });
  });

  it('removes saved tabs: propose, then confirm', async () => {
    const snapshot = snapshotOf(3);
    await addSnapshot(snapshot);
    const proposal = (await dispatch({
      id: 'p',
      method: 'proposeRemoveFromSnapshot',
      params: { id: snapshot.id, indexes: [2] },
    })) as any;
    expect(proposal.result.tabs).toHaveLength(1);
    const done = (await dispatch({
      id: 'c',
      method: 'confirmProposal',
      params: { proposalId: proposal.result.proposalId },
    })) as any;
    expect(done.result).toMatchObject({ action: 'removeFromSnapshot', removed: 1 });
  });

  it('maps bad requests to error codes', async () => {
    expect(await dispatch({ id: 'x', method: 'proposeRemoveFromSnapshot', params: { id: 'nope', indexes: [0] } })).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(await dispatch({ id: 'x', method: 'proposeCloseTabs', params: { tabIds: [] } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });
});
