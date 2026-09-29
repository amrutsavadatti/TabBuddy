import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { BridgeFailure } from './bridgeFailure';
import { addCategory } from './categories';
import { getManagedTabIds } from './managedTabs';
import { parseSaveWindowParams, saveWindow } from './agentSave';
import { addSnapshot, getSnapshots } from './storage';
import { makeSnapshot } from '@/test/factories';

describe('parseSaveWindowParams', () => {
  it('trims the name and removes duplicate category ids', () => {
    expect(parseSaveWindowParams({ name: '  Research  ', categoryIds: ['a', 'a', 'b'] })).toEqual({
      name: 'Research',
      windowId: undefined,
      categoryIds: ['a', 'b'],
    });
  });

  it('accepts a window id', () => {
    expect(parseSaveWindowParams({ name: 'X', windowId: 7 }).windowId).toBe(7);
  });

  it.each([
    [undefined],
    [{}],
    [{ name: '' }],
    [{ name: '   ' }],
    [{ name: 5 }],
    [{ name: 'x'.repeat(101) }],
    [{ name: 'X', windowId: '7' }],
    [{ name: 'X', windowId: 1.5 }],
    [{ name: 'X', categoryIds: 'a' }],
    [{ name: 'X', categoryIds: [1] }],
  ])('rejects %j as invalid_params', (params) => {
    try {
      parseSaveWindowParams(params);
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('invalid_params');
    }
  });

  it.each([['Archived'], ['archived'], ['  ARCHIVED ']])('rejects the reserved name %j', (name) => {
    try {
      parseSaveWindowParams({ name });
      expect.unreachable();
    } catch (error) {
      expect((error as BridgeFailure).code).toBe('reserved_name');
    }
  });
});

async function windowWithTabs(urls: string[]) {
  const win = (await fakeBrowser.windows.create({}))!;
  const tabs = [];
  for (const url of urls) tabs.push(await fakeBrowser.tabs.create({ windowId: win.id, url }));
  // the fake window starts with one blank tab
  for (const blank of (await fakeBrowser.tabs.query({ windowId: win.id })).filter((t) => !t.url)) {
    await fakeBrowser.tabs.remove(blank.id!);
  }
  return { win, tabs };
}

describe('saveWindow', () => {
  // fake-browser has no tabGroups.query (capture.test.ts mocks it the same way)
  beforeEach(() => {
    vi.spyOn(fakeBrowser as any, 'tabGroups', 'get').mockReturnValue({ query: async () => [] });
  });

  it('saves the window the user used last, linked to it', async () => {
    const { win, tabs } = await windowWithTabs(['https://a.test/', 'https://b.test/']);
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: win.id, incognito: false } as never);

    const result = await saveWindow({ name: 'Research' });

    expect(result).toEqual({
      snapshotId: expect.any(String),
      name: 'Research',
      tabCount: 2,
      windowId: win.id,
      linkedToWindow: true,
      windowAlreadySavedAs: null,
    });
    const [saved] = await getSnapshots();
    expect(saved).toMatchObject({ name: 'Research', linkedWindowId: win.id, usageCount: 0 });
    expect(saved!.tabs.map((t) => t.url)).toEqual(['https://a.test/', 'https://b.test/']);
    // the saved tabs are protected from nudges
    expect([...(await getManagedTabIds())].sort()).toEqual(tabs.map((t) => t.id!).sort());
  });

  it('saves the window it is told to, whichever the user used last', async () => {
    const { win } = await windowWithTabs(['https://a.test/']);
    const getLast = vi.spyOn(fakeBrowser.windows, 'getLastFocused');
    const result = await saveWindow({ name: 'Chosen', windowId: win.id });
    expect(getLast).not.toHaveBeenCalled();
    expect(result.windowId).toBe(win.id);
  });

  it('adds "(2)" when the name is taken and reports the name it used', async () => {
    const { win } = await windowWithTabs(['https://a.test/']);
    await addSnapshot(makeSnapshot({ name: 'Research' }));
    const result = await saveWindow({ name: 'Research', windowId: win.id });
    expect(result.name).toBe('Research (2)');
    expect((await getSnapshots()).map((s) => s.name)).toEqual(['Research', 'Research (2)']);
  });

  it('files the snapshot under the given categories', async () => {
    const { win } = await windowWithTabs(['https://a.test/']);
    const work = await addCategory('Work');
    await saveWindow({ name: 'Tagged', windowId: win.id, categoryIds: [work.id] });
    expect((await getSnapshots())[0]!.categoryIds).toEqual([work.id]);
  });

  it('checks the categories before saving anything', async () => {
    const { win } = await windowWithTabs(['https://a.test/']);
    await expect(saveWindow({ name: 'X', windowId: win.id, categoryIds: ['nope'] })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await getSnapshots()).toEqual([]);
    expect([...(await getManagedTabIds())]).toEqual([]);
  });

  it('saves a window that already belongs to a snapshot as an unlinked copy', async () => {
    const { win } = await windowWithTabs(['https://a.test/']);
    await addSnapshot(makeSnapshot({ name: 'Job Hunt', linkedWindowId: win.id ?? null }));

    const result = await saveWindow({ name: 'Copy', windowId: win.id });

    expect(result).toMatchObject({ linkedToWindow: false, windowAlreadySavedAs: 'Job Hunt' });
    const saved = (await getSnapshots()).find((s) => s.name === 'Copy')!;
    expect(saved.linkedWindowId).toBeNull();
    expect((await getSnapshots()).find((s) => s.name === 'Job Hunt')!.linkedWindowId).toBe(win.id);
    expect([...(await getManagedTabIds())]).toEqual([]);
  });

  it('refuses the reserved name without touching anything', async () => {
    const { win } = await windowWithTabs(['https://a.test/']);
    await expect(saveWindow({ name: 'archived', windowId: win.id })).rejects.toMatchObject({ code: 'reserved_name' });
    expect(await getSnapshots()).toEqual([]);
  });

  it('treats an incognito window as not found', async () => {
    vi.spyOn(fakeBrowser.windows, 'get').mockResolvedValue({ id: 5, incognito: true } as never);
    await expect(saveWindow({ name: 'X', windowId: 5 })).rejects.toMatchObject({ code: 'not_found' });
    expect(await getSnapshots()).toEqual([]);
  });

  it('asks for a windowId when the window used last is private', async () => {
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 5, incognito: true } as never);
    await expect(saveWindow({ name: 'X' })).rejects.toMatchObject({
      code: 'not_found',
      message: expect.stringContaining('windowId'),
    });
  });

  it('reports a window that does not exist', async () => {
    vi.spyOn(fakeBrowser.windows, 'get').mockRejectedValue(new Error('No window with id'));
    await expect(saveWindow({ name: 'X', windowId: 404 })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('only saves ordinary browser windows', async () => {
    vi.spyOn(fakeBrowser.windows, 'get').mockResolvedValue({ id: 9, incognito: false, type: 'popup' } as never);
    await expect(saveWindow({ name: 'X', windowId: 9 })).rejects.toMatchObject({ code: 'invalid_params' });
  });

  it('refuses a window with no tabs, leaving nothing behind', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([] as never);
    await expect(saveWindow({ name: 'X', windowId: win.id })).rejects.toMatchObject({ code: 'invalid_params' });
    expect(await getSnapshots()).toEqual([]);
  });
});
