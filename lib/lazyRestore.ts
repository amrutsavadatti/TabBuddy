const LAZY_RESTORE_KEY = 'lazyRestoreEnabled';

export async function getLazyRestoreEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(LAZY_RESTORE_KEY);
  const stored = result[LAZY_RESTORE_KEY];
  return stored === undefined ? true : Boolean(stored);
}

export async function setLazyRestoreEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [LAZY_RESTORE_KEY]: enabled });
}
