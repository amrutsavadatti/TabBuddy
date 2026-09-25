import { describe, expect, it, vi } from 'vitest';
import { setManagedTabs } from './managedTabs';
import { snoozeUrl } from './nudgeState';
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

  it('skips every open tab on a snoozed address, even duplicates in other windows', async () => {
    mockTabs([staleTab(1, 'https://same.com/x'), staleTab(2, 'https://same.com/x'), staleTab(3)]);
    await snoozeUrl('https://same.com/x');
    const result = await runNudgeScan();
    expect(result.map((t) => t.id)).toEqual([3]);
  });

  it('still skips a snoozed page after the browser restarts and tab ids change', async () => {
    await snoozeUrl('https://t1.com/');
    // same page, but Chrome has handed it a different tab id
    mockTabs([staleTab(500, 'https://t1.com/'), staleTab(501)]);
    const result = await runNudgeScan();
    expect(result.map((t) => t.id)).toEqual([501]);
  });

  it('skips snoozed tabs', async () => {
    mockTabs([staleTab(1), staleTab(2)]);
    await snoozeUrl('https://t1.com/');
    const result = await runNudgeScan();
    expect(result.map((t) => t.id)).toEqual([2]);
  });
});
