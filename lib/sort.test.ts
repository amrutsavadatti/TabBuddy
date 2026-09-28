import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/test/factories';
import { getDisplayOrder, getMostUsedSnapshots } from './sort';

describe('getDisplayOrder', () => {
  it('separates pinned and unpinned snapshots', () => {
    const pinned = makeSnapshot({ pinned: true, pinnedPosition: 0 });
    const unpinned = makeSnapshot({ pinned: false });
    const { pinned: pinnedOut, unpinned: unpinnedOut } = getDisplayOrder([
      pinned,
      unpinned,
    ]);
    expect(pinnedOut).toEqual([pinned]);
    expect(unpinnedOut).toEqual([unpinned]);
  });

  it('orders pinned snapshots by pinnedPosition regardless of sort option', () => {
    const first = makeSnapshot({ pinned: true, pinnedPosition: 1, usageCount: 0 });
    const second = makeSnapshot({ pinned: true, pinnedPosition: 0, usageCount: 100 });
    const { pinned } = getDisplayOrder([first, second], 'mfu');
    expect(pinned).toEqual([second, first]);
  });

  it('sorts unpinned by most-frequently-used by default', () => {
    const low = makeSnapshot({ usageCount: 1 });
    const high = makeSnapshot({ usageCount: 10 });
    const { unpinned } = getDisplayOrder([low, high]);
    expect(unpinned).toEqual([high, low]);
  });

  it('sorts unpinned by recently updated', () => {
    const older = makeSnapshot({ updatedAt: 1000 });
    const newer = makeSnapshot({ updatedAt: 2000 });
    const { unpinned } = getDisplayOrder([older, newer], 'recentlyUpdated');
    expect(unpinned).toEqual([newer, older]);
  });

  it('sorts unpinned by recently created', () => {
    const older = makeSnapshot({ createdAt: 1000 });
    const newer = makeSnapshot({ createdAt: 2000 });
    const { unpinned } = getDisplayOrder([older, newer], 'recentlyCreated');
    expect(unpinned).toEqual([newer, older]);
  });
});

describe('getMostUsedSnapshots', () => {
  it('picks the highest usage count first', () => {
    const low = makeSnapshot({ usageCount: 1 });
    const high = makeSnapshot({ usageCount: 10 });
    expect(getMostUsedSnapshots([low, high], 3)).toEqual([high, low]);
  });

  it('breaks a tie in usage by most recently updated', () => {
    const older = makeSnapshot({ usageCount: 5, updatedAt: 1000 });
    const newer = makeSnapshot({ usageCount: 5, updatedAt: 2000 });
    expect(getMostUsedSnapshots([older, newer], 2)).toEqual([newer, older]);
  });

  it('leaves out snapshots that have never been opened', () => {
    const unused = makeSnapshot({ usageCount: 0 });
    const used = makeSnapshot({ usageCount: 1 });
    expect(getMostUsedSnapshots([unused, used], 3)).toEqual([used]);
  });

  it('leaves out the Archived snapshot even if it has usage', () => {
    const archived = makeSnapshot({ name: 'Archived', usageCount: 50 });
    const normal = makeSnapshot({ usageCount: 1 });
    expect(getMostUsedSnapshots([archived, normal], 3)).toEqual([normal]);
  });

  it('returns fewer than requested rather than padding the list', () => {
    const only = makeSnapshot({ usageCount: 1 });
    expect(getMostUsedSnapshots([only], 3)).toEqual([only]);
  });

  it('is empty when nothing has been opened yet', () => {
    expect(getMostUsedSnapshots([makeSnapshot({ usageCount: 0 })], 3)).toEqual([]);
  });
});
