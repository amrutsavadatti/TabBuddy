import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  archiveTab,
  ARCHIVED_SNAPSHOT_NAME,
  ensureArchivedSnapshotExists,
  isArchivedSnapshot,
} from './archive';
import { getSnapshots } from './storage';
import type { TriageTab } from './triage';

async function makeOpenTab(props: Partial<TriageTab> = {}): Promise<TriageTab> {
  const created = await fakeBrowser.tabs.create({ url: props.url ?? 'https://example.com' });
  return {
    id: created.id ?? 0,
    url: props.url ?? 'https://example.com',
    title: props.title ?? 'Example',
    favIconUrl: props.favIconUrl,
    pinned: props.pinned ?? false,
  };
}

describe('archiveTab', () => {
  it('creates the Archived snapshot on first use', async () => {
    const tab = await makeOpenTab({ title: 'First tab' });
    await archiveTab(tab);

    const snapshots = await getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.name).toBe(ARCHIVED_SNAPSHOT_NAME);
    expect(snapshots[0]!.tabs).toHaveLength(1);
    expect(snapshots[0]!.tabs[0]!.title).toBe('First tab');
  });

  it('appends to the existing Archived snapshot on later calls', async () => {
    const first = await makeOpenTab({ title: 'First tab' });
    const second = await makeOpenTab({ title: 'Second tab' });

    await archiveTab(first);
    await archiveTab(second);

    const snapshots = await getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.tabs.map((t) => t.title)).toEqual(['First tab', 'Second tab']);
  });

  it('closes the real browser tab after archiving', async () => {
    const tab = await makeOpenTab();
    await archiveTab(tab);

    const stillOpen = await fakeBrowser.tabs.query({});
    expect(stillOpen.find((t) => t.id === tab.id)).toBeUndefined();
  });

  it('does not throw if the tab is already closed', async () => {
    const tab: TriageTab = { id: 999_999, url: 'https://gone.example', title: 'Gone', pinned: false };

    await expect(archiveTab(tab)).resolves.not.toThrow();
    const snapshots = await getSnapshots();
    expect(snapshots[0]!.tabs).toHaveLength(1);
  });
});

describe('ensureArchivedSnapshotExists', () => {
  it('creates the Archived snapshot when none exists', async () => {
    await ensureArchivedSnapshotExists();
    const snapshots = await getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.name).toBe(ARCHIVED_SNAPSHOT_NAME);
    expect(snapshots[0]!.pinned).toBe(true);
  });

  it('is idempotent — does not create duplicates on repeated calls', async () => {
    await ensureArchivedSnapshotExists();
    await ensureArchivedSnapshotExists();
    await ensureArchivedSnapshotExists();
    const snapshots = await getSnapshots();
    expect(snapshots).toHaveLength(1);
  });

  it('does not clobber an Archived snapshot that already has tabs', async () => {
    const tab = await makeOpenTab({ title: 'Kept' });
    await archiveTab(tab);
    await ensureArchivedSnapshotExists();

    const snapshots = await getSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.tabs).toHaveLength(1);
  });
});

describe('isArchivedSnapshot', () => {
  it('matches only the reserved Archived name', () => {
    expect(isArchivedSnapshot({ name: 'Archived' })).toBe(true);
    expect(isArchivedSnapshot({ name: 'Work stuff' })).toBe(false);
  });
});
