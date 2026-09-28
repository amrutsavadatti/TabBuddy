export const QUICK_LINKS_ENABLED_KEY = 'quickLinksEnabled';

/** On by default. Turning it off stops counting visits and hides the row;
 * the data already collected is kept until the user clears it. */
export async function getQuickLinksEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(QUICK_LINKS_ENABLED_KEY);
  const stored = result[QUICK_LINKS_ENABLED_KEY];
  return stored === undefined ? true : Boolean(stored);
}

export async function setQuickLinksEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [QUICK_LINKS_ENABLED_KEY]: enabled });
}
