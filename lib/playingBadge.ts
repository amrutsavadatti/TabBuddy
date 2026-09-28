import { getPlayingTabs } from './audibleTabs';

const BADGE_COLOR = '#10b981';
const DEFAULT_TITLE = 'TabBuddy';

/** Empty for none (which hides the badge), the count up to 9, then "9+". */
export function badgeTextFor(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

export function badgeTitleFor(count: number): string {
  if (count <= 0) return DEFAULT_TITLE;
  return `${DEFAULT_TITLE} — ${count} tab${count === 1 ? '' : 's'} playing sound`;
}

interface ActionApi {
  setBadgeText(details: { text: string }): unknown;
  setBadgeBackgroundColor(details: { color: string }): unknown;
  setTitle(details: { title: string }): unknown;
}

// Several updates can be in flight at once (a tab starting and another
// stopping); only the newest one may write, so an older answer can never
// overwrite a newer one.
let latest = 0;

/** Shows how many tabs are making sound on the toolbar icon, or clears it. */
export async function updatePlayingBadge(
  action: ActionApi = browser.action,
  getCount: () => Promise<number> = async () => (await getPlayingTabs()).length,
): Promise<number> {
  const mine = ++latest;
  const count = await getCount();
  if (mine !== latest) return count;
  await action.setBadgeText({ text: badgeTextFor(count) });
  if (count > 0) await action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await action.setTitle({ title: badgeTitleFor(count) });
  return count;
}
