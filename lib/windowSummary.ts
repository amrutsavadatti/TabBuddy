import {
  MAX_SUMMARY_FLAGGED,
  MAX_SUMMARY_SAVED_ELSEWHERE,
  MAX_SUMMARY_SITES,
  type OpenTab,
  type OpenWindow,
  type SiteSummary,
  type WindowSummary,
} from '../bridge/protocol';
import { isArchivedSnapshot } from './archive';
import { findDuplicateTabs } from './duplicateTabs';
import { pageKey } from './pageKey';
import { getDomain } from './siteStats';
import type { Snapshot } from './types';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MAX_TAB_IDS_PER_SITE = 100;
const SAMPLE_TITLES = 3;
const SAMPLE_TITLE_LENGTH = 80;
const OTHER_PAGES = '(browser and local pages)';

/** An empty "new tab" page, in any Chromium browser. */
export function isBlankTab(url: string): boolean {
  return url === '' || url === 'about:blank' || /^[a-z-]+:\/\/newtab\/?$/i.test(url);
}

/** Rules for tabs that might hold work in progress. A guess from the address
 * and title only (TabBuddy never reads pages), so it errs toward listing
 * more, and the reason says why so the user can judge. */
const UNSAVED_RULES: { reason: string; test: (url: URL | null, title: string) => boolean }[] = [
  {
    reason: 'an email being written',
    test: (url, title) =>
      /(^|[?&#])compose=/i.test(`${url?.search ?? ''}${url?.hash ?? ''}`) ||
      /\/compose(\/|$|\?)/i.test(url?.pathname ?? '') ||
      /^(compose|new message)\b/i.test(title),
  },
  {
    reason: 'a new issue, pull request or file edit',
    test: (url) =>
      /(^|\.)github\.com$/.test(url?.hostname ?? '') &&
      /\/(issues\/new|pull\/new|compare\/|edit\/|new\/)/.test(url?.pathname ?? ''),
  },
  {
    reason: 'a checkout or payment page',
    test: (url) => /\/(checkout|payment|billing|cart)(\/|$)/i.test(url?.pathname ?? ''),
  },
  {
    reason: 'an application form',
    test: (url, title) =>
      /\/(apply|application|applications)(\/|$)/i.test(url?.pathname ?? '') ||
      /\b(application for|apply (to|for))\b/i.test(title),
  },
  {
    reason: 'a draft or unsaved document',
    test: (_url, title) => /\b(draft|untitled|unsaved)\b/i.test(title),
  },
];

/** Pure: why this tab might hold unsaved work, or null. */
export function unsavedWorkReason(tab: Pick<OpenTab, 'url' | 'title'>): string | null {
  let url: URL | null = null;
  try {
    url = new URL(tab.url);
  } catch {
    // titles can still give it away
  }
  return UNSAVED_RULES.find((rule) => rule.test(url, tab.title))?.reason ?? null;
}

function idleBucket(lastAccessed: number | null, now: number) {
  if (lastAccessed === null) return 'unknown' as const;
  const idle = now - lastAccessed;
  if (idle < HOUR) return 'underHour' as const;
  if (idle < DAY) return 'underDay' as const;
  if (idle < WEEK) return 'underWeek' as const;
  return 'overWeek' as const;
}

/** Pure: a compact picture of one window, for deciding what to do with it. */
export function summarizeWindow({
  window,
  snapshots,
  now,
}: {
  window: OpenWindow;
  snapshots: Pick<Snapshot, 'id' | 'name' | 'linkedWindowId' | 'tabs'>[];
  now: number;
}): WindowSummary {
  const counts = { pinned: 0, playing: 0, managed: 0, lazy: 0, blank: 0 };
  const idle = { underHour: 0, underDay: 0, underWeek: 0, overWeek: 0, unknown: 0 };
  const siteMap = new Map<string, OpenTab[]>();

  for (const tab of window.tabs) {
    if (tab.pinned) counts.pinned += 1;
    if (tab.audible) counts.playing += 1;
    if (tab.managed) counts.managed += 1;
    if (tab.lazy) counts.lazy += 1;
    idle[idleBucket(tab.lastAccessed, now)] += 1;
    if (isBlankTab(tab.url)) {
      counts.blank += 1;
      continue;
    }
    const domain = getDomain(tab.url) ?? OTHER_PAGES;
    siteMap.set(domain, [...(siteMap.get(domain) ?? []), tab]);
  }

  const allSites: SiteSummary[] = [...siteMap.entries()]
    .map(([domain, tabs]) => ({
      domain,
      tabCount: tabs.length,
      idleOverDay: tabs.filter((t) => t.lastAccessed !== null && now - t.lastAccessed >= DAY).length,
      sampleTitles: tabs.slice(0, SAMPLE_TITLES).map((t) => t.title.slice(0, SAMPLE_TITLE_LENGTH)),
      tabIds: tabs.slice(0, MAX_TAB_IDS_PER_SITE).map((t) => t.id),
    }))
    .sort((a, b) => b.tabCount - a.tabCount || a.domain.localeCompare(b.domain));
  const shownSites = allSites.slice(0, MAX_SUMMARY_SITES);
  const restSites = allSites.slice(MAX_SUMMARY_SITES);

  const duplicates = findDuplicateTabs({ windows: [window] });

  // Pages already saved in some *other* snapshot. Preferring a normal snapshot
  // over the Archived one when a page is in both.
  const savedBy = new Map<string, string>();
  const others = snapshots.filter((s) => s.linkedWindowId !== window.windowId);
  for (const snapshot of [...others.filter((s) => !isArchivedSnapshot(s)), ...others.filter(isArchivedSnapshot)]) {
    for (const saved of snapshot.tabs) {
      const key = pageKey(saved.url);
      if (key !== null && !savedBy.has(key)) savedBy.set(key, snapshot.name);
    }
  }
  const savedTabs = window.tabs.flatMap((tab) => {
    const key = pageKey(tab.url);
    const snapshotName = key === null ? undefined : savedBy.get(key);
    return snapshotName === undefined ? [] : [{ tabId: tab.id, snapshotName }];
  });

  const flagged = window.tabs.flatMap((tab) => {
    const reason = unsavedWorkReason(tab);
    return reason === null ? [] : [{ tabId: tab.id, title: tab.title, reason }];
  });

  return {
    windowId: window.windowId,
    focused: window.focused,
    snapshot: window.snapshot,
    tabCount: window.tabs.length,
    counts,
    idle,
    sites: shownSites,
    otherSites: { sites: restSites.length, tabs: restSites.reduce((sum, s) => sum + s.tabCount, 0) },
    duplicates: { groups: duplicates.groupCount, extraTabs: duplicates.extraTabCount },
    savedElsewhere: { count: savedTabs.length, tabs: savedTabs.slice(0, MAX_SUMMARY_SAVED_ELSEWHERE) },
    mayHaveUnsavedWork: { total: flagged.length, tabs: flagged.slice(0, MAX_SUMMARY_FLAGGED) },
  };
}
