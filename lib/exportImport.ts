import type { Snapshot } from './types';
import { getUniqueName } from './names';

interface ExportFile {
  version: 1;
  exportedAt: number;
  snapshots: Snapshot[];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function downloadSnapshotsAsFile(snapshots: Snapshot[]): void {
  const payload: ExportFile = {
    version: 1,
    exportedAt: Date.now(),
    snapshots,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const filename =
    snapshots.length === 1
      ? `tabbuddy-${slugify(snapshots[0]!.name)}.json`
      : `tabbuddy-export-${new Date().toISOString().slice(0, 10)}.json`;

  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function isValidSnapshotShape(value: unknown): value is Snapshot {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.name === 'string' &&
    Array.isArray(s.tabs) &&
    Array.isArray(s.tabGroups)
  );
}

/** Parses an imported file, resetting device-specific fields (id, usage,
 * pin state, linked window) so shared/backed-up snapshots start fresh, and
 * renaming any snapshot whose name collides with an existing one (or
 * another snapshot in the same import batch). */
export async function parseImportFile(
  file: File,
  existingNames: string[] = [],
): Promise<Snapshot[]> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const rawSnapshots: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.snapshots)
      ? parsed.snapshots
      : [];

  const validSnapshots = rawSnapshots.filter(isValidSnapshotShape);
  if (validSnapshots.length === 0) {
    throw new Error('No valid snapshots found in this file.');
  }

  const now = Date.now();
  const usedNames = [...existingNames];
  return validSnapshots.map((s) => {
    const name = getUniqueName(s.name, usedNames);
    usedNames.push(name);
    return {
      ...s,
      id: crypto.randomUUID(),
      name,
      linkedWindowId: null,
      usageCount: 0,
      pinned: false,
      pinnedPosition: null,
      createdAt: now,
      updatedAt: now,
    };
  });
}
