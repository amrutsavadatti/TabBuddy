import {
  MAX_OPEN_URLS,
  type FocusTabResult,
  type OpenUrlsParams,
  type OpenUrlsResult,
} from '../bridge/protocol';
import { BridgeFailure } from './bridgeFailure';

const SHOWN_LENGTH = 80;

function shown(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > SHOWN_LENGTH ? `${text.slice(0, SHOWN_LENGTH)}…` : text;
}

/** Pure: checks an openUrls request. Only web pages (http and https) may be
 * opened: never javascript:, file:, chrome: or extension pages. It is all or
 * nothing, so one bad address opens nothing, and the error names each one. */
export function parseOpenUrlsParams(params: unknown): { urls: string[]; newWindow: boolean } {
  const p = (params ?? {}) as Partial<OpenUrlsParams>;
  if (!Array.isArray(p.urls) || p.urls.length === 0) {
    throw new BridgeFailure('invalid_params', 'urls must be a non-empty list of web addresses.');
  }
  if (p.urls.length > MAX_OPEN_URLS) {
    throw new BridgeFailure(
      'invalid_params',
      `Too many urls (${p.urls.length}); open at most ${MAX_OPEN_URLS} at a time.`,
    );
  }
  if (p.newWindow !== undefined && typeof p.newWindow !== 'boolean') {
    throw new BridgeFailure('invalid_params', 'newWindow must be true or false.');
  }
  const urls: string[] = [];
  const bad: string[] = [];
  for (const raw of p.urls) {
    try {
      const parsed = new URL(String(raw));
      if (typeof raw !== 'string' || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
        throw new Error('not a web address');
      }
      urls.push(parsed.href);
    } catch {
      bad.push(shown(raw));
    }
  }
  if (bad.length > 0) {
    throw new BridgeFailure(
      'invalid_params',
      `Only http and https addresses can be opened. Nothing was opened. Not valid: ${bad.join(', ')}`,
    );
  }
  return { urls, newWindow: p.newWindow === true };
}

/** Opens the pages in a new window, or as tabs in the browser window the user
 * used last. A new window is used instead when that window is incognito or
 * belongs to a saved snapshot: tabs added there would be saved into the
 * snapshot the next time the user presses Update. The first page comes to
 * the front; the rest open behind it. */
export async function openUrls(
  urls: string[],
  newWindow: boolean,
  snapshotWindowIds: ReadonlySet<number> = new Set(),
): Promise<OpenUrlsResult> {
  let target: number | undefined;
  if (!newWindow) {
    try {
      const last = await browser.windows.getLastFocused({ windowTypes: ['normal'] });
      if (last?.id !== undefined && !last.incognito && !snapshotWindowIds.has(last.id)) {
        target = last.id;
      }
    } catch {
      // no usable window: fall through to a new one
    }
  }

  if (target === undefined) {
    const created = await browser.windows.create({ url: urls, focused: true });
    if (created?.id === undefined) throw new Error('The browser did not create a window.');
    // Chrome returns the new window's tabs; read them back if a browser doesn't.
    const createdTabs = created.tabs?.length
      ? created.tabs
      : await browser.tabs.query({ windowId: created.id });
    return {
      windowId: created.id,
      openedInNewWindow: true,
      tabs: createdTabs.flatMap((tab, i) =>
        tab.id === undefined ? [] : [{ tabId: tab.id, url: urls[i] ?? tab.url ?? '' }],
      ),
    };
  }

  const tabs: OpenUrlsResult['tabs'] = [];
  for (const [i, url] of urls.entries()) {
    const tab = await browser.tabs.create({ windowId: target, url, active: i === 0 });
    if (tab.id !== undefined) tabs.push({ tabId: tab.id, url });
  }
  await browser.windows.update(target, { focused: true });
  return { windowId: target, openedInNewWindow: false, tabs };
}

export function parseTabId(params: unknown): number {
  const { tabId } = (params ?? {}) as { tabId?: unknown };
  if (typeof tabId !== 'number' || !Number.isInteger(tabId)) {
    throw new BridgeFailure('invalid_params', 'tabId must be a tab id from list_open_windows or search_tabs.');
  }
  return tabId;
}

/** Switches to a tab and brings its window forward. Incognito tabs are
 * reported as missing: the bridge never touches them. */
export async function focusTab(tabId: number): Promise<FocusTabResult> {
  const notFound = new BridgeFailure(
    'not_found',
    'No open tab with that id. It may have been closed; call list_open_windows for current ids.',
  );
  let tab;
  try {
    tab = await browser.tabs.get(tabId);
  } catch {
    throw notFound;
  }
  if (!tab || tab.incognito || tab.id === undefined || tab.windowId === undefined) throw notFound;
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
  return { tabId: tab.id, windowId: tab.windowId, title: tab.title ?? '', url: tab.url ?? '' };
}
