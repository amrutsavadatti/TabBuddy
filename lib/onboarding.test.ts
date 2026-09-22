import { describe, expect, it } from 'vitest';
import { getHasSeenOnboarding, setHasSeenOnboarding } from './onboarding';

describe('getHasSeenOnboarding', () => {
  it('defaults to false for a first-time user', async () => {
    expect(await getHasSeenOnboarding()).toBe(false);
  });

  it('returns true after being marked seen', async () => {
    await setHasSeenOnboarding(true);
    expect(await getHasSeenOnboarding()).toBe(true);
  });
});
