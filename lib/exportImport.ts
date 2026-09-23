import type { Category, Snapshot } from './types';
import { getUniqueName } from './names';

interface ExportFile {
  version: 1;
  exportedAt: number;
  snapshots: Snapshot[];
  /** Only the categories the exported snapshots use. Optional so files made
   * before categories existed still import. */
  categories?: Category[];
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export function downloadSnapshotsAsFile(
  snapshots: Snapshot[],
  categories: Category[] = [],
): void {
  const used = new Set(snapshots.flatMap((s) => s.categoryIds ?? []));
  const payload: ExportFile = {
    version: 1,
    exportedAt: Date.now(),
    snapshots,
    categories: categories.filter((c) => used.has(c.id)),
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

function isValidCategoryShape(value: unknown): value is Category {
  if (!value || typeof value !== 'object') return false;
  const c = value as Record<string, unknown>;
  return typeof c.id === 'string' && typeof c.name === 'string' && c.name.trim() !== '';
}

const nameKey = (name: string) => name.trim().toLowerCase();

export interface ParsedImport {
  snapshots: Snapshot[];
  /** Categories in the file that don't exist on this device yet. The caller
   * must save these before saving the snapshots that reference them. */
  newCategories: Category[];
}

/** Parses an imported file, resetting device-specific fields (id, usage,
 * pin state, linked window) so shared/backed-up snapshots start fresh, and
 * renaming any snapshot whose name collides with an existing one (or
 * another snapshot in the same import batch). Categories are matched to
 * existing ones by name (case-insensitive); missing ones are created. */
export async function parseImportWithCategories(
  file: File,
  existingNames: string[] = [],
  existingCategories: Category[] = [],
): Promise<ParsedImport> {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const rawSnapshots: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.snapshots)
      ? parsed.snapshots
      : [];
  const rawCategories: unknown[] = Array.isArray(parsed?.categories) ? parsed.categories : [];

  const validSnapshots = rawSnapshots.filter(isValidSnapshotShape);
  if (validSnapshots.length === 0) {
    throw new Error('No valid snapshots found in this file.');
  }

  const now = Date.now();

  // file category id -> category id on this device (existing, or newly created)
  const byName = new Map(existingCategories.map((c) => [nameKey(c.name), c.id]));
  const idMap = new Map<string, string>();
  const newCategories: Category[] = [];
  for (const raw of rawCategories.filter(isValidCategoryShape)) {
    let localId = byName.get(nameKey(raw.name));
    if (!localId) {
      localId = crypto.randomUUID();
      byName.set(nameKey(raw.name), localId);
      newCategories.push({
        id: localId,
        name: raw.name.trim(),
        color: typeof raw.color === 'string' ? raw.color : null,
        createdAt: now,
      });
    }
    idMap.set(raw.id, localId);
  }

  const usedNames = [...existingNames];
  const snapshots = validSnapshots.map((s) => {
    const name = getUniqueName(s.name, usedNames);
    usedNames.push(name);
    const fileIds = Array.isArray(s.categoryIds) ? s.categoryIds : [];
    const categoryIds = [
      ...new Set(fileIds.map((id) => idMap.get(id)).filter((id): id is string => !!id)),
    ];
    return {
      ...s,
      id: crypto.randomUUID(),
      name,
      linkedWindowId: null,
      categoryIds,
      usageCount: 0,
      pinned: false,
      pinnedPosition: null,
      createdAt: now,
      updatedAt: now,
    };
  });

  return { snapshots, newCategories };
}

export async function parseImportFile(
  file: File,
  existingNames: string[] = [],
): Promise<Snapshot[]> {
  return (await parseImportWithCategories(file, existingNames)).snapshots;
}
