import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_ACTIVITY_ENTRIES } from '../bridge/protocol';
import { listActivity } from './activityLog';
import { dispatch } from './agentBridge';
import { addSnapshot } from './storage';
import { makeSnapshot, makeTab } from '@/test/factories';

const summaries = async () => (await listActivity()).entries.map((e) => e.summary);
const call = (method: string, params?: unknown) => dispatch({ id: 'x', method, params }) as Promise<any>;

describe('the activity log the tools write', () => {
  it('records what a tool did, in a sentence, with the tool that did it', async () => {
    const created = await call('createSnapshotFromUrls', { name: 'Reading', urls: ['https://a.test/', 'https://b.test/'] });
    const id = created.result.snapshotId;
    await call('renameSnapshot', { id, name: 'Reading list' });
    await call('tagSnapshots', { snapshotIds: [id], categoryNames: ['Learning', 'Later'] });
    await call('addTabsToSnapshot', { id, urls: ['https://c.test/'] });

    const { entries } = await listActivity();
    expect(entries.map((e) => [e.tool, e.summary])).toEqual([
      ['add_tabs_to_snapshot', 'Added 1 tab to "Reading list"'],
      ['tag_snapshots', 'Tagged 1 snapshot with Learning, Later'],
      ['rename_snapshot', 'Renamed "Reading" to "Reading list"'],
      ['create_snapshot_from_urls', 'Created "Reading" from 2 links'],
    ]);
    expect(entries.every((e) => !e.undoable)).toBe(true);
  });

  it('records restoring a snapshot, and bringing an open one to the front', async () => {
    const snapshot = makeSnapshot({ name: 'Job Hunt', tabs: [makeTab(), makeTab()] });
    await addSnapshot(snapshot);
    await call('restoreSnapshot', { id: snapshot.id });
    await call('restoreSnapshot', { id: snapshot.id });
    expect(await summaries()).toEqual(['Brought "Job Hunt" to the front', 'Opened "Job Hunt" (2 tabs)']);
  });

  it('records opening pages, and where they went', async () => {
    vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({
      id: 50,
      tabs: [{ id: 1, url: 'https://a.test/' }, { id: 2, url: 'https://b.test/' }],
    } as never);
    await call('openUrls', { urls: ['https://a.test/', 'https://b.test/'], newWindow: true });
    expect(await summaries()).toEqual(['Opened 2 pages in a new window']);
  });

  it('does not record adding nothing new to a snapshot', async () => {
    const snapshot = makeSnapshot({ tabs: [makeTab({ url: 'https://a.test/' })] });
    await addSnapshot(snapshot);
    const result = await call('addTabsToSnapshot', { id: snapshot.id, urls: ['https://a.test/?utm_source=x'] });
    expect(result.result.added).toEqual([]);
    expect(await summaries()).toEqual([]);
  });

  it('does not record a call that failed', async () => {
    await call('renameSnapshot', { id: 'nope', name: 'X' });
    await call('createSnapshotFromUrls', { name: 'Archived', urls: ['https://a.test/'] });
    await call('addTabsToSnapshot', { id: 'nope', urls: ['https://a.test/'] });
    expect(await summaries()).toEqual([]);
  });

  it('does not record reads, proposals or switching tabs', async () => {
    const snapshot = makeSnapshot({ tabs: [makeTab()] });
    await addSnapshot(snapshot);
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ id: 5, windowId: 1, incognito: false, url: 'https://a.test/', title: 'A' } as never);

    await call('listSnapshots');
    await call('getSnapshot', { id: snapshot.id });
    await call('searchTabs', { query: 'anything' });
    await call('listOpenWindows');
    await call('proposeArchiveTabs', { tabIds: [5] });
    await call('proposeCloseTabs', { tabIds: [5] });
    await call('proposeRemoveFromSnapshot', { id: snapshot.id, indexes: [0] });
    await call('focusTab', { tabId: 5 });

    expect(await summaries()).toEqual([]);
  });

  it('records a confirmed action exactly once, and as one that can be undone', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ id: 5, windowId: 1, incognito: false, url: 'https://a.test/', title: 'A' } as never);
    vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
    const proposal = await call('proposeCloseTabs', { tabIds: [5] });
    const done = await call('confirmProposal', { proposalId: proposal.result.proposalId });

    const { entries } = await listActivity();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: done.result.undoId,
      tool: 'confirm_proposal',
      summary: 'Closed 1 tab',
      undoable: true,
      undone: false,
    });
  });

  it('never turns a success into a failure because the log could not be written', async () => {
    const write = fakeBrowser.storage.local.set.bind(fakeBrowser.storage.local);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockImplementation(((items: Record<string, unknown>) =>
      'agentActivity' in items ? Promise.reject(new Error('log is broken')) : write(items)) as never);

    const created = await call('createSnapshotFromUrls', { name: 'Still works', urls: ['https://a.test/'] });
    expect(created.result).toMatchObject({ name: 'Still works', tabCount: 1 });
    expect(created.error).toBeUndefined();

    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ id: 5, windowId: 1, incognito: false, url: 'https://a.test/', title: 'A' } as never);
    vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
    const proposal = await call('proposeCloseTabs', { tabIds: [5] });
    const done = await call('confirmProposal', { proposalId: proposal.result.proposalId });
    expect(done.result).toMatchObject({ action: 'close', closed: 1, undoId: null }); // still reports what happened
  });
});

describe('getAgentActivity', () => {
  it('lists the newest first, and honours a limit', async () => {
    for (let i = 0; i < 4; i++) {
      await call('createSnapshotFromUrls', { name: `List ${i}`, urls: ['https://a.test/'] });
    }
    const all = await call('getAgentActivity');
    expect(all.result.total).toBe(4);
    expect(all.result.entries[0].summary).toBe('Created "List 3" from 1 link');

    const two = await call('getAgentActivity', { limit: 2 });
    expect(two.result.entries.map((e: { summary: string }) => e.summary)).toEqual([
      'Created "List 3" from 1 link',
      'Created "List 2" from 1 link',
    ]);
    expect(two.result.total).toBe(4);
  });

  it('shows 20 by default and never more than the log holds', async () => {
    expect((await call('getAgentActivity', { limit: 100000 })).result.entries).toHaveLength(0);
    expect(MAX_ACTIVITY_ENTRIES).toBe(100);
  });

  it.each([[0], [-1], [1.5], ['5']])('rejects a limit of %j', async (limit) => {
    expect(await call('getAgentActivity', { limit })).toMatchObject({ error: { code: 'invalid_params' } });
  });

  it('does not itself write to the log', async () => {
    await call('getAgentActivity');
    expect((await listActivity()).total).toBe(0);
  });
});
