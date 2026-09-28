import { resolveLazyTab } from './lazyTab';
import { getDomain } from './siteStats';

export interface TabRef {
  id?: number;
  windowId?: number;
  url?: string;
  lastAccessed?: number;
}

/** The open tab to jump to for a site: any tab on that domain, preferring the
 * one used most recently. Lazy placeholder tabs count as the page they stand for. */
export function pickTabForDomain<T extends TabRef>(tabs: T[], domain: string): T | undefined {
  return tabs
    .filter((tab) => tab.id !== undefined && getDomain(resolveLazyTab(tab).url) === domain)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

/** Jumps to an open tab on this site, or opens a new one (at `url` if given,
 * otherwise the site's home page). */
export async function focusOrOpenSite(domain: string, url?: string): Promise<void> {
  const existing = pickTabForDomain(await browser.tabs.query({}), domain);
  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await browser.tabs.create({ url: url ?? `https://${domain}` });
}
