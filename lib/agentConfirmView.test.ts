import { describe, expect, it } from 'vitest';
import { describeProposal } from './agentConfirmView';
import type { Proposal } from './proposals';

const tab = (n: number) => ({ tabId: n, windowId: 1, title: `Tab ${n}`, url: `https://s${n}.test/` });
const base = { id: 'p', createdAt: 0, expiresAt: 1 };

describe('describeProposal', () => {
  it('describes archiving', () => {
    const view = describeProposal({ ...base, kind: 'archive', tabs: [tab(1), tab(2)], includeProtected: false });
    expect(view.title).toBe('Archive 2 tabs?');
    expect(view.warning).toContain('Archived');
    expect(view.total).toBe(2);
    expect(view.groups).toEqual([
      { label: 'Archive, then close', tabs: [{ title: 'Tab 1', url: 'https://s1.test/' }, { title: 'Tab 2', url: 'https://s2.test/' }] },
    ]);
  });

  it('says closing does not save, and uses the singular for one tab', () => {
    const view = describeProposal({ ...base, kind: 'close', tabs: [tab(1)], includeProtected: false });
    expect(view.title).toBe('Close 1 tab?');
    expect(view.warning).toContain('without being saved');
  });

  it('names the snapshot when removing saved tabs', () => {
    const view = describeProposal({
      ...base,
      kind: 'removeFromSnapshot',
      snapshotId: 's',
      snapshotName: 'Job Hunt',
      snapshotUpdatedAt: 0,
      entries: [{ index: 3, title: 'Old post', url: 'https://old.test/' }],
    });
    expect(view.title).toBe('Remove 1 saved tab from "Job Hunt"?');
    expect(view.warning).toContain('for good');
    expect(view.groups[0]!.tabs).toEqual([{ title: 'Old post', url: 'https://old.test/' }]);
  });

  it('shows a triage plan bucket by bucket with one total', () => {
    const proposal: Proposal = {
      ...base,
      kind: 'triage',
      includeProtected: false,
      steps: [
        { action: 'close', tabs: [tab(1)] },
        { action: 'archive', tabs: [tab(2), tab(3)] },
        { action: 'fileInto', snapshotId: 's1', snapshotName: 'Research', tabs: [tab(4)] },
        { action: 'newSnapshot', name: 'Trip', categoryNames: [], tabs: [tab(5)] },
      ],
    };
    const view = describeProposal(proposal);
    expect(view.title).toBe('Sort out 5 tabs?');
    expect(view.total).toBe(5);
    expect(view.groups.map((g) => [g.label, g.tabs.length])).toEqual([
      ['Close without saving', 1],
      ['Archive, then close', 2],
      ['Add to "Research", then close', 1],
      ['Save as a new snapshot "Trip", then close', 1],
    ]);
  });
});
