import { describe, expect, it } from 'vitest';
import {
  chosenDomains,
  getQuickLinkSlots,
  isDomainInOtherSlot,
  normalizeSiteInput,
  setQuickLinkSlot,
} from './quickLinkSlots';

describe('normalizeSiteInput', () => {
  it('adds https and derives the domain', () => {
    expect(normalizeSiteInput('github.com')).toEqual({ url: 'https://github.com/', domain: 'github.com' });
  });

  it('keeps a full address so the exact page opens', () => {
    expect(normalizeSiteInput('https://mail.google.com/mail/u/1/#inbox')).toEqual({
      url: 'https://mail.google.com/mail/u/1/#inbox',
      domain: 'mail.google.com',
    });
  });

  it('strips www from the domain but not from the address', () => {
    const result = normalizeSiteInput('www.example.com/docs');
    expect(result?.domain).toBe('example.com');
    expect(result?.url).toBe('https://www.example.com/docs');
  });

  it('accepts http and localhost', () => {
    expect(normalizeSiteInput('http://example.org')?.domain).toBe('example.org');
    expect(normalizeSiteInput('localhost:3000')?.domain).toBe('localhost');
  });

  it('rejects things that are not sites', () => {
    expect(normalizeSiteInput('')).toBeNull();
    expect(normalizeSiteInput('   ')).toBeNull();
    expect(normalizeSiteInput('asdf')).toBeNull();
    expect(normalizeSiteInput('two words.com')).toBeNull();
    expect(normalizeSiteInput('chrome://settings')).toBeNull();
    expect(normalizeSiteInput('javascript:alert(1)')).toBeNull();
    expect(normalizeSiteInput('file:///etc/passwd')).toBeNull();
  });
});

describe('slot helpers', () => {
  const a = { url: 'https://a.com/', domain: 'a.com' };
  const b = { url: 'https://b.com/', domain: 'b.com' };

  it('detects a domain already used by another slot only', () => {
    expect(isDomainInOtherSlot([a, b, null], 1, 'a.com')).toBe(true);
    expect(isDomainInOtherSlot([a, b, null], 0, 'a.com')).toBe(false);
    expect(isDomainInOtherSlot([a, b, null], 2, 'c.com')).toBe(false);
  });

  it('lists the chosen domains, skipping empty slots', () => {
    expect([...chosenDomains([a, null, b])].sort()).toEqual(['a.com', 'b.com']);
  });
});

describe('stored slots', () => {
  const a = { url: 'https://a.com/', domain: 'a.com' };

  it('starts with three empty slots', async () => {
    expect(await getQuickLinkSlots()).toEqual([null, null, null]);
  });

  it('fills, replaces and empties a slot without touching the others', async () => {
    await setQuickLinkSlot(0, a);
    await setQuickLinkSlot(2, { url: 'https://c.com/', domain: 'c.com' });
    await setQuickLinkSlot(0, { url: 'https://z.com/', domain: 'z.com' });
    expect((await getQuickLinkSlots()).map((s) => s?.domain ?? null)).toEqual(['z.com', null, 'c.com']);
    await setQuickLinkSlot(0, null);
    expect((await getQuickLinkSlots()).map((s) => s?.domain ?? null)).toEqual([null, null, 'c.com']);
  });

  it('rejects a slot that does not exist', async () => {
    await expect(setQuickLinkSlot(3, a)).rejects.toThrow('does not exist');
    await expect(setQuickLinkSlot(-1, a)).rejects.toThrow('does not exist');
  });

  it('repairs malformed stored data', async () => {
    await browser.storage.local.set({ quickLinkSlots: [{ url: 5 }, 'x'] });
    expect(await getQuickLinkSlots()).toEqual([null, null, null]);
  });
});
