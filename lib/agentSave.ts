import {
  MAX_SNAPSHOT_NAME_LENGTH,
  type SaveWindowParams,
  type SaveWindowResult,
} from '../bridge/protocol';
import { isReservedSnapshotName } from './archive';
import { BridgeFailure } from './bridgeFailure';
import { createSnapshotFromWindow } from './capture';
import { getCategories } from './categories';
import { getUniqueName } from './names';
import { addSnapshot, getSnapshots } from './storage';

export interface ParsedSaveWindow {
  name: string;
  windowId: number | undefined;
  categoryIds: string[];
}

/** Pure: a snapshot name an agent may use: a real, non-reserved name of
 * sensible length. A name that is already taken is fine (callers add "(2)"). */
export function parseSnapshotName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new BridgeFailure('invalid_params', 'name is required: what to call the snapshot.');
  if (name.length > MAX_SNAPSHOT_NAME_LENGTH) {
    throw new BridgeFailure('invalid_params', `name is too long; use ${MAX_SNAPSHOT_NAME_LENGTH} characters or fewer.`);
  }
  if (isReservedSnapshotName(name)) {
    throw new BridgeFailure(
      'reserved_name',
      '"Archived" is reserved for TabBuddy\'s archive. Choose another name.',
    );
  }
  return name;
}

/** Pure: checks a saveWindow request. */
export function parseSaveWindowParams(params: unknown): ParsedSaveWindow {
  const p = (params ?? {}) as Partial<SaveWindowParams>;
  const name = parseSnapshotName(p.name);
  if (p.windowId !== undefined && (typeof p.windowId !== 'number' || !Number.isInteger(p.windowId))) {
    throw new BridgeFailure('invalid_params', 'windowId must be a window id from list_open_windows.');
  }
  if (p.categoryIds !== undefined && (!Array.isArray(p.categoryIds) || p.categoryIds.some((c) => typeof c !== 'string'))) {
    throw new BridgeFailure('invalid_params', 'categoryIds must be a list of category ids from list_categories.');
  }
  return { name, windowId: p.windowId, categoryIds: [...new Set(p.categoryIds ?? [])] };
}

/** The window to save: the one asked for, else the one the user used last.
 * Incognito windows are reported as missing (the bridge never touches them),
 * and only ordinary browser windows can be saved. */
async function resolveWindow(windowId: number | undefined): Promise<number> {
  const notFound = new BridgeFailure(
    'not_found',
    'No such window. Call list_open_windows for current window ids.',
  );
  let window;
  try {
    window = windowId === undefined
      ? await browser.windows.getLastFocused({ windowTypes: ['normal'] })
      : await browser.windows.get(windowId);
  } catch {
    throw notFound;
  }
  if (!window || window.id === undefined || window.incognito) {
    throw windowId === undefined
      ? new BridgeFailure(
          'not_found',
          'The window used last is private or missing. Pass windowId (from list_open_windows).',
        )
      : notFound;
  }
  if (window.type !== undefined && window.type !== 'normal') {
    throw new BridgeFailure('invalid_params', 'Only ordinary browser windows can be saved.');
  }
  return window.id;
}

export async function saveWindow(params: unknown): Promise<SaveWindowResult> {
  const { name, windowId: requested, categoryIds } = parseSaveWindowParams(params);

  const knownCategories = new Set((await getCategories()).map((c) => c.id));
  const unknown = categoryIds.filter((id) => !knownCategories.has(id));
  if (unknown.length > 0) {
    throw new BridgeFailure(
      'not_found',
      `No category with id ${unknown.join(', ')}. Call list_categories for current ids.`,
    );
  }

  const windowId = await resolveWindow(requested);
  const existing = await getSnapshots();
  const owner = existing.find((s) => s.linkedWindowId === windowId);

  // A window that already belongs to a snapshot is saved as a plain copy, so
  // the new snapshot doesn't steal the link (and the nudge protection) from it.
  const snapshot = await createSnapshotFromWindow(
    windowId,
    getUniqueName(name, existing.map((s) => s.name)),
    { link: owner === undefined },
  );
  if (snapshot.tabs.length === 0) {
    throw new BridgeFailure('invalid_params', 'That window has no tabs to save.');
  }
  snapshot.categoryIds = categoryIds;
  await addSnapshot(snapshot);

  return {
    snapshotId: snapshot.id,
    name: snapshot.name,
    tabCount: snapshot.tabs.length,
    windowId,
    linkedToWindow: snapshot.linkedWindowId !== null,
    windowAlreadySavedAs: owner?.name ?? null,
  };
}
