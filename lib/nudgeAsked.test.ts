import { describe, expect, it } from 'vitest';
import {
  forgetAsked,
  getAskedMap,
  markAsked,
  orderByLeastRecentlyAsked,
} from './nudgeAsked';

describe('asked record', () => {
  it('starts empty', async () => {
    expect((await getAskedMap()).size).toBe(0);
  });

  it('remembers when a tab was last asked about', async () => {
    await markAsked(7, 1000);
    await markAsked(7, 2000);
    expect((await getAskedMap()).get(7)).toBe(2000);
  });

  it('forgets a tab, and forgetting an unknown tab is a no-op', async () => {
    await markAsked(1, 10);
    await markAsked(2, 20);
    await forgetAsked(1);
    await forgetAsked(99);
    expect([...(await getAskedMap()).keys()]).toEqual([2]);
  });

  it('keeps it in session storage, not persistent storage', async () => {
    await markAsked(1, 10);
    expect(await browser.storage.local.get(null)).toEqual({});
  });
});

describe('orderByLeastRecentlyAsked', () => {
  it('puts never-asked tabs first and keeps their original order', () => {
    expect(orderByLeastRecentlyAsked([3, 1, 2], new Map())).toEqual([3, 1, 2]);
  });

  it('orders asked tabs by how long ago they were asked about', () => {
    const asked = new Map([[1, 300], [2, 100], [3, 200]]);
    expect(orderByLeastRecentlyAsked([1, 2, 3], asked)).toEqual([2, 3, 1]);
  });

  it('sends a just-asked tab behind tabs that have never been asked', () => {
    const asked = new Map([[1, 500]]);
    expect(orderByLeastRecentlyAsked([1, 2, 3], asked)).toEqual([2, 3, 1]);
  });
});
