import { describe, expect, it } from 'vitest';
import { getAccentColor } from './color';

describe('getAccentColor', () => {
  it('is deterministic for the same name', () => {
    expect(getAccentColor('Job Hunt')).toBe(getAccentColor('Job Hunt'));
  });

  it('returns a valid hsl() string with hue in range', () => {
    const color = getAccentColor('Entertainment');
    const match = color.match(/^hsl\((\d+) 70% 55%\)$/);
    expect(match).not.toBeNull();
    const hue = Number(match![1]);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it('produces different colors for different names (usually)', () => {
    expect(getAccentColor('Job Hunt')).not.toBe(getAccentColor('Entertainment'));
  });

  it('handles the empty string without throwing', () => {
    expect(() => getAccentColor('')).not.toThrow();
  });
});
