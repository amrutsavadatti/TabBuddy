import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/test/factories';
import { getDisplayOrder } from './sort';

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
