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

  await browser.tabs.create({ url: dashboardUrl });
}
