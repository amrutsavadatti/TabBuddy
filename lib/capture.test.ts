import { describe, expect, it, vi } from 'vitest';
import { captureWindowTabs, createSnapshotFromCurrentWindow } from './capture';
import { getManagedTabIds } from './managedTabs';

// fake-browser doesn't implement tabGroups.query, and doesn't let us set a
// tab's groupId via tabs.create, so tabs/tabGroups are mocked directly here
// to fully control the shape being mapped.

describe('captureWindowTabs', () => {
  it('maps tab fields and resolves groupIndex from tabGroups', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://a.com/', title: 'A', pinned: true, groupId: 5 },
      { id: 2, url: 'https://b.com/', title: 'B', pinned: false, groupId: -1 },
    ] as any);
    vi.spyOn(browser.tabGroups as any, 'query').mockResolvedValue([
      { id: 5, title: 'Work', color: 'blue' },
    ]);

    const { tabs, tabGroups } = await captureWindowTabs(1);

    expect(tabGroups).toEqual([{ title: 'Work', color: 'blue' }]);
    expect(tabs).toEqual([
      { url: 'https://a.com/', title: 'A', favIconUrl: undefined, pinned: true, groupIndex: 0 },
      { url: 'https://b.com/', title: 'B', favIconUrl: undefined, pinned: false, groupIndex: null },
    ]);
  });

  it('defaults missing url/title to empty strings and pinned to false', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([{ id: 1 }] as any);
    vi.spyOn(browser.tabGroups as any, 'query').mockResolvedValue([]);

    const { tabs } = await captureWindowTabs(1);
    expect(tabs).toEqual([
      { url: '', title: '', favIconUrl: undefined, pinned: false, groupIndex: null },
    ]);
  });
});

describe('createSnapshotFromCurrentWindow', () => {
  it('builds a fresh Snapshot linked to the current window', async () => {
    vi.spyOn(browser.windows, 'getCurrent').mockResolvedValue({ id: 7 } as any);
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://a.com/', title: 'A', pinned: false, groupId: -1 },
    ] as any);
    vi.spyOn(browser.tabGroups as any, 'query').mockResolvedValue([]);

    const snapshot = await createSnapshotFromCurrentWindow('My Window');

    expect(snapshot.name).toBe('My Window');
    expect(snapshot.linkedWindowId).toBe(7);
    expect(snapshot.tabs).toHaveLength(1);
    expect(snapshot.tabGroups).toEqual([]);
    expect(snapshot.usageCount).toBe(0);
    expect(snapshot.pinned).toBe(false);
    expect(snapshot.pinnedPosition).toBeNull();
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.createdAt).toBe(snapshot.updatedAt);
  });

  it('registers the window\'s tabs as managed by the new snapshot', async () => {
    vi.spyOn(browser.windows, 'getCurrent').mockResolvedValue({ id: 7 } as any);
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 11, url: 'https://a.com/', title: 'A', pinned: false, groupId: -1 },
      { id: 12, url: 'https://b.com/', title: 'B', pinned: false, groupId: -1 },
    ] as any);
    vi.spyOn(browser.tabGroups as any, 'query').mockResolvedValue([]);

    await createSnapshotFromCurrentWindow('My Window');

    expect([...(await getManagedTabIds())].sort()).toEqual([11, 12]);
  });
});
