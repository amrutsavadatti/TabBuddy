/** Chrome/Firefox native messaging framing: a 4-byte little-endian length,
 * then that many bytes of UTF-8 JSON. */

/** Largest message the browser accepts from a native host. */
export const MAX_TO_BROWSER_BYTES = 1024 * 1024;
/** Largest message a host may receive from the browser (the browser's own limit). */
export const MAX_FROM_BROWSER_BYTES = 64 * 1024 * 1024;

export function encodeFrame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  if (body.length > MAX_TO_BROWSER_BYTES) {
    throw new RangeError(
      `Message is ${body.length} bytes; the browser accepts at most ${MAX_TO_BROWSER_BYTES}.`,
    );
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Reassembles frames from arbitrary stdin chunks. */
export class FrameDecoder {
  private buffered: Buffer = Buffer.alloc(0);

  /** Feeds a chunk and returns every message that is now complete. */
  push(chunk: Buffer): unknown[] {
    this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
    const messages: unknown[] = [];
    for (;;) {
      if (this.buffered.length < 4) break;
      const length = this.buffered.readUInt32LE(0);
      if (length > MAX_FROM_BROWSER_BYTES) {
        throw new RangeError(`Frame of ${length} bytes exceeds the native messaging limit.`);
      }
      if (this.buffered.length < 4 + length) break;
      const body = this.buffered.subarray(4, 4 + length);
      this.buffered = this.buffered.subarray(4 + length);
      messages.push(JSON.parse(body.toString('utf8')));
    }
    return messages;
  }
}

/** Newline-delimited JSON, used on the local socket. */
export class LineDecoder {
  private pending = '';

  /** Returns the raw text of each complete, non-empty line. */
  push(chunk: Buffer | string): string[] {
    this.pending += chunk.toString();
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    return lines.map((line) => line.trim()).filter((line) => line.length > 0);
  }
}
