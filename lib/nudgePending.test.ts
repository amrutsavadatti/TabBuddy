import { describe, expect, it, vi } from 'vitest';
import { getAskedMap } from './nudgeAsked';
import {
  clearPendingNudgeFor,
  getPendingNudge,
  getPendingNudgeTab,
  jumpToTab,
  presentNextNudge,
} from './nudgePending';

function mockBrowser() {
  vi.spyOn(browser.tabs, 'get').mockResolvedValue({ id: 7, windowId: 1 } as any);
  vi.spyOn(browser.windows, 'update').mockResolvedValue({} as any);
  vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
  vi.spyOn(browser.action, 'setBadgeText').mockResolvedValue(undefined as any);
  return vi.spyOn(browser.action, 'openPopup').mockResolvedValue(undefined as any);
}

describe('presentNextNudge', () => {
  it('switches to the first candidate, remembers the question and opens the popup', async () => {
    const openPopup = mockBrowser();
    const tabsUpdate = vi.spyOn(browser.tabs, 'update');

    expect(await presentNextNudge([7, 8])).toBe(7);

    expect(tabsUpdate).toHaveBeenCalledWith(7, { active: true });
    expect(openPopup).toHaveBeenCalledTimes(1);
    expect((await getPendingNudge())?.tabId).toBe(7);
    expect((await getAskedMap()).has(7)).toBe(true);
    expect((await getAskedMap()).has(8)).toBe(false);
  });

  it('still records the question when the popup cannot auto-open', async () => {
    mockBrowser().mockRejectedValue(new Error('no focused window'));
    expect(await presentNextNudge([7])).toBe(7);
    expect((await getPendingNudge())?.tabId).toBe(7);
  });

  it('asks nothing while a question is still waiting', async () => {
    const openPopup = mockBrowser();
    await presentNextNudge([7]);
    openPopup.mockClear();

    expect(await presentNextNudge([8])).toBeNull();
    expect(openPopup).not.toHaveBeenCalled();
  });

  it('asks nothing when there are no candidates', async () => {
    const openPopup = mockBrowser();
    expect(await presentNextNudge([])).toBeNull();
    expect(openPopup).not.toHaveBeenCalled();
  });
});

describe('clearPendingNudgeFor', () => {
  it('clears the question only when it is about that tab', async () => {
    mockBrowser();
    await presentNextNudge([7]);

    await clearPendingNudgeFor(8);
    expect((await getPendingNudge())?.tabId).toBe(7);

    await clearPendingNudgeFor(7);
    expect(await getPendingNudge()).toBeNull();
  });
});

describe('jumpToTab', () => {
  it('activates the tab and focuses its window', async () => {
    mockBrowser();
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({ id: 7, windowId: 3 } as any);
    const focus = vi.spyOn(browser.windows, 'update');
    const activate = vi.spyOn(browser.tabs, 'update');

    await jumpToTab(7);

    expect(focus).toHaveBeenCalledWith(3, { focused: true });
    expect(activate).toHaveBeenCalledWith(7, { active: true });
  });

  it('activates the tab before focusing the window, which can close the popup', async () => {
    mockBrowser();
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({ id: 7, windowId: 3 } as any);
    const activate = vi.spyOn(browser.tabs, 'update');
    const focus = vi.spyOn(browser.windows, 'update');

    await jumpToTab(7);

    expect(activate.mock.invocationCallOrder[0]!).toBeLessThan(focus.mock.invocationCallOrder[0]!);
  });
});

describe('getPendingNudgeTab', () => {
  it('is null when nothing is pending', async () => {
    expect(await getPendingNudgeTab()).toBeNull();
  });

  it('describes the tab being asked about', async () => {
    mockBrowser();
    await presentNextNudge([7]);
    vi.spyOn(browser.tabs, 'get').mockResolvedValue({
      id: 7,
      title: 'Old page',
      url: 'https://old.example/',
      pinned: false,
    } as any);

    expect(await getPendingNudgeTab()).toMatchObject({ id: 7, title: 'Old page', url: 'https://old.example/' });
  });

  it('drops the question when the tab is gone', async () => {
    mockBrowser();
    await presentNextNudge([7]);
    vi.spyOn(browser.tabs, 'get').mockRejectedValue(new Error('No tab'));

    expect(await getPendingNudgeTab()).toBeNull();
    expect(await getPendingNudge()).toBeNull();
  });
});
