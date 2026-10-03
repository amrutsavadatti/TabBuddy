import { markAsked } from './nudgeAsked';
import { updatePlayingBadge } from './playingBadge';

const PENDING_KEY = 'nudgePending';
const BADGE_TEXT = '?';

export interface PendingNudge {
  tabId: number;
  askedAt: number;
}

export async function getPendingNudge(): Promise<PendingNudge | null> {
  const result = await browser.storage.session.get(PENDING_KEY);
  return (result[PENDING_KEY] as PendingNudge | undefined) ?? null;
}

export async function clearPendingNudge(): Promise<void> {
  await browser.storage.session.remove(PENDING_KEY);
  // Hand the badge back to the audio-playing count (blank if nothing plays).
  await updatePlayingBadge();
}

/** Points the user at a stale tab and asks about it in the toolbar popup:
 * switches to the tab, remembers the question, badges the icon, and tries to
 * open the popup. Chrome only allows the auto-open while a browser window is
 * focused, so a failure is expected and non-fatal — the badge stays and the
 * question is waiting the next time the icon is clicked. Returns whether the
 * popup opened. */
export async function presentNudge(tabId: number): Promise<boolean> {
  const tab = await browser.tabs.get(tabId);
  if (tab.windowId !== undefined) {
    await browser.windows.update(tab.windowId, { focused: true });
  }
  await browser.tabs.update(tabId, { active: true });

  await browser.storage.session.set({
    [PENDING_KEY]: { tabId, askedAt: Date.now() } satisfies PendingNudge,
  });
  await browser.action.setBadgeText({ text: BADGE_TEXT });

  try {
    await browser.action.openPopup();
    return true;
  } catch (err) {
    console.warn('[TabBuddy] openPopup failed; badge left for the user', err);
    return false;
  }
}

/** Clears the pending nudge if it is about this tab (closed, or the user
 * dealt with it themselves), so a stale question can never block later ones. */
export async function clearPendingNudgeFor(tabId: number): Promise<void> {
  if ((await getPendingNudge())?.tabId === tabId) await clearPendingNudge();
}

/** Asks about the first candidate (callers pass them in the order they want
 * them asked), unless a question is already waiting for an answer. Returns the
 * tab id asked about, or null if nothing was asked. */
export async function presentNextNudge(candidateIds: number[]): Promise<number | null> {
  if (await getPendingNudge()) return null;
  const first = candidateIds[0];
  if (first === undefined) return null;
  await presentNudge(first);
  await markAsked(first);
  return first;
}
