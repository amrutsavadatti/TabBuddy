import type { ReopenSummary } from '../bridge/protocol';
import type { ClosedTab } from './activityLog';

export interface ReopenResult extends ReopenSummary {
  /** The tabs that came back, by either route. */
  succeeded: ClosedTab[];
}

/** The browser remembers only this many recently closed tabs and windows. */
const MAX_RECENTLY_CLOSED = 25;

async function recentlyClosed() {
  try {
    return (await browser.sessions.getRecentlyClosed({ maxResults: MAX_RECENTLY_CLOSED })) ?? [];
  } catch {
    return [];
  }
}

/** Opens a tab again from its saved address: in the window it came from if
 * that still exists, else the window the user used last, else a new one. */
async function openFresh(tab: ClosedTab): Promise<void> {
  let windowId: number | undefined;
  try {
    const original = await browser.windows.get(tab.windowId);
    if (original?.id !== undefined && !original.incognito) windowId = original.id;
  } catch {
    // that window is gone
  }
  if (windowId === undefined) {
    try {
      const last = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
      if (last?.id !== undefined && !last.incognito) windowId = last.id;
    } catch {
      // no usable window
    }
  }
  if (windowId === undefined) {
    const created = await browser.windows.create({ url: tab.url, focused: true });
    if (created?.id === undefined) throw new Error('The browser did not create a window.');
    return;
  }
  await browser.tabs.create({ windowId, url: tab.url, pinned: tab.pinned, active: false });
}

/** Brings closed tabs back. Where the browser still remembers a tab it is
 * restored from its recently-closed list, which keeps its history and scroll
 * position; a window whose every tab is one of ours is restored as a whole.
 * Anything else, including whatever fell out of that list of 25, is opened
 * again from its saved address. Never throws: it reports what it managed. */
export async function reopenTabs(tabs: ClosedTab[]): Promise<ReopenResult> {
  const remaining = [...tabs];
  const succeeded: ClosedTab[] = [];
  let restored = 0;
  const sessions = await recentlyClosed();

  // A closed window: only if all of its tabs are among the ones we closed.
  for (const session of sessions) {
    const win = session.window;
    if (!win?.sessionId || !win.tabs?.length) continue;
    const picks: number[] = [];
    for (const t of win.tabs) {
      const at = remaining.findIndex((r, i) => r.rawUrl === t.url && !picks.includes(i));
      if (at === -1) break;
      picks.push(at);
    }
    if (picks.length !== win.tabs.length) continue;
    try {
      await browser.sessions.restore(win.sessionId);
    } catch {
      continue;
    }
    for (const at of [...picks].sort((a, b) => b - a)) succeeded.push(...remaining.splice(at, 1));
    restored += picks.length;
  }

  // Single closed tabs.
  for (const session of sessions) {
    const tab = session.tab;
    if (!tab?.sessionId) continue;
    const at = remaining.findIndex((r) => r.rawUrl === tab.url);
    if (at === -1) continue;
    try {
      await browser.sessions.restore(tab.sessionId);
    } catch {
      continue;
    }
    succeeded.push(...remaining.splice(at, 1));
    restored += 1;
  }

  let reopened = 0;
  let failed = 0;
  for (const tab of remaining) {
    try {
      await openFresh(tab);
      succeeded.push(tab);
      reopened += 1;
    } catch {
      failed += 1;
    }
  }
  return { restored, reopened, failed, succeeded };
}
