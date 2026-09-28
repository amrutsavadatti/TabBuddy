import { describe, expect, it, vi } from 'vitest';
import { buildLazyTabUrl } from './lazyTab';
import { focusOrOpenSite, pickTabForDomain } from './quickLinks';

describe('pickTabForDomain', () => {
  it('finds a tab on the domain, ignoring www and paths', () => {
    const tabs = [
      { id: 1, url: 'https://other.com/' },
      { id: 2, url: 'https://www.github.com/org/repo' },
    ];
    expect(pickTabForDomain(tabs, 'github.com')?.id).toBe(2);
  });

  it('prefers the most recently used tab', () => {
    const tabs = [
      { id: 1, url: 'https://github.com/a', lastAccessed: 100 },
      { id: 2, url: 'https://github.com/b', lastAccessed: 900 },
      { id: 3, url: 'https://github.com/c', lastAccessed: 500 },
    ];
    expect(pickTabForDomain(tabs, 'github.com')?.id).toBe(2);
  });

  it('matches a lazy placeholder to the page it stands for', () => {
    const lazy = buildLazyTabUrl({ url: 'https://docs.example.com/x' });
    expect(pickTabForDomain([{ id: 5, url: lazy }], 'docs.example.com')?.id).toBe(5);
  });

  it('does not match a different subdomain', () => {
    expect(pickTabForDomain([{ id: 1, url: 'https://mail.google.com/' }], 'google.com')).toBeUndefined();
  });

  it('returns nothing when the site is not open', () => {
    expect(pickTabForDomain([{ id: 1, url: 'https://a.com/' }], 'b.com')).toBeUndefined();
  });
});

describe('focusOrOpenSite', () => {
  it('activates an open tab and focuses its window', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([
      { id: 7, windowId: 3, url: 'https://github.com/x' },
    ] as any);
    const updateTab = vi.spyOn(browser.tabs, 'update').mockResolvedValue({} as any);
    const updateWindow = vi.spyOn(browser.windows, 'update').mockResolvedValue({} as any);
    const create = vi.spyOn(browser.tabs, 'create');

    await focusOrOpenSite('github.com');

    expect(updateTab).toHaveBeenCalledWith(7, { active: true });
    expect(updateWindow).toHaveBeenCalledWith(3, { focused: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('opens the chosen address when given one and the site is not open', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([] as any);
    const create = vi.spyOn(browser.tabs, 'create').mockResolvedValue({} as any);

    await focusOrOpenSite('mail.google.com', 'https://mail.google.com/mail/u/1/');

    expect(create).toHaveBeenCalledWith({ url: 'https://mail.google.com/mail/u/1/' });
  });

  it('opens a new tab when the site is not open', async () => {
    vi.spyOn(browser.tabs, 'query').mockResolvedValue([] as any);
    const create = vi.spyOn(browser.tabs, 'create').mockResolvedValue({} as any);

    await focusOrOpenSite('github.com');

    expect(create).toHaveBeenCalledWith({ url: 'https://github.com' });
  });
});
