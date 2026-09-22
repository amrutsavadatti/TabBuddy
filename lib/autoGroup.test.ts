import { describe, expect, it, vi } from 'vitest';
import { autoGroupByDomain } from './autoGroup';

describe('autoGroupByDomain', () => {
  it('groups tabs that share a hostname (stripping www.)', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://linkedin.com/in/a' },
      { id: 2, url: 'https://www.linkedin.com/in/b' },
      { id: 3, url: 'https://youtube.com/watch?v=1' },
    ] as any);
    const groupSpy = vi.spyOn(browser.tabs as any, 'group').mockResolvedValue(101);
    const updateSpy = vi.spyOn(browser.tabGroups as any, 'update').mockResolvedValue({});

    const count = await autoGroupByDomain(1);

    expect(count).toBe(1);
    expect(groupSpy).toHaveBeenCalledTimes(1);
    expect(groupSpy).toHaveBeenCalledWith({
      tabIds: [1, 2],
      createProperties: { windowId: 1 },
    });
    expect(updateSpy).toHaveBeenCalledWith(101, {
      title: 'linkedin.com',
      color: expect.any(String),
    });
  });

  it('does not group a hostname with only one tab', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://linkedin.com/in/a' },
      { id: 2, url: 'https://youtube.com/watch?v=1' },
    ] as any);
    const groupSpy = vi.spyOn(browser.tabs as any, 'group').mockResolvedValue(1);

    const count = await autoGroupByDomain(1);

    expect(count).toBe(0);
    expect(groupSpy).not.toHaveBeenCalled();
  });

  it('skips tabs with missing or invalid URLs', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 1, url: undefined },
      { id: 2, url: 'not a url' },
      { id: 3 },
    ] as any);
    const groupSpy = vi.spyOn(browser.tabs as any, 'group');

    const count = await autoGroupByDomain(1);
    expect(count).toBe(0);
    expect(groupSpy).not.toHaveBeenCalled();
  });

  it('assigns the same color to the same hostname consistently', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 1, url: 'https://linkedin.com/a' },
      { id: 2, url: 'https://linkedin.com/b' },
    ] as any);
    vi.spyOn(browser.tabs as any, 'group').mockResolvedValue(1);
    const updateSpy = vi.spyOn(browser.tabGroups as any, 'update').mockResolvedValue({});

    await autoGroupByDomain(1);
    const firstColor = (updateSpy.mock.calls[0]![1] as any).color;

    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 3, url: 'https://linkedin.com/c' },
      { id: 4, url: 'https://linkedin.com/d' },
    ] as any);
    await autoGroupByDomain(2);
    const secondColor = (updateSpy.mock.calls[1]![1] as any).color;

    expect(firstColor).toBe(secondColor);
  });
});
