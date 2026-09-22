import { describe, expect, it, vi } from 'vitest';
import { makeSnapshot } from '@/test/factories';
import { downloadSnapshotsAsFile, parseImportFile } from './exportImport';

function fileFrom(content: unknown): File {
  return new File([JSON.stringify(content)], 'import.json', {
    type: 'application/json',
  });
}

describe('downloadSnapshotsAsFile', () => {
  it('creates an object URL and triggers a download link click', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:fake-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadSnapshotsAsFile([makeSnapshot({ name: 'My Snapshot' })]);

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');

    vi.unstubAllGlobals();
    clickSpy.mockRestore();
  });

  it('names a single-snapshot export after the snapshot', () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn().mockReturnValue('blob:fake-url'),
      revokeObjectURL: vi.fn(),
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      expect(this.download).toBe('tabbuddy-job-hunt.json');
    });

    downloadSnapshotsAsFile([makeSnapshot({ name: 'Job Hunt' })]);

    expect(clickSpy).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
    clickSpy.mockRestore();
  });
});

describe('parseImportFile', () => {
  it('parses a bare array of snapshots', async () => {
    const snapshot = makeSnapshot({ name: 'Imported' });
    const result = await parseImportFile(fileFrom([snapshot]));
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Imported');
  });

  it('parses the wrapped export format ({ snapshots: [...] })', async () => {
    const snapshot = makeSnapshot({ name: 'Wrapped' });
    const result = await parseImportFile(
      fileFrom({ version: 1, exportedAt: Date.now(), snapshots: [snapshot] }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Wrapped');
  });

  it('resets device-specific fields on every imported snapshot', async () => {
    const snapshot = makeSnapshot({
      linkedWindowId: 123,
      usageCount: 50,
      pinned: true,
      pinnedPosition: 2,
    });
    const [result] = await parseImportFile(fileFrom([snapshot]));
    expect(result!.id).not.toBe(snapshot.id);
    expect(result!.linkedWindowId).toBeNull();
    expect(result!.usageCount).toBe(0);
    expect(result!.pinned).toBe(false);
    expect(result!.pinnedPosition).toBeNull();
  });

  it('renames a snapshot that collides with an existing name', async () => {
    const snapshot = makeSnapshot({ name: 'Job Hunt' });
    const [result] = await parseImportFile(fileFrom([snapshot]), ['Job Hunt']);
    expect(result!.name).toBe('Job Hunt (2)');
  });

  it('renames snapshots that collide with each other within the same batch', async () => {
    const a = makeSnapshot({ name: 'Same Name' });
    const b = makeSnapshot({ name: 'Same Name' });
    const result = await parseImportFile(fileFrom([a, b]));
    expect(result.map((s) => s.name).sort()).toEqual(['Same Name', 'Same Name (2)']);
  });

  it('filters out entries that are not valid snapshot shapes', async () => {
    const valid = makeSnapshot({ name: 'Valid' });
    const result = await parseImportFile(
      fileFrom([valid, { not: 'a snapshot' }, null, 42]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Valid');
  });

  it('throws when no valid snapshots are found', async () => {
    await expect(parseImportFile(fileFrom([{ garbage: true }]))).rejects.toThrow(
      'No valid snapshots found in this file.',
    );
    await expect(parseImportFile(fileFrom({ snapshots: [] }))).rejects.toThrow();
  });

  it('throws on malformed JSON', async () => {
    const badFile = new File(['{ not json'], 'import.json');
    await expect(parseImportFile(badFile)).rejects.toThrow();
  });
});
