import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityEntry } from '../../bridge/protocol';
import { AgentActivityDialog } from './AgentActivityDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const entry = (id: string, summary: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id,
  at: Date.now() - 5 * 60_000,
  tool: 'confirm_proposal',
  summary,
  undoable: false,
  undone: false,
  ...extra,
});

let root: Root | null = null;

async function show(props: Partial<Parameters<typeof AgentActivityDialog>[0]> = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onUndo = props.onUndo ?? vi.fn();
  await act(async () => {
    root!.render(
      <AgentActivityDialog
        open
        onOpenChange={() => {}}
        entries={[]}
        busyId={null}
        error={null}
        onUndo={onUndo}
        {...props}
      />,
    );
  });
  return { onUndo };
}

const buttons = () => [...document.body.querySelectorAll('button')].filter((b) => /undo/i.test(b.textContent ?? ''));
const text = () => document.body.textContent ?? '';

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('AgentActivityDialog', () => {
  it('explains itself when there is nothing yet', async () => {
    await show();
    expect(text()).toContain('Agent activity');
    expect(text()).toContain('Nothing yet');
    expect(buttons()).toHaveLength(0);
  });

  it('renders nothing when closed', async () => {
    await show({ open: false, entries: [entry('a', 'Archived 2 tabs', { undoable: true })] });
    expect(text()).not.toContain('Archived 2 tabs');
  });

  it('lists each entry with when it happened, and an Undo only where one is possible', async () => {
    await show({
      entries: [
        entry('a', 'Archived 3 tabs', { undoable: true }),
        entry('b', 'Renamed "A" to "B"', { tool: 'rename_snapshot' }),
        entry('c', 'Closed 2 tabs', { undone: true }),
      ],
    });

    expect(text()).toContain('Archived 3 tabs');
    expect(text()).toContain('Renamed "A" to "B"');
    expect(text()).toContain('5 minutes ago');
    expect(buttons()).toHaveLength(1); // only the undoable one
    expect(text()).toContain('undone'); // the undone one says so
  });

  it('calls onUndo with the id of the entry whose Undo was pressed', async () => {
    const onUndo = vi.fn();
    await show({
      entries: [entry('first', 'Closed 1 tab', { undoable: true }), entry('second', 'Archived 2 tabs', { undoable: true })],
      onUndo,
    });
    expect(buttons()).toHaveLength(2);
    await act(async () => buttons()[1]!.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onUndo).toHaveBeenCalledWith('second');
  });

  it('disables every Undo while one is running, and says which', async () => {
    await show({
      entries: [entry('a', 'Closed 1 tab', { undoable: true }), entry('b', 'Archived 2 tabs', { undoable: true })],
      busyId: 'b',
    });
    const [first, second] = buttons();
    expect(first!.disabled).toBe(true);
    expect(second!.disabled).toBe(true);
    expect(second!.textContent).toContain('Undoing');
    expect(first!.textContent).not.toContain('Undoing');
  });

  it('shows why an undo failed, as an alert', async () => {
    await show({ error: 'None of the archived tabs could be reopened.', entries: [entry('a', 'Archived 1 tab', { undoable: true })] });
    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Couldn't undo");
    expect(alert?.textContent).toContain('None of the archived tabs could be reopened.');
  });

  it('sorts the log into what the user asked for, with a header for each', async () => {
    await show({
      entries: [
        entry('a', 'Closed 3 tabs', { request: 'clean up my Job Hunt window', undoable: true }),
        entry('b', 'Saved a window as "Research" (5 tabs)', { request: 'clean up my Job Hunt window', tool: 'save_window' }),
        entry('c', 'Created "Reading" from 2 links', { request: 'save my reading list', tool: 'create_snapshot_from_urls' }),
      ],
    });

    const headers = [...document.body.querySelectorAll('p.font-semibold')].map((p) => p.textContent);
    expect(headers).toEqual(['clean up my Job Hunt window', 'save my reading list']);
    expect(text()).toContain('2 actions');
    expect(text()).toContain('1 action ');
    // each entry sits under its own header
    const groups = [...document.body.querySelectorAll('ul[aria-label="Agent activity"] > li')];
    expect(groups).toHaveLength(2);
    expect(groups[0]!.textContent).toContain('Closed 3 tabs');
    expect(groups[0]!.textContent).toContain('Saved a window as "Research"');
    expect(groups[0]!.textContent).not.toContain('Created "Reading"');
    expect(groups[1]!.textContent).toContain('Created "Reading"');
  });

  it('keeps every group at its full height, so a long log scrolls instead of squashing the groups', async () => {
    // jsdom does no layout, so this checks the class that prevents the bug. The list is a
    // height-capped flex column and a group has overflow-hidden; without shrink-0 each group
    // shrinks to fit and is clipped, and the list never overflows, so it never scrolls.
    await show({
      entries: Array.from({ length: 6 }, (_, i) => entry(`e${i}`, `Closed ${i} tabs`, { request: `request ${i}` })),
    });
    const list = document.body.querySelector('ul[aria-label="Agent activity"]') as HTMLElement;
    expect(list.className).toContain('overflow-y-auto');
    expect(list.className).toContain('max-h-96');
    const groups = [...list.children];
    expect(groups).toHaveLength(6);
    for (const group of groups) expect(group.className).toContain('shrink-0');
  });

  it('labels actions that came with no request, and explains why in a tooltip', async () => {
    await show({ entries: [entry('a', 'Renamed "A" to "B"', { tool: 'rename_snapshot' })] });
    const header = document.body.querySelector('p.font-semibold') as HTMLElement;
    expect(header.textContent).toBe('No request noted');
    expect(header.title).toContain('grouped by when they happened');
  });

  it('keeps Undo working inside a group', async () => {
    const onUndo = vi.fn();
    await show({
      entries: [entry('a', 'Closed 3 tabs', { request: 'tidy up', undoable: true })],
      onUndo,
    });
    await act(async () => buttons()[0]!.click());
    expect(onUndo).toHaveBeenCalledWith('a');
  });

  it('shows no alert when there is no error', async () => {
    await show({ entries: [entry('a', 'Archived 1 tab', { undoable: true })] });
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });
});
