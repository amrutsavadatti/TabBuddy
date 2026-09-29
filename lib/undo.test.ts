import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { listActivity, getActivity, recordActivity } from './activityLog';
import { dispatch } from './agentBridge';
import {
  confirmProposal,
  proposeArchiveTabs,
  proposeCloseTabs,
  proposeRemoveFromSnapshot,
} from './agentProposals';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { addSnapshot, getSnapshots, updateSnapshot } from './storage';
import { undoActivity } from './undo';
import { makeSnapshot, makeTab } from '@/test/factories';

type TabSpec = Record<string, unknown>;

function mockTabs(table: Record<number, TabSpec>) {
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((async (id: number) => {
    if (!(id in table)) throw new Error(`No tab with id: ${id}`);
    return { id, windowId: 1, incognito: false, pinned: false, audible: false, ...table[id] };
  }) as never);
  vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
}
const web = (n: number, extra: TabSpec = {}): TabSpec => ({ url: `https://site${n}.test/page`, title: `Site ${n}`, ...extra });

/** The browser side of bringing tabs back: nothing remembered, so tabs open fresh. */
function mockReopen({ createFails = false, failFor = [] as string[] } = {}) {
  vi.spyOn(fakeBrowser.sessions, 'getRecentlyClosed').mockResolvedValue([] as never);
  vi.spyOn(fakeBrowser.windows, 'get').mockImplementation((async (id: number) => ({ id, incognito: false })) as never);
  const create = vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async (props: { url: string }) => {
    if (createFails || failFor.includes(props.url)) throw new Error('cannot open');
    return { id: 99 };
  }) as never);
  return create;
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as BridgeFailure;
  }
  throw new Error('expected a failure');
};

const archived = async () => (await getSnapshots()).find((s) => s.name === ARCHIVED_SNAPSHOT_NAME);
const snapshotOf = (count: number, extra: Record<string, unknown> = {}) =>
  makeSnapshot({
    name: 'Reading',
    updatedAt: 1000,
    tabs: Array.from({ length: count }, (_, i) => makeTab({ url: `https://saved${i}.test/`, title: `Saved ${i}` })),
    ...extra,
  });

describe('undoing a removal from a snapshot', () => {
  async function removed(snapshot = snapshotOf(5), indexes = [1, 3]) {
    await addSnapshot(snapshot);
    const { proposalId } = await proposeRemoveFromSnapshot({ id: snapshot.id, indexes });
    const result = await confirmProposal({ proposalId });
    return { snapshot, undoId: result.undoId! };
  }

  it('puts the tabs back in their original positions', async () => {
    const { snapshot, undoId } = await removed();
    expect((await getSnapshots())[0]!.tabs).toHaveLength(3);

    const result = await undoActivity(undoId);

    expect(result).toEqual({
      action: 'undo',
      undid: 'removeFromSnapshot',
      restoredTabs: 2,
      snapshot: { id: snapshot.id, name: 'Reading', tabCount: 5 },
      snapshotChangedSince: false,
    });
    expect((await getSnapshots())[0]!.tabs.map((t) => t.title)).toEqual(snapshot.tabs.map((t) => t.title));
  });

  it('restores every detail of a tab, not only its address', async () => {
    const tabs = [
      makeTab({ title: 'Plain' }),
      makeTab({ title: 'Special', pinned: true, groupIndex: 0, favIconUrl: 'data:image/png;base64,AAAA' }),
    ];
    const snapshot = snapshotOf(0, { tabs, tabGroups: [{ title: 'Work', color: 'blue' }] });
    const { undoId } = await removed(snapshot, [1]);
    await undoActivity(undoId);
    expect((await getSnapshots())[0]!.tabs[1]).toEqual(tabs[1]);
  });

  it('says so when the snapshot changed after the removal, and still puts the tabs back', async () => {
    const { snapshot, undoId } = await removed();
    const current = (await getSnapshots())[0]!;
    await updateSnapshot(snapshot.id, { tabs: [makeTab({ title: 'Added later' }), ...current.tabs], updatedAt: 9000 });

    const result = await undoActivity(undoId);

    expect(result).toMatchObject({ restoredTabs: 2, snapshotChangedSince: true });
    const titles = (await getSnapshots())[0]!.tabs.map((t) => t.title);
    expect(titles).toHaveLength(6);
    expect(titles).toEqual(expect.arrayContaining(['Saved 1', 'Saved 3', 'Added later']));
  });

  it('puts a tab at the end if its position is now beyond the end', async () => {
    const { snapshot, undoId } = await removed(snapshotOf(5), [4]);
    await updateSnapshot(snapshot.id, { tabs: snapshot.tabs.slice(0, 2), updatedAt: 9000 });
    await undoActivity(undoId);
    expect((await getSnapshots())[0]!.tabs.map((t) => t.title)).toEqual(['Saved 0', 'Saved 1', 'Saved 4']);
  });

  it('cannot be done if the snapshot is gone, and can be tried again', async () => {
    const { undoId } = await removed();
    await fakeBrowser.storage.local.set({ snapshots: [] });
    const error = await failure(undoActivity(undoId));
    expect(error.code).toBe('not_found');
    expect(error.message).toContain('no longer exists');
    expect((await getActivity(undoId))!.undone).toBe(false);
  });
});

describe('undoing a close', () => {
  it('opens the closed tabs again, in their window, and reports how', async () => {
    mockTabs({ 1: web(1, { windowId: 3 }), 2: web(2, { windowId: 3 }) });
    const { proposalId } = await proposeCloseTabs({ tabIds: [1, 2] });
    const { undoId } = await confirmProposal({ proposalId });
    const create = mockReopen();

    const result = await undoActivity(undoId!);

    expect(result).toEqual({ action: 'undo', undid: 'close', reopen: { restored: 0, reopened: 2, failed: 0 } });
    expect(create.mock.calls.map(([p]) => [p.url, p.windowId])).toEqual([
      ['https://site1.test/page', 3],
      ['https://site2.test/page', 3],
    ]);
  });

  it('marks the entry undone, and logs the undo itself', async () => {
    mockTabs({ 1: web(1) });
    const { proposalId } = await proposeCloseTabs({ tabIds: [1] });
    const { undoId } = await confirmProposal({ proposalId });
    mockReopen();
    await undoActivity(undoId!);

    const { entries } = await listActivity();
    expect(entries[0]).toMatchObject({ tool: 'undo', summary: 'Undid: Closed 1 tab', undoable: false });
    expect(entries.find((e) => e.id === undoId)).toMatchObject({ undone: true, undoable: false });
  });

  it('leaves the entry alone, so it can be tried again, when no tab could be reopened', async () => {
    mockTabs({ 1: web(1) });
    const { proposalId } = await proposeCloseTabs({ tabIds: [1] });
    const { undoId } = await confirmProposal({ proposalId });
    mockReopen({ createFails: true });

    const error = await failure(undoActivity(undoId!));

    expect(error.code).toBe('internal');
    expect((await getActivity(undoId!))!.undone).toBe(false);
  });

  it('can only be done once', async () => {
    mockTabs({ 1: web(1) });
    const { proposalId } = await proposeCloseTabs({ tabIds: [1] });
    const { undoId } = await confirmProposal({ proposalId });
    const create = mockReopen();
    await undoActivity(undoId!);
    const error = await failure(undoActivity(undoId!));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('already been undone');
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('undoing an archive', () => {
  async function archivedTabs(table: Record<number, TabSpec>, ids: number[]) {
    mockTabs(table);
    const { proposalId } = await proposeArchiveTabs({ tabIds: ids });
    return (await confirmProposal({ proposalId })).undoId!;
  }

  it('reopens the tabs and takes them out of the Archived snapshot, leaving its other tabs', async () => {
    await addSnapshot(
      makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, tabs: [makeTab({ url: 'https://older.test/', title: 'Older' })] }),
    );
    const undoId = await archivedTabs({ 1: web(1), 2: web(2) }, [1, 2]);
    expect((await archived())!.tabs).toHaveLength(3);
    const create = mockReopen();

    const result = await undoActivity(undoId);

    expect(result).toEqual({
      action: 'undo',
      undid: 'archive',
      reopen: { restored: 0, reopened: 2, failed: 0 },
      removedFromArchived: 2,
    });
    expect((await archived())!.tabs.map((t) => t.url)).toEqual(['https://older.test/']);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('takes out the newest matching entry when the same page was archived before', async () => {
    await addSnapshot(
      makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, tabs: [makeTab({ url: 'https://site1.test/page', title: 'Earlier copy' })] }),
    );
    const undoId = await archivedTabs({ 1: web(1) }, [1]);
    mockReopen();
    await undoActivity(undoId);
    expect((await archived())!.tabs.map((t) => t.title)).toEqual(['Earlier copy']);
  });

  it('keeps in the archive any tab that could not be reopened', async () => {
    const undoId = await archivedTabs({ 1: web(1), 2: web(2) }, [1, 2]);
    mockReopen({ failFor: ['https://site2.test/page'] });

    const result = await undoActivity(undoId);

    expect(result).toMatchObject({ reopen: { reopened: 1, failed: 1 }, removedFromArchived: 1 });
    expect((await archived())!.tabs.map((t) => t.url)).toEqual(['https://site2.test/page']);
  });

  it('touches nothing, and can be tried again, when no tab could be reopened', async () => {
    const undoId = await archivedTabs({ 1: web(1) }, [1]);
    mockReopen({ createFails: true });

    const error = await failure(undoActivity(undoId));

    expect(error.code).toBe('internal');
    expect((await archived())!.tabs).toHaveLength(1);
    expect((await getActivity(undoId))!.undone).toBe(false);
  });

  it('still reopens the tabs if the Archived snapshot has since been deleted', async () => {
    const undoId = await archivedTabs({ 1: web(1) }, [1]);
    await fakeBrowser.storage.local.set({ snapshots: [] });
    mockReopen();
    expect(await undoActivity(undoId)).toMatchObject({ removedFromArchived: 0, reopen: { reopened: 1 } });
  });
});

describe('undoActivity, in general', () => {
  it('answers not_found for an unknown id', async () => {
    expect((await failure(undoActivity('nope'))).code).toBe('not_found');
  });

  it.each([[undefined], [''], [5], [null]])('rejects %j as invalid_params', async (id) => {
    expect((await failure(undoActivity(id))).code).toBe('invalid_params');
  });

  it('explains that an entry with nothing to undo cannot be undone', async () => {
    const id = await recordActivity({ tool: 'rename_snapshot', summary: 'Renamed "A" to "B"' });
    const error = await failure(undoActivity(id));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('cannot be undone');
    expect(error.message).toContain('Renamed "A" to "B"');
  });
});

describe('through the dispatcher', () => {
  it('closes tabs, sees the entry in the activity log, and undoes it', async () => {
    mockTabs({ 1: web(1) });
    const proposal = (await dispatch({ id: 'p', method: 'proposeCloseTabs', params: { tabIds: [1] } })) as any;
    const done = (await dispatch({
      id: 'c',
      method: 'confirmProposal',
      params: { proposalId: proposal.result.proposalId },
    })) as any;
    const undoId = done.result.undoId;
    expect(undoId).toEqual(expect.any(String));

    const log = (await dispatch({ id: 'l', method: 'getAgentActivity' })) as any;
    expect(log.result.entries[0]).toMatchObject({ id: undoId, tool: 'confirm_proposal', summary: 'Closed 1 tab', undoable: true });

    mockReopen();
    const undone = (await dispatch({ id: 'u', method: 'undo', params: { undoId } })) as any;
    expect(undone.result).toMatchObject({ action: 'undo', undid: 'close' });
  });

  it('maps undo failures to error codes', async () => {
    expect(await dispatch({ id: 'u', method: 'undo', params: { undoId: 'nope' } })).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(await dispatch({ id: 'u', method: 'undo', params: {} })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });
});
