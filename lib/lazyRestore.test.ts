import { describe, expect, it } from 'vitest';
import { getLazyRestoreEnabled, setLazyRestoreEnabled } from './lazyRestore';

describe('getLazyRestoreEnabled', () => {
  it('defaults to true when nothing is stored', async () => {
    expect(await getLazyRestoreEnabled()).toBe(true);
  });

  it('respects a stored false value', async () => {
    await setLazyRestoreEnabled(false);
    expect(await getLazyRestoreEnabled()).toBe(false);
  });

  it('respects a stored true value', async () => {
    await setLazyRestoreEnabled(false);
    await setLazyRestoreEnabled(true);
    expect(await getLazyRestoreEnabled()).toBe(true);
  });
});
