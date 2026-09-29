import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_REQUEST_LENGTH } from '../bridge/protocol';
import { getActivity, listActivity } from './activityLog';
import { dispatch } from './agentBridge';
import { addSnapshot } from './storage';
import { makeSnapshot, makeTab } from '@/test/factories';

const call = (method: string, params?: unknown) => dispatch({ id: 'x', method, params }) as Promise<any>;
const newest = async () => (await listActivity()).entries[0]!;

describe('the request phrase reaches the activity log', () => {
  it('is stored with an action taken through a logged tool', async () => {
    await call('createSnapshotFromUrls', {
      name: 'Reading',
      urls: ['https://a.test/'],
      request: 'save my reading list',
    });
    expect(await newest()).toMatchObject({ tool: 'create_snapshot_from_urls', request: 'save my reading list' });
  });

  it('is tidied and cut to length', async () => {
    await call('createSnapshotFromUrls', {
      name: 'R',
      urls: ['https://a.test/'],
      request: `  ${'word '.repeat(60)}  `,
    });
    const { request } = await newest();
    expect(request!.length).toBeLessThanOrEqual(MAX_REQUEST_LENGTH);
    expect(request).not.toMatch(/^\s|\s\s/);
  });

  it('is simply absent when the agent gave none, or gave something that is not a phrase', async () => {
    await call('createSnapshotFromUrls', { name: 'A', urls: ['https://a.test/'] });
    expect('request' in (await newest())).toBe(false);
    await call('createSnapshotFromUrls', { name: 'B', urls: ['https://b.test/'], request: 42 });
    expect('request' in (await newest())).toBe(false);
    await call('createSnapshotFromUrls', { name: 'C', urls: ['https://c.test/'], request: '   ' });
    expect('request' in (await newest())).toBe(false);
  });

  it('never gets in the way of the tool itself', async () => {
    const result = await call('createSnapshotFromUrls', { name: 'Fine', urls: ['https://a.test/'], request: { not: 'a string' } });
    expect(result.result).toMatchObject({ name: 'Fine', tabCount: 1 });
  });

  it('marks every action of one request, so they can be grouped', async () => {
    const created = await call('createSnapshotFromUrls', { name: 'List', urls: ['https://a.test/'], request: 'tidy my reading' });
    await call('renameSnapshot', { id: created.result.snapshotId, name: 'Reading list', request: 'tidy my reading' });
    await call('tagSnapshots', { snapshotIds: [created.result.snapshotId], categoryNames: ['Later'], request: 'tidy my reading' });
    const requests = (await listActivity()).entries.map((e) => e.request);
    expect(requests).toEqual(['tidy my reading', 'tidy my reading', 'tidy my reading']);
  });
});

describe('a confirmed action takes the request it was proposed with', () => {
  function mockTab() {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
      id: 5,
      windowId: 1,
      incognito: false,
      url: 'https://a.test/',
      title: 'A',
    } as never);
    vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
  }

  it('for closing tabs', async () => {
    mockTab();
    const proposal = await call('proposeCloseTabs', { tabIds: [5], request: 'clear out my window' });
    await call('confirmProposal', { proposalId: proposal.result.proposalId }); // no request passed here
    expect(await newest()).toMatchObject({ summary: 'Closed 1 tab', request: 'clear out my window' });
  });

  it('for archiving tabs', async () => {
    mockTab();
    const proposal = await call('proposeArchiveTabs', { tabIds: [5], request: 'archive the old stuff' });
    await call('confirmProposal', { proposalId: proposal.result.proposalId });
    expect(await newest()).toMatchObject({ summary: 'Archived 1 tab', request: 'archive the old stuff' });
  });

  it('for removing saved tabs', async () => {
    const snapshot = makeSnapshot({ name: 'Reading', tabs: [makeTab({ title: 'One' }), makeTab({ title: 'Two' })] });
    await addSnapshot(snapshot);
    const proposal = await call('proposeRemoveFromSnapshot', { id: snapshot.id, indexes: [0], request: 'prune my reading list' });
    await call('confirmProposal', { proposalId: proposal.result.proposalId });
    expect(await newest()).toMatchObject({ request: 'prune my reading list' });
  });

  it('and has none when the proposal had none', async () => {
    mockTab();
    const proposal = await call('proposeCloseTabs', { tabIds: [5] });
    await call('confirmProposal', { proposalId: proposal.result.proposalId });
    expect('request' in (await newest())).toBe(false);
  });

  it('and the undo of it is grouped with it', async () => {
    mockTab();
    const proposal = await call('proposeCloseTabs', { tabIds: [5], request: 'clear out my window' });
    const done = await call('confirmProposal', { proposalId: proposal.result.proposalId });
    vi.spyOn(fakeBrowser.sessions, 'getRecentlyClosed').mockResolvedValue([] as never);
    vi.spyOn(fakeBrowser.windows, 'get').mockImplementation((async (id: number) => ({ id, incognito: false })) as never);
    vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({ id: 9 } as never);

    await call('undo', { undoId: done.result.undoId });

    const [undo, original] = (await listActivity()).entries;
    expect(undo).toMatchObject({ tool: 'undo', request: 'clear out my window' });
    expect(original).toMatchObject({ id: done.result.undoId, request: 'clear out my window', undone: true });
    expect((await getActivity(done.result.undoId))!.request).toBe('clear out my window');
  });
});
