import {
  MAX_SEARCH_RESULTS,
  MAX_TITLE_LENGTH,
  type OpenWindow,
  type SearchMatch,
  type SearchScope,
  type SearchTabsResult,
} from '../bridge/protocol';
import { isArchivedSnapshot } from './archive';
import type { Snapshot } from './types';

/** Filler words that would otherwise match many tabs when someone searches
 * with a sentence ("the pricing page I had open"): function words, plus
 * words that describe the act of looking for a tab rather than the tab. */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'had', 'has', 'have', 'i',
  'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'with',
  'page', 'pages', 'tab', 'tabs', 'open', 'opened', 'site', 'sites', 'website', 'link', 'links',
  'saved', 'find', 'found', 'looking', 'one',
]);

/** Lowercase words of the query, without filler. If nothing but filler is
 * left, the filler is kept so the search still does something. Empty when
 * the query has no words at all. */
export function queryTokens(query: string): string[] {
  const all = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
  const meaningful = all.filter((t) => !STOPWORDS.has(t) && t.length >= 2);
  return meaningful.length > 0 ? meaningful : all;
}

function decode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/** The tokens that appear in the tab's title or URL (which contains its domain). */
function matchedTokens(tokens: string[], title: string, url: string): string[] {
  const haystack = `${title} ${decode(url)}`.toLowerCase();
  return tokens.filter((token) => haystack.includes(token));
}

function truncateTitle(title: string): string {
  return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
}

export interface SearchOptions {
  query: string;
  scope: SearchScope;
  snapshots: Snapshot[];
  openWindows: OpenWindow[];
  limit?: number;
}

interface Candidate {
  match: SearchMatch;
  recency: number;
  matched: string[];
}

/** Pure: matches for the query, best first. A tab matches if it contains at
 * least one query word. Words are weighted by how rare they are among the
 * tabs searched (a word on half your tabs says little, one on two tabs says
 * a lot), so the rarer words a tab matches, the higher it ranks; ties go to
 * the more recently used tab (a snapshot's last update, or a tab's last
 * access). `score` reports how many of the words matched. The reserved
 * Archived snapshot counts as "archived", not "saved". */
export function searchTabs({
  query,
  scope,
  snapshots,
  openWindows,
  limit = MAX_SEARCH_RESULTS,
}: SearchOptions): SearchTabsResult {
  const tokens = queryTokens(query);
  const candidates: Candidate[] = [];
  let searched = 0;

  for (const snapshot of snapshots) {
    const source = isArchivedSnapshot(snapshot) ? 'archived' : 'saved';
    if (scope !== 'all' && scope !== source) continue;
    snapshot.tabs.forEach((tab, index) => {
      searched += 1;
      const matched = matchedTokens(tokens, tab.title, tab.url);
      if (matched.length === 0) return;
      candidates.push({
        matched,
        recency: snapshot.updatedAt,
        match: {
          source,
          snapshotId: snapshot.id,
          snapshotName: snapshot.name,
          index,
          url: tab.url,
          title: truncateTitle(tab.title),
          score: matched.length,
        },
      });
    });
  }

  if (scope === 'open' || scope === 'all') {
    for (const window of openWindows) {
      for (const tab of window.tabs) {
        searched += 1;
        const matched = matchedTokens(tokens, tab.title, tab.url);
        if (matched.length === 0) continue;
        candidates.push({
          matched,
          recency: tab.lastAccessed ?? 0,
          match: {
            source: 'open',
            windowId: window.windowId,
            tabId: tab.id,
            url: tab.url,
            title: truncateTitle(tab.title),
            lastAccessed: tab.lastAccessed,
            score: matched.length,
          },
        });
      }
    }
  }

  const tabsWith = new Map<string, number>();
  for (const { matched } of candidates) {
    for (const token of matched) tabsWith.set(token, (tabsWith.get(token) ?? 0) + 1);
  }
  const weight = (token: string) => Math.log(1 + searched / tabsWith.get(token)!);
  const weighted = candidates.map((c) => ({ ...c, weight: c.matched.reduce((sum, t) => sum + weight(t), 0) }));

  weighted.sort((a, b) => b.weight - a.weight || b.recency - a.recency);
  const matches = weighted.slice(0, limit).map((r) => r.match);
  return { matches, total: weighted.length, truncated: weighted.length > matches.length };
}
