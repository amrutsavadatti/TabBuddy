import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_TRIAGE_TABS } from '../bridge/protocol';
import { listActivity } from './activityLog';
import { dispatch } from './agentBridge';
import { parseManualTriageParams, startManualTriage } from './agentManualTriage';
import { BridgeFailure } from './bridgeFailure';

type TabSpec = Record<string, unknown>;

function mockTabs(table: Record<number, TabSpec>) {
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((async (id: number) => {
    if (!(id in table)) throw new Error(`No tab with id: ${id}`);
    return { id, windowId: 1, incognito: false, pinned: false, audible: false, ...table[id] };
  }) as never);
  const create = vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({ id: 500 } as never);
  const update = vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never);
  const remove = vi.spyOn(fakeBrowser.tabs, 'remove');
  return { create, update, remove };
}
const web = (n: number, extra: TabSpec = {}): TabSpec => ({ url: `https://site${n}.test/page`, title: `Site ${n}`, ...extra });

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as BridgeFailure;
  }
  throw new Error('expected a failure');
};

describe('parseManualTriageParams', () => {
  it('removes repeated ids', () => {
    expect(parseManualTriageParams({ tabIds: [1, 1, 2] })).toEqual({ tabIds: [1, 2] });
  });

  it.each([[undefined], [{}], [{ tabIds: [] }], [{ tabIds: 'x' }], [{ tabIds: ['1'] }], [{ tabIds: [1.5] }]])(
    'rejects %j',
    (params) => {
      expect(() => parseManualTriageParams(params)).toThrow(BridgeFailure);
    },
  );

  it('caps how many tabs can be handed over', () => {
    const ids = Array.from({ length: MAX_TRIAGE_TABS + 1 }, (_, i) => i);
    expect(() => parseManualTriageParams({ tabIds: ids })).toThrow(/at most 300/);
    expect(parseManualTriageParams({ tabIds: ids.slice(0, MAX_TRIAGE_TABS) }).tabIds).toHaveLength(MAX_TRIAGE_TABS);
  });
});

describe('startManualTriage', () => {
  it('opens the sorting screen for just those tabs, in their window, and closes or saves nothing', async () => {
    const m = mockTabs({ 1: web(1, { windowId: 7 }), 2: web(2, { windowId: 7 }) });

    const result = await startManualTriage({ tabIds: [2, 1] });

    expect(result).toEqual({ opened: true, windowId: 7, tabCount: 2, skipped: [] });
    expect(m.create).toHaveBeenCalledWith({
      url: fakeBrowser.runtime.getURL('/dashboard.html?triage=7&tabs=2,1' as never),
      windowId: 7,
      active: true,
    });
    expect(m.update).toHaveBeenCalledWith(7, { focused: true });
    expect(m.remove).not.toHaveBeenCalled();
  });

  it('leaves out closed, private and TabBuddy tabs, saying why, and never reveals a private one', async () => {
    mockTabs({
      1: web(1),
      2: web(2, { incognito: true, url: 'https://secret.test/' }),
      3: { url: fakeBrowser.runtime.getURL('/dashboard.html' as never), title: 'TabBuddy' },
    });
    const result = await startManualTriage({ tabIds: [1, 2, 3, 99] });
    expect(result.tabCount).toBe(1);
    expect(result.skipped.map((s) => [s.tabId, s.reason])).toEqual([
      [2, 'no open tab with that id (it may have been closed)'],
      [3, "one of TabBuddy's own pages"],
      [99, 'no open tab with that id (it may have been closed)'],
    ]);
    expect(JSON.stringify(result)).not.toContain('secret.test');
  });

  it('includes pinned, playing and snapshot tabs: a person, not the agent, decides each one', async () => {
    mockTabs({ 1: web(1, { pinned: true }), 2: web(2, { audible: true }) });
    expect((await startManualTriage({ tabIds: [1, 2] })).tabCount).toBe(2);
  });

  it('accepts browser pages, which can still be closed by the user', async () => {
    mockTabs({ 1: { url: 'chrome://settings', title: 'Settings' }, 2: { url: '', title: '' } });
    expect((await startManualTriage({ tabIds: [1, 2] })).tabCount).toBe(2);
  });

  it('refuses tabs from more than one window, and opens nothing', async () => {
    const m = mockTabs({ 1: web(1, { windowId: 1 }), 2: web(2, { windowId: 2 }) });
    const error = await failure(startManualTriage({ tabIds: [1, 2] }));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('2 different windows');
    expect(m.create).not.toHaveBeenCalled();
  });

  it('refuses when no tab can be handed over, naming every reason', async () => {
    const m = mockTabs({ 1: web(1, { incognito: true }) });
    const error = await failure(startManualTriage({ tabIds: [1, 99] }));
    expect(error.code).toBe('invalid_params');
    expect(error.message).toContain('None of those tabs can be sorted');
    expect(error.message).toContain('tab 99');
    expect(m.create).not.toHaveBeenCalled();
  });
});

describe('through the dispatcher', () => {
  it('opens the screen and logs it, without an undo', async () => {
    mockTabs({ 1: web(1), 2: web(2) });
    const response = (await dispatch({
      id: 'm',
      method: 'startManualTriage',
      params: { tabIds: [1, 2], request: 'clean up my window' },
    })) as any;
    expect(response.result).toMatchObject({ opened: true, tabCount: 2 });
    const { entries } = await listActivity();
    expect(entries[0]).toMatchObject({
      tool: 'start_manual_triage',
      summary: 'Handed 2 tabs to you to sort one by one',
      request: 'clean up my window',
      undoable: false,
    });
  });

  it('maps a bad request to an error code and logs nothing', async () => {
    expect(await dispatch({ id: 'm', method: 'startManualTriage', params: { tabIds: [] } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
    expect((await listActivity()).total).toBe(0);
  });
});
