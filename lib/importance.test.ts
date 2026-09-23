import { describe, expect, it } from 'vitest';
import { DEFAULT_INACTIVITY_THRESHOLD_MS, scoreTabImportance } from './importance';

const NOW = 1_000_000_000_000;

describe('scoreTabImportance', () => {
  it('treats a pinned tab as important regardless of inactivity', () => {
    const result = scoreTabImportance(
      { pinned: true, lastAccessed: NOW - DEFAULT_INACTIVITY_THRESHOLD_MS * 10 },
      NOW,
    );
    expect(result).toBe('important');
  });

  it('treats an audible tab as important regardless of inactivity', () => {
    const result = scoreTabImportance(
      { audible: true, lastAccessed: NOW - DEFAULT_INACTIVITY_THRESHOLD_MS * 10 },
      NOW,
    );
    expect(result).toBe('important');
  });

  it('treats a missing lastAccessed as important (safe default)', () => {
    expect(scoreTabImportance({}, NOW)).toBe('important');
  });

  it('treats a recently-accessed tab as important', () => {
    const result = scoreTabImportance(
      { lastAccessed: NOW - 60_000 }, // 1 minute ago
      NOW,
    );
    expect(result).toBe('important');
  });

  it('treats a tab untouched past the threshold as unimportant', () => {
    const result = scoreTabImportance(
      { lastAccessed: NOW - DEFAULT_INACTIVITY_THRESHOLD_MS - 1 },
      NOW,
    );
    expect(result).toBe('unimportant');
  });

  it('treats a tab exactly at the threshold as unimportant', () => {
    const result = scoreTabImportance(
      { lastAccessed: NOW - DEFAULT_INACTIVITY_THRESHOLD_MS },
      NOW,
    );
    expect(result).toBe('unimportant');
  });

  it('respects a custom inactivity threshold', () => {
    const oneHour = 60 * 60 * 1000;
    const result = scoreTabImportance(
      { lastAccessed: NOW - oneHour - 1 },
      NOW,
      oneHour,
    );
    expect(result).toBe('unimportant');
  });
});
