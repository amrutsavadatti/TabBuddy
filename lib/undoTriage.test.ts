import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ConfirmTriageResult } from '../bridge/protocol';
import { getActivity, listActivity } from './activityLog';
import { dispatch } from './agentBridge';
import { confirmProposal } from './agentProposals';
import { proposeTriagePlan } from './agentTriage';
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
  return vi.spyOn(fakeBrowser.tabs, 'create').mockImplementation((async (props: { url: string }) => {
    if (createFails || failFor.includes(props.url)) throw new Error('cannot open');
    return { id: 99 };
  }) as never);
}

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as BridgeFailure;
  }
  throw new Error('expected a failure');
};
const byName = async (name: string) => (await getSnapshots()).find((s) => s.name === name);

/** A triage plan with a bucket of every kind, confirmed; returns what undo needs. */
async function triaged() {
  await addSnapshot(makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, tabs: [], updatedAt: 1000 }));
  const reading = makeSnapshot({
    name: 'Reading',
    updatedAt: 1000,
    tabs: [makeTab({ url: 'https://site4.test/page', title: 'Already here' })],
  });
  await addSnapshot(reading);
  mockTabs({ 1: web(1), 2: web(2), 3: web(3), 4: web(4), 5: web(5), 6: web(6) });
  const { proposalId } = await proposeTriagePlan({
    close: [1],
    archive: [2],
    fileInto: [{ id: reading.id, tabIds: [3, 4] }],
    newSnapshots: [{ name: 'Research', tabIds: [5, 6] }],
    request: 'clean up my window',
  });
  const result = (await confirmProposal({ proposalId })) as ConfirmTriageResult;
  return { undoId: result.undoId!, reading };
}

describe('undoing a triage plan', () => {
  it('reopens every tab and takes back exactly what the plan saved', async () => {
    const { undoId, reading } = await triaged();
    expect((await byName('Research'))!.tabs).toHaveLength(2);
    expect((await byName(ARCHIVED_SNAPSHOT_NAME))!.tabs).toHaveLength(1);
    const create = mockReopen();

    const result = await undoActivity(undoId);

    expect(result).toEqual({
      action: 'undo',
      undid: 'triage',
      reopen: { restored: 0, reopened: 6, failed: 0 },
      removedFromArchived: 1,
      removedFromSnapshots: 1,
      deletedSnapshots: 1,
      keptSnapshots: 0,
    });
    expect(create).toHaveBeenCalledTimes(6);
    expect((await byName(ARCHIVED_SNAPSHOT_NAME))!.tabs).toEqual([]);
    expect(await byName('Research')).toBeUndefined(); // the snapshot the plan made is gone
    // the page that was already in Reading is still there: only what the plan added was taken back
    expect((await byName('Reading'))!.tabs.map((t) => t.title)).toEqual(['Already here']);
    expect((await byName('Reading'))!.id).toBe(reading.id);
  });

  it('marks the entry undone, logs the undo in the same group, and allows it only once', async () => {
    const { undoId } = await triaged();
    mockReopen();
    await undoActivity(undoId);

    const { entries } = await listActivity();
    expect(entries[0]).toMatchObject({ tool: 'undo', request: 'clean up my window' });
    expect(entries[0]!.summary).toMatch(/^Undid: Triaged 6 tabs/);
    expect(entries.find((e) => e.id === undoId)).toMatchObject({ undone: true, undoable: false });
    expect((await failure(undoActivity(undoId))).message).toContain('already been undone');
  });

  it('keeps a new snapshot that has been changed since, but still takes back the rest', async () => {
    const { undoId } = await triaged();
    const research = (await byName('Research'))!;
    await updateSnapshot(research.id, { tabs: [...research.tabs, makeTab({ title: 'Added by the user' })], updatedAt: 9000 });
    mockReopen();

    const result = await undoActivity(undoId);

    expect(result).toMatchObject({ deletedSnapshots: 0, keptSnapshots: 1, removedFromArchived: 1, removedFromSnapshots: 1 });
    expect((await byName('Research'))!.tabs.map((t) => t.title)).toContain('Added by the user');
  });

  it('keeps a new snapshot when one of its tabs could not be reopened, so nothing is lost', async () => {
    const { undoId } = await triaged();
    mockReopen({ failFor: ['https://site6.test/page'] });

    const result = await undoActivity(undoId);

    expect(result).toMatchObject({ reopen: { reopened: 5, failed: 1 }, deletedSnapshots: 0, keptSnapshots: 1 });
    expect((await byName('Research'))!.tabs).toHaveLength(2); // both saved tabs still there
  });

  it('keeps the archive entry, and the snapshot entry, for a tab that could not be reopened', async () => {
    const { undoId } = await triaged();
    mockReopen({ failFor: ['https://site2.test/page', 'https://site3.test/page'] });

    const result = await undoActivity(undoId);

    expect(result).toMatchObject({ removedFromArchived: 0, removedFromSnapshots: 0, deletedSnapshots: 1 });
    expect((await byName(ARCHIVED_SNAPSHOT_NAME))!.tabs.map((t) => t.url)).toEqual(['https://site2.test/page']);
    expect((await byName('Reading'))!.tabs.map((t) => t.title)).toEqual(['Already here', 'Site 3']);
  });

  it('changes nothing, and can be tried again, when no tab could be reopened', async () => {
    const { undoId } = await triaged();
    mockReopen({ createFails: true });

    const error = await failure(undoActivity(undoId));

    expect(error.code).toBe('internal');
    expect(error.message).toContain('left as it is');
    expect((await byName(ARCHIVED_SNAPSHOT_NAME))!.tabs).toHaveLength(1);
    expect((await byName('Research'))!.tabs).toHaveLength(2);
    expect((await byName('Reading'))!.tabs).toHaveLength(2);
    expect((await getActivity(undoId))!.undone).toBe(false);
  });

  it('copes when the user has already deleted a snapshot or emptied the archive', async () => {
    const { undoId } = await triaged();
    await fakeBrowser.storage.local.set({ snapshots: [] }); // everything is gone
    mockReopen();

    const result = await undoActivity(undoId);

    expect(result).toMatchObject({
      reopen: { reopened: 6 },
      removedFromArchived: 0,
      removedFromSnapshots: 0,
      deletedSnapshots: 0,
      keptSnapshots: 0,
    });
  });

  it('works through the dispatcher', async () => {
    const { undoId } = await triaged();
    mockReopen();
    const response = (await dispatch({ id: 'u', method: 'undo', params: { undoId } })) as any;
    expect(response.result).toMatchObject({ action: 'undo', undid: 'triage', deletedSnapshots: 1 });
  });
});

describe('a close-only or archive-only plan', () => {
  it('has nothing to take back beyond reopening the tabs', async () => {
    mockTabs({ 1: web(1), 2: web(2) });
    const { proposalId } = await proposeTriagePlan({ close: [1, 2] });
    const { undoId } = (await confirmProposal({ proposalId })) as ConfirmTriageResult;
    mockReopen();
    expect(await undoActivity(undoId!)).toMatchObject({
      undid: 'triage',
      reopen: { reopened: 2 },
      removedFromArchived: 0,
      removedFromSnapshots: 0,
      deletedSnapshots: 0,
      keptSnapshots: 0,
    });
  });
});
