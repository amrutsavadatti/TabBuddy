import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { dispatch } from './agentBridge';

async function windowWith(urls: string[]) {
  const win = (await fakeBrowser.windows.create({}))!;
  for (const url of urls) await fakeBrowser.tabs.create({ windowId: win.id, url });
  // the fake window starts with one blank tab
  for (const blank of (await fakeBrowser.tabs.query({ windowId: win.id })).filter((t) => !t.url)) {
    await fakeBrowser.tabs.remove(blank.id!);
  }
  return win;
}

describe('findDuplicateTabs through the dispatcher', () => {
  it('finds duplicates in a window', async () => {
    const win = await windowWith(['https://a.test/p', 'https://a.test/p?utm_source=x', 'https://b.test/']);
    const response = (await dispatch({ id: 'd', method: 'findDuplicateTabs', params: { windowId: win.id } })) as any;
    expect(response.result.groupCount).toBe(1);
    expect(response.result.extraTabCount).toBe(1);
  });

  it('answers not_found for a window it cannot see, and invalid_params for a bad id', async () => {
    expect(await dispatch({ id: 'd', method: 'findDuplicateTabs', params: { windowId: 987654 } })).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(await dispatch({ id: 'd', method: 'findDuplicateTabs', params: { windowId: 'one' } })).toMatchObject({
      error: { code: 'invalid_params' },
    });
  });
});

describe('summarizeWindow through the dispatcher', () => {
  it('summarizes the given window', async () => {
    const win = await windowWith(['https://a.test/1', 'https://a.test/2', 'https://b.test/']);
    const response = (await dispatch({ id: 's', method: 'summarizeWindow', params: { windowId: win.id } })) as any;
    expect(response.result).toMatchObject({ windowId: win.id, tabCount: 3 });
    expect(response.result.sites[0]).toMatchObject({ domain: 'a.test', tabCount: 2 });
  });

  it('summarizes the window used last when none is given', async () => {
    const win = await windowWith(['https://a.test/1']);
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: win.id, incognito: false } as never);
    const response = (await dispatch({ id: 's', method: 'summarizeWindow' })) as any;
    expect(response.result.windowId).toBe(win.id);
  });

  it('will not summarize an incognito window', async () => {
    vi.spyOn(fakeBrowser.windows, 'get').mockResolvedValue({ id: 5, incognito: true } as never);
    expect(await dispatch({ id: 's', method: 'summarizeWindow', params: { windowId: 5 } })).toMatchObject({
      error: { code: 'not_found' },
    });
  });
});
