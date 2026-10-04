import { markAsked } from './nudgeAsked';
import { updatePlayingBadge } from './playingBadge';
import type { TriageTab } from './triage';

export const PENDING_KEY = 'nudgePending';
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

/** Brings the tab to the front, in whichever window it lives. The tab is
 * activated first: focusing the window can close the toolbar popup this is
 * often called from, and the call would never finish. */
export async function jumpToTab(tabId: number): Promise<void> {
  await browser.tabs.update(tabId, { active: true });
  const tab = await browser.tabs.get(tabId);
  if (tab.windowId !== undefined) {
    await browser.windows.update(tab.windowId, { focused: true });
  }
}

/** The tab the pending nudge is asking about, or null when nothing is pending.
 * A question about a tab that no longer exists is dropped on the way. */
export async function getPendingNudgeTab(): Promise<TriageTab | null> {
  const pending = await getPendingNudge();
  if (!pending) return null;
  try {
    const t = await browser.tabs.get(pending.tabId);
    return {
      id: pending.tabId,
      title: t.title ?? '',
      url: t.url ?? '',
      favIconUrl: t.favIconUrl,
      pinned: t.pinned ?? false,
    };
  } catch {
    await clearPendingNudge(); // tab closed before the user answered
    return null;
  }
}

/** Points the user at a stale tab and asks about it in the toolbar popup:
 * switches to the tab, remembers the question, badges the icon, and tries to
 * open the popup. Chrome only allows the auto-open while a browser window is
 * focused, so a failure is expected and non-fatal — the badge stays and the
 * question is waiting the next time the icon is clicked. Returns whether the
 * popup opened. */
async function presentNudge(tabId: number): Promise<boolean> {
  await jumpToTab(tabId);

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

/** If the current pending nudge has been sitting unanswered for longer than
 * `intervalMs`, expire it so the next scan can move on to a different tab. */
export async function expireIgnoredNudge(intervalMs: number, now = Date.now()): Promise<void> {
  const pending = await getPendingNudge();
  if (pending && now - pending.askedAt >= intervalMs) {
    await clearPendingNudge();
  }
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
