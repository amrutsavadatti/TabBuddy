import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { isUrlSnoozed } from '@/lib/nudgeState';
import { NudgePeek } from './NudgePeek';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function show() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<NudgePeek />);
  });
  await act(async () => {}); // let the pending nudge load
}

const handle = () =>
  document.body.querySelector('button[aria-label="A tab needs a decision"]') as HTMLButtonElement | null;
const button = (label: string) =>
  [...document.body.querySelectorAll('button')].find((b) => b.textContent === label)!;
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
const pending = async () => (await fakeBrowser.storage.session.get('nudgePending')).nudgePending;

async function setPending() {
  vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({
    id: 7,
    url: 'https://old.example/',
    title: 'Old page',
    pinned: false,
  } as never);
  await fakeBrowser.storage.session.set({ nudgePending: { tabId: 7, askedAt: 1 } });
}

beforeEach(() => {
  fakeBrowser.reset();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the dashboard nudge peek', () => {
  it('is hidden when nothing is pending', async () => {
    await show();
    expect(handle()).toBeNull();
  });

  it('starts collapsed, with the card out of reach until opened', async () => {
    await setPending();
    await show();

    expect(handle()!.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('[inert]')).not.toBeNull();

    await click(handle()!);

    expect(handle()!.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.querySelector('[inert]')).toBeNull();
    expect(document.body.textContent).toContain('Old page');
  });

  it('is portalled to <body>, so no dashboard stacking context can bury it', async () => {
    await setPending();
    await show();
    expect(handle()!.parentElement!.parentElement).toBe(document.body);
  });

  it('appears live when a nudge becomes pending', async () => {
    await show();
    await act(async () => {
      await setPending();
    });
    await act(async () => {});
    expect(handle()).not.toBeNull();
  });

  it('Keep decides from the dashboard and the card goes away', async () => {
    await setPending();
    await show();
    await click(handle()!);

    await click(button('Keep'));
    await act(async () => {});

    expect(await isUrlSnoozed('https://old.example/')).toBe(true);
    expect(await pending()).toBeUndefined();
    expect(handle()).toBeNull();
  });

  it('Go to tab collapses the card but leaves the question pending', async () => {
    vi.spyOn(fakeBrowser.tabs, 'update').mockResolvedValue({} as never);
    vi.spyOn(fakeBrowser.windows, 'update').mockResolvedValue({} as never);
    await setPending();
    await show();
    await click(handle()!);

    await click(document.body.querySelector('button[title="Go to this tab"]')!);

    expect(handle()!.getAttribute('aria-expanded')).toBe('false');
    expect(await pending()).toBeDefined();
  });

  it('collapses on Escape', async () => {
    await setPending();
    await show();
    await click(handle()!);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(handle()!.getAttribute('aria-expanded')).toBe('false');
  });
});
