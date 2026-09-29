import { MAX_REQUEST_LENGTH } from '../bridge/protocol';

/** The `request` phrase an agent passes to say what the user asked for. It only
 * groups entries in the activity log, so it is read leniently: anything that is
 * not a non-blank string is ignored, spaces are tidied, and a long one is cut. */
export function parseRequest(params: unknown): string | undefined {
  const value = (params as { request?: unknown } | null | undefined)?.request;
  if (typeof value !== 'string') return undefined;
  const tidy = value.trim().replace(/\s+/g, ' ');
  return tidy === '' ? undefined : tidy.slice(0, MAX_REQUEST_LENGTH);
}
