import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { archiveTab, archiveTabs, ARCHIVED_SNAPSHOT_NAME } from './archive';
import { addSnapshot, getSnapshots } from './storage';
import type { TriageTab } from './triage';
import { makeSnapshot, makeTab } from '@/test/factories';

const tab = (id: number): TriageTab => ({
  id,
  url: `https://s${id}.test/`,
  title: `Tab ${id}`,
  pinned: false,
});

describe('archiveTabs', () => {
  it('writes every tab to the Archived snapshot in a single update, then closes them in order', async () => {
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await archiveTabs([tab(1), tab(2), tab(3)]);

    const archived = (await getSnapshots()).find((s) => s.name === ARCHIVED_SNAPSHOT_NAME)!;
    expect(archived.tabs.map((t) => t.url)).toEqual(['https://s1.test/', 'https://s2.test/', 'https://s3.test/']);
    expect(remove.mock.calls.map(([id]) => id)).toEqual([1, 2, 3]);
    expect(result).toEqual({ snapshotId: archived.id, snapshotTabCount: 3, closed: 3 });
  });

  it('appends to an existing Archived snapshot without touching its other tabs', async () => {
    const existing = makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, tabs: [makeTab({ url: 'https://old.test/' })] });
    await addSnapshot(existing);
    vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);

    const result = await archiveTabs([tab(1)]);

    expect(result.snapshotTabCount).toBe(2);
    expect((await getSnapshots()).find((s) => s.id === existing.id)!.tabs.map((t) => t.url)).toEqual([
      'https://old.test/',
      'https://s1.test/',
    ]);
  });

  it('counts only the tabs the browser actually closed', async () => {
    vi.spyOn(fakeBrowser.tabs, 'remove').mockImplementation((async (id: number) => {
      if (id === 2) throw new Error('No tab with id: 2');
    }) as never);
    const result = await archiveTabs([tab(1), tab(2), tab(3)]);
    expect(result.closed).toBe(2);
    expect(result.snapshotTabCount).toBe(3); // still saved, even the one already gone
  });

  it('closes nothing if saving fails', async () => {
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
    vi.spyOn(fakeBrowser.storage.local, 'set').mockRejectedValue(new Error('disk full'));
    await expect(archiveTabs([tab(1)])).rejects.toThrow('disk full');
    expect(remove).not.toHaveBeenCalled();
  });

  it('is what archiveTab uses for a single tab', async () => {
    const remove = vi.spyOn(fakeBrowser.tabs, 'remove').mockResolvedValue(undefined as never);
    await archiveTab(tab(9));
    expect((await getSnapshots()).find((s) => s.name === ARCHIVED_SNAPSHOT_NAME)!.tabs).toHaveLength(1);
    expect(remove).toHaveBeenCalledWith(9);
  });
});
