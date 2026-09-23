import { describe, expect, it } from 'vitest';
import { findNudgeCandidates } from './nudgeScan';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe('findNudgeCandidates', () => {
  it('flags an inactive, unpinned, non-audible tab', () => {
    const tabs = [{ id: 1, lastAccessed: NOW - DAY - 1 }];
    expect(findNudgeCandidates(tabs, () => false, NOW)).toEqual([1]);
  });

  it('excludes a recently-active tab', () => {
    const tabs = [{ id: 1, lastAccessed: NOW - 1000 }];
    expect(findNudgeCandidates(tabs, () => false, NOW)).toEqual([]);
  });

  it('excludes a pinned tab even if inactive', () => {
    const tabs = [{ id: 1, lastAccessed: NOW - DAY - 1, pinned: true }];
    expect(findNudgeCandidates(tabs, () => false, NOW)).toEqual([]);
  });

  it('excludes an audible tab even if inactive', () => {
    const tabs = [{ id: 1, lastAccessed: NOW - DAY - 1, audible: true }];
    expect(findNudgeCandidates(tabs, () => false, NOW)).toEqual([]);
  });

  it('excludes a snoozed tab even if otherwise a candidate', () => {
    const tabs = [{ id: 1, lastAccessed: NOW - DAY - 1 }];
    expect(findNudgeCandidates(tabs, (id) => id === 1, NOW)).toEqual([]);
  });

  it('returns multiple candidates and skips non-candidates in a mixed list', () => {
    const tabs = [
      { id: 1, lastAccessed: NOW - DAY - 1 }, // candidate
      { id: 2, lastAccessed: NOW - 1000 }, // too recent
      { id: 3, lastAccessed: NOW - DAY - 1, pinned: true }, // pinned
      { id: 4, lastAccessed: NOW - DAY - 1 }, // candidate
    ];
    expect(findNudgeCandidates(tabs, () => false, NOW)).toEqual([1, 4]);
  });

  it('respects a custom inactivity threshold', () => {
    const oneHour = 60 * 60 * 1000;
    const tabs = [{ id: 1, lastAccessed: NOW - oneHour - 1 }];
    expect(findNudgeCandidates(tabs, () => false, NOW, oneHour)).toEqual([1]);
  });
});
