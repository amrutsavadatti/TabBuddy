import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_PROPOSAL_TABS, PROPOSAL_TTL_MS } from '../bridge/protocol';
import { dispatch } from './agentBridge';
import {
  confirmProposal,
  parseProposeArchiveParams,
  proposeArchiveTabs,
  protectionReason,
} from './agentProposals';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { buildLazyTabUrl } from './lazyTab';
import { setManagedTabs } from './managedTabs';
import { addSnapshot, getSnapshots } from './storage';
import { makeSnapshot, makeTab } from '@/test/factories';

type TabSpec = Record<string, unknown>;

/** Answers tabs.get from a mutable table, rejecting for any other id. */
function mockTabs(table: Record<number, TabSpec>) {
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((async (id: number) => {
    if (!(id in table)) throw new Error(`No tab with id: ${id}`);
    return { id, windowId: 1, incognito: false, pinned: false, audible: false, ...table[id] };
  }) as never);
  return table;
}

const web = (n: number, extra: TabSpec = {}): TabSpec => ({
  url: `https://site${n}.test/page`,
  title: `Site ${n}`,
  ...extra,
});

const code = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return (error as BridgeFailure).code;
  }
  return 'no error';
};

const archivedSnapshot = async () => (await getSnapshots()).find((s) => s.name === ARCHIVED_SNAPSHOT_NAME);

describe('parseProposeArchiveParams', () => {
  it('removes repeated ids and defaults includeProtected to false', () => {
    expect(parseProposeArchiveParams({ tabIds: [1, 1, 2] })).toEqual({ tabIds: [1, 2], includeProtected: false });
    expect(parseProposeArchiveParams({ tabIds: [3], includeProtected: true }).includeProtected).toBe(true);
  });

  it.each([
    [undefined],
    [{}],
    [{ tabIds: [] }],
    [{ tabIds: '1' }],
    [{ tabIds: ['1'] }],
    [{ tabIds: [1.5] }],
    [{ tabIds: [1], includeProtected: 'yes' }],
    [{ tabIds: Array.from({ length: MAX_PROPOSAL_TABS + 1 }, (_, i) => i) }],
  ])('rejects %j as invalid_params', (params) => {
    try {
      parseProposeArchiveParams(params);
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
    }
  });

  it('allows exactly the maximum', () => {
    const tabIds = Array.from({ length: MAX_PROPOSAL_TABS }, (_, i) => i);
    expect(parseProposeArchiveParams({ tabIds }).tabIds).toHaveLength(MAX_PROPOSAL_TABS);
  });
});

describe('protectionReason', () => {
  it('protects pinned tabs, tabs playing sound, and tabs a snapshot owns', () => {
    expect(protectionReason({ pinned: true }, null)).toBe('pinned');
    expect(protectionReason({ audible: true }, null)).toBe('playing sound');
    expect(protectionReason({}, 'Job Hunt')).toBe('part of the open window of the snapshot "Job Hunt"');
    expect(protectionReason({}, '')).toBe("part of a snapshot's open window");
  });

  it('leaves an ordinary tab alone', () => {
    expect(protectionReason({ pinned: false, audible: false }, null)).toBeNull();
    expect(protectionReason({}, undefined)).toBeNull();
  });
});

describe('proposeArchiveTabs', () => {
  it('describes what would be archived and changes nothing', async () => {
    mockTabs({ 1: web(1), 2: web(2) });
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove');
    vi.spyOn(Date, 'now').mockReturnValue(1_000);

    const result = await proposeArchiveTabs({ tabIds: [1, 2] });

    expect(result).toMatchObject({
      action: 'archive',
      summary: 'Archive 2 tabs into the Archived snapshot and close them.',
      expiresAt: 1_000 + PROPOSAL_TTL_MS,
      expiresInSeconds: 300,
      skipped: [],
    });
    expect(result.tabs).toEqual([
      { tabId: 1, windowId: 1, title: 'Site 1', url: 'https://site1.test/page' },
      { tabId: 2, windowId: 1, title: 'Site 2', url: 'https://site2.test/page' },
    ]);
    expect(remove).not.toHaveBeenCalled();
    expect(await getSnapshots()).toEqual([]);
  });

  it('uses the singular for one tab', async () => {
    mockTabs({ 1: web(1) });
    expect((await proposeArchiveTabs({ tabIds: [1] })).summary).toBe(
      'Archive 1 tab into the Archived snapshot and close it.',
    );
  });

  it('shows the real page for a lazy placeholder', async () => {
    mockTabs({ 1: { url: buildLazyTabUrl({ url: 'https://real.test/p', title: 'Real page' }), title: 'real.test' } });
    const { tabs } = await proposeArchiveTabs({ tabIds: [1] });
    expect(tabs[0]).toMatchObject({ url: 'https://real.test/p', title: 'Real page' });
  });

  it('leaves out closed, private and non-web tabs, saying why and never revealing a private address', async () => {
    mockTabs({
      1: web(1),
      2: web(2, { incognito: true, url: 'https://secret.test/' }),
      3: { url: 'chrome://settings', title: 'Settings' },
    });
    const result = await proposeArchiveTabs({ tabIds: [1, 2, 3, 99] });
    expect(result.tabs.map((t) => t.tabId)).toEqual([1]);
    expect(result.skipped).toEqual([
      { tabId: 2, reason: 'no open tab with that id (it may have been closed)' },
      { tabId: 3, reason: 'not a web page, so there is nothing worth archiving' },
      { tabId: 99, reason: 'no open tab with that id (it may have been closed)' },
    ]);
    expect(JSON.stringify(result)).not.toContain('secret.test');
  });

  it('leaves pinned, playing and snapshot-owned tabs alone unless asked', async () => {
    const snapshot = makeSnapshot({ name: 'Job Hunt', linkedWindowId: 1 });
    await addSnapshot(snapshot);
    await setManagedTabs(snapshot.id, [4]);
    const table = {
      1: web(1),
      2: web(2, { pinned: true }),
      3: web(3, { audible: true }),
      4: web(4),
    };
    mockTabs(table);

    const result = await proposeArchiveTabs({ tabIds: [1, 2, 3, 4] });

    expect(result.tabs.map((t) => t.tabId)).toEqual([1]);
    expect(result.skipped.map((s) => [s.tabId, s.reason.split(',')[0]])).toEqual([
      [2, 'pinned'],
      [3, 'playing sound'],
      [4, 'part of the open window of the snapshot "Job Hunt"'],
    ]);
    expect(result.skipped[0]!.reason).toContain('unless the user explicitly asks');
  });

  it('includes protected tabs when the user explicitly asked for them', async () => {
    mockTabs({ 1: web(1, { pinned: true }), 2: web(2, { audible: true }) });
    const result = await proposeArchiveTabs({ tabIds: [1, 2], includeProtected: true });
    expect(result.tabs.map((t) => t.tabId)).toEqual([1, 2]);
    expect(result.skipped).toEqual([]);
  });

  it('refuses, naming every reason, when no tab can be archived, and stores no proposal', async () => {
    mockTabs({ 1: web(1, { pinned: true }) });
    try {
      await proposeArchiveTabs({ tabIds: [1, 99] });
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
      expect((error as Error).message).toContain('tab 1 (pinned');
      expect((error as Error).message).toContain('tab 99');
    }
  });

  it('cuts very long titles', async () => {
    mockTabs({ 1: web(1, { title: 'x'.repeat(500) }) });
    expect((await proposeArchiveTabs({ tabIds: [1] })).tabs[0]!.title).toHaveLength(200);
  });
});

describe('confirmProposal', () => {
  async function proposed(table: Record<number, TabSpec>, ids: number[], extra: Record<string, unknown> = {}) {
    mockTabs(table);
    const proposal = await proposeArchiveTabs({ tabIds: ids, ...extra });
    return proposal.proposalId;
  }
  const closeAll = () => vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);

  it('saves the tabs to the Archived snapshot and closes them', async () => {
    const proposalId = await proposed({ 1: web(1), 2: web(2) }, [1, 2]);
    const remove = closeAll();

    const result = await confirmProposal({ proposalId });

    expect(result).toEqual({
      action: 'archive',
      archived: 2,
      closed: 2,
      archivedSnapshot: { id: expect.any(String), tabCount: 2 },
    });
    expect(remove.mock.calls.map(([id]) => id)).toEqual([1, 2]);
    const archived = await archivedSnapshot();
    expect(archived!.id).toBe(result.archivedSnapshot.id);
    expect(archived!.tabs.map((t) => [t.title, t.url])).toEqual([
      ['Site 1', 'https://site1.test/page'],
      ['Site 2', 'https://site2.test/page'],
    ]);
  });

  it('saves before it closes, so a failed save would close nothing', async () => {
    const proposalId = await proposed({ 1: web(1) }, [1]);
    let savedWhenClosing = -1;
    vi.spyOn(fakeBrowser.tabs, 'remove').mockImplementation((async () => {
      savedWhenClosing = (await archivedSnapshot())?.tabs.length ?? 0;
    }) as never);

    await confirmProposal({ proposalId });

    expect(savedWhenClosing).toBe(1);
  });

  it('adds to an Archived snapshot that already holds tabs', async () => {
    const existing = makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, tabs: [makeTab({ url: 'https://old.test/' })] });
    await addSnapshot(existing);
    const proposalId = await proposed({ 1: web(1) }, [1]);
    closeAll();

    const result = await confirmProposal({ proposalId });

    expect(result.archivedSnapshot).toEqual({ id: existing.id, tabCount: 2 });
    expect((await archivedSnapshot())!.tabs.map((t) => t.url)).toEqual([
      'https://old.test/',
      'https://site1.test/page',
    ]);
  });

  it('can be confirmed once only', async () => {
    const proposalId = await proposed({ 1: web(1) }, [1]);
    closeAll();
    await confirmProposal({ proposalId });
    expect(await code(confirmProposal({ proposalId }))).toBe('proposal_expired');
    expect((await archivedSnapshot())!.tabs).toHaveLength(1); // not archived twice
  });

  it('refuses an unknown or expired proposal', async () => {
    expect(await code(confirmProposal({ proposalId: 'nope' }))).toBe('proposal_expired');

    const proposalId = await proposed({ 1: web(1) }, [1]);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + PROPOSAL_TTL_MS + 1000);
    expect(await code(confirmProposal({ proposalId }))).toBe('proposal_expired');
    expect(await archivedSnapshot()).toBeUndefined();
  });

  it('changes nothing if a tab now shows a different page, and uses the proposal up', async () => {
    const table = { 1: web(1), 2: web(2) };
    const proposalId = await proposed(table, [1, 2]);
    table[2] = web(2, { url: 'https://elsewhere.test/', title: 'Moved on' });
    const remove = closeAll();

    await expect(confirmProposal({ proposalId })).rejects.toMatchObject({
      code: 'tabs_changed',
      message: expect.stringContaining('now shows a different page'),
    });
    expect(remove).not.toHaveBeenCalled();
    expect(await archivedSnapshot()).toBeUndefined();
    expect(await code(confirmProposal({ proposalId }))).toBe('proposal_expired');
  });

  it('changes nothing if a tab has been closed', async () => {
    const table: Record<number, TabSpec> = { 1: web(1), 2: web(2) };
    const proposalId = await proposed(table, [1, 2]);
    delete table[1];
    const remove = closeAll();

    await expect(confirmProposal({ proposalId })).rejects.toMatchObject({
      code: 'tabs_changed',
      message: expect.stringContaining('was closed'),
    });
    expect(remove).not.toHaveBeenCalled();
    expect(await archivedSnapshot()).toBeUndefined();
  });

  it('changes nothing if a tab has since become pinned, or started playing sound', async () => {
    for (const change of [{ pinned: true }, { audible: true }]) {
      const table = { 1: web(1) };
      const proposalId = await proposed(table, [1]);
      table[1] = web(1, change);
      const remove = closeAll();
      await expect(confirmProposal({ proposalId })).rejects.toMatchObject({ code: 'tabs_changed' });
      expect(remove).not.toHaveBeenCalled();
    }
    expect(await archivedSnapshot()).toBeUndefined();
  });

  it('changes nothing if a tab has since become part of a snapshot window', async () => {
    const table = { 1: web(1) };
    const proposalId = await proposed(table, [1]);
    await setManagedTabs('some-snapshot', [1]);
    const remove = closeAll();
    await expect(confirmProposal({ proposalId })).rejects.toMatchObject({ code: 'tabs_changed' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not re-check protection for a proposal that deliberately included protected tabs', async () => {
    const proposalId = await proposed({ 1: web(1, { pinned: true }) }, [1], { includeProtected: true });
    closeAll();
    await expect(confirmProposal({ proposalId })).resolves.toMatchObject({ archived: 1, closed: 1 });
  });

  it('names the changed tabs, and counts the rest when there are many', async () => {
    const table: Record<number, TabSpec> = {};
    for (let i = 1; i <= 8; i++) table[i] = web(i);
    const proposalId = await proposed(table, [1, 2, 3, 4, 5, 6, 7, 8]);
    for (let i = 1; i <= 8; i++) delete table[i];
    await expect(confirmProposal({ proposalId })).rejects.toMatchObject({
      code: 'tabs_changed',
      message: expect.stringMatching(/8 of the 8 tabs changed.*and 3 more/s),
    });
  });

  it('still succeeds when a tab closes on its own between the check and closing it', async () => {
    const proposalId = await proposed({ 1: web(1), 2: web(2) }, [1, 2]);
    vi.spyOn(fakeBrowser.tabs, 'remove').mockImplementation((async (id: number) => {
      if (id === 1) throw new Error('No tab with id: 1');
    }) as never);

    const result = await confirmProposal({ proposalId });

    expect(result).toMatchObject({ archived: 2, closed: 1 });
    expect((await archivedSnapshot())!.tabs).toHaveLength(2);
  });

  it('archives the real page for a lazy placeholder', async () => {
    const lazy = buildLazyTabUrl({ url: 'https://real.test/p', title: 'Real page' });
    const proposalId = await proposed({ 1: { url: lazy, title: 'real.test' } }, [1]);
    closeAll();
    await confirmProposal({ proposalId });
    expect((await archivedSnapshot())!.tabs[0]).toMatchObject({ url: 'https://real.test/p', title: 'Real page' });
  });

  it.each([[undefined], [{}], [{ proposalId: '' }], [{ proposalId: 5 }]])('rejects %j as invalid_params', async (params) => {
    expect(await code(confirmProposal(params))).toBe('invalid_params');
  });
});

describe('through the dispatcher', () => {
  it('proposes, then confirms', async () => {
    mockTabs({ 1: web(1), 2: web(2) });
    vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);

    const proposal = (await dispatch({ id: 'p', method: 'proposeArchiveTabs', params: { tabIds: [1, 2] } })) as any;
    expect(proposal.result.tabs).toHaveLength(2);

    const done = (await dispatch({
      id: 'c',
      method: 'confirmProposal',
      params: { proposalId: proposal.result.proposalId },
    })) as any;
    expect(done.result).toMatchObject({ action: 'archive', archived: 2, closed: 2 });
  });

  it('maps a stale proposal and changed tabs to their error codes', async () => {
    expect(await dispatch({ id: 'c', method: 'confirmProposal', params: { proposalId: 'gone' } })).toMatchObject({
      error: { code: 'proposal_expired' },
    });

    const table = { 1: web(1) };
    mockTabs(table);
    const proposal = (await dispatch({ id: 'p', method: 'proposeArchiveTabs', params: { tabIds: [1] } })) as any;
    table[1] = web(1, { url: 'https://other.test/' });
    expect(
      await dispatch({ id: 'c', method: 'confirmProposal', params: { proposalId: proposal.result.proposalId } }),
    ).toMatchObject({ error: { code: 'tabs_changed' } });
  });
});
