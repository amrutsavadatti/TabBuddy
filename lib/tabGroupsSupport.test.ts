import { describe, expect, it } from 'vitest';
import { hasTabGroupsSupport } from './tabGroupsSupport';

describe('hasTabGroupsSupport', () => {
  it('is true when the browser provides tabGroups and tabs.group', () => {
    expect(hasTabGroupsSupport()).toBe(true);
  });

  it('is false when tabGroups is missing', () => {
    expect(hasTabGroupsSupport({ ...browser, tabGroups: undefined } as any)).toBe(false);
  });

  it('is false when tabs.group is missing', () => {
    expect(
      hasTabGroupsSupport({ ...browser, tabs: { ...browser.tabs, group: undefined } } as any),
    ).toBe(false);
  });

  it('is false when the api itself is missing', () => {
    expect(hasTabGroupsSupport(null as any)).toBe(false);
  });
});
