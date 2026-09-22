import { describe, expect, it } from 'vitest';
import { formatRelativeTime } from './relativeTime';

describe('formatRelativeTime', () => {
  const ago = (ms: number) => Date.now() - ms;

  it('says "just now" for less than a minute', () => {
    expect(formatRelativeTime(ago(30_000))).toBe('just now');
  });

  it('formats minutes with correct pluralization', () => {
    expect(formatRelativeTime(ago(60_000))).toBe('1 minute ago');
    expect(formatRelativeTime(ago(5 * 60_000))).toBe('5 minutes ago');
  });

  it('formats hours with correct pluralization', () => {
    expect(formatRelativeTime(ago(60 * 60_000))).toBe('1 hour ago');
    expect(formatRelativeTime(ago(3 * 60 * 60_000))).toBe('3 hours ago');
  });

  it('formats days with correct pluralization', () => {
    const day = 24 * 60 * 60_000;
    expect(formatRelativeTime(ago(day))).toBe('1 day ago');
    expect(formatRelativeTime(ago(5 * day))).toBe('5 days ago');
  });

  it('formats months with correct pluralization', () => {
    const month = 30 * 24 * 60 * 60_000;
    expect(formatRelativeTime(ago(month))).toBe('1 month ago');
    expect(formatRelativeTime(ago(3 * month))).toBe('3 months ago');
  });

  it('formats years with correct pluralization', () => {
    const year = 365 * 24 * 60 * 60_000;
    expect(formatRelativeTime(ago(year))).toBe('1 year ago');
    expect(formatRelativeTime(ago(2 * year))).toBe('2 years ago');
  });
});
