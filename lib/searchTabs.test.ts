import { describe, expect, it } from 'vitest';
import type { OpenWindow } from '../bridge/protocol';
import { ARCHIVED_SNAPSHOT_NAME } from './archive';
import { queryTokens, searchTabs } from './searchTabs';
import { makeSnapshot, makeTab } from '@/test/factories';

function openWindow(tabs: { id: number; title: string; url: string; lastAccessed?: number | null }[]): OpenWindow {
  return {
    windowId: 1,
    focused: true,
    snapshot: null,
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      active: false,
      pinned: false,
      audible: false,
      lastAccessed: t.lastAccessed ?? null,
      managed: false,
      lazy: false,
    })),
  };
}

const search = (query: string, overrides: Partial<Parameters<typeof searchTabs>[0]> = {}) =>
  searchTabs({ query, scope: 'all', snapshots: [], openWindows: [], ...overrides });

describe('queryTokens', () => {
  it('lowercases, splits on punctuation and drops filler words', () => {
    expect(queryTokens('The Pricing-Page I had open')).toEqual(['pricing']);
  });

  it('drops words about looking for a tab, like page, tab and open', () => {
    expect(queryTokens('the pricing page I had open in a tab')).toEqual(['pricing']);
  });

  it('keeps filler if that is all there is, and returns nothing for an empty query', () => {
    expect(queryTokens('the')).toEqual(['the']);
    expect(queryTokens('  ,, ')).toEqual([]);
  });

  it('handles non-English letters', () => {
    expect(queryTokens('Café Zürich')).toEqual(['café', 'zürich']);
  });
});

describe('searchTabs matching', () => {
  const snapshot = makeSnapshot({
    name: 'Research',
    tabs: [
      makeTab({ title: 'Acme Pricing', url: 'https://acme.test/pricing' }),
      makeTab({ title: 'Acme Blog', url: 'https://acme.test/blog' }),
      makeTab({ title: 'Other', url: 'https://other.test/' }),
    ],
  });

  it('matches title, url and domain, case-insensitively', () => {
    expect(search('PRICING', { snapshots: [snapshot] }).matches.map((m) => m.title)).toEqual(['Acme Pricing']);
    // "other.test" is two words; the tab matching both ranks above ones matching only "test"
    expect(search('other.test', { snapshots: [snapshot] }).matches[0]).toMatchObject({ title: 'Other', score: 2 });
    expect(search('acme', { snapshots: [snapshot] }).total).toBe(2);
  });

  it('matches percent-encoded urls', () => {
    const s = makeSnapshot({ tabs: [makeTab({ title: 'x', url: 'https://a.test/our%20pricing%20page' })] });
    expect(search('pricing page', { snapshots: [s] }).total).toBe(1);
  });

  it('returns the snapshot, the tab index and where a saved tab lives', () => {
    const [match] = search('blog', { snapshots: [snapshot] }).matches;
    expect(match).toEqual({
      source: 'saved',
      snapshotId: snapshot.id,
      snapshotName: 'Research',
      index: 1,
      url: 'https://acme.test/blog',
      title: 'Acme Blog',
      score: 1,
    });
  });

  it('returns nothing when nothing matches', () => {
    expect(search('zzz', { snapshots: [snapshot] })).toEqual({ matches: [], total: 0, truncated: false });
  });
});

describe('searchTabs ranking', () => {
  it('puts tabs that match more of the words first', () => {
    const s = makeSnapshot({
      tabs: [
        makeTab({ title: 'acme home', url: 'https://acme.test/' }),
        makeTab({ title: 'acme pricing', url: 'https://acme.test/pricing' }),
      ],
    });
    const { matches } = search('acme pricing', { snapshots: [s] });
    expect(matches.map((m) => [m.title, m.score])).toEqual([
      ['acme pricing', 2],
      ['acme home', 1],
    ]);
  });

  it('lets a rare word outweigh a common one', () => {
    const tabs = [
      ...Array.from({ length: 6 }, (_, i) => makeTab({ title: `docs ${i}`, url: `https://docs${i}.test/` })),
      makeTab({ title: 'Kubernetes intro', url: 'https://k.test/' }),
      makeTab({ title: 'docs and kubernetes', url: 'https://d.test/' }),
    ];
    const s = makeSnapshot({ tabs });
    // "docs" is on 7 tabs, "kubernetes" on 2: matching only the rare word beats matching only the common one
    const titles = search('docs kubernetes', { snapshots: [s], limit: 3 }).matches.map((m) => m.title);
    expect(titles[0]).toBe('docs and kubernetes');
    expect(titles[1]).toBe('Kubernetes intro');
  });

  it('is not thrown off by filler in a sentence-style query', () => {
    const newer = makeSnapshot({
      name: 'Newer',
      updatedAt: 900,
      tabs: [makeTab({ title: 'Netflix open page', url: 'https://netflix.test/' })],
    });
    const older = makeSnapshot({
      name: 'Older',
      updatedAt: 100,
      tabs: [makeTab({ title: 'Recommendations', url: 'https://jobs.test/' })],
    });
    const { matches } = search('the recommendations page I had open', { snapshots: [newer, older] });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ snapshotName: 'Older' });
  });

  it('breaks ties with the more recently updated snapshot, or last-accessed tab', () => {
    const old = makeSnapshot({ name: 'Old', updatedAt: 100, tabs: [makeTab({ title: 'docs', url: 'https://a.test/' })] });
    const fresh = makeSnapshot({ name: 'Fresh', updatedAt: 900, tabs: [makeTab({ title: 'docs', url: 'https://b.test/' })] });
    expect(search('docs', { snapshots: [old, fresh] }).matches.map((m) => (m as any).snapshotName)).toEqual([
      'Fresh',
      'Old',
    ]);

    const windows = [
      openWindow([
        { id: 1, title: 'docs a', url: 'https://a.test/', lastAccessed: 10 },
        { id: 2, title: 'docs b', url: 'https://b.test/', lastAccessed: 50 },
        { id: 3, title: 'docs c', url: 'https://c.test/', lastAccessed: null },
      ]),
    ];
    expect(search('docs', { openWindows: windows, scope: 'open' }).matches.map((m) => (m as any).tabId)).toEqual([2, 1, 3]);
  });
});

describe('searchTabs scope', () => {
  const saved = makeSnapshot({ name: 'Work', tabs: [makeTab({ title: 'shared thing', url: 'https://w.test/' })] });
  const archived = makeSnapshot({
    name: ARCHIVED_SNAPSHOT_NAME,
    tabs: [makeTab({ title: 'shared thing', url: 'https://x.test/' })],
  });
  const windows = [openWindow([{ id: 7, title: 'shared thing', url: 'https://o.test/', lastAccessed: 5 }])];
  const sources = (scope: 'saved' | 'archived' | 'open' | 'all') =>
    search('shared', { scope, snapshots: [saved, archived], openWindows: windows }).matches.map((m) => m.source);

  it('saved excludes the Archived snapshot and open tabs', () => expect(sources('saved')).toEqual(['saved']));
  it('archived is only the Archived snapshot', () => expect(sources('archived')).toEqual(['archived']));
  it('open is only open tabs', () => expect(sources('open')).toEqual(['open']));
  it('all searches everything', () => expect(sources('all').sort()).toEqual(['archived', 'open', 'saved']));

  it('describes an open match with its window and tab id', () => {
    expect(search('shared', { scope: 'open', openWindows: windows }).matches[0]).toEqual({
      source: 'open',
      windowId: 1,
      tabId: 7,
      url: 'https://o.test/',
      title: 'shared thing',
      lastAccessed: 5,
      score: 1,
    });
  });
});

describe('searchTabs limits', () => {
  const many = makeSnapshot({
    tabs: Array.from({ length: 8 }, (_, i) => makeTab({ title: `page ${i}`, url: `https://s${i}.test/` })),
  });

  it('caps the results and reports the real total', () => {
    const result = search('page', { snapshots: [many], limit: 3 });
    expect(result.matches).toHaveLength(3);
    expect(result.total).toBe(8);
    expect(result.truncated).toBe(true);
  });

  it('is not truncated when everything fits', () => {
    expect(search('page', { snapshots: [many], limit: 8 }).truncated).toBe(false);
  });

  it('cuts very long titles', () => {
    const s = makeSnapshot({ tabs: [makeTab({ title: `needle ${'x'.repeat(500)}`, url: 'https://a.test/' })] });
    expect(search('needle', { snapshots: [s] }).matches[0]!.title.length).toBe(200);
  });
});
