import { describe, expect, it } from 'vitest';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import type { SiteStats } from './siteStats';
import { buildUsageStats } from './usageStats';
import { makeSnapshot } from '@/test/factories';

const NOW = 1_000_000_000_000;
const stat = (score: number, extra: Partial<SiteStats[string]> = {}) => ({
  score,
  lastVisitAt: NOW,
  hidden: false,
  ...extra,
});

describe('buildUsageStats', () => {
  const snapshots = [
    makeSnapshot({ name: 'Rarely', usageCount: 1 }),
    makeSnapshot({ name: 'Often', usageCount: 30, pinned: true }),
    makeSnapshot({ name: 'Never', usageCount: 0 }),
    makeSnapshot({ name: ARCHIVED_SNAPSHOT_NAME, usageCount: 99 }),
    makeSnapshot({ name: 'Sometimes', usageCount: 7 }),
  ];

  it('ranks snapshots by how often they are opened, leaving out Archived and never-opened ones', () => {
    const stats = buildUsageStats({ snapshots, siteStats: {}, siteTrackingEnabled: true, now: NOW });
    expect(stats.topSnapshots.map((s) => [s.name, s.usageCount])).toEqual([
      ['Often', 30],
      ['Sometimes', 7],
      ['Rarely', 1],
    ]);
    expect(stats.topSnapshots[0]).toMatchObject({ pinned: true });
  });

  it('honours the count', () => {
    expect(buildUsageStats({ snapshots, siteStats: {}, siteTrackingEnabled: true, now: NOW, count: 2 }).topSnapshots).toHaveLength(2);
  });

  it('lists top sites by domain with a rounded score, skipping hidden ones', () => {
    const siteStats: SiteStats = {
      'github.com': stat(12.345),
      'youtube.com': stat(20.04),
      'secret.test': stat(99, { hidden: true }),
    };
    const stats = buildUsageStats({ snapshots: [], siteStats, siteTrackingEnabled: true, now: NOW });
    expect(stats.topSites).toEqual([
      { domain: 'youtube.com', score: 20 },
      { domain: 'github.com', score: 12.3 },
    ]);
    expect(stats.siteTrackingEnabled).toBe(true);
  });

  it('reports no sites while Quick links is off, even if old data is stored', () => {
    const stats = buildUsageStats({
      snapshots: [],
      siteStats: { 'github.com': stat(10) },
      siteTrackingEnabled: false,
      now: NOW,
    });
    expect(stats.topSites).toEqual([]);
    expect(stats.siteTrackingEnabled).toBe(false);
  });

  it('exposes only domains, never pages or icons', () => {
    const stats = buildUsageStats({
      snapshots: [],
      siteStats: { 'github.com': stat(5, { favIconUrl: 'data:image/png;base64,AAAA' }) },
      siteTrackingEnabled: true,
      now: NOW,
    });
    expect(Object.keys(stats.topSites[0]!).sort()).toEqual(['domain', 'score']);
    expect(JSON.stringify(stats)).not.toContain('data:image');
  });
});
