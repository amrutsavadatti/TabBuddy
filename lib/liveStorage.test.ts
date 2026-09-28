import { describe, expect, it } from 'vitest';
import { makeSnapshot } from '@/test/factories';
import { interpretStorageChange } from './liveStorage';

describe('interpretStorageChange', () => {
  it('ignores other storage areas', () => {
    expect(interpretStorageChange({ snapshots: { newValue: [] } }, 'session')).toBeNull();
    expect(interpretStorageChange({ snapshots: { newValue: [] } }, 'sync')).toBeNull();
  });

  it('ignores keys the dashboard does not show', () => {
    expect(interpretStorageChange({ nudgeSnoozes: { newValue: {} } }, 'local')).toBeNull();
    expect(interpretStorageChange({ managedTabs: { newValue: {} } }, 'local')).toBeNull();
  });

  it('returns the new snapshots, filling in a missing categoryIds', () => {
    const legacy = { ...makeSnapshot() } as Partial<ReturnType<typeof makeSnapshot>>;
    delete legacy.categoryIds;
    const result = interpretStorageChange({ snapshots: { newValue: [legacy] } }, 'local');
    expect(result?.snapshots).toHaveLength(1);
    expect(result?.snapshots?.[0]?.categoryIds).toEqual([]);
    expect(result?.settings).toBe(false);
  });

  it('treats a removed snapshots key as an empty list', () => {
    expect(interpretStorageChange({ snapshots: {} }, 'local')?.snapshots).toEqual([]);
  });

  it('returns new categories', () => {
    const cats = [{ id: 'a', name: 'Work', color: null, createdAt: 1 }];
    expect(interpretStorageChange({ categories: { newValue: cats } }, 'local')?.categories).toEqual(cats);
  });

  it('returns the new visit stats, or an empty set when they were cleared', () => {
    const stats = { 'a.com': { score: 1, lastVisitAt: 1, hidden: false } };
    expect(interpretStorageChange({ siteStats: { newValue: stats } }, 'local')?.siteStats).toEqual(stats);
    expect(interpretStorageChange({ siteStats: {} }, 'local')?.siteStats).toEqual({});
  });

  it('returns the new quick link slots, padded to three', () => {
    const slots = [{ url: 'https://a.com/', domain: 'a.com' }];
    expect(
      interpretStorageChange({ quickLinkSlots: { newValue: slots } }, 'local')?.quickLinkSlots,
    ).toEqual([{ url: 'https://a.com/', domain: 'a.com' }, null, null]);
  });

  it('flags every dashboard setting', () => {
    for (const key of [
      'hoverPeekEnabled',
      'lazyRestoreEnabled',
      'nudgeEnabled',
      'nudgeIntervalMinutes',
      'nudgeStaleMinutes',
      'quickLinksEnabled',
    ]) {
      expect(interpretStorageChange({ [key]: { newValue: 1 } }, 'local')?.settings).toBe(true);
    }
  });

  it('reports snapshots and settings changing together', () => {
    const result = interpretStorageChange(
      { snapshots: { newValue: [] }, hoverPeekEnabled: { newValue: false } },
      'local',
    );
    expect(result?.snapshots).toEqual([]);
    expect(result?.settings).toBe(true);
  });
});
