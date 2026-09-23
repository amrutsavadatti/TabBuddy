import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  archiveTab,
  ARCHIVED_SNAPSHOT_NAME,
  ensureArchivedSnapshotExists,
  isArchivedSnapshot,
  isReservedSnapshotName,
  renameSnapshot,
} from './archive';
import { addSnapshot, getSnapshots } from './storage';
import { makeSnapshot } from '@/test/factories';
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

describe('isReservedSnapshotName', () => {
  it('matches Archived ignoring case and surrounding spaces', () => {
    expect(isReservedSnapshotName('Archived')).toBe(true);
    expect(isReservedSnapshotName('  archived ')).toBe(true);
    expect(isReservedSnapshotName('Archived (2)')).toBe(false);
    expect(isReservedSnapshotName('Work')).toBe(false);
  });
});

describe('renameSnapshot', () => {
  it('renames an ordinary snapshot and trims the name', async () => {
    const snap = makeSnapshot({ name: 'Old' });
    await addSnapshot(snap);
    expect(await renameSnapshot(snap.id, '  New name ')).toBe('New name');
    expect((await getSnapshots())[0]!.name).toBe('New name');
  });

  it('leaves the name alone when given a blank one', async () => {
    const snap = makeSnapshot({ name: 'Keep' });
    await addSnapshot(snap);
    expect(await renameSnapshot(snap.id, '   ')).toBe('Keep');
    expect((await getSnapshots())[0]!.name).toBe('Keep');
  });

  it('refuses to rename the Archived snapshot', async () => {
    await ensureArchivedSnapshotExists();
    const [archived] = await getSnapshots();
    await expect(renameSnapshot(archived!.id, 'Stuff')).rejects.toThrow('cannot be renamed');
    expect((await getSnapshots())[0]!.name).toBe(ARCHIVED_SNAPSHOT_NAME);
  });

  it('refuses to give another snapshot the reserved name', async () => {
    const snap = makeSnapshot({ name: 'Work' });
    await addSnapshot(snap);
    await expect(renameSnapshot(snap.id, 'archived')).rejects.toThrow('reserved');
    expect((await getSnapshots())[0]!.name).toBe('Work');
  });

  it('rejects an unknown snapshot', async () => {
    await expect(renameSnapshot('nope', 'X')).rejects.toThrow('no longer exists');
  });
});
