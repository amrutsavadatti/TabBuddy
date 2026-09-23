import { describe, expect, it } from 'vitest';
import { buildLazyTabUrl, isHttpUrl, resolveLazyTab } from './lazyTab';

describe('isHttpUrl', () => {
  it('accepts only http and https', () => {
    expect(isHttpUrl('https://a.com')).toBe(true);
    expect(isHttpUrl('http://a.com')).toBe(true);
    expect(isHttpUrl('chrome://settings')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl(undefined)).toBe(false);
  });
});

describe('buildLazyTabUrl / resolveLazyTab', () => {
  it('round-trips the real url, title and favicon', () => {
    const lazy = buildLazyTabUrl({
      url: 'https://a.com/x?y=1&z=2',
      title: 'Hello & welcome',
      favIconUrl: 'https://a.com/icon.png',
    });
    expect(lazy).toContain('lazy.html');
    expect(resolveLazyTab({ url: lazy, title: 'a.com' })).toEqual({
      url: 'https://a.com/x?y=1&z=2',
      title: 'Hello & welcome',
      favIconUrl: 'https://a.com/icon.png',
    });
  });

  it('leaves ordinary tabs untouched', () => {
    const tab = { url: 'https://a.com/', title: 'A' };
    expect(resolveLazyTab(tab)).toBe(tab);
  });

  it('refuses a placeholder whose target is not http(s)', () => {
    const bad = buildLazyTabUrl({ url: 'javascript:alert(1)' });
    const tab = { url: bad, title: 'x' };
    expect(resolveLazyTab(tab)).toBe(tab);
  });
});
