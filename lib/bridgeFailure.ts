import type { ErrorCode } from '../bridge/protocol';

/** A failure a handler wants reported with a specific code. */
export class BridgeFailure extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
