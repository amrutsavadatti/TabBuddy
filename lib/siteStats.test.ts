import { describe, expect, it } from 'vitest';
import { setQuickLinksEnabled } from './quickLinksSetting';
import {
  applyVisit,
  clearSiteStats,
  decayedScore,
  getDomain,
  getHiddenSites,
  getSiteStats,
  getTopSites,
  MAX_TRACKED_SITES,
  pruneStats,
  recordSiteVisit,
  SCORE_HALF_LIFE_MS,
  setSiteHidden,
  VISIT_REPEAT_WINDOW_MS,
  type SiteStats,
} from './siteStats';

const DAY = 24 * 60 * 60 * 1000;

describe('getDomain', () => {
  it('lowercases and strips a leading www', () => {
    expect(getDomain('https://WWW.GitHub.com/org/repo?x=1#top')).toBe('github.com');
  });

  it('keeps other subdomains distinct', () => {
    expect(getDomain('https://docs.google.com/d/1')).toBe('docs.google.com');
  });

  it('ignores anything that is not a web page', () => {
    expect(getDomain('chrome://settings')).toBeNull();
    expect(getDomain('chrome-extension://abc/dashboard.html')).toBeNull();
    expect(getDomain('file:///tmp/a.html')).toBeNull();
    expect(getDomain('about:blank')).toBeNull();
    expect(getDomain('')).toBeNull();
    expect(getDomain(undefined)).toBeNull();
    expect(getDomain('not a url')).toBeNull();
  });
});

describe('applyVisit', () => {
  it('counts a first visit', () => {
    const { stats, counted } = applyVisit({}, 'a.com', 1000);
    expect(counted).toBe(true);
    expect(stats['a.com']).toMatchObject({ score: 1, lastVisitAt: 1000, hidden: false });
  });

  it('does not count the same site again inside the repeat window', () => {
    const first = applyVisit({}, 'a.com', 1000).stats;
    const again = applyVisit(first, 'a.com', 1000 + VISIT_REPEAT_WINDOW_MS - 1);
    expect(again.counted).toBe(false);
    expect(again.stats['a.com']!.score).toBe(1);
  });

  it('counts it again once the window has passed', () => {
    const first = applyVisit({}, 'a.com', 1000).stats;
    const again = applyVisit(first, 'a.com', 1000 + VISIT_REPEAT_WINDOW_MS);
    expect(again.counted).toBe(true);
    expect(again.stats['a.com']!.score).toBeCloseTo(2, 2);
  });

  it('decays an older score before adding the new visit', () => {
    const old: SiteStats = { 'a.com': { score: 8, lastVisitAt: 0, hidden: false } };
    const { stats } = applyVisit(old, 'a.com', SCORE_HALF_LIFE_MS);
    expect(stats['a.com']!.score).toBeCloseTo(5, 5); // 8 * 0.5 + 1
  });

  it('remembers a web favicon, even from an uncounted visit', () => {
    const first = applyVisit({}, 'a.com', 1000).stats;
    const again = applyVisit(first, 'a.com', 2000, 'https://a.com/icon.png');
    expect(again.counted).toBe(false);
    expect(again.stats['a.com']!.favIconUrl).toBe('https://a.com/icon.png');
  });

  it('ignores oversized or non-web favicons', () => {
    expect(applyVisit({}, 'a.com', 1, 'data:image/png;base64,AAAA').stats['a.com']!.favIconUrl).toBeUndefined();
    expect(
      applyVisit({}, 'a.com', 1, 'https://a.com/' + 'x'.repeat(600)).stats['a.com']!.favIconUrl,
    ).toBeUndefined();
  });

  it('keeps the previous favicon when a visit has none', () => {
    const withIcon = applyVisit({}, 'a.com', 0, 'https://a.com/i.png').stats;
    const next = applyVisit(withIcon, 'a.com', VISIT_REPEAT_WINDOW_MS);
    expect(next.stats['a.com']!.favIconUrl).toBe('https://a.com/i.png');
  });

  it('keeps a site hidden when it is visited', () => {
    const hidden: SiteStats = { 'a.com': { score: 3, lastVisitAt: 0, hidden: true } };
    expect(applyVisit(hidden, 'a.com', VISIT_REPEAT_WINDOW_MS).stats['a.com']!.hidden).toBe(true);
  });
});

describe('decayedScore', () => {
  it('halves every half-life', () => {
    const stat = { score: 4, lastVisitAt: 0, hidden: false };
    expect(decayedScore(stat, 0)).toBe(4);
    expect(decayedScore(stat, SCORE_HALF_LIFE_MS)).toBeCloseTo(2, 5);
    expect(decayedScore(stat, 2 * SCORE_HALF_LIFE_MS)).toBeCloseTo(1, 5);
  });
});

describe('getTopSites', () => {
  const now = 100 * DAY;
  const stats: SiteStats = {
    'a.com': { score: 5, lastVisitAt: now, hidden: false },
    'b.com': { score: 9, lastVisitAt: now, hidden: false },
    'c.com': { score: 7, lastVisitAt: now, hidden: false },
    'd.com': { score: 99, lastVisitAt: now, hidden: true },
  };

  it('returns the highest scoring sites first and skips hidden ones', () => {
    expect(getTopSites(stats, now, 3).map((s) => s.domain)).toEqual(['b.com', 'c.com', 'a.com']);
  });

  it('skips excluded sites and fills from the next best', () => {
    expect(getTopSites(stats, now, 2, new Set(['b.com'])).map((s) => s.domain)).toEqual(['c.com', 'a.com']);
  });

  it('prefers recent habits over a bigger but old score', () => {
    const mixed: SiteStats = {
      'old.com': { score: 20, lastVisitAt: now - 8 * SCORE_HALF_LIFE_MS, hidden: false },
      'new.com': { score: 3, lastVisitAt: now, hidden: false },
    };
    expect(getTopSites(mixed, now, 1)[0]!.domain).toBe('new.com');
  });

  it('breaks ties by most recent visit', () => {
    const tied: SiteStats = {
      'x.com': { score: 2, lastVisitAt: now - 1000, hidden: false },
      'y.com': { score: 2, lastVisitAt: now - 1000, hidden: false },
    };
    expect(getTopSites(tied, now, 2)).toHaveLength(2);
  });
});

describe('getHiddenSites', () => {
  it('lists hidden domains alphabetically and skips visible ones', () => {
    const stats: SiteStats = {
      'zed.com': { score: 1, lastVisitAt: 1, hidden: true },
      'ok.com': { score: 5, lastVisitAt: 1, hidden: false },
      'alpha.com': { score: 0, lastVisitAt: 0, hidden: true },
    };
    expect(getHiddenSites(stats)).toEqual(['alpha.com', 'zed.com']);
  });

  it('is empty when nothing is hidden', () => {
    expect(getHiddenSites({})).toEqual([]);
  });
});

describe('pruneStats', () => {
  it('keeps only the top sites but never drops a hidden one', () => {
    const now = 10 * DAY;
    const stats: SiteStats = {
      'low.com': { score: 1, lastVisitAt: now, hidden: false },
      'high.com': { score: 9, lastVisitAt: now, hidden: false },
      'hid.com': { score: 0, lastVisitAt: 0, hidden: true },
    };
    expect(Object.keys(pruneStats(stats, now, 1)).sort()).toEqual(['hid.com', 'high.com']);
  });

  it('caps how many sites are tracked', () => {
    const now = 10 * DAY;
    const stats: SiteStats = {};
    for (let i = 0; i < MAX_TRACKED_SITES + 50; i++) {
      stats[`s${i}.com`] = { score: i + 1, lastVisitAt: now, hidden: false };
    }
    expect(Object.keys(pruneStats(stats, now))).toHaveLength(MAX_TRACKED_SITES);
  });
});

describe('stored stats', () => {
  it('records a visit and counts it once inside the window', async () => {
    expect(await recordSiteVisit('https://www.a.com/x', undefined, 1000)).toBe(true);
    expect(await recordSiteVisit('https://a.com/y', undefined, 2000)).toBe(false);
    expect((await getSiteStats())['a.com']!.score).toBe(1);
  });

  it('ignores pages that are not web pages', async () => {
    expect(await recordSiteVisit('chrome://newtab', undefined, 1000)).toBe(false);
    expect(await getSiteStats()).toEqual({});
  });

  it('does not lose visits that arrive at the same moment', async () => {
    await Promise.all([
      recordSiteVisit('https://a.com', undefined, 1000),
      recordSiteVisit('https://b.com', undefined, 1000),
      recordSiteVisit('https://c.com', undefined, 1000),
    ]);
    expect(Object.keys(await getSiteStats()).sort()).toEqual(['a.com', 'b.com', 'c.com']);
  });

  it('hides and unhides a site', async () => {
    await recordSiteVisit('https://a.com', undefined, 1000);
    await setSiteHidden('a.com', true);
    expect((await getSiteStats())['a.com']!.hidden).toBe(true);
    await setSiteHidden('a.com', false);
    expect((await getSiteStats())['a.com']!.hidden).toBe(false);
  });

  it('drops the placeholder entry when a never-counted site is unhidden', async () => {
    await setSiteHidden('mail.example.com', true);
    await setSiteHidden('mail.example.com', false);
    expect(await getSiteStats()).toEqual({});
  });

  it('keeps the score of a counted site when it is unhidden', async () => {
    await recordSiteVisit('https://a.com', undefined, 1000);
    await setSiteHidden('a.com', true);
    await setSiteHidden('a.com', false);
    expect((await getSiteStats())['a.com']).toMatchObject({ score: 1, hidden: false });
  });

  it('remembers a site hidden before it was ever counted', async () => {
    await setSiteHidden('mail.example.com', true);
    await recordSiteVisit('https://mail.example.com', undefined, 5000);
    expect((await getSiteStats())['mail.example.com']!.hidden).toBe(true);
  });

  it('counts nothing while quick links are switched off, and resumes when back on', async () => {
    await setQuickLinksEnabled(false);
    expect(await recordSiteVisit('https://a.com', undefined, 1000)).toBe(false);
    expect(await getSiteStats()).toEqual({});
    await setQuickLinksEnabled(true);
    expect(await recordSiteVisit('https://a.com', undefined, 2000)).toBe(true);
  });

  it('keeps what was collected when switched off', async () => {
    await recordSiteVisit('https://a.com', undefined, 1000);
    await setQuickLinksEnabled(false);
    expect((await getSiteStats())['a.com']).toBeDefined();
  });

  it('clears everything', async () => {
    await recordSiteVisit('https://a.com', undefined, 1000);
    await clearSiteStats();
    expect(await getSiteStats()).toEqual({});
  });

  it('never stores the full URL or title, only the domain', async () => {
    await recordSiteVisit('https://a.com/private/path?token=secret', undefined, 1000);
    const raw = JSON.stringify(await browser.storage.local.get(null));
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('private');
  });
});
