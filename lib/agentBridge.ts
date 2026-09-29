import {
  PROTOCOL_VERSION,
  type BridgeError,
  type BridgeRequest,
  type BridgeResponse,
  type CategorySummary,
  type GetSnapshotParams,
  type FocusTabResult,
  type GetStaleTabsParams,
  type OpenUrlsResult,
  type RestoreSnapshotResult,
  type GetUsageStatsParams,
  type StaleTabsResult,
  type UsageStats,
  MAX_USAGE_ITEMS,
  type HelloResult,
  type ListSnapshotsParams,
  type OpenWindowsResult,
  type SearchScope,
  type SearchTabsParams,
  type SearchTabsResult,
  MAX_SEARCH_RESULTS,
  type SnapshotDetail,
  type SnapshotSummary,
  MAX_SNAPSHOT_TABS_PER_CALL,
  MAX_TITLE_LENGTH,
} from '../bridge/protocol';
import { focusTab, openUrls, parseOpenUrlsParams, parseTabId } from './agentOpen';
import { saveWindow } from './agentSave';
import { BridgeFailure } from './bridgeFailure';
import { getCategories, getSnapshotsInCategory } from './categories';
import { resolveLazyTab } from './lazyTab';
import { getManagedTabIds } from './managedTabs';
import { shapeOpenWindows } from './openWindows';
import { getNudgeStaleMinutes } from './nudgeSettings';
import { getSnoozedKeys } from './nudgeState';
import { getQuickLinksEnabled } from './quickLinksSetting';
import { queryTokens, searchTabs } from './searchTabs';
import { getSiteStats } from './siteStats';
import { findStaleTabs } from './staleTabs';
import { buildUsageStats } from './usageStats';
import { restoreSnapshot } from './restore';
import { getSnapshots } from './storage';
import type { Category, Snapshot } from './types';

export { BridgeFailure };

export type Handler = (params: unknown) => Promise<unknown>;
export type HandlerTable = Record<string, Handler>;

export function toBridgeError(error: unknown): BridgeError {
  if (error instanceof BridgeFailure) {
    return { code: error.code, message: error.message };
  }
  return {
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
  };
}

/** Pure: no favicons (they can be huge data: URLs and are useless to an agent). */
export function summarizeSnapshot(snapshot: Snapshot, categories: Category[] = []): SnapshotSummary {
  const namesById = new Map(categories.map((c) => [c.id, c.name]));
  return {
    id: snapshot.id,
    name: snapshot.name,
    tabCount: snapshot.tabs.length,
    categoryIds: snapshot.categoryIds,
    categoryNames: snapshot.categoryIds.flatMap((id) => namesById.get(id) ?? []),
    usageCount: snapshot.usageCount,
    pinned: snapshot.pinned,
    isOpen: snapshot.linkedWindowId !== null,
    updatedAt: snapshot.updatedAt,
  };
}

function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

/** Validates getSnapshot's params, throwing invalid_params with a message an
 * agent can act on. */
export function parseGetSnapshotParams(params: unknown): Required<GetSnapshotParams> {
  const p = (params ?? {}) as Record<string, unknown>;
  if (typeof p.id !== 'string' || p.id === '') {
    throw new BridgeFailure('invalid_params', 'id must be a snapshot id from list_snapshots.');
  }
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
  if (p.offset !== undefined && (!isCount(p.offset) || p.offset < 0)) {
    throw new BridgeFailure('invalid_params', 'offset must be a whole number, 0 or more.');
  }
  if (p.limit !== undefined && (!isCount(p.limit) || p.limit < 1)) {
    throw new BridgeFailure('invalid_params', 'limit must be a whole number, 1 or more.');
  }
  return {
    id: p.id,
    offset: (p.offset as number | undefined) ?? 0,
    limit: Math.min((p.limit as number | undefined) ?? MAX_SNAPSHOT_TABS_PER_CALL, MAX_SNAPSHOT_TABS_PER_CALL),
  };
}

/** Pure: a page of a snapshot's tabs, addressed by index, without favicons
 * and with long titles cut. */
export function describeSnapshot(
  snapshot: Snapshot,
  { offset, limit }: { offset: number; limit: number },
  categories: Category[] = [],
): SnapshotDetail {
  const page = snapshot.tabs.slice(offset, offset + limit);
  return {
    ...summarizeSnapshot(snapshot, categories),
    tabs: page.map((tab, i) => ({
      index: offset + i,
      url: tab.url,
      title: truncateTitle(tab.title),
      pinned: tab.pinned,
      group: tab.groupIndex === null ? null : (snapshot.tabGroups[tab.groupIndex]?.title ?? null),
    })),
    offset,
    truncated: offset + page.length < snapshot.tabs.length,
  };
}

async function loadOpenWindows(limit?: number): Promise<OpenWindowsResult> {
  const [windows, snapshots, managedTabIds] = await Promise.all([
    browser.windows.getAll({ populate: true }),
    getSnapshots(),
    getManagedTabIds(),
  ]);
  return shapeOpenWindows({
    windows,
    snapshots,
    managedTabIds,
    resolveLazy: resolveLazyTab,
    extensionOrigin: browser.runtime.getURL('/' as never),
    limit,
  });
}

const SEARCH_SCOPES: SearchScope[] = ['saved', 'archived', 'open', 'all'];

export function parseSearchParams(params: unknown): { query: string; scope: SearchScope; limit: number } {
  const p = (params ?? {}) as Partial<SearchTabsParams>;
  if (typeof p.query !== 'string' || queryTokens(p.query).length === 0) {
    throw new BridgeFailure('invalid_params', 'query must contain at least one word to search for.');
  }
  if (p.scope !== undefined && !SEARCH_SCOPES.includes(p.scope)) {
    throw new BridgeFailure('invalid_params', `scope must be one of: ${SEARCH_SCOPES.join(', ')}.`);
  }
  if (p.limit !== undefined && (!Number.isInteger(p.limit) || p.limit < 1)) {
    throw new BridgeFailure('invalid_params', 'limit must be a whole number, 1 or more.');
  }
  return {
    query: p.query,
    scope: p.scope ?? 'all',
    limit: Math.min(p.limit ?? MAX_SEARCH_RESULTS, MAX_SEARCH_RESULTS),
  };
}

export function parseStaleParams(params: unknown): { olderThanMinutes: number | undefined } {
  const { olderThanMinutes } = (params ?? {}) as GetStaleTabsParams;
  if (olderThanMinutes !== undefined && (typeof olderThanMinutes !== 'number' || !(olderThanMinutes > 0))) {
    throw new BridgeFailure('invalid_params', 'olderThanMinutes must be a number of minutes greater than 0.');
  }
  return { olderThanMinutes };
}

export function parseUsageParams(params: unknown): { limit: number } {
  const { limit } = (params ?? {}) as GetUsageStatsParams;
  if (limit !== undefined && (!Number.isInteger(limit) || (limit as number) < 1)) {
    throw new BridgeFailure('invalid_params', 'limit must be a whole number, 1 or more.');
  }
  return { limit: Math.min(limit ?? 5, MAX_USAGE_ITEMS) };
}

export const handlers: HandlerTable = {
  hello: async (): Promise<HelloResult> => ({
    protocol: PROTOCOL_VERSION,
    extensionVersion: browser.runtime.getManifest().version,
  }),
  listSnapshots: async (params) => {
    const { categoryId } = (params ?? {}) as ListSnapshotsParams;
    if (categoryId !== undefined && typeof categoryId !== 'string') {
      throw new BridgeFailure('invalid_params', 'categoryId must be a category id from list_categories.');
    }
    const [snapshots, categories] = await Promise.all([getSnapshots(), getCategories()]);
    if (categoryId !== undefined && !categories.some((c) => c.id === categoryId)) {
      throw new BridgeFailure('not_found', 'No category with that id. Call list_categories for current ids.');
    }
    const selected = categoryId === undefined ? snapshots : getSnapshotsInCategory(snapshots, categoryId);
    return selected.map((s) => summarizeSnapshot(s, categories));
  },
  listCategories: async (): Promise<CategorySummary[]> => {
    const [snapshots, categories] = await Promise.all([getSnapshots(), getCategories()]);
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      snapshotCount: getSnapshotsInCategory(snapshots, c.id).length,
    }));
  },
  listOpenWindows: (): Promise<OpenWindowsResult> => loadOpenWindows(),
  getStaleTabs: async (params): Promise<StaleTabsResult> => {
    const { olderThanMinutes } = parseStaleParams(params);
    const now = Date.now();
    const minutes = olderThanMinutes ?? (await getNudgeStaleMinutes());
    const [open, snoozedKeys] = await Promise.all([
      loadOpenWindows(Number.MAX_SAFE_INTEGER),
      getSnoozedKeys(now),
    ]);
    return findStaleTabs({
      openWindows: open.windows,
      snoozedKeys,
      now,
      thresholdMs: minutes * 60_000,
    });
  },
  getUsageStats: async (params): Promise<UsageStats> => {
    const { limit } = parseUsageParams(params);
    const [snapshots, siteStats, siteTrackingEnabled] = await Promise.all([
      getSnapshots(),
      getSiteStats(),
      getQuickLinksEnabled(),
    ]);
    return buildUsageStats({ snapshots, siteStats, siteTrackingEnabled, now: Date.now(), count: limit });
  },
  restoreSnapshot: async (params): Promise<RestoreSnapshotResult> => {
    const { id } = (params ?? {}) as { id?: unknown };
    if (typeof id !== 'string' || id === '') {
      throw new BridgeFailure('invalid_params', 'id must be a snapshot id from list_snapshots.');
    }
    const snapshot = (await getSnapshots()).find((s) => s.id === id);
    if (!snapshot) {
      throw new BridgeFailure('not_found', 'No snapshot with that id. Call list_snapshots for current ids.');
    }
    if (snapshot.tabs.length === 0) {
      throw new BridgeFailure('invalid_params', `"${snapshot.name}" has no tabs, so there is nothing to open.`);
    }
    const windowId = await restoreSnapshot(snapshot);
    return {
      windowId,
      snapshotName: snapshot.name,
      tabCount: snapshot.tabs.length,
      // a brand-new window can never share the id of the one it was linked to
      reusedExistingWindow: windowId === snapshot.linkedWindowId,
    };
  },
  focusTab: (params): Promise<FocusTabResult> => focusTab(parseTabId(params)),
  saveWindow: (params) => saveWindow(params),
  openUrls: async (params): Promise<OpenUrlsResult> => {
    const { urls, newWindow } = parseOpenUrlsParams(params);
    const snapshotWindowIds = new Set(
      (await getSnapshots()).flatMap((s) => (s.linkedWindowId === null ? [] : [s.linkedWindowId])),
    );
    return openUrls(urls, newWindow, snapshotWindowIds);
  },
  searchTabs: async (params): Promise<SearchTabsResult> => {
    const { query, scope, limit } = parseSearchParams(params);
    const wantsOpen = scope === 'open' || scope === 'all';
    const [snapshots, open] = await Promise.all([
      getSnapshots(),
      wantsOpen ? loadOpenWindows(Number.MAX_SAFE_INTEGER) : Promise.resolve(null),
    ]);
    return searchTabs({ query, scope, snapshots, openWindows: open?.windows ?? [], limit });
  },
  getSnapshot: async (params) => {
    const { id, offset, limit } = parseGetSnapshotParams(params);
    const [snapshots, categories] = await Promise.all([getSnapshots(), getCategories()]);
    const snapshot = snapshots.find((s) => s.id === id);
    if (!snapshot) {
      throw new BridgeFailure('not_found', 'No snapshot with that id. Call list_snapshots for current ids.');
    }
    return describeSnapshot(snapshot, { offset, limit }, categories);
  },
};

/** Routes one request to its handler. Never throws: failures become error
 * responses so the bridge always has something to send back. */
export async function dispatch(
  request: BridgeRequest,
  table: HandlerTable = handlers,
): Promise<BridgeResponse> {
  const handler = Object.hasOwn(table, request.method) ? table[request.method] : undefined;
  if (!handler) {
    return {
      id: request.id,
      error: { code: 'unknown_method', message: `Unknown method: ${request.method}` },
    };
  }
  try {
    return { id: request.id, result: await handler(request.params) };
  } catch (error) {
    return { id: request.id, error: toBridgeError(error) };
  }
}
