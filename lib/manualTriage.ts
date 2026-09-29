/** The one-by-one sorting screen ("Sort tabs one by one") can be opened for a whole
 * window, or, when an agent hands over the tabs it was unsure about, for just
 * those tabs. The choice travels in the screen's address. */

export const TRIAGE_PARAM = 'triage';
export const TRIAGE_TABS_PARAM = 'tabs';

/** Pure: the tab ids in a `tabs=1,2,3` parameter. Null means the parameter is
 * absent, which is a whole-window session. A parameter that is present but not a
 * clean list of whole numbers reads as an EMPTY list, never as absent: falling
 * back to the whole window would show every tab and close the window at the end,
 * which is the opposite of what a malformed request should do. */
export function parseTriageTabsParam(raw: string | null): number[] | null {
  if (raw === null) return null;
  const parts = raw.split(',').map((part) => part.trim());
  const ids = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
  if (ids.length === 0 || ids.some((id) => !Number.isSafeInteger(id))) return [];
  return [...new Set(ids)];
}

/** Pure: the screen's address for a window, and optionally just some of its tabs. */
export function buildTriageUrl(path: string, windowId: number, onlyTabIds?: number[]): string {
  const base = `${path}?${TRIAGE_PARAM}=${windowId}`;
  return onlyTabIds === undefined ? base : `${base}&${TRIAGE_TABS_PARAM}=${onlyTabIds.join(',')}`;
}

/** Pure: whether finishing the list closes the window. Only a whole-window
 * session does: the user has been through every tab in it. A session for a few
 * handed-over tabs must leave the window alone, or it would close tabs the user
 * never saw. */
export function closesWindowWhenDone(onlyTabIds: number[] | null): boolean {
  return onlyTabIds === null;
}
