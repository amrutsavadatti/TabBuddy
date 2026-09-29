import {
  MAX_OPEN_TABS,
  MAX_TITLE_LENGTH,
  type OpenTab,
  type OpenWindow,
  type OpenWindowsResult,
} from '../bridge/protocol';
import type { Snapshot } from './types';

interface TabLike {
  id?: number;
  title?: string;
  url?: string;
  active?: boolean;
  pinned?: boolean;
  audible?: boolean;
  incognito?: boolean;
  lastAccessed?: number;
}

export interface WindowLike {
  id?: number;
  focused?: boolean;
  incognito?: boolean;
  tabs?: TabLike[];
}

export interface ShapeOptions {
  windows: WindowLike[];
  snapshots: Pick<Snapshot, 'id' | 'name' | 'linkedWindowId'>[];
  managedTabIds: Set<number>;
  /** Turns a placeholder tab into the real page it stands for. */
  resolveLazy: (tab: TabLike) => TabLike;
  /** TabBuddy's own pages (dashboard, nudge popup) start with this. */
  extensionOrigin: string;
  limit?: number;
}

function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

/** Pure: what an agent should see of the open browser. Leaves out incognito
 * windows and tabs, and TabBuddy's own pages (a window left with nothing
 * else is dropped). Caps the total number of tabs. */
export function shapeOpenWindows({
  windows,
  snapshots,
  managedTabIds,
  resolveLazy,
  extensionOrigin,
  limit = MAX_OPEN_TABS,
}: ShapeOptions): OpenWindowsResult {
  const result: OpenWindow[] = [];
  let tabCount = 0;
  let truncated = false;

  for (const window of windows) {
    if (window.incognito || window.id === undefined) continue;
    const tabs: OpenTab[] = [];
    for (const raw of window.tabs ?? []) {
      if (raw.incognito || raw.id === undefined) continue;
      const tab = resolveLazy(raw);
      if (tab.url?.startsWith(extensionOrigin)) continue;
      if (tabCount >= limit) {
        truncated = true;
        continue;
      }
      tabCount += 1;
      tabs.push({
        id: raw.id,
        title: truncateTitle(tab.title || tab.url || 'Untitled tab'),
        url: tab.url ?? '',
        active: raw.active === true,
        pinned: raw.pinned === true,
        audible: raw.audible === true,
        lastAccessed: raw.lastAccessed ?? null,
        managed: managedTabIds.has(raw.id),
        lazy: tab !== raw,
      });
    }
    if (tabs.length === 0) continue;
    const linked = snapshots.find((s) => s.linkedWindowId === window.id);
    result.push({
      windowId: window.id,
      focused: window.focused === true,
      snapshot: linked ? { id: linked.id, name: linked.name } : null,
      tabs,
    });
  }
  return { windows: result, tabCount, truncated };
}
