const ONBOARDING_KEY = 'hasSeenOnboarding';

export async function getHasSeenOnboarding(): Promise<boolean> {
  const result = await browser.storage.local.get(ONBOARDING_KEY);
  return Boolean(result[ONBOARDING_KEY]);
}

export async function setHasSeenOnboarding(seen: boolean): Promise<void> {
  await browser.storage.local.set({ [ONBOARDING_KEY]: seen });
}
