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
  | 'getUsageStats'
  | 'restoreSnapshot'
  | 'focusTab'
  | 'openUrls'
  | 'saveWindow'
  | 'createSnapshotFromUrls'
  | 'updateSnapshotFromWindow'
  | 'renameSnapshot'
  | 'tagSnapshots'
  | 'findDuplicateTabs'
  | 'summarizeWindow'
  | 'addTabsToSnapshot'
  | 'proposeArchiveTabs'
  | 'confirmProposal';

export type ErrorCode =
  | 'unknown_method'
  | 'not_found'
  | 'invalid_params'
  | 'reserved_name'
  | 'proposal_expired'
  | 'tabs_changed'
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

export interface RestoreSnapshotParams {
  id: string;
}

export interface RestoreSnapshotResult {
  windowId: number;
  snapshotName: string;
  tabCount: number;
  /** True if the snapshot was already open and its window was brought to the front. */
  reusedExistingWindow: boolean;
}

export interface FocusTabParams {
  tabId: number;
}

export interface FocusTabResult {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
}

/** Most URLs `openUrls` opens in one call. */
export const MAX_OPEN_URLS = 25;

export interface OpenUrlsParams {
  urls: string[];
  /** Open in a new window instead of the current one. */
  newWindow?: boolean;
}

export interface OpenUrlsResult {
  windowId: number;
  /** True if the pages went into a new window: asked for, or because the
   * window the user used last belongs to a saved snapshot (or is incognito). */
  openedInNewWindow: boolean;
  tabs: { tabId: number; url: string }[];
}

/** Longest snapshot name `saveWindow` accepts. */
export const MAX_SNAPSHOT_NAME_LENGTH = 100;

export interface SaveWindowParams {
  name: string;
  /** Defaults to the window the user used last. */
  windowId?: number;
  categoryIds?: string[];
}

export interface SaveWindowResult {
  snapshotId: string;
  /** The name it was saved under; "(2)" is added if the name was taken. */
  name: string;
  tabCount: number;
  windowId: number;
  /** True if the snapshot is tied to the window (its tabs are then protected from nudges). */
  linkedToWindow: boolean;
  /** Set when the window already belonged to a snapshot: the new one is an unlinked copy. */
  windowAlreadySavedAs: string | null;
}

/** Most URLs `createSnapshotFromUrls` accepts. */
export const MAX_SNAPSHOT_URLS = 50;
export const MAX_CATEGORY_NAME_LENGTH = 50;
/** Most category names one call may use. */
export const MAX_CATEGORY_NAMES = 10;
/** Most snapshots `tagSnapshots` tags in one call. */
export const MAX_TAG_TARGETS = 50;

/** A category a call used, and whether the call had to create it. */
export interface CategoryUse {
  id: string;
  name: string;
  created: boolean;
}

export interface CreateSnapshotFromUrlsParams {
  name: string;
  urls: (string | { url: string; title?: string })[];
  /** Category names (matched case-insensitively; created if missing). */
  categoryNames?: string[];
}

export interface CreateSnapshotFromUrlsResult {
  snapshotId: string;
  /** The name it was saved under; "(2)" is added if the name was taken. */
  name: string;
  tabCount: number;
  /** Entries that were not saved, and why (invalid address, or a duplicate). */
  skipped: { value: string; reason: string }[];
  categories: CategoryUse[];
}

export interface UpdateSnapshotFromWindowParams {
  id: string;
}

export interface UpdateSnapshotFromWindowResult {
  id: string;
  name: string;
  /** Tabs it held before; the snapshot now matches its window, so closed tabs are gone from it. */
  previousTabCount: number;
  tabCount: number;
}

export interface RenameSnapshotParams {
  id: string;
  name: string;
}

export interface RenameSnapshotResult {
  id: string;
  previousName: string;
  /** The name it now has; "(2)" is added if another snapshot uses the name. */
  name: string;
}

export interface TagSnapshotsParams {
  snapshotIds: string[];
  categoryNames: string[];
}

export interface TagSnapshotsResult {
  categories: CategoryUse[];
  tagged: number;
}

/** Most duplicate groups `findDuplicateTabs` returns in one call. */
export const MAX_DUPLICATE_GROUPS = 50;

export interface FindDuplicateTabsParams {
  /** Only look within this window. Default: across all open windows. */
  windowId?: number;
}

export interface DuplicateTab {
  tabId: number;
  windowId: number;
  title: string;
  lastAccessed: number | null;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  managed: boolean;
}

export interface DuplicateGroup {
  /** The address of the tab to keep. */
  url: string;
  /** The tab worth keeping: the active, pinned, snapshot-managed, playing or most recently used one. */
  keepTabId: number;
  /** All the tabs on this page, the one to keep first. */
  tabs: DuplicateTab[];
  /** The others: what could be closed. */
  extraTabIds: number[];
}

export interface FindDuplicateTabsResult {
  groups: DuplicateGroup[];
  /** All duplicate groups found, before the cap. */
  groupCount: number;
  /** Tabs beyond the first in every group, i.e. how many could go. */
  extraTabCount: number;
  truncated: boolean;
}

export interface SummarizeWindowParams {
  /** Default: the window the user used last. */
  windowId?: number;
}

/** Most sites listed in a window summary; the rest are counted in otherSites. */
export const MAX_SUMMARY_SITES = 15;
export const MAX_SUMMARY_FLAGGED = 20;
export const MAX_SUMMARY_SAVED_ELSEWHERE = 50;

export interface SiteSummary {
  domain: string;
  tabCount: number;
  /** Tabs from this site not used for over a day. */
  idleOverDay: number;
  /** A few titles, to show what the tabs are. */
  sampleTitles: string[];
  tabIds: number[];
}

export interface WindowSummary {
  windowId: number;
  focused: boolean;
  /** The saved snapshot this window was opened from, if any. */
  snapshot: { id: string; name: string } | null;
  tabCount: number;
  counts: {
    pinned: number;
    playing: number;
    /** Belong to a snapshot's live window. */
    managed: number;
    /** TabBuddy placeholders that have not loaded yet. */
    lazy: number;
    /** Empty "new tab" pages. */
    blank: number;
  };
  /** How long since the user last looked at each tab; every tab is in exactly one bucket. */
  idle: { underHour: number; underDay: number; underWeek: number; overWeek: number; unknown: number };
  /** The biggest sites first; each with the ids of its tabs. */
  sites: SiteSummary[];
  otherSites: { sites: number; tabs: number };
  /** Same-page tabs in this window; find_duplicate_tabs has the details. */
  duplicates: { groups: number; extraTabs: number };
  /** Open tabs whose page is already saved in another snapshot (so closing them loses nothing). */
  savedElsewhere: { count: number; tabs: { tabId: number; snapshotName: string }[] };
  /** Tabs that look like they might hold work in progress (an email being written, a form, a checkout). A guess from the address and title only. */
  mayHaveUnsavedWork: { total: number; tabs: { tabId: number; title: string; reason: string }[] };
}

/** Most tabs and links `addTabsToSnapshot` adds in one call. */
export const MAX_ADD_TABS = 50;

export interface AddTabsToSnapshotParams {
  /** The snapshot to add to. */
  id: string;
  /** Open tabs to add, from list_open_windows or search_tabs. */
  tabIds?: number[];
  /** Links to add, as URLs or {url, title}. */
  urls?: (string | { url: string; title?: string })[];
}

export interface AddTabsToSnapshotResult {
  snapshotId: string;
  name: string;
  /** What was added, with each tab's position in the snapshot. */
  added: { index: number; url: string; title: string }[];
  /** Entries that were not added, and why. */
  skipped: { value: string; reason: string }[];
  /** How many tabs the snapshot holds now. */
  tabCount: number;
  /** True if the snapshot is open in a window. Pressing Update on it later would replace its saved tabs with that window's, dropping what was added. */
  snapshotIsOpen: boolean;
}

/** Most tabs one proposal may cover. */
export const MAX_PROPOSAL_TABS = 100;
/** How long a proposal can be confirmed for. */
export const PROPOSAL_TTL_MS = 5 * 60_000;

export interface ProposeArchiveTabsParams {
  tabIds: number[];
  /** Also propose pinned tabs, tabs playing sound and tabs in a snapshot's live window. Only when the user explicitly asked for those tabs. */
  includeProtected?: boolean;
}

export interface ProposalTab {
  tabId: number;
  windowId: number;
  title: string;
  /** The real page (a lazy placeholder shows the page it stands for). */
  url: string;
}

export interface ProposalResult {
  proposalId: string;
  action: 'archive';
  /** One sentence describing what confirming will do. */
  summary: string;
  /** When the proposal stops being confirmable (ms since epoch). */
  expiresAt: number;
  expiresInSeconds: number;
  /** What would be archived: show these titles to the user. */
  tabs: ProposalTab[];
  /** Tabs left out, and why. */
  skipped: { tabId: number; reason: string }[];
}

export interface ConfirmProposalParams {
  proposalId: string;
}

export interface ConfirmArchiveResult {
  action: 'archive';
  /** Tabs saved to the Archived snapshot. */
  archived: number;
  /** Tabs actually closed (a tab the user already closed doesn't count). */
  closed: number;
  archivedSnapshot: { id: string; tabCount: number };
}

export type ConfirmProposalResult = ConfirmArchiveResult;
