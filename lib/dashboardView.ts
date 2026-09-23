export type DashboardView = 'simple' | 'categories';

const VIEW_KEY = 'dashboardView';

export async function getDashboardView(): Promise<DashboardView> {
  const result = await browser.storage.local.get(VIEW_KEY);
  return result[VIEW_KEY] === 'categories' ? 'categories' : 'simple';
}

export async function setDashboardView(view: DashboardView): Promise<void> {
  await browser.storage.local.set({ [VIEW_KEY]: view });
}
