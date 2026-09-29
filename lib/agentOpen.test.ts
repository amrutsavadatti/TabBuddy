import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MAX_OPEN_URLS } from '../bridge/protocol';
import { focusTab, openUrls, parseOpenUrlsParams, parseTabId } from './agentOpen';
import { BridgeFailure } from './bridgeFailure';

describe('parseOpenUrlsParams', () => {
  it('accepts http and https addresses and normalises them', () => {
    expect(parseOpenUrlsParams({ urls: ['https://example.com', 'HTTP://Example.org/a b'] })).toEqual({
      urls: ['https://example.com/', 'http://example.org/a%20b'],
      newWindow: false,
    });
  });

  it('passes newWindow through', () => {
    expect(parseOpenUrlsParams({ urls: ['https://a.test'], newWindow: true }).newWindow).toBe(true);
  });

  it.each([
    ['javascript:alert(1)'],
    ['file:///etc/passwd'],
    ['chrome://settings'],
    ['chrome-extension://abc/dashboard.html'],
    ['data:text/html,<h1>x</h1>'],
    ['about:blank'],
    ['ftp://files.test/'],
    ['not a url'],
    [''],
  ])('refuses %s', (bad) => {
    expect(() => parseOpenUrlsParams({ urls: ['https://ok.test/', bad] })).toThrow(BridgeFailure);
  });

  it('opens nothing if any address is bad, and names the bad ones', () => {
    try {
      parseOpenUrlsParams({ urls: ['https://ok.test/', 'javascript:x', 'file:///y'] });
      expect.unreachable();
    } catch (error) {
      const failure = error as BridgeFailure;
      expect(failure.code).toBe('invalid_params');
      expect(failure.message).toContain('Nothing was opened');
      expect(failure.message).toContain('javascript:x');
      expect(failure.message).toContain('file:///y');
      expect(failure.message).not.toContain('ok.test');
    }
  });

  it.each([
    [undefined],
    [{}],
    [{ urls: [] }],
    [{ urls: 'https://a.test' }],
    [{ urls: [5] }],
    [{ urls: [null] }],
    [{ urls: ['https://a.test'], newWindow: 'yes' }],
  ])('rejects %j', (params) => {
    expect(() => parseOpenUrlsParams(params)).toThrow(BridgeFailure);
  });

  it('caps how many pages open at once', () => {
    const urls = Array.from({ length: MAX_OPEN_URLS + 1 }, (_, i) => `https://s${i}.test/`);
    expect(() => parseOpenUrlsParams({ urls })).toThrow(/at most 25/);
    expect(parseOpenUrlsParams({ urls: urls.slice(0, MAX_OPEN_URLS) }).urls).toHaveLength(MAX_OPEN_URLS);
  });

  it('cuts very long values in the error', () => {
    try {
      parseOpenUrlsParams({ urls: ['javascript:' + 'x'.repeat(500)] });
    } catch (error) {
      expect((error as Error).message.length).toBeLessThan(250);
    }
  });
});

describe('openUrls', () => {
  it('adds tabs to the window the user used last, first one in front', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: win.id, incognito: false } as never);
    const create = vi.spyOn(fakeBrowser.tabs, 'create');

    const result = await openUrls(['https://a.test/', 'https://b.test/'], false);

    expect(result.windowId).toBe(win.id);
    expect(result.openedInNewWindow).toBe(false);
    expect(result.tabs.map((t) => t.url)).toEqual(['https://a.test/', 'https://b.test/']);
    expect(create.mock.calls.map(([props]) => [props.url, props.active])).toEqual([
      ['https://a.test/', true],
      ['https://b.test/', false],
    ]);
  });

  // fake-browser creates the window but never the tabs for a `url` list, so
  // windows.create is mocked to answer the way Chrome does.
  const chromeWindow = (id: number, urls: string[]) =>
    ({ id, incognito: false, tabs: urls.map((url, i) => ({ id: id * 10 + i, url })) }) as never;

  it('opens a new window when asked, with every page in it', async () => {
    const create = vi
      .spyOn(fakeBrowser.windows, 'create')
      .mockResolvedValue(chromeWindow(50, ['https://a.test/', 'https://b.test/']));
    const result = await openUrls(['https://a.test/', 'https://b.test/'], true);
    expect(create).toHaveBeenCalledWith({ url: ['https://a.test/', 'https://b.test/'], focused: true });
    expect(result).toEqual({
      windowId: 50,
      openedInNewWindow: true,
      tabs: [
        { tabId: 500, url: 'https://a.test/' },
        { tabId: 501, url: 'https://b.test/' },
      ],
    });
  });

  it('reads the tabs back when the browser does not return them', async () => {
    vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue({ id: 60, incognito: false } as never);
    vi.spyOn(fakeBrowser.tabs, 'query').mockResolvedValue([{ id: 601, url: 'https://a.test/' }] as never);
    const result = await openUrls(['https://a.test/'], true);
    expect(result).toEqual({
      windowId: 60,
      openedInNewWindow: true,
      tabs: [{ tabId: 601, url: 'https://a.test/' }],
    });
  });

  it('never adds to an incognito window: it opens a new one instead', async () => {
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 999, incognito: true } as never);
    vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue(chromeWindow(70, ['https://a.test/']));
    const tabsCreate = vi.spyOn(fakeBrowser.tabs, 'create');
    const result = await openUrls(['https://a.test/'], false);
    expect(tabsCreate).not.toHaveBeenCalled();
    expect(result.windowId).toBe(70);
  });

  it("uses a new window when the last one belongs to a saved snapshot, so the tabs can't be saved into it", async () => {
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: 33, incognito: false } as never);
    vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue(chromeWindow(90, ['https://a.test/']));
    const tabsCreate = vi.spyOn(fakeBrowser.tabs, 'create');

    const result = await openUrls(['https://a.test/'], false, new Set([33]));

    expect(tabsCreate).not.toHaveBeenCalled();
    expect(result.windowId).toBe(90);
    expect(result.openedInNewWindow).toBe(true);
  });

  it('still uses the last window when it does not belong to a snapshot', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockResolvedValue({ id: win.id, incognito: false } as never);
    const result = await openUrls(['https://a.test/'], false, new Set([12345]));
    expect(result.windowId).toBe(win.id);
    expect(result.openedInNewWindow).toBe(false);
  });

  it('opens a new window when there is no usable one', async () => {
    vi.spyOn(fakeBrowser.windows, 'getLastFocused').mockRejectedValue(new Error('no window'));
    vi.spyOn(fakeBrowser.windows, 'create').mockResolvedValue(chromeWindow(80, ['https://a.test/']));
    const result = await openUrls(['https://a.test/'], false);
    expect(result.windowId).toBe(80);
    expect(result.tabs).toHaveLength(1);
  });
});

describe('parseTabId', () => {
  it('accepts a whole number and rejects anything else', () => {
    expect(parseTabId({ tabId: 12 })).toBe(12);
    for (const bad of [undefined, {}, { tabId: '12' }, { tabId: 1.5 }, { tabId: null }]) {
      expect(() => parseTabId(bad)).toThrow(BridgeFailure);
    }
  });
});

describe('focusTab', () => {
  it('activates the tab and brings its window forward', async () => {
    const win = (await fakeBrowser.windows.create({}))!;
    const tab = await fakeBrowser.tabs.create({ windowId: win.id, url: 'https://a.test/' });
    const updateTab = vi.spyOn(fakeBrowser.tabs, 'update');
    const updateWindow = vi.spyOn(fakeBrowser.windows, 'update');

    const result = await focusTab(tab.id!);

    expect(updateTab).toHaveBeenCalledWith(tab.id, { active: true });
    expect(updateWindow).toHaveBeenCalledWith(win.id, { focused: true });
    expect(result).toMatchObject({ tabId: tab.id, windowId: win.id, url: 'https://a.test/' });
  });

  it('reports not_found for a tab that is gone', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockRejectedValue(new Error('No tab with id'));
    await expect(focusTab(12345)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('treats an incognito tab as not found, and leaves it alone', async () => {
    vi.spyOn(fakeBrowser.tabs, 'get').mockResolvedValue({ id: 5, windowId: 1, incognito: true } as never);
    const update = vi.spyOn(fakeBrowser.tabs, 'update');
    await expect(focusTab(5)).rejects.toMatchObject({ code: 'not_found' });
    expect(update).not.toHaveBeenCalled();
  });
});
