import {
  PROTOCOL_VERSION,
  type BridgeError,
  type BridgeRequest,
  type BridgeResponse,
  type ErrorCode,
  type HelloResult,
  type SnapshotSummary,
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

export const handlers: HandlerTable = {
  hello: async (): Promise<HelloResult> => ({
    protocol: PROTOCOL_VERSION,
    extensionVersion: browser.runtime.getManifest().version,
  }),
  listSnapshots: async () => (await getSnapshots()).map(summarizeSnapshot),
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
