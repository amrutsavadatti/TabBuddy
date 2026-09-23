import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot, makeTab } from '@/test/factories';
import { getManagedTabIds, setManagedTabs } from './managedTabs';
import { clearAllWindowLinks, reconcileAfterReload } from './reconcile';
import { addSnapshots, getSnapshots } from './storage';

describe('clearAllWindowLinks', () => {
  it('unlinks every snapshot and empties the registry', async () => {
    const a = makeSnapshot({ linkedWindowId: 3 });
    const b = makeSnapshot({ linkedWindowId: null });
    await addSnapshots([a, b]);
    await setManagedTabs(a.id, [1, 2]);

    await clearAllWindowLinks();

    const stored = await getSnapshots();
    expect(stored.every((s) => s.linkedWindowId === null)).toBe(true);
    expect((await getManagedTabIds()).size).toBe(0);
  });
});

describe('reconcileAfterReload', () => {
  it('unlinks snapshots whose window no longer exists', async () => {
    const snap = makeSnapshot({ linkedWindowId: 42 });
    await addSnapshots([snap]);
    vi.spyOn(browser.windows, 'get').mockRejectedValue(new Error('No such window'));

    await reconcileAfterReload();

    expect((await getSnapshots())[0]!.linkedWindowId).toBeNull();
  });

  it('re-registers saved tabs of a surviving linked window, but not new ones', async () => {
    const snap = makeSnapshot({
      linkedWindowId: 5,
      tabs: [makeTab({ url: 'https://a.com/' }), makeTab({ url: 'https://b.com/' })],
    });
    await addSnapshots([snap]);
    vi.spyOn(browser.windows, 'get').mockResolvedValue({ id: 5 } as any);
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 10, url: 'https://a.com/' },
      { id: 11, url: 'https://b.com/' },
      { id: 12, url: 'https://opened-later.com/' },
    ] as any);

    await reconcileAfterReload();

    expect([...(await getManagedTabIds())].sort()).toEqual([10, 11]);
    expect((await getSnapshots())[0]!.linkedWindowId).toBe(5);
  });

  it('ignores snapshots that were never linked', async () => {
    await addSnapshots([makeSnapshot({ linkedWindowId: null })]);
    await reconcileAfterReload();
    expect((await getManagedTabIds()).size).toBe(0);
  });
});
