const ASKED_KEY = 'nudgeAsked';

type AskedMap = Record<string, number>; // tabId (as string) -> last time a nudge was shown

/** Tab ids reset when the browser restarts, so this lives in session storage. */
async function readMap(): Promise<AskedMap> {
  const result = await browser.storage.session.get(ASKED_KEY);
  return (result[ASKED_KEY] as AskedMap | undefined) ?? {};
}

export async function getAskedMap(): Promise<Map<number, number>> {
  const map = await readMap();
  return new Map(Object.entries(map).map(([id, at]) => [Number(id), at]));
}

export async function markAsked(tabId: number, now: number = Date.now()): Promise<void> {
  const map = await readMap();
  map[tabId] = now;
  await browser.storage.session.set({ [ASKED_KEY]: map });
}

export async function forgetAsked(tabId: number): Promise<void> {
  const map = await readMap();
  if (!(tabId in map)) return;
  delete map[tabId];
  await browser.storage.session.set({ [ASKED_KEY]: map });
}

/** Never-asked tabs first, then the one asked about longest ago. A tab that
 * was just shown (and maybe dismissed) goes to the back of the line, so it
 * does not come straight back on the next check. Ties keep the input order. */
export function orderByLeastRecentlyAsked(
  candidateIds: number[],
  asked: Map<number, number>,
): number[] {
  return candidateIds
    .map((id, index) => ({ id, index, at: asked.get(id) ?? 0 }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map((entry) => entry.id);
}
