import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/test/factories';
import { addSnapshot, getSnapshots } from './storage';
import { updateSnapshotFromLiveWindow } from './update';

describe('updateSnapshotFromLiveWindow', () => {
  it('returns false when the snapshot has no linked window', async () => {
    const snapshot = makeSnapshot({ linkedWindowId: null });
    await addSnapshot(snapshot);
    expect(await updateSnapshotFromLiveWindow(snapshot)).toBe(false);
  });

  it('returns false when the linked window no longer exists', async () => {
    const snapshot = makeSnapshot({ linkedWindowId: 999 });
    await addSnapshot(snapshot);
    vi.spyOn(browser.windows, 'get').mockRejectedValue(new Error('No such window'));

    expect(await updateSnapshotFromLiveWindow(snapshot)).toBe(false);
  });

  it('re-captures tabs from the live window and overwrites the snapshot', async () => {
    const window = (await browser.windows.create({}))!;
    const snapshot = makeSnapshot({ linkedWindowId: window.id!, tabs: [], usageCount: 0 });
    await addSnapshot(snapshot);

    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://fresh.com/', title: 'Fresh', pinned: false, groupId: -1 },
    ] as any);
    vi.spyOn(browser.tabGroups as any, 'query').mockResolvedValue([]);

    const result = await updateSnapshotFromLiveWindow(snapshot);
    expect(result).toBe(true);

    const [updated] = await getSnapshots();
    expect(updated?.tabs).toEqual([
      { url: 'https://fresh.com/', title: 'Fresh', favIconUrl: undefined, pinned: false, groupIndex: null },
    ]);
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(snapshot.updatedAt);
  });
});
