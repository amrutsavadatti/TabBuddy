/** Wire protocol shared by the extension and the tabbuddy-bridge package.
 * Keep this file free of imports so both sides can use it as-is. */

export const PROTOCOL_VERSION = 1;

export type Method =
  | 'hello'
  | 'listSnapshots'
  | 'getSnapshot'
  | 'listCategories'
  | 'listOpenWindows';

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
