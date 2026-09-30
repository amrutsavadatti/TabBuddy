import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { addSnapshot } from '@/lib/storage';
import { makeSnapshot } from '@/test/factories';

const restore = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/lib/restore', () => ({ restoreSnapshot: restore }));

import App from './App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

async function show(snapshots: ReturnType<typeof makeSnapshot>[] = []) {
  for (const snapshot of snapshots) await addSnapshot(snapshot);
  vi.spyOn(fakeBrowser.windows, 'getCurrent').mockResolvedValue({ id: 1 } as never);
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  await act(async () => {}); // let the snapshots load
}

const text = () => document.body.textContent ?? '';
const searchBox = () => document.body.querySelector('input[aria-label="Search snapshots"]') as HTMLInputElement | null;
const rows = () => [...document.body.querySelectorAll('button[title^="Open \\""]')] as HTMLButtonElement[];

async function typeQuery(value: string) {
  const input = searchBox()!;
  await act(async () => {
    // React tracks the value itself, so go through the native setter
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (k: string) =>
  act(async () => {
    searchBox()!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  fakeBrowser.reset();
  restore.mockClear();
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('the popup search bar', () => {
  const snapshots = () => [
    makeSnapshot({ name: 'Job Hunt', usageCount: 4 }),
    makeSnapshot({ name: 'Research', usageCount: 2 }),
    makeSnapshot({ name: 'job board notes', usageCount: 0 }),
    makeSnapshot({ name: 'Recipes', usageCount: 0 }),
  ];

  it('is not shown until there is a snapshot to search', async () => {
    await show([]);
    expect(searchBox()).toBeNull();
  });

  it('shows the Most used list until you type, then only matching snapshots', async () => {
    await show(snapshots());
    expect(text()).toContain('Most used');
    expect(rows().map((r) => r.textContent)).toEqual(['Job Hunt1 tab', 'Research1 tab']);

    await typeQuery('job');
    expect(text()).not.toContain('Most used');
    expect(rows().map((r) => r.title)).toEqual(['Open "Job Hunt"', 'Open "job board notes"']);
  });

  it('finds snapshots that are not in Most used, ignoring case', async () => {
    await show(snapshots());
    await typeQuery('RECIP');
    expect(rows().map((r) => r.title)).toEqual(['Open "Recipes"']);
  });

  it('says so when nothing matches, and offers no rows', async () => {
    await show(snapshots());
    await typeQuery('zzz');
    expect(text()).toContain('No snapshots match "zzz".');
    expect(rows()).toHaveLength(0);
  });

  it('opens a result on click and closes the popup', async () => {
    const all = snapshots();
    await show(all);
    await typeQuery('recipes');
    await act(async () => rows()[0]!.click());
    expect(restore).toHaveBeenCalledTimes(1);
    expect(restore.mock.calls[0]![0].id).toBe(all[3]!.id);
    expect(window.close).toHaveBeenCalled();
  });

  it('opens the top result with Enter', async () => {
    const all = snapshots();
    await show(all);
    await typeQuery('job');
    await key('Enter');
    expect(restore.mock.calls[0]![0].id).toBe(all[0]!.id); // "Job Hunt" starts with it
  });

  it('does nothing on Enter when nothing matches', async () => {
    await show(snapshots());
    await typeQuery('zzz');
    await key('Enter');
    expect(restore).not.toHaveBeenCalled();
  });

  it('clears with Escape and with the clear button, returning to Most used', async () => {
    await show(snapshots());
    await typeQuery('job');
    await key('Escape');
    expect(searchBox()!.value).toBe('');
    expect(text()).toContain('Most used');

    await typeQuery('job');
    await act(async () => (document.body.querySelector('button[title="Clear search"]') as HTMLButtonElement).click());
    expect(searchBox()!.value).toBe('');
    expect(text()).toContain('Most used');
  });

  it('treats a blank query as no search', async () => {
    await show(snapshots());
    await typeQuery('   ');
    expect(text()).toContain('Most used');
    expect(text()).not.toContain('No snapshots match');
  });

  it('also finds the snapshot linked to the current window and the Archived one', async () => {
    await show([
      makeSnapshot({ name: 'Linked work', linkedWindowId: 1 }),
      makeSnapshot({ name: 'Archived', usageCount: 3 }),
    ]);
    await typeQuery('linked');
    expect(rows().map((r) => r.title)).toEqual(['Open "Linked work"']);
    await typeQuery('archived');
    expect(rows().map((r) => r.title)).toEqual(['Open "Archived"']);
  });
});
