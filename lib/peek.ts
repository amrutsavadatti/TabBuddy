const PEEK_STORAGE_KEY = 'hoverPeekEnabled';

export async function getHoverPeekEnabled(): Promise<boolean> {
  const result = await browser.storage.local.get(PEEK_STORAGE_KEY);
  const stored = result[PEEK_STORAGE_KEY];
  return stored === undefined ? true : Boolean(stored);
}

export async function setHoverPeekEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [PEEK_STORAGE_KEY]: enabled });
}
