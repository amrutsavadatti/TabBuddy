import { isArchivedSnapshot } from './archive';
import { getAccentColor } from './color';
import { getUniqueName } from './names';
import { getSnapshots, updateSnapshot, updateSnapshots } from './storage';
import type { Category, Snapshot } from './types';

export const CATEGORIES_KEY = 'categories';

export async function getCategories(): Promise<Category[]> {
  const result = await browser.storage.local.get(CATEGORIES_KEY);
  return (result[CATEGORIES_KEY] as Category[] | undefined) ?? [];
}

async function saveCategories(categories: Category[]): Promise<void> {
  await browser.storage.local.set({ [CATEGORIES_KEY]: categories });
}

function cleanName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Category name cannot be empty.');
  return trimmed;
}

export async function addCategory(name: string, color: string | null = null): Promise<Category> {
  const categories = await getCategories();
  const category: Category = {
    id: crypto.randomUUID(),
    name: getUniqueName(
      cleanName(name),
      categories.map((c) => c.name),
    ),
    color,
    createdAt: Date.now(),
  };
  await saveCategories([...categories, category]);
  return category;
}

/** Appends already-built categories (used by import) in a single write. */
export async function addCategories(newCategories: Category[]): Promise<void> {
  if (newCategories.length === 0) return;
  await saveCategories([...(await getCategories()), ...newCategories]);
}

export async function renameCategory(id: string, name: string): Promise<void> {
  const categories = await getCategories();
  const others = categories.filter((c) => c.id !== id).map((c) => c.name);
  const unique = getUniqueName(cleanName(name), others);
  await saveCategories(categories.map((c) => (c.id === id ? { ...c, name: unique } : c)));
}

export async function setCategoryColor(id: string, color: string | null): Promise<void> {
  const categories = await getCategories();
  await saveCategories(categories.map((c) => (c.id === id ? { ...c, color } : c)));
}

/** Removes the category and strips its tag from every snapshot. Snapshots
 * themselves are never deleted. */
export async function deleteCategory(id: string): Promise<void> {
  const categories = await getCategories();
  await saveCategories(categories.filter((c) => c.id !== id));

  const snapshots = await getSnapshots();
  await updateSnapshots(
    snapshots
      .filter((s) => s.categoryIds.includes(id))
      .map((s) => ({
        id: s.id,
        changes: { categoryIds: s.categoryIds.filter((c) => c !== id) },
      })),
  );
}

async function loadTaggableSnapshot(snapshotId: string): Promise<Snapshot> {
  const snapshot = (await getSnapshots()).find((s) => s.id === snapshotId);
  if (!snapshot) throw new Error('That snapshot no longer exists.');
  if (isArchivedSnapshot(snapshot)) throw new Error('The Archived snapshot cannot be categorized.');
  return snapshot;
}

async function assertCategoriesExist(ids: string[]): Promise<void> {
  const known = new Set((await getCategories()).map((c) => c.id));
  if (ids.some((id) => !known.has(id))) throw new Error('That category no longer exists.');
}

export async function setSnapshotCategories(snapshotId: string, categoryIds: string[]): Promise<void> {
  await loadTaggableSnapshot(snapshotId);
  const unique = [...new Set(categoryIds)];
  await assertCategoriesExist(unique);
  await updateSnapshot(snapshotId, { categoryIds: unique });
}

export async function addSnapshotToCategory(snapshotId: string, categoryId: string): Promise<void> {
  const snapshot = await loadTaggableSnapshot(snapshotId);
  await setSnapshotCategories(snapshotId, [...snapshot.categoryIds, categoryId]);
}

export async function removeSnapshotFromCategory(
  snapshotId: string,
  categoryId: string,
): Promise<void> {
  const snapshot = await loadTaggableSnapshot(snapshotId);
  await updateSnapshot(snapshotId, {
    categoryIds: snapshot.categoryIds.filter((id) => id !== categoryId),
  });
}

/** Adds the given categories to every listed snapshot in one write. Skips the
 * Archived snapshot and unknown ids; returns how many snapshots were tagged. */
export async function addSnapshotsToCategories(
  snapshotIds: string[],
  categoryIds: string[],
): Promise<number> {
  const unique = [...new Set(categoryIds)];
  await assertCategoriesExist(unique);
  const wanted = new Set(snapshotIds);
  const targets = (await getSnapshots()).filter((s) => wanted.has(s.id) && !isArchivedSnapshot(s));
  await updateSnapshots(
    targets.map((s) => ({
      id: s.id,
      changes: { categoryIds: [...new Set([...s.categoryIds, ...unique])] },
    })),
  );
  return targets.length;
}

export function getSnapshotsInCategory(snapshots: Snapshot[], categoryId: string): Snapshot[] {
  return snapshots.filter((s) => s.categoryIds.includes(categoryId));
}

/** Snapshots with no tag pointing at an existing category. The Archived
 * snapshot is excluded — it lives outside categories. */
export function getUncategorizedSnapshots(
  snapshots: Snapshot[],
  categories: Pick<Category, 'id'>[],
): Snapshot[] {
  const known = new Set(categories.map((c) => c.id));
  return snapshots.filter(
    (s) => !isArchivedSnapshot(s) && !s.categoryIds.some((id) => known.has(id)),
  );
}

export function getCategoryColor(category: Pick<Category, 'name' | 'color'>): string {
  return category.color ?? getAccentColor(category.name);
}
