/** Wire protocol shared by the extension and the tabbuddy-bridge package.
 * Keep this file free of imports so both sides can use it as-is. */

export const PROTOCOL_VERSION = 1;

export type Method =
  | 'hello'
  | 'listSnapshots'
  | 'getSnapshot'
  | 'listCategories'
  | 'listOpenWindows'
  | 'searchTabs'
  | 'getStaleTabs'
  | 'getUsageStats';

export type ErrorCode =
  | 'unknown_method'
  | 'not_found'
  | 'invalid_params'
  | 'reserved_name'
  | 'proposal_expired'
  | 'bridge_disabled'
  | 'browser_unreachable'
  | 'internal';

export interface BridgeRequest {
  id: string;
  method: string;
  params?: unknown;
}

export interface BridgeError {
  code: ErrorCode;
  message: string;
}

export type BridgeResponse =
  | { id: string; result: unknown }
  | { id: string; error: BridgeError };

export interface HelloResult {
  protocol: number;
  extensionVersion: string;
}

export interface SnapshotSummary {
  id: string;
  name: string;
  tabCount: number;
  categoryIds: string[];
  /** Names of the categories in `categoryIds` (ids are opaque to an agent). */
  categoryNames: string[];
  usageCount: number;
  pinned: boolean;
  /** True while the snapshot is linked to a live window. */
  isOpen: boolean;
  updatedAt: number;
}

/** Most tabs `getSnapshot` returns per call; keeps replies well under the
 * browser's 1 MB native messaging limit. Page through with `offset`. */
export const MAX_SNAPSHOT_TABS_PER_CALL = 200;
export const MAX_TITLE_LENGTH = 200;

export interface GetSnapshotParams {
  id: string;
  offset?: number;
  limit?: number;
}

export interface SnapshotTabDetail {
  /** Position in the snapshot; how later tools refer to this tab. */
  index: number;
  url: string;
  title: string;
  pinned: boolean;
  /** Title of the native tab group it belongs to, if any. */
  group: string | null;
}

export interface SnapshotDetail extends SnapshotSummary {
  /** Total tabs in the snapshot; `tabs` may hold fewer (see `truncated`). */
  tabCount: number;
  tabs: SnapshotTabDetail[];
  offset: number;
  /** True when more tabs follow; call again with a larger `offset`. */
  truncated: boolean;
}

export interface ListSnapshotsParams {
  /** Only snapshots in this category. */
  categoryId?: string;
}

export interface CategorySummary {
  id: string;
  name: string;
  snapshotCount: number;
}

/** Most tabs `listOpenWindows` returns in one call. */
export const MAX_OPEN_TABS = 500;

export interface OpenTab {
  /** The browser's tab id; valid until the tab or browser closes. */
  id: number;
  title: string;
  /** The real page. A not-yet-loaded lazy tab shows the page it stands for. */
  url: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  /** When the user last looked at the tab (ms since epoch), if known. */
  lastAccessed: number | null;
  /** True if the tab belongs to a snapshot's live window, so TabBuddy never nudges it. */
  managed: boolean;
  /** True for a TabBuddy placeholder that hasn't loaded its page yet. */
  lazy: boolean;
}

export interface OpenWindow {
  windowId: number;
  focused: boolean;
  /** The saved snapshot this window was opened from, if any. */
  snapshot: { id: string; name: string } | null;
  tabs: OpenTab[];
}

export interface OpenWindowsResult {
  windows: OpenWindow[];
  tabCount: number;
  /** True when tabs beyond MAX_OPEN_TABS were left out. */
  truncated: boolean;
}

export type SearchScope = 'saved' | 'archived' | 'open' | 'all';

/** Most matches `searchTabs` returns in one call. */
export const MAX_SEARCH_RESULTS = 50;

export interface SearchTabsParams {
  query: string;
  scope?: SearchScope;
  limit?: number;
}

interface SearchMatchBase {
  url: string;
  title: string;
  /** How many of the query's words this tab matched. */
  score: number;
}

/** A tab stored in a saved snapshot, or in the reserved Archived snapshot. */
export interface SavedSearchMatch extends SearchMatchBase {
  source: 'saved' | 'archived';
  snapshotId: string;
  snapshotName: string;
  /** The tab's position in the snapshot, as get_snapshot reports it. */
  index: number;
}

/** A tab that is open in the browser right now. */
export interface OpenSearchMatch extends SearchMatchBase {
  source: 'open';
  windowId: number;
  tabId: number;
  lastAccessed: number | null;
}

export type SearchMatch = SavedSearchMatch | OpenSearchMatch;

export interface SearchTabsResult {
  matches: SearchMatch[];
  /** All matches found, before the cap. */
  total: number;
  /** True when `total` exceeds the matches returned. */
  truncated: boolean;
}

/** Most stale tabs `getStaleTabs` returns in one call. */
export const MAX_STALE_TABS = 100;
/** Most snapshots or sites `getUsageStats` returns per list. */
export const MAX_USAGE_ITEMS = 20;

export interface GetStaleTabsParams {
  /** Stale means untouched this long. Defaults to the user's nudge setting. */
  olderThanMinutes?: number;
}

export interface StaleTab {
  windowId: number;
  tabId: number;
  title: string;
  url: string;
  lastAccessed: number;
  minutesSinceLastUse: number;
}

export interface StaleTabsResult {
  /** The threshold used, in minutes. */
  olderThanMinutes: number;
  /** Most stale first. */
  tabs: StaleTab[];
  /** All stale tabs found, before the cap. */
  total: number;
  truncated: boolean;
  /** Old tabs that were left out, and why, so a short list can be explained. */
  skipped: {
    /** Belong to a snapshot's live window, so TabBuddy never nudges them. */
    managed: number;
    /** The user chose Keep on the page's address. */
    snoozed: number;
  };
}

export interface GetUsageStatsParams {
  limit?: number;
}

export interface UsageStats {
  /** The snapshots opened most, most first. Archived and never-opened ones are left out. */
  topSnapshots: { id: string; name: string; usageCount: number; pinned: boolean; updatedAt: number }[];
  /** Most visited sites by domain (no pages or URLs), most first. */
  topSites: { domain: string; score: number }[];
  /** False when the user has turned off Quick links; no sites are reported then. */
  siteTrackingEnabled: boolean;
}
