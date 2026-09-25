import { markAsked } from './nudgeAsked';

const NUDGE_PAGE = '/nudge.html';
const NUDGE_WIDTH = 340;
const NUDGE_HEIGHT = 420;
const MARGIN = 24;

/** Opens the small nudge popup window for a given tab. Returns the new
 * window's id (used by the caller to avoid opening a second nudge while one
 * is already showing).
 *
 * Explicit left/top/state are set because a `type: "popup"` window created
 * without them can inherit a maximized/fullscreen state from whatever
 * window/context was focused at creation time — most relevant if the
 * user's actual browser window is in native fullscreen when a nudge fires. */
export async function openNudgeForTab(tabId: number): Promise<number | undefined> {
  const url = browser.runtime.getURL(`${NUDGE_PAGE}?tabId=${tabId}` as never);

  let left = 100;
  let top = 100;
  try {
    const parent = await browser.windows.getLastFocused();
    const parentLeft = parent.left ?? 0;
    const parentTop = parent.top ?? 0;
    const parentWidth = parent.width ?? 1280;
    const parentHeight = parent.height ?? 800;
    left = Math.max(0, parentLeft + parentWidth - NUDGE_WIDTH - MARGIN);
    top = Math.max(0, parentTop + parentHeight - NUDGE_HEIGHT - MARGIN);
  } catch {
    // fall back to the defaults above if there's no window to anchor to
  }

  const win = await browser.windows.create({
    type: 'popup',
    url,
    width: NUDGE_WIDTH,
    height: NUDGE_HEIGHT,
    left,
    top,
    focused: true,
    state: 'normal',
  });
  return win?.id;
}

export interface OpenNudge {
  windowId: number;
  /** The tab this nudge is asking about. */
  targetTabId: number | null;
}

/** Nudge popups that are open right now, read from the browser itself rather
 * than remembered — the background service worker is restarted often and
 * would forget any in-memory state. */
export async function findOpenNudges(): Promise<OpenNudge[]> {
  const base = browser.runtime.getURL(NUDGE_PAGE as never);
  const windows = await browser.windows.getAll({ populate: true });
  const found: OpenNudge[] = [];
  for (const win of windows) {
    if (win.id === undefined) continue;
    for (const tab of win.tabs ?? []) {
      const url = tab.url || tab.pendingUrl;
      if (!url || !url.startsWith(base)) continue;
      const raw = new URL(url).searchParams.get('tabId');
      const parsed = raw === null ? NaN : Number(raw);
      found.push({ windowId: win.id, targetTabId: Number.isFinite(parsed) ? parsed : null });
    }
  }
  return found;
}

/** Closes any open nudge that is asking about this tab (it was closed, or the
 * user opened it themselves), so a stale popup can never block later nudges. */
export async function closeNudgesFor(tabId: number): Promise<void> {
  for (const nudge of await findOpenNudges()) {
    if (nudge.targetTabId !== tabId) continue;
    try {
      await browser.windows.remove(nudge.windowId);
    } catch {
      // already closing — fine
    }
  }
}

/** Shows a nudge for the first candidate (callers pass them in the order they
 * want them asked), unless a nudge is already open. Returns the tab id shown,
 * or null if nothing was shown. */
export async function openNextNudge(candidateIds: number[]): Promise<number | null> {
  if ((await findOpenNudges()).length > 0) return null;
  const first = candidateIds[0];
  if (first === undefined) return null;
  await openNudgeForTab(first);
  await markAsked(first);
  return first;
}
