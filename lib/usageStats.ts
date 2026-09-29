import { MAX_USAGE_ITEMS, type UsageStats } from '../bridge/protocol';
import { getTopSites, type SiteStats } from './siteStats';
import { getMostUsedSnapshots } from './sort';
import type { Snapshot } from './types';

export interface UsageOptions {
  snapshots: Snapshot[];
  siteStats: SiteStats;
  siteTrackingEnabled: boolean;
  now: number;
  count?: number;
}

/** Pure: what the user opens and visits most. Sites are reported by domain
 * only, and not at all while the user has Quick links (visit counting)
 * switched off, even if older data is still stored. Hidden sites stay hidden. */
export function buildUsageStats({
  snapshots,
  siteStats,
  siteTrackingEnabled,
  now,
  count = 5,
}: UsageOptions): UsageStats {
  const n = Math.min(count, MAX_USAGE_ITEMS);
  return {
    topSnapshots: getMostUsedSnapshots(snapshots, n).map((s) => ({
      id: s.id,
      name: s.name,
      usageCount: s.usageCount,
      pinned: s.pinned,
      updatedAt: s.updatedAt,
    })),
    topSites: siteTrackingEnabled
      ? getTopSites(siteStats, now, n).map(({ domain, score }) => ({
          domain,
          score: Math.round(score * 10) / 10,
        }))
      : [],
    siteTrackingEnabled,
  };
}
