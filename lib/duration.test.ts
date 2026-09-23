import { describe, expect, it } from 'vitest';
import { formatDurationShort, fromMinutes, toMinutes } from './duration';

describe('toMinutes', () => {
  it('converts each unit', () => {
    expect(toMinutes(5, 'minutes')).toBe(5);
    expect(toMinutes(2, 'hours')).toBe(120);
    expect(toMinutes(3, 'days')).toBe(4320);
  });
});

describe('fromMinutes', () => {
  it('uses the largest unit that divides evenly', () => {
    expect(fromMinutes(5)).toEqual({ value: 5, unit: 'minutes' });
    expect(fromMinutes(90)).toEqual({ value: 90, unit: 'minutes' });
    expect(fromMinutes(120)).toEqual({ value: 2, unit: 'hours' });
    expect(fromMinutes(1440)).toEqual({ value: 1, unit: 'days' });
    expect(fromMinutes(2880)).toEqual({ value: 2, unit: 'days' });
  });
});

describe('formatDurationShort', () => {
  it('formats compactly', () => {
    expect(formatDurationShort(20)).toBe('20m');
    expect(formatDurationShort(60)).toBe('1h');
    expect(formatDurationShort(1440)).toBe('1d');
  });
});
