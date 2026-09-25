import { describe, expect, it } from 'vitest';
import { computePeekPlacement } from './peekPosition';

const viewport = { width: 1200, height: 800 };
const panel = { width: 320, height: 200 };

describe('computePeekPlacement', () => {
  it('centres the panel under a card that has room below', () => {
    const card = { left: 400, top: 100, width: 260, height: 180 };
    const p = computePeekPlacement(card, panel, viewport);
    expect(p.placement).toBe('below');
    expect(p.left).toBe(530 - 160);
    expect(p.top).toBe(100 + 180 + 12);
    expect(p.arrowLeft).toBe(160);
  });

  it('flips above the card when there is no room below', () => {
    const card = { left: 400, top: 560, width: 260, height: 200 };
    const p = computePeekPlacement(card, panel, viewport);
    expect(p.placement).toBe('above');
    expect(p.top).toBe(560 - 12 - 200);
  });

  it('centres over the card when neither side has room', () => {
    const tall = { width: 320, height: 700 };
    const card = { left: 400, top: 200, width: 260, height: 300 };
    const p = computePeekPlacement(card, tall, viewport);
    expect(p.placement).toBe('center');
    expect(p.top).toBeGreaterThanOrEqual(12);
    expect(p.top + tall.height).toBeLessThanOrEqual(viewport.height - 12);
  });

  it('keeps the panel inside the left and right edges', () => {
    const left = computePeekPlacement({ left: 0, top: 100, width: 200, height: 150 }, panel, viewport);
    expect(left.left).toBe(12);
    const right = computePeekPlacement({ left: 1000, top: 100, width: 200, height: 150 }, panel, viewport);
    expect(right.left).toBe(1200 - 320 - 12);
  });

  it('keeps the pointer inside the panel and pointing at the card', () => {
    const p = computePeekPlacement({ left: 0, top: 100, width: 100, height: 150 }, panel, viewport);
    expect(p.arrowLeft).toBeGreaterThanOrEqual(16);
    expect(p.arrowLeft).toBeLessThanOrEqual(panel.width - 16);
    expect(p.left + p.arrowLeft).toBeCloseTo(50, -1);
  });

  it('never returns a position off screen even for a viewport narrower than the panel', () => {
    const p = computePeekPlacement(
      { left: 10, top: 10, width: 100, height: 100 },
      panel,
      { width: 300, height: 800 },
    );
    expect(p.left).toBe(12);
  });
});
