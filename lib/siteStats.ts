import { getQuickLinksEnabled } from './quickLinksSetting';

export const SITE_STATS_KEY = 'siteStats';

/** A site counts at most once per this window, however many times its tabs
 * are focused or reloaded. */
export const VISIT_REPEAT_WINDOW_MS = 30 * 60 * 1000;
/** Scores halve every two weeks, so "most visited" follows recent habits. */
export const SCORE_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_TRACKED_SITES = 200;
const MAX_FAVICON_LENGTH = 500;

export interface SiteStat {
  /** Visit score as of `lastVisitAt`; it only changes when a visit is counted. */
  score: number;
  lastVisitAt: number;
  favIconUrl?: string;
  hidden: boolean;
}

export type SiteStats = Record<string, SiteStat>;

/** The domain a visit is filed under: web pages only, lowercased, without a
 * leading "www.". Browser pages, extension pages and files are ignored. */
export function getDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export function decayedScore(stat: SiteStat, now: number): number {
  const age = Math.max(0, now - stat.lastVisitAt);
  return stat.score * Math.pow(0.5, age / SCORE_HALF_LIFE_MS);
}

function usableFavicon(favIconUrl: string | undefined): string | undefined {
  if (!favIconUrl || favIconUrl.length > MAX_FAVICON_LENGTH) return undefined;
  return /^https?:\/\//i.test(favIconUrl) ? favIconUrl : undefined;
}

/** Pure update: returns new stats and whether a visit was counted. A visit
 * within the repeat window of the last one is not counted, but still refreshes
 * the site's icon. */
export function applyVisit(
  stats: SiteStats,
  domain: string,
  now: number,
  favIconUrl?: string,
): { stats: SiteStats; counted: boolean } {
  const existing = stats[domain];
  const icon = usableFavicon(favIconUrl);

  if (existing && now - existing.lastVisitAt < VISIT_REPEAT_WINDOW_MS) {
    if (!icon || icon === existing.favIconUrl) return { stats, counted: false };
    return { stats: { ...stats, [domain]: { ...existing, favIconUrl: icon } }, counted: false };
  }

  const next: SiteStat = {
    score: (existing ? decayedScore(existing, now) : 0) + 1,
    lastVisitAt: now,
    favIconUrl: icon ?? existing?.favIconUrl,
    hidden: existing?.hidden ?? false,
  };
  return { stats: { ...stats, [domain]: next }, counted: true };
}

/** Keeps every hidden site (dropping one would silently unhide it) and the
 * highest scoring others, so storage cannot grow without bound. */
export function pruneStats(stats: SiteStats, now: number, max = MAX_TRACKED_SITES): SiteStats {
  const entries = Object.entries(stats);
  const hidden = entries.filter(([, s]) => s.hidden);
  const visible = entries
    .filter(([, s]) => !s.hidden)
    .sort(([, a], [, b]) => decayedScore(b, now) - decayedScore(a, now))
    .slice(0, max);
  return Object.fromEntries([...hidden, ...visible]);
}

/** Domains the user hid, in alphabetical order. */
export function getHiddenSites(stats: SiteStats): string[] {
  return Object.entries(stats)
    .filter(([, s]) => s.hidden)
    .map(([domain]) => domain)
    .sort();
}

export interface TopSite {
  domain: string;
  score: number;
  favIconUrl?: string;
}

/** The most visited sites right now, most visited first. Hidden sites and
 * anything in `exclude` are skipped. */
export function getTopSites(
  stats: SiteStats,
  now: number,
  count: number,
  exclude: ReadonlySet<string> = new Set(),
): TopSite[] {
  return Object.entries(stats)
    .filter(([domain, s]) => !s.hidden && !exclude.has(domain))
    .map(([domain, s]) => ({
      domain,
      score: decayedScore(s, now),
      favIconUrl: s.favIconUrl,
      lastVisitAt: s.lastVisitAt,
    }))
    .sort((a, b) => b.score - a.score || b.lastVisitAt - a.lastVisitAt)
    .slice(0, count)
    .map(({ domain, score, favIconUrl }) => ({ domain, score, favIconUrl }));
}

// ---- storage ----

export async function getSiteStats(): Promise<SiteStats> {
  const result = await browser.storage.local.get(SITE_STATS_KEY);
  return (result[SITE_STATS_KEY] as SiteStats | undefined) ?? {};
}

async function saveSiteStats(stats: SiteStats): Promise<void> {
  await browser.storage.local.set({ [SITE_STATS_KEY]: stats });
}

// Visit events arrive in bursts (activate + load); running the read-modify-write
// one at a time stops two of them from overwriting each other.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** Records that the user is looking at this page. Returns whether it counted. */
export async function recordSiteVisit(
  url: string | undefined,
  favIconUrl?: string,
  now: number = Date.now(),
): Promise<boolean> {
  const domain = getDomain(url);
  if (!domain) return false;
  // Quick links switched off: count nothing.
  if (!(await getQuickLinksEnabled())) return false;
  return serialized(async () => {
    const { stats, counted } = applyVisit(await getSiteStats(), domain, now, favIconUrl);
    await saveSiteStats(pruneStats(stats, now));
    return counted;
  });
}

export function setSiteHidden(domain: string, hidden: boolean): Promise<void> {
  return serialized(async () => {
    const stats = await getSiteStats();
    const existing = stats[domain];
    if (!existing) {
      if (!hidden) return;
      // Hiding a site we have not counted yet still has to stick.
      stats[domain] = { score: 0, lastVisitAt: 0, hidden: true };
    } else if (!hidden && existing.score === 0 && existing.lastVisitAt === 0) {
      // Only ever existed as "hidden before it was counted": nothing to keep.
      delete stats[domain];
    } else {
      stats[domain] = { ...existing, hidden };
    }
    await saveSiteStats(stats);
  });
}

export function clearSiteStats(): Promise<void> {
  return serialized(async () => {
    await browser.storage.local.remove(SITE_STATS_KEY);
  });
}
