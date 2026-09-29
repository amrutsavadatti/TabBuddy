import { describe, expect, it } from 'vitest';
import {
  encodeFrame,
  FrameDecoder,
  LineDecoder,
  MAX_FROM_BROWSER_BYTES,
  MAX_TO_BROWSER_BYTES,
} from './framing.js';

describe('encodeFrame', () => {
  it('prefixes the JSON body with its little-endian byte length', () => {
    const frame = encodeFrame({ a: 'é' });
    const body = Buffer.from('{"a":"é"}', 'utf8');
    expect(frame.readUInt32LE(0)).toBe(body.length); // bytes, not characters
    expect(frame.subarray(4).equals(body)).toBe(true);
  });

  it('accepts a body of exactly 1 MB and rejects one byte more', () => {
    const overhead = Buffer.byteLength(JSON.stringify({ s: '' }));
    const exact = { s: 'x'.repeat(MAX_TO_BROWSER_BYTES - overhead) };
    expect(encodeFrame(exact).length).toBe(4 + MAX_TO_BROWSER_BYTES);
    expect(() => encodeFrame({ s: `${exact.s}x` })).toThrow(RangeError);
  });
});

describe('FrameDecoder', () => {
  it('decodes a message split into single bytes', () => {
    const decoder = new FrameDecoder();
    const frame = encodeFrame({ id: '1', method: 'hello' });
    const out: unknown[] = [];
    for (const byte of frame) out.push(...decoder.push(Buffer.from([byte])));
    expect(out).toEqual([{ id: '1', method: 'hello' }]);
  });

  it('decodes several messages arriving in one chunk', () => {
    const decoder = new FrameDecoder();
    const chunk = Buffer.concat([encodeFrame({ n: 1 }), encodeFrame({ n: 2 }), encodeFrame({ n: 3 })]);
    expect(decoder.push(chunk)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  });

  it('keeps a partial trailing message for the next chunk', () => {
    const decoder = new FrameDecoder();
    const second = encodeFrame({ n: 2 });
    const chunk = Buffer.concat([encodeFrame({ n: 1 }), second.subarray(0, 6)]);
    expect(decoder.push(chunk)).toEqual([{ n: 1 }]);
    expect(decoder.push(second.subarray(6))).toEqual([{ n: 2 }]);
  });

  it('round-trips a message at exactly 1 MB', () => {
    const overhead = Buffer.byteLength(JSON.stringify({ s: '' }));
    const message = { s: 'y'.repeat(MAX_TO_BROWSER_BYTES - overhead) };
    expect(new FrameDecoder().push(encodeFrame(message))).toEqual([message]);
  });

  it('rejects a length beyond the native messaging limit', () => {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(MAX_FROM_BROWSER_BYTES + 1, 0);
    expect(() => new FrameDecoder().push(header)).toThrow(RangeError);
  });
});

describe('LineDecoder', () => {
  it('returns complete lines and holds back the unfinished one', () => {
    const decoder = new LineDecoder();
    expect(decoder.push('{"a":1}\n{"b"')).toEqual(['{"a":1}']);
    expect(decoder.push(':2}\n\n')).toEqual(['{"b":2}']);
  });
});
