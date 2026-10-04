import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeStatus, type BridgeState } from '@/lib/agentBridgeStatus';
import {
  AgentBridgeDialog,
  CONNECT_COMMAND,
  CONNECT_COMMAND_CODEX,
  INSTALL_COMMAND,
} from './AgentBridgeDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

const statusFor = (enabled: boolean, state: BridgeState = 'connected', detail?: string) =>
  describeStatus(enabled, { state, since: 1, ...(detail ? { detail } : {}) });

async function show(props: Partial<Parameters<typeof AgentBridgeDialog>[0]> = {}) {
  const handlers = {
    onOpenChange: vi.fn(),
    onToggle: vi.fn(),
    onCheckAgain: vi.fn(),
    onAskInBrowserChange: vi.fn(),
    onOpenActivity: vi.fn(),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AgentBridgeDialog
        open
        enabled
        status={statusFor(true)}
        askInBrowser={false}
        undoableCount={0}
        {...handlers}
        {...props}
      />,
    );
  });
  return handlers;
}

const text = () => document.body.textContent ?? '';
const button = (pattern: RegExp) =>
  [...document.body.querySelectorAll('button')].find((b) => pattern.test(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`));
const click = (el: Element | undefined) => act(async () => el!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

describe('AgentBridgeDialog', () => {
  it('shows the four states', async () => {
    await show({ enabled: false, status: statusFor(false) });
    expect(text()).toContain('Status: Off');
    expect(text()).toContain('Agent bridge is off');
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    await show({ status: statusFor(true, 'connected') });
    expect(text()).toContain('Status: Connected');
    expect(text()).toContain('Agent bridge is on');
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    await show({ status: statusFor(true, 'not_installed', 'The TabBuddy bridge is not installed on this computer yet.') });
    expect(text()).toContain('Status: Bridge not installed');
    expect(text()).toContain('not installed on this computer');
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    await show({ status: statusFor(true, 'error', 'It broke.') });
    expect(text()).toContain('Status: Error');
    expect(text()).toContain('It broke.');
  });

  it('flips the bridge from the toggle', async () => {
    const { onToggle } = await show();
    await click(document.querySelector('[role="switch"]')!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('offers "Check again" only when it is on and something is wrong', async () => {
    const { onCheckAgain } = await show({ status: statusFor(true, 'not_installed', 'x') });
    await click(button(/check again/i));
    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    await show({ status: statusFor(true, 'connected') });
    expect(button(/check again/i)).toBeUndefined();
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    await show({ enabled: false, status: statusFor(false) });
    expect(button(/check again/i)).toBeUndefined();
  });

  it('hides setup once connected, and shows it open while not connected', async () => {
    await show({ status: statusFor(true, 'connected') });
    expect(text()).not.toContain(INSTALL_COMMAND);
    await click(button(/setup instructions/i));
    expect(text()).toContain(INSTALL_COMMAND);
    await act(async () => root!.unmount());
    root = null;
    document.body.innerHTML = '';

    await show({ enabled: false, status: statusFor(false) });
    expect(text()).toContain(INSTALL_COMMAND);
  });

  it('switches the connect command per AI client', async () => {
    await show({ enabled: false, status: statusFor(false) });
    expect(text()).toContain(CONNECT_COMMAND);
    await click(button(/^Codex\s*$/));
    expect(text()).toContain(CONNECT_COMMAND_CODEX);
    expect(text()).not.toContain(CONNECT_COMMAND);
    await click(button(/Claude Desktop/));
    expect(text()).toContain('"mcpServers"');
  });

  it('shows both commands and copies the one you ask for', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await show({ enabled: false, status: statusFor(false) });
    expect(text()).toContain(INSTALL_COMMAND);
    expect(text()).toContain(CONNECT_COMMAND);
    await click(button(new RegExp(`Copy: ${INSTALL_COMMAND}`)));
    expect(writeText).toHaveBeenCalledWith(INSTALL_COMMAND);
    expect(text()).toContain('Copied');
  });

  it('turns the in-browser confirmation on and off', async () => {
    const { onAskInBrowserChange } = await show({ askInBrowser: false });
    const askSwitch = [...document.querySelectorAll('[role="switch"]')].find((el) =>
      /ask me in the browser/i.test(el.textContent ?? ''),
    )!;
    expect(askSwitch.getAttribute('aria-checked')).toBe('false');
    await click(askSwitch);
    expect(onAskInBrowserChange).toHaveBeenCalledWith(true);
  });

  it('reflects the in-browser setting when it is on', async () => {
    const { onAskInBrowserChange } = await show({ askInBrowser: true });
    const askSwitch = [...document.querySelectorAll('[role="switch"]')].find((el) =>
      /ask me in the browser/i.test(el.textContent ?? ''),
    )!;
    expect(askSwitch.getAttribute('aria-checked')).toBe('true');
    await click(askSwitch);
    expect(onAskInBrowserChange).toHaveBeenCalledWith(false);
  });

  it('links to the activity panel, closing itself first, and counts what can be undone', async () => {
    const { onOpenActivity, onOpenChange } = await show({ undoableCount: 3 });
    expect(text()).toContain('3 to undo');
    await click(button(/agent activity/i));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenActivity).toHaveBeenCalledTimes(1);
  });
});
