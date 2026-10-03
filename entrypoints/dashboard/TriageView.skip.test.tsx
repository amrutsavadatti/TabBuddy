import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getSnapshots } from '@/lib/storage';
import { TriageView } from './TriageView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

function browserWith(count: number) {
  const tabs = Array.from({ length: count }, (_, i) => ({
    id: 10 + i,
    windowId: 1,
    url: `https://site${i + 1}.test/`,
    title: `Site ${i + 1}`,
    pinned: false,
  }));
  vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue(tabs as never);
  const removeTab = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
  const removeWindow = vi.spyOn(fakeBrowser.windows, 'remove').mockResolvedValue(undefined as never);
  const restore = vi.spyOn(fakeBrowser.sessions, 'restore').mockResolvedValue(undefined as never);
  return { removeTab, removeWindow, restore };
}

async function show() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const onExit = vi.fn();
  await act(async () => {
    root!.render(<TriageView windowId={1} onExit={onExit} />);
  });
  await vi.waitFor(() => expect(text()).not.toContain('Loading'));
  return { onExit };
}

const text = () => document.body.textContent ?? '';
const skipButton = () => document.body.querySelector('button[title^="Leave this tab open"]') as HTMLButtonElement;
const closeButton = () => document.body.querySelector('button[title="Close this tab"]') as HTMLButtonElement;
const undoButton = () => document.body.querySelector('button[title="Undo last step"]') as HTMLButtonElement;
const skip = () => act(async () => skipButton().click());
const close = () => act(async () => closeButton().click());
const undo = () => act(async () => undoButton().click());
const press = (key: string, target: EventTarget = document.body) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });

beforeEach(() => fakeBrowser.reset());
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('skipping a tab', () => {
  it('moves on to the next tab and touches nothing: not closed, not filed', async () => {
    const b = browserWith(3);
    await show();
    expect(text()).toContain('Tab 1 of 3');
    expect(text()).toContain('Site 1');

    await skip();
    expect(text()).toContain('Tab 2 of 3');
    expect(text()).toContain('Site 2');
    expect(b.removeTab).not.toHaveBeenCalled();
    expect(b.removeWindow).not.toHaveBeenCalled();
    expect(await getSnapshots()).toEqual([]);
  });

  it('does not close the window after the last tab if any tab was skipped', async () => {
    const b = browserWith(2);
    const { onExit } = await show();
    await skip();
    await close();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(b.removeTab.mock.calls.map(([id]) => id)).toEqual([11]); // only the second tab
    expect(b.removeWindow).not.toHaveBeenCalled(); // so the skipped tab stays put
  });

  it('does not close the window when the very last tab is the one skipped', async () => {
    const b = browserWith(2);
    const { onExit } = await show();
    await close();
    await skip();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(b.removeWindow).not.toHaveBeenCalled();
    expect(b.removeTab.mock.calls.map(([id]) => id)).toEqual([10]);
  });

  it('still closes the window as before when nothing was skipped', async () => {
    const b = browserWith(2);
    const { onExit } = await show();
    await close();
    await close();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(b.removeWindow).toHaveBeenCalledWith(1);
  });

  it('can be undone: back to the tab, nothing reopened, and it no longer counts as skipped', async () => {
    const b = browserWith(2);
    const { onExit } = await show();
    await skip();
    expect(text()).toContain('Tab 2 of 2');

    await undo();
    expect(text()).toContain('Tab 1 of 2');
    expect(b.restore).not.toHaveBeenCalled(); // there was nothing to bring back

    await close();
    await close();
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(b.removeWindow).toHaveBeenCalledWith(1); // no skips left, so the window may close
  });

  it('is offered as a button, a hint and the S key', async () => {
    browserWith(3);
    await show();
    expect(skipButton()).toBeTruthy();
    expect(text()).toContain('Skip leaves it open');
    await press('s');
    expect(text()).toContain('Tab 2 of 3');
    await press('S');
    expect(text()).toContain('Tab 3 of 3');
  });

  it('ignores S while typing in a text field, and with a modifier key', async () => {
    browserWith(3);
    await show();
    const input = document.createElement('input');
    document.body.appendChild(input);
    await press('s', input);
    expect(text()).toContain('Tab 1 of 3');

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));
    });
    expect(text()).toContain('Tab 1 of 3');
  });

  it('mixes with closing and undoing in any order', async () => {
    const b = browserWith(4);
    const { onExit } = await show();
    await close(); // tab 1 closed
    await skip(); // tab 2 left open
    await close(); // tab 3 closed
    await undo(); // tab 3 comes back
    expect(b.restore).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Tab 3 of 4');
    await skip(); // tab 3 left open as well
    await close(); // tab 4 closed
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1));
    expect(b.removeWindow).not.toHaveBeenCalled();
  });
});
