const LAZY_PAGE_PATH = '/lazy.html';

interface TabLike {
  url?: string;
  title?: string;
  favIconUrl?: string;
}

export function isHttpUrl(url: string | undefined): url is string {
  return url !== undefined && /^https?:\/\//i.test(url);
}

function lazyPageBase(): string {
  return browser.runtime.getURL(LAZY_PAGE_PATH as never);
}

/** Only http(s) pages can be re-opened by the placeholder; chrome://, file://
 * and similar are blocked for extension pages, so those must load normally. */
export function buildLazyTabUrl(tab: { url: string; title?: string; favIconUrl?: string }): string {
  const params = new URLSearchParams({ u: tab.url });
  if (tab.title) params.set('t', tab.title);
  if (tab.favIconUrl) params.set('f', tab.favIconUrl);
  return `${lazyPageBase()}?${params.toString()}`;
}

/** If the tab is one of our placeholders, returns the real page it stands
 * for (url, title, favicon); otherwise returns the tab unchanged. Keeps
 * saving/grouping from ever treating the placeholder as the real page. */
export function resolveLazyTab<T extends TabLike>(tab: T): T {
  if (!tab.url || !tab.url.startsWith(lazyPageBase())) return tab;
  try {
    const params = new URL(tab.url).searchParams;
    const url = params.get('u');
    if (!isHttpUrl(url ?? undefined)) return tab;
    return {
      ...tab,
      url: url!,
      title: params.get('t') ?? tab.title,
      favIconUrl: params.get('f') ?? tab.favIconUrl,
    };
  } catch {
    return tab;
  }
}
