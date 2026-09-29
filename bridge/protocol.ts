/** Wire protocol shared by the extension and the tabbuddy-bridge package.
 * Keep this file free of imports so both sides can use it as-is. */

export const PROTOCOL_VERSION = 1;

export type Method = 'hello' | 'listSnapshots';

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
  usageCount: number;
  pinned: boolean;
  /** True while the snapshot is linked to a live window. */
  isOpen: boolean;
  updatedAt: number;
}
