import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { readDecision } from '@/lib/agentConfirmation';
import { createProposal } from '@/lib/proposals';
import App from './App';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const tab = (n: number) => ({ tabId: n, windowId: 1, title: `Page ${n}`, url: `https://s${n}.test/` });

async function show(proposalId: string | null) {
  window.history.replaceState({}, '', proposalId === null ? '/confirm.html' : `/confirm.html?proposalId=${proposalId}`);
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  await act(async () => {}); // let the proposal load
}

const text = () => document.body.textContent ?? '';
const button = (pattern: RegExp) => [...document.body.querySelectorAll('button')].find((b) => pattern.test(b.textContent ?? ''));
const click = (el: Element | undefined) => act(async () => el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

beforeEach(() => {
  fakeBrowser.reset();
  vi.spyOn(window, 'close').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('confirmation window', () => {
  it('lists what the agent wants to do, by title and page', async () => {
    const proposal = await createProposal({ kind: 'archive', tabs: [tab(1), tab(2)], includeProtected: false });
    await show(proposal.id);
    expect(text()).toContain('Archive 2 tabs?');
    expect(text()).toContain('Page 1');
    expect(text()).toContain('https://s2.test/');
    expect(text()).not.toContain('proposalId');
  });

  it('records Confirm and closes the window', async () => {
    const proposal = await createProposal({ kind: 'close', tabs: [tab(1)], includeProtected: false });
    await show(proposal.id);
    await click(button(/^confirm$/i));
    expect(await readDecision(proposal.id)).toBe('confirm');
    expect(window.close).toHaveBeenCalled();
  });

  it('records Cancel and closes the window', async () => {
    const proposal = await createProposal({ kind: 'close', tabs: [tab(1)], includeProtected: false });
    await show(proposal.id);
    await click(button(/^cancel$/i));
    expect(await readDecision(proposal.id)).toBe('cancel');
    expect(window.close).toHaveBeenCalled();
  });

  it('records only the first answer', async () => {
    const proposal = await createProposal({ kind: 'close', tabs: [tab(1)], includeProtected: false });
    await show(proposal.id);
    await click(button(/^confirm$/i));
    await click(button(/^cancel$/i));
    expect(await readDecision(proposal.id)).toBe('confirm');
  });

  it('says so, and offers no Confirm, when the proposal is gone or the address is wrong', async () => {
    await show('nope');
    expect(text()).toContain('expired or was already answered');
    expect(button(/^confirm$/i)).toBeUndefined();
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    await show(null);
    expect(text()).toContain('expired or was already answered');
  });
});
