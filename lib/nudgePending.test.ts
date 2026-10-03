import { describe, expect, it, vi } from 'vitest';
import { getAskedMap } from './nudgeAsked';
import { getPendingNudge, presentNextNudge } from './nudgePending';

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
