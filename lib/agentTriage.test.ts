import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_TRIAGE_TABS, type ConfirmTriageResult } from '../bridge/protocol';
import { getActivity, listActivity } from './activityLog';
import { dispatch } from './agentBridge';
import { confirmProposal } from './agentProposals';
import { parseTriageParams, proposeTriagePlan } from './agentTriage';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { getCategories } from './categories';
import { setManagedTabs } from './managedTabs';
import { addSnapshot, getSnapshots } from './storage';
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
const confirm = async (proposalId: string) => (await confirmProposal({ proposalId })) as ConfirmTriageResult;
const byName = async (name: string) => (await getSnapshots()).find((s) => s.name === name);
const withArchive = () => addSnapshot(makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, tabs: [], updatedAt: 1000 }));

describe('parseTriageParams', () => {
  it('normalises the buckets, removing repeats and empty entries', () => {
    const parsed = parseTriageParams({
      close: [1, 1, 2],
      archive: [3],
      fileInto: [{ id: 's1', tabIds: [4] }, { id: 's1', tabIds: [4, 5] }, { id: 's2', tabIds: [] }],
      newSnapshots: [{ name: '  Research ', tabIds: [6], categoryNames: ['Learning', 'learning'] }, { name: 'Empty', tabIds: [] }],
      windowId: 9,
    });
    expect(parsed).toEqual({
      close: [1, 2],
      archive: [3],
      fileInto: [{ id: 's1', tabIds: [4, 5] }], // merged, and the empty one dropped
      newSnapshots: [{ name: 'Research', tabIds: [6], categoryNames: ['Learning'] }],
      windowId: 9,
      includeProtected: false,
    });
  });

  it('refuses a plan with nothing in it', () => {
    for (const params of [undefined, {}, { close: [] }, { fileInto: [{ id: 's', tabIds: [] }] }]) {
      expect(() => parseTriageParams(params)).toThrow(/plan is empty/);
    }
  });

  it('refuses a tab that is in two buckets, naming both', () => {
    try {
      parseTriageParams({ close: [1, 2], archive: [2], newSnapshots: [{ name: 'Reading', tabIds: [1] }] });
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
      const message = (error as Error).message;
      expect(message).toContain('tab 2 is in both close and archive');
      expect(message).toContain('tab 1 is in both close and the new snapshot "Reading"');
    }
  });

  it('caps the plan at 300 tabs', () => {
    const ids = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(parseTriageParams({ close: ids(MAX_TRIAGE_TABS) }).close).toHaveLength(MAX_TRIAGE_TABS);
    expect(() => parseTriageParams({ close: ids(MAX_TRIAGE_TABS), archive: [MAX_TRIAGE_TABS] })).toThrow(/at most 300/);
  });

  it.each([
    [{ close: 'x' }],
    [{ close: ['1'] }],
    [{ close: [1.5] }],
    [{ fileInto: 'x' }],
    [{ fileInto: [{ tabIds: [1] }] }],
    [{ fileInto: [{ id: '', tabIds: [1] }] }],
    [{ newSnapshots: 'x' }],
    [{ newSnapshots: [{ name: '', tabIds: [1] }] }],
    [{ newSnapshots: [{ name: 'Archived', tabIds: [1] }] }],
    [{ newSnapshots: [{ name: 'X', tabIds: [1], categoryNames: 'a' }] }],
    [{ close: [1], windowId: '3' }],
    [{ close: [1], includeProtected: 'yes' }],
  ])('rejects %j', (params) => {
    expect(() => parseTriageParams(params)).toThrow(BridgeFailure);
  });
});

describe('proposeTriagePlan', () => {
  it('lays the plan out bucket by bucket, and changes nothing', async () => {
    mockTabs({ 1: web(1), 2: web(2), 3: web(3), 4: web(4), 5: web(5) });
    const target = makeSnapshot({ name: 'Reading' });
    await addSnapshot(target);
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove');
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, url: `https://x${id}.test/`, incognito: false })) as never);

    const result = await proposeTriagePlan({
      close: [1],
      archive: [2],
      fileInto: [{ id: target.id, tabIds: [3, 4] }],
      newSnapshots: [{ name: 'Research', tabIds: [5], categoryNames: ['Learning'] }],
      windowId: 1,
    });

    expect(result.action).toBe('triage');
    expect(result.steps.map((s) => s.action)).toEqual(['close', 'archive', 'fileInto', 'newSnapshot']);
    expect(result.totals).toEqual({ close: 1, archive: 1, fileInto: 2, newSnapshot: 1 });
    expect(result.steps[2]).toMatchObject({ snapshot: { id: target.id, name: 'Reading' } });
    expect(result.steps[3]).toMatchObject({ name: 'Research', categoryNames: ['Learning'] });
    expect(result.leftOpen).toBe(2); // 7 tabs in the window, 5 planned
    expect(result.expiresInSeconds).toBe(300);
    expect(result.summary).toBe(
      'Close 1 tab without saving, archive 1 tab, add 2 tabs to "Reading", save 1 tab as the new snapshot "Research". ' +
        'Everything is saved first, then all 5 tabs are closed; 2 tabs stay open.',
    );
    expect(remove).not.toHaveBeenCalled();
    expect((await getSnapshots()).map((s) => s.name)).toEqual(['Reading']); // nothing created
    expect(await getCategories()).toEqual([]); // and no category yet
  });

  it('does not say how many stay open when no window was named', async () => {
    mockTabs({ 1: web(1) });
    const result = await proposeTriagePlan({ close: [1] });
    expect(result.leftOpen).toBeNull();
    expect(result.summary).toBe('Close 1 tab without saving. Everything is saved first, then all 1 tab is closed.');
  });

  it('does not count TabBuddy pages or private tabs among the tabs left open', async () => {
    mockTabs({ 1: web(1) });
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://a.test/' },
      { id: 2, url: 'https://b.test/' },
      { id: 3, url: fakeBrowser.runtime.getURL('/dashboard.html' as never) },
      { id: 4, url: 'https://secret.test/', incognito: true },
    ] as never);
    expect((await proposeTriagePlan({ close: [1], windowId: 1 })).leftOpen).toBe(1);
  });

  it('leaves a tab out, saying why, and drops a bucket that ends up empty', async () => {
    mockTabs({
      1: web(1),
      2: web(2, { incognito: true, url: 'https://secret.test/' }),
      3: web(3, { pinned: true }),
      4: { url: 'chrome://settings', title: 'Settings' },
      5: { url: fakeBrowser.runtime.getURL('/dashboard.html' as never), title: 'TabBuddy' },
      6: { url: 'chrome://extensions', title: 'Extensions' },
    });
    const result = await proposeTriagePlan({
      close: [1, 2, 3, 4, 5, 99],
      archive: [6], // a browser page can be closed but not archived...
    });
    expect(result.steps).toHaveLength(1); // ...so the archive bucket disappears
    expect(result.steps[0]).toMatchObject({ action: 'close' });
    expect(result.steps[0]!.tabs.map((t) => t.tabId)).toEqual([1, 4]);
  });

  it('says why tabs were left out, and never reveals a private one', async () => {
    mockTabs({ 1: web(1), 2: web(2, { incognito: true, url: 'https://secret.test/' }), 3: web(3, { pinned: true }), 4: { url: 'chrome://settings', title: 'S' } });
    const target = makeSnapshot({ name: 'Reading' });
    await addSnapshot(target);
    const result = await proposeTriagePlan({
      close: [1, 2, 3],
      fileInto: [{ id: target.id, tabIds: [4] }],
    });
    expect(result.skipped.map((s) => [s.tabId, s.reason.split(',')[0]])).toEqual([
      [2, 'no open tab with that id (it may have been closed)'],
      [3, 'pinned'],
      [4, 'not a web page'],
    ]);
    expect(JSON.stringify(result)).not.toContain('secret.test');
  });

  it('plans pinned and playing tabs only when asked', async () => {
    mockTabs({ 1: web(1, { pinned: true }), 2: web(2, { audible: true }) });
    expect((await failure(proposeTriagePlan({ close: [1, 2] }))).code).toBe('invalid_params');
    const result = await proposeTriagePlan({ close: [1, 2], includeProtected: true });
    expect(result.steps[0]!.tabs.map((t) => t.tabId)).toEqual([1, 2]);
  });

  it('leaves snapshot-owned tabs alone, naming the snapshot', async () => {
    const owner = makeSnapshot({ name: 'Job Hunt', linkedWindowId: 1 });
    await addSnapshot(owner);
    await setManagedTabs(owner.id, [1]);
    mockTabs({ 1: web(1), 2: web(2) });
    const result = await proposeTriagePlan({ close: [1, 2] });
    expect(result.steps[0]!.tabs.map((t) => t.tabId)).toEqual([2]);
    expect(result.skipped[0]!.reason).toContain('the snapshot "Job Hunt"');
  });

  it('refuses when no tab at all can be planned, naming every reason', async () => {
    mockTabs({ 1: web(1, { pinned: true }) });
    const error = await failure(proposeTriagePlan({ close: [1, 99] }));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('None of those tabs can be triaged');
    expect(error.message).toContain('tab 99');
  });

  it('fails on an unknown or Archived target snapshot before looking at any tab', async () => {
    const get = vi.spyOn(fakeBrowser.tabs, 'get');
    expect((await failure(proposeTriagePlan({ fileInto: [{ id: 'nope', tabIds: [1] }] }))).code).toBe('not_found');
    const archived = makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME });
    await addSnapshot(archived);
    const error = await failure(proposeTriagePlan({ fileInto: [{ id: archived.id, tabIds: [1] }] }));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('archive bucket');
    expect(get).not.toHaveBeenCalled();
  });

  it('shows the real page for a lazy placeholder', async () => {
    mockTabs({ 1: { url: fakeBrowser.runtime.getURL('/lazy.html?u=https%3A%2F%2Freal.test%2Fp&t=Real%20page' as never), title: 'real.test' } });
    const result = await proposeTriagePlan({ archive: [1] });
    expect(result.steps[0]!.tabs[0]).toMatchObject({ url: 'https://real.test/p', title: 'Real page' });
  });
});

describe('confirming a triage plan', () => {
  async function proposed(table: Record<number, TabSpec>, plan: Record<string, unknown>) {
    mockTabs(table);
    return (await proposeTriagePlan(plan)).proposalId;
  }

  it('saves into every bucket, closes every tab, and logs one entry that can be undone', async () => {
    await withArchive();
    const target = makeSnapshot({ name: 'Reading', updatedAt: 1000, tabs: [makeTab({ url: 'https://site4.test/page', title: 'Already here' })] });
    await addSnapshot(target);
    const table = { 1: web(1), 2: web(2), 3: web(3), 4: web(4), 5: web(5), 6: web(6) };
    const proposalId = await proposed(table, {
      close: [1],
      archive: [2],
      fileInto: [{ id: target.id, tabIds: [3, 4] }],
      newSnapshots: [{ name: 'Research', tabIds: [5, 6], categoryNames: ['Learning'] }],
      request: 'clean up my window',
    });
    const remove = closeAll();

    const result = await confirm(proposalId);

    expect(result).toEqual({
      action: 'triage',
      undoId: expect.any(String),
      closed: 6,
      archived: 1,
      filed: [{ snapshotId: target.id, name: 'Reading', added: 1, alreadyThere: 1 }],
      created: [{ snapshotId: expect.any(String), name: 'Research', tabCount: 2 }],
    });
    expect(remove.mock.calls.map(([id]) => id).sort()).toEqual([1, 2, 3, 4, 5, 6]);

    expect((await byName(ARCHIVED_SNAPSHOT_NAME))!.tabs.map((t) => t.url)).toEqual(['https://site2.test/page']);
    // the page already in the snapshot is not added twice, but its tab is still closed
    expect((await byName('Reading'))!.tabs.map((t) => t.title)).toEqual(['Already here', 'Site 3']);
    const research = (await byName('Research'))!;
    expect(research.tabs.map((t) => t.url)).toEqual(['https://site5.test/page', 'https://site6.test/page']);
    expect(research).toMatchObject({ linkedWindowId: null, usageCount: 0, tabGroups: [] });
    const [learning] = await getCategories();
    expect(learning!.name).toBe('Learning');
    expect(research.categoryIds).toEqual([learning!.id]);

    const { entries } = await listActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: result.undoId,
      tool: 'confirm_proposal',
      summary: 'Triaged 6 tabs (closed 1, archived 1, added 1 to 1 snapshot, saved 1 new snapshot)',
      request: 'clean up my window',
      undoable: true,
    });
  });

  it('saves everything before it closes anything', async () => {
    await withArchive();
    const target = makeSnapshot({ name: 'Reading', updatedAt: 1000, tabs: [] });
    await addSnapshot(target);
    const proposalId = await proposed(
      { 1: web(1), 2: web(2), 3: web(3), 4: web(4) },
      { close: [1], archive: [2], fileInto: [{ id: target.id, tabIds: [3] }], newSnapshots: [{ name: 'Research', tabIds: [4] }] },
    );
    let seenAtFirstClose: Record<string, number> | null = null;
    vi.spyOn(fakeBrowser.tabs, 'remove').mockImplementation((async () => {
      if (seenAtFirstClose) return;
      const all = await getSnapshots();
      seenAtFirstClose = Object.fromEntries(all.map((s) => [s.name, s.tabs.length]));
    }) as never);

    await confirm(proposalId);

    expect(seenAtFirstClose).toEqual({ Archived: 1, Reading: 1, Research: 1 });
  });

  it('adds "(2)" to a new snapshot whose name is taken, including one made in the same plan', async () => {
    await addSnapshot(makeSnapshot({ name: 'Research' }));
    const proposalId = await proposed(
      { 1: web(1), 2: web(2) },
      { newSnapshots: [{ name: 'Research', tabIds: [1] }, { name: 'Research', tabIds: [2] }] },
    );
    closeAll();
    const result = await confirm(proposalId);
    expect(result.created.map((c) => c.name)).toEqual(['Research (2)', 'Research (3)']);
  });

  it('closes tabs in a close-only plan without saving anywhere', async () => {
    const proposalId = await proposed({ 1: { url: 'chrome://newtab/', title: 'New Tab' }, 2: web(2) }, { close: [1, 2] });
    const remove = closeAll();
    const result = await confirm(proposalId);
    expect(result).toMatchObject({ closed: 2, archived: 0, filed: [], created: [] });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await getSnapshots()).toEqual([]);
  });

  it('changes nothing if any tab changed since the proposal', async () => {
    await withArchive();
    const table = { 1: web(1), 2: web(2) };
    const proposalId = await proposed(table, { archive: [1], newSnapshots: [{ name: 'Research', tabIds: [2] }] });
    table[2] = web(2, { url: 'https://elsewhere.test/' });
    const remove = closeAll();

    const error = await failure(confirmProposal({ proposalId }));

    expect(error.code).toBe('tabs_changed');
    expect(error.message).toContain('Nothing was changed');
    expect(error.message).toContain('now shows a different page');
    expect(remove).not.toHaveBeenCalled();
    expect((await byName(ARCHIVED_SNAPSHOT_NAME))!.tabs).toEqual([]);
    expect(await byName('Research')).toBeUndefined();
    expect((await listActivity()).total).toBe(0);
    expect((await failure(confirmProposal({ proposalId }))).code).toBe('proposal_expired');
  });

  it('changes nothing if a snapshot to file into has been deleted', async () => {
    const target = makeSnapshot({ name: 'Reading' });
    await addSnapshot(target);
    const proposalId = await proposed({ 1: web(1), 2: web(2) }, { close: [1], fileInto: [{ id: target.id, tabIds: [2] }] });
    await fakeBrowser.storage.local.set({ snapshots: [] });
    const remove = closeAll();

    const error = await failure(confirmProposal({ proposalId }));

    expect(error.code).toBe('tabs_changed');
    expect(error.message).toContain('"Reading" no longer exists');
    expect(remove).not.toHaveBeenCalled();
  });

  it('undoes the saving, and closes nothing, if a save fails partway', async () => {
    await withArchive();
    const target = makeSnapshot({ name: 'Reading', updatedAt: 1000, tabs: [makeTab({ title: 'Existing' })] });
    await addSnapshot(target);
    const proposalId = await proposed(
      { 1: web(1), 2: web(2), 3: web(3) },
      { archive: [1], fileInto: [{ id: target.id, tabIds: [2] }], newSnapshots: [{ name: 'Research', tabIds: [3] }] },
    );
    const remove = closeAll();
    // steps run archive, fileInto, newSnapshot: fail the third write to snapshots, the new snapshot's
    let writes = 0;
    const write = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(((items: Record<string, unknown>) => {
      if ('snapshots' in items && ++writes === 3) return Promise.reject(new Error('disk full'));
      return write(items);
    }) as never);

    await expect(confirmProposal({ proposalId })).rejects.toThrow('disk full');

    expect(remove).not.toHaveBeenCalled(); // nothing was closed
    expect((await byName(ARCHIVED_SNAPSHOT_NAME))!.tabs).toEqual([]); // the archive is as it was
    expect((await byName('Reading'))!.tabs.map((t) => t.title)).toEqual(['Existing']); // and so is Reading
    expect((await byName('Reading'))!.updatedAt).toBe(1000);
    expect(await byName('Research')).toBeUndefined();
    expect((await listActivity()).total).toBe(0); // and nothing is logged
  });

  it('deletes a snapshot it already created if a later save fails', async () => {
    const proposalId = await proposed(
      { 1: web(1), 2: web(2) },
      { newSnapshots: [{ name: 'First', tabIds: [1] }, { name: 'Second', tabIds: [2] }] },
    );
    const remove = closeAll();
    // "First" is written, then the write for "Second" fails
    let writes = 0;
    const write = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(((items: Record<string, unknown>) => {
      if ('snapshots' in items && ++writes === 2) return Promise.reject(new Error('disk full'));
      return write(items);
    }) as never);

    await expect(confirmProposal({ proposalId })).rejects.toThrow('disk full');

    expect(await byName('First')).toBeUndefined(); // it was created, then taken back
    expect(await byName('Second')).toBeUndefined();
    expect(await getSnapshots()).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });

  it('still succeeds when a tab closes on its own between the check and closing it', async () => {
    const proposalId = await proposed({ 1: web(1), 2: web(2) }, { close: [1, 2] });
    vi.spyOn(fakeBrowser.tabs, 'remove').mockImplementation((async (id: number) => {
      if (id === 1) throw new Error('No tab with id: 1');
    }) as never);
    expect(await confirm(proposalId)).toMatchObject({ closed: 1 });
  });

  it('does not re-check protection for a plan that deliberately included protected tabs', async () => {
    const proposalId = await proposed({ 1: web(1, { pinned: true }) }, { close: [1], includeProtected: true });
    closeAll();
    expect(await confirm(proposalId)).toMatchObject({ closed: 1 });
  });

  it('can be confirmed once only', async () => {
    const proposalId = await proposed({ 1: web(1) }, { close: [1] });
    const remove = closeAll();
    await confirm(proposalId);
    expect((await failure(confirmProposal({ proposalId }))).code).toBe('proposal_expired');
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('records what undo will need', async () => {
    await withArchive();
    const proposalId = await proposed({ 1: web(1), 2: web(2) }, { archive: [1], newSnapshots: [{ name: 'Research', tabIds: [2] }] });
    closeAll();
    const { undoId } = await confirm(proposalId);
    const stored = await getActivity(undoId!);
    expect(stored!.undo).toMatchObject({
      kind: 'triage',
      closed: [{ url: 'https://site1.test/page' }, { url: 'https://site2.test/page' }],
      archive: { urls: ['https://site1.test/page'] },
      appended: [],
      created: [{ name: 'Research', urls: ['https://site2.test/page'] }],
    });
  });
});

describe('through the dispatcher', () => {
  it('proposes, then confirms', async () => {
    mockTabs({ 1: web(1), 2: web(2) });
    closeAll();
    const proposal = (await dispatch({
      id: 'p',
      method: 'proposeTriagePlan',
      params: { close: [1], newSnapshots: [{ name: 'Keep', tabIds: [2] }] },
    })) as any;
    expect(proposal.result.totals).toEqual({ close: 1, archive: 0, fileInto: 0, newSnapshot: 1 });
    const done = (await dispatch({ id: 'c', method: 'confirmProposal', params: { proposalId: proposal.result.proposalId } })) as any;
    expect(done.result).toMatchObject({ action: 'triage', closed: 2 });
  });

  it('maps bad plans to error codes', async () => {
    expect(await dispatch({ id: 'x', method: 'proposeTriagePlan', params: {} })).toMatchObject({ error: { code: 'invalid_params' } });
    expect(await dispatch({ id: 'x', method: 'proposeTriagePlan', params: { close: [1], archive: [1] } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });
});
