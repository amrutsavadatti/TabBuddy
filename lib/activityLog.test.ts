import { describe, expect, it } from 'vitest';
import { MAX_ACTIVITY_ENTRIES, MAX_UNDOABLE_ENTRIES } from '../bridge/protocol';
import {
  getActivity,
  listActivity,
  markUndone,
  recordActivity,
  slimTab,
  type UndoPayload,
} from './activityLog';
import { makeTab } from '@/test/factories';

const undo = (n = 1): UndoPayload => ({
  kind: 'close',
  tabs: [{ url: `https://s${n}.test/`, rawUrl: `https://s${n}.test/`, title: `Tab ${n}`, pinned: false, windowId: 1 }],
});

describe('recordActivity and listActivity', () => {
  it('lists entries newest first, with whether each can be undone', async () => {
    const first = await recordActivity({ tool: 'rename_snapshot', summary: 'Renamed "A" to "B"' }, 1000);
    const second = await recordActivity({ tool: 'confirm_proposal', summary: 'Closed 2 tabs', undo: undo() }, 2000);

    const { entries, total } = await listActivity();

    expect(total).toBe(2);
    expect(entries).toEqual([
      { id: second, at: 2000, tool: 'confirm_proposal', summary: 'Closed 2 tabs', undoable: true, undone: false },
      { id: first, at: 1000, tool: 'rename_snapshot', summary: 'Renamed "A" to "B"', undoable: false, undone: false },
    ]);
  });

  it('never exposes the undo data in the listing', async () => {
    await recordActivity({ tool: 'confirm_proposal', summary: 'Closed 1 tab', undo: undo() });
    expect(JSON.stringify(await listActivity())).not.toContain('s1.test');
  });

  it('honours a limit but still reports the total', async () => {
    for (let i = 0; i < 5; i++) await recordActivity({ tool: 't', summary: `entry ${i}` }, i);
    const { entries, total } = await listActivity(2);
    expect(entries.map((e) => e.summary)).toEqual(['entry 4', 'entry 3']);
    expect(total).toBe(5);
  });

  it('is empty to begin with', async () => {
    expect(await listActivity()).toEqual({ entries: [], total: 0 });
  });

  it('keeps only the newest 100 entries', async () => {
    for (let i = 0; i < MAX_ACTIVITY_ENTRIES + 5; i++) await recordActivity({ tool: 't', summary: `entry ${i}` }, i);
    const { entries, total } = await listActivity();
    expect(total).toBe(MAX_ACTIVITY_ENTRIES);
    expect(entries[0]!.summary).toBe(`entry ${MAX_ACTIVITY_ENTRIES + 4}`);
    expect(entries.at(-1)!.summary).toBe('entry 5');
  });

  it('keeps the data needed to undo only for the newest 20 undoable entries', async () => {
    const ids: string[] = [];
    for (let i = 0; i < MAX_UNDOABLE_ENTRIES + 3; i++) {
      ids.push(await recordActivity({ tool: 'confirm_proposal', summary: `Closed ${i}`, undo: undo(i) }, i));
      // plain entries in between must not use up the allowance
      await recordActivity({ tool: 'rename_snapshot', summary: `Renamed ${i}` }, i);
    }
    const { entries } = await listActivity();
    const undoable = entries.filter((e) => e.undoable).map((e) => e.summary);
    expect(undoable).toHaveLength(MAX_UNDOABLE_ENTRIES);
    expect(undoable[0]).toBe(`Closed ${MAX_UNDOABLE_ENTRIES + 2}`);
    expect((await getActivity(ids[0]!))!.undo).toBeUndefined(); // the oldest lost its undo data
    expect((await getActivity(ids.at(-1)!))!.undo).toBeDefined();
    // ...but its line stays in the log
    expect(entries.some((e) => e.summary === 'Closed 0')).toBe(true);
  });
});

describe('getActivity and markUndone', () => {
  it('finds an entry with its undo data, and returns nothing for an unknown id', async () => {
    const id = await recordActivity({ tool: 'confirm_proposal', summary: 'Closed 1 tab', undo: undo() });
    expect((await getActivity(id))!.undo).toEqual(undo());
    expect(await getActivity('nope')).toBeUndefined();
  });

  it('marks an entry undone, drops its undo data, and leaves the others alone', async () => {
    const a = await recordActivity({ tool: 'confirm_proposal', summary: 'Closed A', undo: undo(1) });
    const b = await recordActivity({ tool: 'confirm_proposal', summary: 'Closed B', undo: undo(2) });

    await markUndone(a);

    const stored = await getActivity(a);
    expect(stored!.undone).toBe(true);
    expect(stored!.undo).toBeUndefined();
    expect((await getActivity(b))!.undo).toBeDefined();
    const byId = Object.fromEntries((await listActivity()).entries.map((e) => [e.id, e]));
    expect(byId[a]).toMatchObject({ undone: true, undoable: false });
    expect(byId[b]).toMatchObject({ undone: false, undoable: true });
  });
});

describe('slimTab', () => {
  it('keeps a small favicon and drops one that is too big to be worth storing', () => {
    const small = makeTab({ favIconUrl: 'data:image/png;base64,AAAA' });
    const big = makeTab({ favIconUrl: `data:image/png;base64,${'A'.repeat(5000)}` });
    expect(slimTab(small)).toEqual(small);
    const slim = slimTab(big);
    expect(slim.favIconUrl).toBeUndefined();
    expect(slim.url).toBe(big.url);
    expect(slim.title).toBe(big.title);
  });

  it('leaves a tab without a favicon alone', () => {
    const tab = makeTab({ favIconUrl: undefined });
    expect(slimTab(tab)).toEqual(tab);
  });
});
