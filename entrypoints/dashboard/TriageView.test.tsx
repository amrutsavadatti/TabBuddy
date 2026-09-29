import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { TriageView } from './TriageView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type TabSpec = Record<string, unknown>;

let root: Root | null = null;

/** A browser with these tabs: `get` finds any of them by id, `query` lists those in window 1. */
function browserWith(table: Record<number, TabSpec>) {
  const tab = (id: number) => ({ id, windowId: 1, incognito: false, pinned: false, ...table[id] });
  vi.spyOn(fakeBrowser.tabs, 'get').mockImplementation((async (id: number) => {
    if (!(id in table)) throw new Error(`No tab with id: ${id}`);
    return tab(id);
  }) as never);
  const query = vi
    .spyOn(fakeBrowser.tabs, 'query')
    .mockImplementation((async () => Object.keys(table).map((id) => tab(Number(id)))) as never);
  const removeTab = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
  const removeWindow = vi.spyOn(fakeBrowser.windows, 'remove').mockResolvedValue(undefined as never);
  return { query, removeTab, removeWindow };
}
const page = (n: number, extra: TabSpec = {}): TabSpec => ({
  url: `https://site${n}.test/page`,
  title: `Site ${n}`,
  ...extra,
});

async function show(props: { onlyTabIds?: number[] | null } = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onExit = vi.fn();
  await act(async () => {
    root!.render(<TriageView windowId={1} onExit={onExit} {...props} />);
  });
  await vi.waitFor(() => expect(text()).not.toContain('Loading'));
  return { onExit };
}

const text = () => document.body.textContent ?? '';
const closeButton = () => document.body.querySelector('button[title="Close this tab"]') as HTMLButtonElement;
async function closeCurrentTab() {
  await act(async () => closeButton().click());
}

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('the sorting screen for tabs an agent handed over', () => {
  it('shows only those tabs, in the order given, and explains why', async () => {
    const b = browserWith({ 11: page(11), 12: page(12), 50: page(50), 51: page(51) });
    await show({ onlyTabIds: [12, 11] });

    expect(text()).toContain('Tab 1 of 2');
    expect(text()).toContain('Site 12'); // first, as the agent ordered them
    expect(text()).not.toContain('Site 50');
    expect(text()).toContain("Your assistant wasn't sure about these 2 tabs");
    expect(text()).toContain('Every other tab in the window stays exactly as it is');
    expect(b.query).not.toHaveBeenCalled(); // it did not list the whole window
  });

  it('does not close the window when the last handed-over tab is dealt with', async () => {
    const b = browserWith({ 11: page(11), 12: page(12), 50: page(50) });
    const { onExit } = await show({ onlyTabIds: [11, 12] });

    await closeCurrentTab();
    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    expect(onExit).not.toHaveBeenCalled();
    await closeCurrentTab();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));

    expect(b.removeTab.mock.calls.map(([id]) => id)).toEqual([11, 12]); // exactly the two, in order
    expect(b.removeWindow).not.toHaveBeenCalled(); // the window, and tab 50 in it, are left alone
    expect(b.removeTab).not.toHaveBeenCalledWith(50);
  });

  it('skips a tab that has since closed, and one in a private window', async () => {
    browserWith({ 11: page(11), 13: page(13, { incognito: true }) });
    await show({ onlyTabIds: [11, 99, 13] });
    expect(text()).toContain('Tab 1 of 1');
    expect(text()).toContain("Your assistant wasn't sure about this tab");
    expect(text()).toContain('Decide it');
    expect(text()).not.toContain('Site 13');
  });

  it('says there is nothing to sort when none of the tabs is left, and never falls back to the window', async () => {
    const b = browserWith({ 50: page(50) });
    await show({ onlyTabIds: [99] });
    expect(text()).toContain('No tabs to sort');
    expect(b.query).not.toHaveBeenCalled();
    expect(text()).not.toContain('Site 50');
  });

  it('treats an empty list like a list, not like the whole window', async () => {
    const b = browserWith({ 50: page(50) });
    await show({ onlyTabIds: [] });
    expect(text()).toContain('No tabs to sort');
    expect(b.query).not.toHaveBeenCalled();
  });
});

describe('the sorting screen for a whole window', () => {
  it('shows every tab in the window with the original explanation', async () => {
    const b = browserWith({ 11: page(11), 12: page(12) });
    await show();
    expect(b.query).toHaveBeenCalledWith({ windowId: 1 });
    expect(text()).toContain('Tab 1 of 2');
    expect(text()).toContain('Go through a messy window one tab at a time');
    expect(text()).not.toContain('Your assistant');
  });

  it('still closes the window when the whole list has been dealt with', async () => {
    const b = browserWith({ 11: page(11), 12: page(12) });
    const { onExit } = await show({ onlyTabIds: null });

    await closeCurrentTab();
    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    await closeCurrentTab();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));

    expect(b.removeWindow).toHaveBeenCalledWith(1);
  });
});

describe('undoing a closed tab in the sorting screen', () => {
  /** A browser where closing a tab that is not open fails, and restoring gives the tab a NEW id. */
  function browserWithRestore(table: Record<number, TabSpec>, restored: object) {
    const b = browserWith(table);
    const open = new Set(Object.keys(table).map(Number));
    b.removeTab.mockImplementation((async (id: number) => {
      if (!open.has(id)) throw new Error(`No tab with id: ${id}`);
      open.delete(id);
    }) as never);
    const restore = vi.spyOn(fakeBrowser.sessions, 'restore').mockImplementation((async () => {
      const id = (restored as { tab?: { id: number }; window?: { tabs: { id: number }[] } }).tab?.id
        ?? (restored as { window: { tabs: { id: number }[] } }).window.tabs[0]!.id;
      open.add(id);
      return { lastModified: 1, ...restored };
    }) as never);
    vi.spyOn(fakeBrowser.tabs, 'getCurrent').mockResolvedValue({ id: 1, windowId: 1 } as never);
    vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never);
    vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never);
    return { ...b, restore };
  }
  const undoButton = () => document.body.querySelector('button[title="Undo last step"]') as HTMLButtonElement;
  const errorText = "Couldn't close that tab";

  it('can close the tab again afterwards, even though the browser gave it a new id', async () => {
    const b = browserWithRestore({ 11: page(11), 12: page(12) }, { tab: { id: 777 } });
    await show({ onlyTabIds: [11, 12] });

    await closeCurrentTab(); // closes 11, moves to the second card
    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    await act(async () => undoButton().click()); // brings 11 back as tab 777, and returns to card 1
    await vi.waitFor(() => expect(text()).toContain('Tab 1 of 2'));
    await closeCurrentTab(); // must close the RESTORED tab

    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    expect(text()).not.toContain(errorText);
    expect(b.removeTab.mock.calls.map(([id]) => id)).toEqual([11, 777]);
  });

  it('copes when the browser restores a whole window (the tab was the last one in it)', async () => {
    const b = browserWithRestore({ 11: page(11), 12: page(12) }, { window: { tabs: [{ id: 888 }] } });
    await show({ onlyTabIds: [11, 12] });

    await closeCurrentTab();
    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    await act(async () => undoButton().click());
    await vi.waitFor(() => expect(text()).toContain('Tab 1 of 2'));
    await closeCurrentTab();

    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    expect(text()).not.toContain(errorText);
    expect(b.removeTab.mock.calls.map(([id]) => id)).toEqual([11, 888]);
  });

  it('survives undoing and re-closing the same card twice in a row', async () => {
    const b = browserWithRestore({ 11: page(11), 12: page(12) }, { tab: { id: 777 } });
    await show({ onlyTabIds: [11, 12] });

    await closeCurrentTab(); // 11 closed
    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    for (let round = 0; round < 2; round++) {
      await act(async () => undoButton().click()); // the tab comes back, and we return to card 1
      await vi.waitFor(() => expect(text()).toContain('Tab 1 of 2'));
      await closeCurrentTab(); // and it is closed again
      await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    }

    expect(text()).not.toContain(errorText);
    expect(b.removeTab.mock.calls.map(([id]) => id)).toEqual([11, 777, 777]);
  });

  it('also works for a tab that was filed away, not just closed', async () => {
    const b = browserWithRestore({ 11: page(11), 12: page(12) }, { tab: { id: 777 } });
    await show({ onlyTabIds: [11, 12] });

    const newSnapshot = [...document.body.querySelectorAll('button, div')].find((el) =>
      el.textContent?.trim() === 'New snapshot',
    ) as HTMLElement;
    await act(async () => newSnapshot.click());
    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    await act(async () => undoButton().click());
    await vi.waitFor(() => expect(text()).toContain('Tab 1 of 2'));
    await closeCurrentTab();

    await vi.waitFor(() => expect(text()).toContain('Tab 2 of 2'));
    expect(text()).not.toContain(errorText);
    expect(b.removeTab.mock.calls.map(([id]) => id)).toEqual([11, 777]);
  });
});
