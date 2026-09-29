import { describe, expect, it } from 'vitest';
import { MAX_SUMMARY_SITES, type OpenTab, type OpenWindow } from '../bridge/protocol';
import { isBlankTab, summarizeWindow, unsavedWorkReason } from './windowSummary';

const NOW = 1_000_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function tab(id: number, url: string, extra: Partial<OpenTab> = {}): OpenTab {
  return {
    id,
    title: `Tab ${id}`,
    url,
    active: false,
    pinned: false,
    audible: false,
    lastAccessed: NOW - 5 * 60_000,
    managed: false,
    lazy: false,
    ...extra,
  };
}
const win = (tabs: OpenTab[], extra: Partial<OpenWindow> = {}): OpenWindow => ({
  windowId: 1,
  focused: true,
  snapshot: null,
  tabs,
  ...extra,
});
const summarize = (window: OpenWindow, snapshots: Parameters<typeof summarizeWindow>[0]['snapshots'] = []) =>
  summarizeWindow({ window, snapshots, now: NOW });
const saved = (name: string, urls: string[], linkedWindowId: number | null = null) => ({
  id: name,
  name,
  linkedWindowId,
  tabs: urls.map((url) => ({ url, title: '', pinned: false, groupIndex: null })),
});

describe('isBlankTab', () => {
  it.each([[''], ['about:blank'], ['chrome://newtab/'], ['brave://newtab'], ['edge://newtab/']])(
    '%j is blank',
    (url) => expect(isBlankTab(url)).toBe(true),
  );
  it.each([['https://a.test/'], ['chrome://settings'], ['https://a.test/newtab']])('%j is not', (url) =>
    expect(isBlankTab(url)).toBe(false),
  );
});

describe('summarizeWindow counts', () => {
  it('counts pinned, playing, managed, lazy and blank tabs and describes the window', () => {
    const s = summarize(
      win(
        [
          tab(1, 'https://a.test/', { pinned: true }),
          tab(2, 'https://b.test/', { audible: true }),
          tab(3, 'https://c.test/', { managed: true, lazy: true }),
          tab(4, 'chrome://newtab/'),
          tab(5, 'https://d.test/'),
        ],
        { snapshot: { id: 's1', name: 'Job Hunt' } },
      ),
    );
    expect(s.tabCount).toBe(5);
    expect(s.counts).toEqual({ pinned: 1, playing: 1, managed: 1, lazy: 1, blank: 1 });
    expect(s.snapshot).toEqual({ id: 's1', name: 'Job Hunt' });
    expect(s.windowId).toBe(1);
  });

  it('puts every tab in exactly one idle bucket', () => {
    const s = summarize(
      win([
        tab(1, 'https://a.test/', { lastAccessed: NOW - 10 * 60_000 }),
        tab(2, 'https://a.test/x', { lastAccessed: NOW - 3 * HOUR }),
        tab(3, 'https://a.test/y', { lastAccessed: NOW - 3 * DAY }),
        tab(4, 'https://a.test/z', { lastAccessed: NOW - 20 * DAY }),
        tab(5, 'https://a.test/w', { lastAccessed: null }),
      ]),
    );
    expect(s.idle).toEqual({ underHour: 1, underDay: 1, underWeek: 1, overWeek: 1, unknown: 1 });
    expect(Object.values(s.idle).reduce((a, b) => a + b, 0)).toBe(s.tabCount);
  });
});

describe('summarizeWindow sites', () => {
  it('groups by domain (ignoring www), biggest first, with ids and sample titles', () => {
    const s = summarize(
      win([
        tab(1, 'https://www.aws.test/a', { title: 'EC2' }),
        tab(2, 'https://aws.test/b', { title: 'S3', lastAccessed: NOW - 2 * DAY }),
        tab(3, 'https://news.test/'),
        tab(4, 'chrome://settings'),
      ]),
    );
    expect(s.sites[0]).toEqual({
      domain: 'aws.test',
      tabCount: 2,
      idleOverDay: 1,
      sampleTitles: ['EC2', 'S3'],
      tabIds: [1, 2],
    });
    expect(s.sites.map((x) => x.domain)).toEqual(['aws.test', '(browser and local pages)', 'news.test']);
  });

  it('lists the biggest sites and counts the rest', () => {
    const tabs = Array.from({ length: MAX_SUMMARY_SITES + 3 }, (_, i) =>
      tab(i + 1, `https://site${String(i).padStart(2, '0')}.test/`),
    );
    tabs.push(tab(999, 'https://site00.test/again')); // make one site bigger
    const s = summarize(win(tabs));
    expect(s.sites).toHaveLength(MAX_SUMMARY_SITES);
    expect(s.sites[0]!.domain).toBe('site00.test');
    expect(s.otherSites).toEqual({ sites: 3, tabs: 3 });
  });

  it('keeps blank tabs out of the site list', () => {
    const s = summarize(win([tab(1, 'chrome://newtab/'), tab(2, 'https://a.test/')]));
    expect(s.sites.map((x) => x.domain)).toEqual(['a.test']);
  });
});

describe('summarizeWindow duplicates and saved tabs', () => {
  it('counts duplicate pages in the window', () => {
    const s = summarize(
      win([tab(1, 'https://a.test/p'), tab(2, 'https://a.test/p?utm_source=z'), tab(3, 'https://a.test/p#x')]),
    );
    expect(s.duplicates).toEqual({ groups: 1, extraTabs: 2 });
  });

  it('reports tabs whose page is already saved in another snapshot', () => {
    const s = summarize(win([tab(1, 'https://a.test/saved'), tab(2, 'https://a.test/new')]), [
      saved('Reading', ['https://www.a.test/saved/']),
    ]);
    expect(s.savedElsewhere).toEqual({ count: 1, tabs: [{ tabId: 1, snapshotName: 'Reading' }] });
  });

  it("does not count the window's own snapshot, and prefers a normal snapshot over Archived", () => {
    const s = summarize(win([tab(1, 'https://a.test/x'), tab(2, 'https://a.test/y')]), [
      saved('Mine', ['https://a.test/x'], 1), // this window's own snapshot
      saved('Archived', ['https://a.test/y']),
      saved('Reading', ['https://a.test/y']),
    ]);
    expect(s.savedElsewhere.tabs).toEqual([{ tabId: 2, snapshotName: 'Reading' }]);
  });
});

describe('unsavedWorkReason', () => {
  const reason = (url: string, title = 'x') => unsavedWorkReason({ url, title });

  it('flags an email being written', () => {
    expect(reason('https://mail.google.com/mail/u/0/#inbox?compose=new')).toBe('an email being written');
    expect(reason('https://outlook.live.com/mail/0/compose')).toBe('an email being written');
    expect(reason('https://mail.test/', 'Compose: new message')).toBe('an email being written');
  });

  it('flags a new GitHub issue, pull request or file edit, but not a normal repo page', () => {
    expect(reason('https://github.com/o/r/issues/new')).toBe('a new issue, pull request or file edit');
    expect(reason('https://github.com/o/r/compare/main...feature')).toBe('a new issue, pull request or file edit');
    expect(reason('https://github.com/o/r')).toBeNull();
    expect(reason('https://github.com/o/r/issues/12')).toBeNull();
  });

  it('flags checkout and application pages', () => {
    expect(reason('https://shop.test/checkout/step2')).toBe('a checkout or payment page');
    expect(reason('https://jobs.test/acme/123/apply')).toBe('an application form');
  });

  it('flags an application form by its title when the address gives nothing away', () => {
    const greenhouse = 'https://job-boards.greenhouse.io/acme/jobs/123';
    expect(reason(greenhouse, 'Job Application for GenAI Engineer - Acme')).toBe('an application form');
    expect(reason(greenhouse, 'Apply to Acme - Software Engineer')).toBe('an application form');
    // an ordinary posting is not flagged
    expect(reason(greenhouse, 'Software Engineer at Acme')).toBeNull();
    expect(reason('https://a.test/', 'Job Application')).toBeNull();
  });

  it('flags drafts by title, and leaves ordinary pages alone', () => {
    expect(reason('https://cms.test/p/1', 'Untitled document')).toBe('a draft or unsaved document');
    expect(reason('https://cms.test/p/1', 'My Draft post')).toBe('a draft or unsaved document');
    expect(reason('https://news.test/story', 'Ordinary headline')).toBeNull();
    expect(reason('https://a.test/drafts-of-law', 'Overview')).toBeNull();
  });

  it('lists flagged tabs in the summary with a total and the reason', () => {
    const s = summarize(
      win([
        tab(1, 'https://shop.test/checkout'),
        tab(2, 'https://a.test/'),
        tab(3, 'https://github.com/o/r/issues/new'),
      ]),
    );
    expect(s.mayHaveUnsavedWork.total).toBe(2);
    expect(s.mayHaveUnsavedWork.tabs.map((t) => t.tabId)).toEqual([1, 3]);
  });
});
