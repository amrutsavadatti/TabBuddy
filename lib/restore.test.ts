import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot, makeTab } from '@/test/factories';
import { addSnapshot, getSnapshots } from './storage';
import { setLazyRestoreEnabled } from './lazyRestore';
import { getManagedTabIds } from './managedTabs';
import { restoreSnapshot } from './restore';

describe('restoreSnapshot', () => {
  it('focuses an existing window instead of creating a duplicate', async () => {
    const existingWindow = (await browser.windows.create({}))!;
    const snapshot = makeSnapshot({
      linkedWindowId: existingWindow.id!,
      usageCount: 2,
    });
    await addSnapshot(snapshot);

    const createSpy = vi.spyOn(browser.windows, 'create');
    const windowId = await restoreSnapshot(snapshot);

    expect(windowId).toBe(existingWindow.id);
    expect(createSpy).not.toHaveBeenCalled();

    const [updated] = await getSnapshots();
    expect(updated?.usageCount).toBe(3);
  });

  it('opens a new window, pins tabs, and recreates tab groups when nothing is open', async () => {
    const snapshot = makeSnapshot({
      linkedWindowId: null,
      usageCount: 0,
      tabs: [
        makeTab({ url: 'https://a.com', pinned: true, groupIndex: 0 }),
        makeTab({ url: 'https://b.com', pinned: false, groupIndex: 0 }),
        makeTab({ url: 'https://c.com', pinned: false, groupIndex: null }),
      ],
      tabGroups: [{ title: 'Work', color: 'blue' }],
    });
    await addSnapshot(snapshot);

    vi.spyOn(browser.windows, 'create').mockResolvedValue({
      id: 99,
      tabs: [{ id: 1 }, { id: 2 }, { id: 3 }],
    } as any);
    const updateTabSpy = vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    const groupSpy = vi.spyOn(browser.tabs as any, 'group').mockResolvedValue(555);
    const tabGroupsUpdateSpy = vi
      .spyOn(browser.tabGroups as any, 'update')
      .mockResolvedValue({});

    const windowId = await restoreSnapshot(snapshot);

    expect(windowId).toBe(99);
    expect([...(await getManagedTabIds())].sort()).toEqual([1, 2, 3]);
    expect(updateTabSpy).toHaveBeenCalledWith(1, { pinned: true });
    expect(updateTabSpy).not.toHaveBeenCalledWith(2, expect.anything());
    expect(groupSpy).toHaveBeenCalledWith({
      tabIds: [1, 2],
      createProperties: { windowId: 99 },
    });
    expect(tabGroupsUpdateSpy).toHaveBeenCalledWith(555, {
      title: 'Work',
      color: 'blue',
    });

    const [updated] = await getSnapshots();
    expect(updated?.linkedWindowId).toBe(99);
    expect(updated?.usageCount).toBe(1);
  });

  it('falls back to a new window if the linked window was closed', async () => {
    const snapshot = makeSnapshot({ linkedWindowId: 12345, usageCount: 0, tabs: [] });
    await addSnapshot(snapshot);

    // Real Chrome rejects windows.get() for a nonexistent id; fake-browser's
    // fidelity doesn't go that far, so it's simulated explicitly here.
    vi.spyOn(browser.windows, 'get').mockRejectedValue(
      new Error('No window with id: 12345'),
    );
    vi.spyOn(browser.windows, 'create').mockResolvedValue({ id: 7, tabs: [] } as any);

    const windowId = await restoreSnapshot(snapshot);
    expect(windowId).toBe(7);
  });

  it('opens only the first tab for real; the rest as lazy placeholders', async () => {
    const snapshot = makeSnapshot({
      linkedWindowId: null,
      tabs: [
        makeTab({ url: 'https://a.com/', title: 'A' }),
        makeTab({ url: 'https://b.com/page', title: 'B' }),
        makeTab({ url: 'chrome://settings/' }),
      ],
    });
    await addSnapshot(snapshot);
    const createSpy = vi
      .spyOn(browser.windows, 'create')
      .mockResolvedValue({ id: 60, tabs: [{ id: 1 }, { id: 2 }, { id: 3 }] } as any);

    await restoreSnapshot(snapshot);

    const { url } = createSpy.mock.calls[0]![0] as { url: string[] };
    expect(url[0]).toBe('https://a.com/');
    expect(url[1]).toContain('lazy.html');
    expect(new URL(url[1]!).searchParams.get('u')).toBe('https://b.com/page');
    expect(url[2]).toBe('chrome://settings/');
  });

  it('opens every tab normally when lazy restore is turned off', async () => {
    await setLazyRestoreEnabled(false);
    const snapshot = makeSnapshot({
      linkedWindowId: null,
      tabs: [makeTab({ url: 'https://a.com/' }), makeTab({ url: 'https://b.com/' })],
    });
    await addSnapshot(snapshot);
    const createSpy = vi
      .spyOn(browser.windows, 'create')
      .mockResolvedValue({ id: 62, tabs: [{ id: 1 }, { id: 2 }] } as any);

    await restoreSnapshot(snapshot);

    const { url } = createSpy.mock.calls[0]![0] as { url: string[] };
    expect(url).toEqual(['https://a.com/', 'https://b.com/']);
  });

  it('registers all restored tabs as managed', async () => {
    const snapshot = makeSnapshot({ linkedWindowId: null, tabs: [makeTab(), makeTab()] });
    await addSnapshot(snapshot);
    vi.spyOn(browser.windows, 'create').mockResolvedValue({
      id: 61,
      tabs: [{ id: 1 }, { id: 2 }],
    } as any);

    await restoreSnapshot(snapshot);

    expect([...(await getManagedTabIds())].sort()).toEqual([1, 2]);
  });
});
