import { describe, expect, it } from 'vitest';
import { tabToSnapshotTab, type TriageTab } from './triage';

describe('tabToSnapshotTab', () => {
  it('maps fields and always sets groupIndex to null', () => {
    const tab: TriageTab = {
      id: 42,
      url: 'https://example.com/',
      title: 'Example',
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: true,
    };
    expect(tabToSnapshotTab(tab)).toEqual({
      url: 'https://example.com/',
      title: 'Example',
      favIconUrl: 'https://example.com/favicon.ico',
      pinned: true,
      groupIndex: null,
    });
  });

  it('drops the tab id (not part of a SnapshotTab)', () => {
    const tab: TriageTab = { id: 1, url: 'https://a.com', title: 'A', pinned: false };
    expect(tabToSnapshotTab(tab)).not.toHaveProperty('id');
  });
});
