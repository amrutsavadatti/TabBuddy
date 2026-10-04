import { getDomain } from './siteStats';

export const QUICK_LINK_SLOTS_KEY = 'quickLinkSlots';
export const SLOT_COUNT = 3;

export interface QuickLinkSlot {
  /** Where a click opens when the site is not already open. */
  url: string;
  domain: string;
}

export type QuickLinkSlots = (QuickLinkSlot | null)[];

/** Turns whatever the user typed ("github.com", "https://mail.google.com/mail/u/1")
 * into a web address plus its domain, or null if it isn't a usable site. */
export function normalizeSiteInput(input: string): QuickLinkSlot | null {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    const domain = getDomain(parsed.toString());
    if (!domain) return null;
    // "asdf" is a typo, not a site; real hosts have a dot (localhost aside).
    if (!domain.includes('.') && domain !== 'localhost') return null;
    return { url: parsed.toString(), domain };
  } catch {
    return null;
  }
}

/** True if another slot (not `index`) already holds this domain. */
export function isDomainInOtherSlot(slots: QuickLinkSlots, index: number, domain: string): boolean {
  return slots.some((slot, i) => i !== index && slot?.domain === domain);
}

export function chosenDomains(slots: QuickLinkSlots): Set<string> {
  return new Set(slots.flatMap((slot) => (slot ? [slot.domain] : [])));
}

function normalizeSlots(raw: unknown): QuickLinkSlots {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: SLOT_COUNT }, (_, i) => {
    const item = list[i] as Partial<QuickLinkSlot> | null | undefined;
    return item && typeof item.url === 'string' && typeof item.domain === 'string'
      ? { url: item.url, domain: item.domain }
      : null;
  });
}

export function parseSlotsChange(newValue: unknown): QuickLinkSlots {
  return normalizeSlots(newValue);
}

export async function getQuickLinkSlots(): Promise<QuickLinkSlots> {
  const result = await browser.storage.local.get(QUICK_LINK_SLOTS_KEY);
  return normalizeSlots(result[QUICK_LINK_SLOTS_KEY]);
}

/** Replaces all slots at once (used by import to avoid read-modify-write races). */
export async function setAllQuickLinkSlots(slots: QuickLinkSlots): Promise<void> {
  await browser.storage.local.set({ [QUICK_LINK_SLOTS_KEY]: normalizeSlots(slots) });
}

/** Fills, replaces or (with null) empties one slot. */
export async function setQuickLinkSlot(index: number, slot: QuickLinkSlot | null): Promise<void> {
  if (!Number.isInteger(index) || index < 0 || index >= SLOT_COUNT) {
    throw new Error('That quick link slot does not exist.');
  }
  const slots = await getQuickLinkSlots();
  slots[index] = slot;
  await browser.storage.local.set({ [QUICK_LINK_SLOTS_KEY]: slots });
}
