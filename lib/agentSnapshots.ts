import {
  MAX_CATEGORY_NAME_LENGTH,
  MAX_CATEGORY_NAMES,
  MAX_SNAPSHOT_URLS,
  MAX_TAG_TARGETS,
  MAX_TITLE_LENGTH,
  type CategoryUse,
  type CreateSnapshotFromUrlsParams,
  type CreateSnapshotFromUrlsResult,
  type RenameSnapshotResult,
  type TagSnapshotsResult,
  type UpdateSnapshotFromWindowResult,
} from '../bridge/protocol';
import { parseSnapshotName } from './agentSave';
import { isArchivedSnapshot, renameSnapshot } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { addCategory, addSnapshotsToCategories, getCategories } from './categories';
import { getUniqueName } from './names';
import { addSnapshot, getSnapshots } from './storage';
import type { Snapshot, SnapshotTab } from './types';
import { updateSnapshotFromLiveWindow } from './update';

const SHOWN_LENGTH = 80;

function shown(value: unknown): string {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? String(value));
  return text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)}…` : text;
}

// ---- categories by name ----

/** Pure: checks a list of category names. Blank names are refused, and names
 * that differ only in case or spacing count as one. */
export function parseCategoryNames(value: unknown, field = 'categoryNames'): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((n) => typeof n !== 'string')) {
    throw new BridgeFailure('invalid_params', `${field} must be a list of category names.`);
  }
  if (value.length > MAX_CATEGORY_NAMES) {
    throw new BridgeFailure('invalid_params', `Use at most ${MAX_CATEGORY_NAMES} categories at a time.`);
  }
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of value as string[]) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (!name) throw new BridgeFailure('invalid_params', 'Category names cannot be blank.');
    if (name.length > MAX_CATEGORY_NAME_LENGTH) {
      throw new BridgeFailure('invalid_params', `Category names can be ${MAX_CATEGORY_NAME_LENGTH} characters at most.`);
    }
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      names.push(name);
    }
  }
  return names;
}

/** Finds each category by name (ignoring case), creating the missing ones. */
export async function findOrCreateCategories(names: string[]): Promise<CategoryUse[]> {
  const existing = await getCategories();
  const uses: CategoryUse[] = [];
  for (const name of names) {
    const match = existing.find((c) => c.name.toLowerCase() === name.toLowerCase());
    if (match) {
      uses.push({ id: match.id, name: match.name, created: false });
    } else {
      const created = await addCategory(name);
      existing.push(created);
      uses.push({ id: created.id, name: created.name, created: true });
    }
  }
  return uses;
}

// ---- create from URLs ----

export interface ParsedUrls {
  tabs: SnapshotTab[];
  skipped: { value: string; reason: string }[];
}

function siteName(url: URL): string {
  return url.hostname.replace(/^www\./, '');
}

/** Pure: turns URLs (or {url, title} pairs) into snapshot tabs. Only web
 * addresses are kept; anything else, and repeats of an address, are left out
 * and reported, so nothing disappears silently. A missing title becomes the
 * site's name. */
export function parseSnapshotUrls(value: unknown): ParsedUrls {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BridgeFailure('invalid_params', 'urls must be a non-empty list of web addresses.');
  }
  if (value.length > MAX_SNAPSHOT_URLS) {
    throw new BridgeFailure(
      'invalid_params',
      `Too many urls (${value.length}); save at most ${MAX_SNAPSHOT_URLS} in one snapshot.`,
    );
  }
  const tabs: SnapshotTab[] = [];
  const skipped: ParsedUrls['skipped'] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const rawUrl = typeof entry === 'string' ? entry : (entry as { url?: unknown } | null)?.url;
    const rawTitle = typeof entry === 'string' ? undefined : (entry as { title?: unknown } | null)?.title;
    let url: URL;
    try {
      if (typeof rawUrl !== 'string') throw new Error('not a string');
      url = new URL(rawUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not a web address');
    } catch {
      skipped.push({ value: shown(rawUrl ?? entry), reason: 'not an http or https address' });
      continue;
    }
    if (seen.has(url.href)) {
      skipped.push({ value: shown(url.href), reason: 'listed more than once' });
      continue;
    }
    seen.add(url.href);
    const title = typeof rawTitle === 'string' ? rawTitle.trim().slice(0, MAX_TITLE_LENGTH) : '';
    tabs.push({ url: url.href, title: title || siteName(url), pinned: false, groupIndex: null });
  }
  if (tabs.length === 0) {
    throw new BridgeFailure(
      'invalid_params',
      `None of the urls could be saved: ${skipped.map((s) => `${s.value} (${s.reason})`).join('; ')}`,
    );
  }
  return { tabs, skipped };
}

export async function createSnapshotFromUrls(params: unknown): Promise<CreateSnapshotFromUrlsResult> {
  const p = (params ?? {}) as Partial<CreateSnapshotFromUrlsParams>;
  const name = parseSnapshotName(p.name);
  const { tabs, skipped } = parseSnapshotUrls(p.urls);
  const categoryNames = parseCategoryNames(p.categoryNames);

  const categories = await findOrCreateCategories(categoryNames);
  const existing = await getSnapshots();
  const now = Date.now();
  const snapshot: Snapshot = {
    id: crypto.randomUUID(),
    name: getUniqueName(name, existing.map((s) => s.name)),
    tabs,
    tabGroups: [],
    linkedWindowId: null,
    categoryIds: categories.map((c) => c.id),
    usageCount: 0,
    pinned: false,
    pinnedPosition: null,
    createdAt: now,
    updatedAt: now,
  };
  await addSnapshot(snapshot);
  return { snapshotId: snapshot.id, name: snapshot.name, tabCount: tabs.length, skipped, categories };
}

// ---- update, rename, tag ----

function requireId(params: unknown): string {
  const { id } = (params ?? {}) as { id?: unknown };
  if (typeof id !== 'string' || id === '') {
    throw new BridgeFailure('invalid_params', 'id must be a snapshot id from list_snapshots.');
  }
  return id;
}

const NO_SUCH_SNAPSHOT = 'No snapshot with that id. Call list_snapshots for current ids.';

export async function updateSnapshotFromWindow(params: unknown): Promise<UpdateSnapshotFromWindowResult> {
  const id = requireId(params);
  const snapshot = (await getSnapshots()).find((s) => s.id === id);
  if (!snapshot) throw new BridgeFailure('not_found', NO_SUCH_SNAPSHOT);
  if (isArchivedSnapshot(snapshot)) {
    throw new BridgeFailure('invalid_params', 'The Archived snapshot cannot be updated from a window.');
  }
  if (!(await updateSnapshotFromLiveWindow(snapshot))) {
    throw new BridgeFailure(
      'invalid_params',
      `"${snapshot.name}" is not open in a window, so there is nothing to update it from. Open it first with restore_snapshot.`,
    );
  }
  const updated = (await getSnapshots()).find((s) => s.id === id);
  return {
    id,
    name: snapshot.name,
    previousTabCount: snapshot.tabs.length,
    tabCount: updated?.tabs.length ?? 0,
  };
}

export async function renameSnapshotTo(params: unknown): Promise<RenameSnapshotResult> {
  const id = requireId(params);
  const name = parseSnapshotName((params as { name?: unknown }).name);
  const snapshots = await getSnapshots();
  const snapshot = snapshots.find((s) => s.id === id);
  if (!snapshot) throw new BridgeFailure('not_found', NO_SUCH_SNAPSHOT);
  if (isArchivedSnapshot(snapshot)) {
    throw new BridgeFailure('invalid_params', 'The Archived snapshot cannot be renamed.');
  }
  const unique = getUniqueName(name, snapshots.filter((s) => s.id !== id).map((s) => s.name));
  const finalName = await renameSnapshot(id, unique);
  return { id, previousName: snapshot.name, name: finalName };
}

export async function tagSnapshots(params: unknown): Promise<TagSnapshotsResult> {
  const p = (params ?? {}) as { snapshotIds?: unknown; categoryNames?: unknown };
  if (
    !Array.isArray(p.snapshotIds) ||
    p.snapshotIds.length === 0 ||
    p.snapshotIds.some((id) => typeof id !== 'string' || id === '')
  ) {
    throw new BridgeFailure('invalid_params', 'snapshotIds must be a non-empty list of snapshot ids from list_snapshots.');
  }
  if (p.snapshotIds.length > MAX_TAG_TARGETS) {
    throw new BridgeFailure('invalid_params', `Tag at most ${MAX_TAG_TARGETS} snapshots at a time.`);
  }
  const names = parseCategoryNames(p.categoryNames);
  if (names.length === 0) {
    throw new BridgeFailure('invalid_params', 'categoryNames must list at least one category.');
  }

  // Check every snapshot before creating any category, so a typo in an id
  // cannot leave stray categories behind.
  const snapshots = await getSnapshots();
  const ids = [...new Set(p.snapshotIds as string[])];
  const unknown = ids.filter((id) => !snapshots.some((s) => s.id === id));
  if (unknown.length > 0) {
    throw new BridgeFailure('not_found', `No snapshot with id ${unknown.join(', ')}. Call list_snapshots for current ids.`);
  }
  if (ids.some((id) => isArchivedSnapshot(snapshots.find((s) => s.id === id)!))) {
    throw new BridgeFailure('invalid_params', 'The Archived snapshot cannot be given categories.');
  }

  const categories = await findOrCreateCategories(names);
  const tagged = await addSnapshotsToCategories(ids, categories.map((c) => c.id));
  return { categories, tagged };
}
