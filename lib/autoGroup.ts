import type { Browser } from 'wxt/browser';
import { resolveLazyTab } from './lazyTab';

const GROUP_COLORS: `${Browser.tabGroups.Color}`[] = [
  'blue',
  'cyan',
  'green',
  'orange',
  'pink',
  'purple',
  'red',
  'yellow',
];

function colorForHostname(hostname: string): `${Browser.tabGroups.Color}` {
  let hash = 0;
  for (let i = 0; i < hostname.length; i++) {
    hash = (hash << 5) - hash + hostname.charCodeAt(i);
    hash |= 0;
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length]!;
}

function getHostname(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Groups a window's tabs by hostname (e.g. all linkedin.com tabs together).
 * Only creates a group for hostnames with 2+ tabs. Returns the number of
 * groups created. */
export async function autoGroupByDomain(windowId: number): Promise<number> {
  const tabs = await browser.tabs.query({ windowId });

  const buckets = new Map<string, number[]>();
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const hostname = getHostname(resolveLazyTab(tab).url);
    if (!hostname) continue;
    const tabIds = buckets.get(hostname) ?? [];
    tabIds.push(tab.id);
    buckets.set(hostname, tabIds);
  }

  let groupsCreated = 0;
  for (const [hostname, tabIds] of buckets) {
    if (tabIds.length < 2) continue;
    const groupId = await browser.tabs.group({
      tabIds: tabIds as [number, ...number[]],
      createProperties: { windowId },
    });
    await browser.tabGroups.update(groupId, {
      title: hostname,
      color: colorForHostname(hostname),
    });
    groupsCreated++;
  }

  return groupsCreated;
}
