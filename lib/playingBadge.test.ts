import { describe, expect, it, vi } from 'vitest';
import { badgeTextFor, badgeTitleFor, updatePlayingBadge } from './playingBadge';

const fakeAction = () => ({
  setBadgeText: vi.fn(),
  setBadgeBackgroundColor: vi.fn(),
  setTitle: vi.fn(),
});

describe('badgeTextFor', () => {
  it('is empty when nothing is playing', () => {
    expect(badgeTextFor(0)).toBe('');
    expect(badgeTextFor(-1)).toBe('');
  });

  it('shows the count, capped at 9+', () => {
    expect(badgeTextFor(1)).toBe('1');
    expect(badgeTextFor(9)).toBe('9');
    expect(badgeTextFor(10)).toBe('9+');
    expect(badgeTextFor(40)).toBe('9+');
  });
});

describe('badgeTitleFor', () => {
  it('describes what is playing, with correct plurals', () => {
    expect(badgeTitleFor(0)).toBe('TabBuddy');
    expect(badgeTitleFor(1)).toBe('TabBuddy — 1 tab playing sound');
    expect(badgeTitleFor(3)).toBe('TabBuddy — 3 tabs playing sound');
  });
});

describe('updatePlayingBadge', () => {
  it('shows the count in green with a helpful tooltip', async () => {
    const action = fakeAction();
    const count = await updatePlayingBadge(action, async () => 2);
    expect(count).toBe(2);
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '2' });
    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({ color: '#10b981' });
    expect(action.setTitle).toHaveBeenCalledWith({ title: 'TabBuddy — 2 tabs playing sound' });
  });

  it('clears the badge and tooltip when the sound stops', async () => {
    const action = fakeAction();
    await updatePlayingBadge(action, async () => 0);
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
    expect(action.setTitle).toHaveBeenCalledWith({ title: 'TabBuddy' });
  });

  it('lets only the newest update write, so a slow older answer cannot win', async () => {
    const action = fakeAction();
    let releaseOld!: (n: number) => void;
    const older = updatePlayingBadge(action, () => new Promise<number>((r) => (releaseOld = r)));
    await updatePlayingBadge(action, async () => 0); // newer: nothing playing
    releaseOld(3); // older resolves late with a stale count
    await older;
    expect(action.setBadgeText).toHaveBeenCalledTimes(1);
    expect(action.setBadgeText).toHaveBeenCalledWith({ text: '' });
  });
});
