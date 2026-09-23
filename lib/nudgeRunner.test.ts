import { describe, expect, it, vi } from 'vitest';
import { setManagedTabs } from './managedTabs';
import { snoozeTab } from './nudgeState';
import { runNudgeScan } from './nudgeRunner';

const DAY = 24 * 60 * 60 * 1000;
const staleTab = (id: number, url = `https://t${id}.com/`) => ({
  id,
  url,
  title: `Tab ${id}`,
  lastAccessed: Date.now() - 2 * DAY,
  pinned: false,
  audible: false,
});

function mockTabs(tabs: ReturnType<typeof staleTab>[]) {
  vi.spyOn(browser.tabs, 'query').mockResolvedValue(tabs as any);
  vi.spyOn(console, 'log').mockImplementation(() => {});
}

describe('runNudgeScan', () => {
  it('returns stale, unpinned tabs', async () => {
    mockTabs([staleTab(1), staleTab(2)]);
    const result = await runNudgeScan();
    expect(result.map((t) => t.id)).toEqual([1, 2]);
  });

  it('skips tabs owned by a snapshot, even after they navigated elsewhere', async () => {
    mockTabs([staleTab(1, 'https://navigated-away.com/'), staleTab(2)]);
    await setManagedTabs('snap-1', [1]);
    const result = await runNudgeScan();
    expect(result.map((t) => t.id)).toEqual([2]);
  });

  it('still nudges unmanaged tabs opened in a snapshot window later', async () => {
    mockTabs([staleTab(1), staleTab(5)]);
    await setManagedTabs('snap-1', [1]);
    const result = await runNudgeScan();
    expect(result.map((t) => t.id)).toEqual([5]);
  });

  it('skips snoozed tabs', async () => {
    mockTabs([staleTab(1), staleTab(2)]);
    await snoozeTab(1);
    const result = await runNudgeScan();
    expect(result.map((t) => t.id)).toEqual([2]);
  });
});
