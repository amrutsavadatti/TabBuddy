export interface PlayingTab {
  id: number;
  windowId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  muted: boolean;
}

interface TabLike {
  id?: number;
  windowId?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  audible?: boolean;
  lastAccessed?: number;
  mutedInfo?: { muted?: boolean };
}

/** Tabs that have made sound in the last couple of seconds (Chrome keeps
 * reporting a muted tab as audible, so muted ones are included), the one used
 * most recently first. A paused video or a silent call is not reported. */
export function selectPlayingTabs(tabs: TabLike[]): PlayingTab[] {
  return tabs
    .filter((tab) => tab.audible === true && tab.id !== undefined && tab.windowId !== undefined)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .map((tab) => ({
      id: tab.id!,
      windowId: tab.windowId!,
      title: tab.title || tab.url || 'Untitled tab',
      url: tab.url ?? '',
      favIconUrl: tab.favIconUrl,
      muted: tab.mutedInfo?.muted ?? false,
    }));
}

export async function getPlayingTabs(): Promise<PlayingTab[]> {
  return selectPlayingTabs(await browser.tabs.query({ audible: true }));
}

/** Brings the tab to the front, in whichever window it lives. */
export async function focusPlayingTab(tab: Pick<PlayingTab, 'id' | 'windowId'>): Promise<void> {
  await browser.tabs.update(tab.id, { active: true });
  await browser.windows.update(tab.windowId, { focused: true });
}

export async function setTabMuted(tabId: number, muted: boolean): Promise<void> {
  await browser.tabs.update(tabId, { muted });
}
