import { describe, expect, it } from 'vitest';
import { getDashboardView, setDashboardView } from './dashboardView';

describe('dashboard view preference', () => {
  it('defaults to the simple view', async () => {
    expect(await getDashboardView()).toBe('simple');
  });

  it('remembers the categories view', async () => {
    await setDashboardView('categories');
    expect(await getDashboardView()).toBe('categories');
  });

  it('falls back to simple for an unrecognised stored value', async () => {
    await browser.storage.local.set({ dashboardView: 'grid-of-doom' });
    expect(await getDashboardView()).toBe('simple');
  });
});
