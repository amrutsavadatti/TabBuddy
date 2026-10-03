import { buildTriageUrl } from './manualTriage';

/** Opens the dashboard in a window of its own the first time it is asked for, so
 * it doesn't add a tab to the window you are working in. Asked for again, it
 * brings the dashboard that is already open to the front instead. */
export async function openOrFocusDashboard(): Promise<void> {
  const dashboardUrl = browser.runtime.getURL('/dashboard.html');
  const tabs = await browser.tabs.query({ url: dashboardUrl });
  const existing = tabs[0];

  if (existing?.id !== undefined) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await browser.windows.create({ url: dashboardUrl, focused: true });
}

/** Opens the one-by-one sorting screen. Without `onlyTabIds` it sorts the whole
 * window and closes it when the list ends. With them (tabs an agent was unsure
 * about) it shows just those tabs, opens in the window they are in and brings it
 * forward, and leaves the window alone at the end. */
export async function openTriageSession(windowId: number, onlyTabIds?: number[]): Promise<void> {
  const url = browser.runtime.getURL(buildTriageUrl('/dashboard.html', windowId, onlyTabIds) as never);
  if (onlyTabIds === undefined) {
    await browser.tabs.create({ url });
    return;
  }
  await browser.tabs.create({ url, windowId, active: true });
  await browser.windows.update(windowId, { focused: true });
}
