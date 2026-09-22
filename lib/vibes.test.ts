import { describe, expect, it } from 'vitest';
import { getStoredVibe, setStoredVibe, VIBES } from './vibes';

describe('getStoredVibe', () => {
  it('defaults to meadow when nothing is stored', async () => {
    expect(await getStoredVibe()).toBe('meadow');
  });

  it('falls back to the default for an invalid stored value', async () => {
    await browser.storage.local.set({ uiVibe: 'not-a-real-vibe' });
    expect(await getStoredVibe()).toBe('meadow');
  });

  it('returns a previously stored valid vibe', async () => {
    await setStoredVibe('sunset');
    expect(await getStoredVibe()).toBe('sunset');
  });
});

describe('VIBES', () => {
  it('includes exactly the four documented vibes', () => {
    expect(VIBES.map((v) => v.id).sort()).toEqual(
      ['aurora', 'meadow', 'ocean', 'sunset'].sort(),
    );
  });
});
