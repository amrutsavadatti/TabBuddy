import { describe, expect, it } from 'vitest';
import { getHoverPeekEnabled, setHoverPeekEnabled } from './peek';

describe('getHoverPeekEnabled', () => {
  it('defaults to true when nothing is stored', async () => {
    expect(await getHoverPeekEnabled()).toBe(true);
  });

  it('respects a stored false value', async () => {
    await setHoverPeekEnabled(false);
    expect(await getHoverPeekEnabled()).toBe(false);
  });

  it('respects a stored true value', async () => {
    await setHoverPeekEnabled(false);
    await setHoverPeekEnabled(true);
    expect(await getHoverPeekEnabled()).toBe(true);
  });
});
