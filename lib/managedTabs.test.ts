import { describe, expect, it } from 'vitest';
import {
  clearManagedTabs,
  getManagedTabIds,
  setManagedTabs,
  unmanageSnapshots,
  unmanageTab,
} from './managedTabs';

describe('managed tab registry', () => {
  it('is empty by default', async () => {
    expect((await getManagedTabIds()).size).toBe(0);
  });

  it('records tab ids for a snapshot', async () => {
    await setManagedTabs('snap-1', [1, 2, 3]);
    expect([...(await getManagedTabIds())].sort()).toEqual([1, 2, 3]);
  });

  it('replaces a snapshot\'s previous tab set', async () => {
    await setManagedTabs('snap-1', [1, 2]);
    await setManagedTabs('snap-1', [3]);
    expect([...(await getManagedTabIds())]).toEqual([3]);
  });

  it('combines tab ids across snapshots', async () => {
    await setManagedTabs('snap-1', [1, 2]);
    await setManagedTabs('snap-2', [3]);
    expect([...(await getManagedTabIds())].sort()).toEqual([1, 2, 3]);
  });

  it('removes a single tab without touching the rest', async () => {
    await setManagedTabs('snap-1', [1, 2, 3]);
    await unmanageTab(2);
    expect([...(await getManagedTabIds())].sort()).toEqual([1, 3]);
  });

  it('unmanaging an unknown tab is a no-op', async () => {
    await setManagedTabs('snap-1', [1]);
    await unmanageTab(99);
    expect([...(await getManagedTabIds())]).toEqual([1]);
  });

  it('removes all tabs of the given snapshots', async () => {
    await setManagedTabs('snap-1', [1, 2]);
    await setManagedTabs('snap-2', [3]);
    await unmanageSnapshots(['snap-1']);
    expect([...(await getManagedTabIds())]).toEqual([3]);
  });

  it('clears everything', async () => {
    await setManagedTabs('snap-1', [1, 2]);
    await clearManagedTabs();
    expect((await getManagedTabIds()).size).toBe(0);
  });

  it('does not touch persistent snapshot storage', async () => {
    await setManagedTabs('snap-1', [1]);
    const local = await browser.storage.local.get(null);
    expect(local).toEqual({});
  });
});
