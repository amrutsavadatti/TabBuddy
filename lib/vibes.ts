export type Vibe = 'aurora' | 'sunset' | 'ocean' | 'meadow';

export const VIBES: { id: Vibe; label: string; swatch: string }[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    swatch: 'linear-gradient(120deg, hsl(190 70% 60%), hsl(260 65% 65%), hsl(150 60% 60%))',
  },
  {
    id: 'sunset',
    label: 'Sunset',
    swatch: 'linear-gradient(120deg, hsl(20 85% 60%), hsl(340 75% 65%), hsl(280 60% 65%))',
  },
  {
    id: 'ocean',
    label: 'Ocean',
    swatch: 'linear-gradient(120deg, hsl(200 75% 55%), hsl(190 65% 55%), hsl(210 65% 60%))',
  },
  {
    id: 'meadow',
    label: 'Meadow',
    swatch: 'linear-gradient(120deg, hsl(90 45% 55%), hsl(150 40% 55%), hsl(50 55% 60%))',
  },
];

const VIBE_STORAGE_KEY = 'uiVibe';
const DEFAULT_VIBE: Vibe = 'meadow';

export async function getStoredVibe(): Promise<Vibe> {
  const result = await browser.storage.local.get(VIBE_STORAGE_KEY);
  const stored = result[VIBE_STORAGE_KEY] as Vibe | undefined;
  return VIBES.some((v) => v.id === stored) ? stored! : DEFAULT_VIBE;
}

export async function setStoredVibe(vibe: Vibe): Promise<void> {
  await browser.storage.local.set({ [VIBE_STORAGE_KEY]: vibe });
}
