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
  const url = browser.runtime.getURL(`/nudge.html?tabId=${tabId}`);

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
