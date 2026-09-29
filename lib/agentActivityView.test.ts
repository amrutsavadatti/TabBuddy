import { describe, expect, it } from 'vitest';
import type { ActivityEntry, UndoResult } from '../bridge/protocol';
import {
  describeUndoResult,
  groupActivity,
  MAX_ACTIVITY_TOASTS,
  newActivityToasts,
  SAME_REQUEST_GAP_MS,
  toastMessageFor,
  UNLABELLED_GAP_MS,
} from './agentActivityView';

const entry = (id: string, summary: string, tool = 'confirm_proposal'): ActivityEntry => ({
  id,
  at: 1,
  tool,
  summary,
  undoable: false,
  undone: false,
});

describe('toastMessageFor', () => {
  it('turns a summary into a sentence about the agent', () => {
    expect(toastMessageFor({ summary: 'Archived 12 tabs' })).toBe('Agent archived 12 tabs');
    expect(toastMessageFor({ summary: 'Renamed "A" to "B"' })).toBe('Agent renamed "A" to "B"');
    expect(toastMessageFor({ summary: 'Opened "Job Hunt" (3 tabs)' })).toBe('Agent opened "Job Hunt" (3 tabs)');
  });
});

describe('newActivityToasts', () => {
  const log = [entry('c', 'Closed 2 tabs'), entry('b', 'Renamed "A" to "B"'), entry('a', 'Archived 5 tabs')];

  it('shows nothing on the first read, whatever the log holds', () => {
    expect(newActivityToasts(null, log)).toEqual([]);
  });

  it('shows only entries that were not there before, oldest first', () => {
    expect(newActivityToasts(new Set(['a']), log)).toEqual(['Agent renamed "A" to "B"', 'Agent closed 2 tabs']);
  });

  it('shows nothing when nothing is new', () => {
    expect(newActivityToasts(new Set(['a', 'b', 'c']), log)).toEqual([]);
  });

  it('skips undos', () => {
    const withUndo = [entry('u', 'Undid: Closed 2 tabs', 'undo'), ...log];
    expect(newActivityToasts(new Set(['a', 'b', 'c']), withUndo)).toEqual([]);
  });

  it('caps a burst, ending with a count of the rest', () => {
    const burst = Array.from({ length: 7 }, (_, i) => entry(`n${i}`, `Created "List ${i}" from 1 link`)).reverse();
    const toasts = newActivityToasts(new Set(), burst);
    expect(toasts).toHaveLength(MAX_ACTIVITY_TOASTS);
    expect(toasts.slice(0, 2)).toEqual(['Agent created "List 0" from 1 link', 'Agent created "List 1" from 1 link']);
    expect(toasts[2]).toBe('Agent did 5 more things: see Agent activity');
  });

  it('shows exactly the cap without a summary line', () => {
    const three = [entry('3', 'Closed 3 tabs'), entry('2', 'Closed 2 tabs'), entry('1', 'Closed 1 tab')];
    expect(newActivityToasts(new Set(), three)).toHaveLength(3);
    expect(newActivityToasts(new Set(), three).some((t) => t.includes('more things'))).toBe(false);
  });
});

describe('describeUndoResult', () => {
  const reopen = (restored: number, reopened: number, failed = 0) => ({ restored, reopened, failed });
  const snapshot = { id: 's', name: 'Reading', tabCount: 5 };

  it('describes undoing an archive', () => {
    const r: UndoResult = { action: 'undo', undid: 'archive', reopen: reopen(2, 1), removedFromArchived: 3 };
    expect(describeUndoResult(r)).toBe('Reopened 3 tabs and took them out of the archive');
  });

  it('uses the singular, and says what could not come back', () => {
    const one: UndoResult = { action: 'undo', undid: 'archive', reopen: reopen(1, 0), removedFromArchived: 1 };
    expect(describeUndoResult(one)).toBe('Reopened 1 tab and took it out of the archive');
    const partial: UndoResult = { action: 'undo', undid: 'archive', reopen: reopen(1, 0, 2), removedFromArchived: 1 };
    expect(describeUndoResult(partial)).toContain('2 could not be reopened and stayed archived');
  });

  it('describes undoing a close', () => {
    expect(describeUndoResult({ action: 'undo', undid: 'close', reopen: reopen(2, 0) })).toBe('Reopened 2 tabs');
    expect(describeUndoResult({ action: 'undo', undid: 'close', reopen: reopen(1, 0, 1) })).toBe(
      'Reopened 1 tab; 1 could not be reopened',
    );
  });

  it('describes undoing a removal, and flags a snapshot that changed', () => {
    const plain: UndoResult = { action: 'undo', undid: 'removeFromSnapshot', restoredTabs: 2, snapshot, snapshotChangedSince: false };
    expect(describeUndoResult(plain)).toBe('Put 2 saved tabs back in "Reading"');
    const changed: UndoResult = { ...plain, restoredTabs: 1, snapshotChangedSince: true };
    expect(describeUndoResult(changed)).toBe('Put 1 saved tab back in "Reading" (it had changed, so positions may differ)');
  });
});


describe('groupActivity', () => {
  const MIN = 60_000;
  const at = (id: string, minutesAgo: number, request?: string): ActivityEntry => ({
    ...entry(id, `Did ${id}`),
    at: 1_000_000_000 - minutesAgo * MIN,
    ...(request === undefined ? {} : { request }),
  });

  it('is empty for an empty log', () => {
    expect(groupActivity([])).toEqual([]);
  });

  it('puts the actions for one request together, newest group first', () => {
    const groups = groupActivity([
      at('e', 1, 'clean up my Job Hunt window'),
      at('d', 2, 'clean up my Job Hunt window'),
      at('c', 3, 'clean up my Job Hunt window'),
      at('b', 30, 'save my reading list'),
      at('a', 31, 'save my reading list'),
    ]);
    expect(groups.map((g) => [g.request, g.entries.map((e) => e.id)])).toEqual([
      ['clean up my Job Hunt window', ['e', 'd', 'c']],
      ['save my reading list', ['b', 'a']],
    ]);
    expect(groups[0]).toMatchObject({ id: 'e', newestAt: at('e', 1).at, oldestAt: at('c', 3).at });
  });

  it('treats phrasing that differs only in case or spacing as the same request', () => {
    const groups = groupActivity([at('b', 1, 'Clean  up my window'), at('a', 2, 'clean up my WINDOW')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.request).toBe('Clean  up my window'); // shown as the newest entry phrased it
  });

  it('keeps different requests apart even when they are back to back', () => {
    const groups = groupActivity([at('b', 1, 'request one'), at('a', 2, 'request two')]);
    expect(groups.map((g) => g.request)).toEqual(['request one', 'request two']);
  });

  it('starts a new group when the same request comes back much later', () => {
    const gap = SAME_REQUEST_GAP_MS / MIN + 5;
    const groups = groupActivity([at('b', 1, 'tidy up'), at('a', 1 + gap, 'tidy up')]);
    expect(groups).toHaveLength(2);
  });

  it('keeps a long request together while each step follows the last within the gap', () => {
    const steps = Array.from({ length: 6 }, (_, i) => at(`s${i}`, i * 40, 'a long clean up'));
    expect(groupActivity(steps)).toHaveLength(1); // 200 minutes in all, but never 60 minutes between steps
  });

  it('groups actions with no request as bursts, and never mixes them with labelled ones', () => {
    const groups = groupActivity([
      at('d', 1),
      at('c', 5),
      at('b', 6, 'a labelled request'),
      at('a', 7),
    ]);
    expect(groups.map((g) => [g.request, g.entries.map((e) => e.id)])).toEqual([
      [null, ['d', 'c']],
      ['a labelled request', ['b']],
      [null, ['a']],
    ]);
  });

  it('splits unlabelled actions that are far apart', () => {
    const gap = UNLABELLED_GAP_MS / MIN + 5;
    expect(groupActivity([at('b', 1), at('a', 1 + gap)])).toHaveLength(2);
  });

  it('never loses or reorders an entry', () => {
    const log = [at('e', 1, 'x'), at('d', 2), at('c', 90, 'x'), at('b', 91, 'y'), at('a', 400)];
    expect(groupActivity(log).flatMap((g) => g.entries.map((e) => e.id))).toEqual(['e', 'd', 'c', 'b', 'a']);
  });
});
