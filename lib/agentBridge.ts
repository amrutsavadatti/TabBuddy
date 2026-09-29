import {
  PROTOCOL_VERSION,
  type BridgeError,
  type BridgeRequest,
  type BridgeResponse,
  type ErrorCode,
  type GetSnapshotParams,
  type HelloResult,
  type SnapshotDetail,
  type SnapshotSummary,
  MAX_SNAPSHOT_TABS_PER_CALL,
  MAX_TITLE_LENGTH,
} from '../bridge/protocol';
import { getSnapshots } from './storage';
import type { Snapshot } from './types';

/** A failure a handler wants reported with a specific code. */
export class BridgeFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

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
export function summarizeSnapshot(snapshot: Snapshot): SnapshotSummary {
  return {
    id: snapshot.id,
    name: snapshot.name,
    tabCount: snapshot.tabs.length,
    categoryIds: snapshot.categoryIds,
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
): SnapshotDetail {
  const page = snapshot.tabs.slice(offset, offset + limit);
  return {
    ...summarizeSnapshot(snapshot),
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

export const handlers: HandlerTable = {
  hello: async (): Promise<HelloResult> => ({
    protocol: PROTOCOL_VERSION,
    extensionVersion: browser.runtime.getManifest().version,
  }),
  listSnapshots: async () => (await getSnapshots()).map(summarizeSnapshot),
  getSnapshot: async (params) => {
    const { id, offset, limit } = parseGetSnapshotParams(params);
    const snapshot = (await getSnapshots()).find((s) => s.id === id);
    if (!snapshot) {
      throw new BridgeFailure('not_found', 'No snapshot with that id. Call list_snapshots for current ids.');
    }
    return describeSnapshot(snapshot, { offset, limit });
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
