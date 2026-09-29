import {
  MAX_DUPLICATE_GROUPS,
  type DuplicateGroup,
  type DuplicateTab,
  type FindDuplicateTabsResult,
  type OpenTab,
  type OpenWindow,
} from '../bridge/protocol';
import { pageKey } from './pageKey';

/** Which of several tabs on the same page to keep: the one being looked at,
 * then pinned, then one a snapshot owns (closing it would quietly drop it
 * from that snapshot), then one playing sound, then the most recently used. */
function keepOrder(a: OpenTab, b: OpenTab): number {
  return (
    Number(b.active) - Number(a.active) ||
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.managed) - Number(a.managed) ||
    Number(b.audible) - Number(a.audible) ||
    (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) ||
    a.id - b.id
  );
}

function describe(tab: OpenTab, windowId: number): DuplicateTab {
  return {
    tabId: tab.id,
    windowId,
    title: tab.title,
    lastAccessed: tab.lastAccessed,
    active: tab.active,
    pinned: tab.pinned,
    audible: tab.audible,
    managed: tab.managed,
  };
}

/** Pure: tabs open on the same page (see pageKey), grouped, biggest pile
 * first. Only web pages count. With `windowId`, only that window is looked at. */
export function findDuplicateTabs({
  windows,
  windowId,
  limit = MAX_DUPLICATE_GROUPS,
}: {
  windows: OpenWindow[];
  windowId?: number;
  limit?: number;
}): FindDuplicateTabsResult {
  const byPage = new Map<string, { tab: OpenTab; windowId: number }[]>();
  for (const window of windows) {
    if (windowId !== undefined && window.windowId !== windowId) continue;
    for (const tab of window.tabs) {
      const key = pageKey(tab.url);
      if (key === null) continue;
      const entries = byPage.get(key) ?? [];
      entries.push({ tab, windowId: window.windowId });
      byPage.set(key, entries);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const entries of byPage.values()) {
    if (entries.length < 2) continue;
    const sorted = [...entries].sort((a, b) => keepOrder(a.tab, b.tab));
    groups.push({
      url: sorted[0]!.tab.url,
      keepTabId: sorted[0]!.tab.id,
      tabs: sorted.map((e) => describe(e.tab, e.windowId)),
      extraTabIds: sorted.slice(1).map((e) => e.tab.id),
    });
  }
  groups.sort((a, b) => b.extraTabIds.length - a.extraTabIds.length || a.url.localeCompare(b.url));

  return {
    groups: groups.slice(0, limit),
    groupCount: groups.length,
    extraTabCount: groups.reduce((sum, g) => sum + g.extraTabIds.length, 0),
    truncated: groups.length > limit,
  };
}
