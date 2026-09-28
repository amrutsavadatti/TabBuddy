import { describe, expect, it } from 'vitest';
import { getQuickLinksEnabled, setQuickLinksEnabled } from './quickLinksSetting';

describe('getQuickLinksEnabled', () => {
  it('defaults to on', async () => {
    expect(await getQuickLinksEnabled()).toBe(true);
  });

  it('respects a stored off and on', async () => {
    await setQuickLinksEnabled(false);
    expect(await getQuickLinksEnabled()).toBe(false);
    await setQuickLinksEnabled(true);
    expect(await getQuickLinksEnabled()).toBe(true);
  });
});
