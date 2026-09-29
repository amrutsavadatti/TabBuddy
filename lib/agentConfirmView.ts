import { plural } from './proposalChecks';
import type { Proposal } from './proposals';

export interface ConfirmViewGroup {
  label: string;
  tabs: { title: string; url: string }[];
}

/** What the in-browser confirmation window shows for a proposal. */
export interface ConfirmView {
  title: string;
  /** One sentence on what confirming does that cannot be taken back by closing. */
  warning: string;
  groups: ConfirmViewGroup[];
  total: number;
}

/** Pure: turns any kind of proposal into a heading, a warning and lists of tabs. */
export function describeProposal(proposal: Proposal): ConfirmView {
  if (proposal.kind === 'removeFromSnapshot') {
    const tabs = proposal.entries.map((e) => ({ title: e.title, url: e.url }));
    return {
      title: `Remove ${plural(tabs.length, 'saved tab', 'saved tabs')} from "${proposal.snapshotName}"?`,
      warning: 'They are removed from the snapshot for good. Tabs open in the browser are not touched.',
      groups: [{ label: `Leaving "${proposal.snapshotName}"`, tabs }],
      total: tabs.length,
    };
  }
  if (proposal.kind === 'triage') {
    const groups = proposal.steps.map((step): ConfirmViewGroup => {
      const tabs = step.tabs.map((t) => ({ title: t.title, url: t.url }));
      switch (step.action) {
        case 'close':
          return { label: 'Close without saving', tabs };
        case 'archive':
          return { label: 'Archive, then close', tabs };
        case 'fileInto':
          return { label: `Add to "${step.snapshotName}", then close`, tabs };
        case 'newSnapshot':
          return { label: `Save as a new snapshot "${step.name}", then close`, tabs };
      }
    });
    const total = groups.reduce((sum, g) => sum + g.tabs.length, 0);
    return {
      title: `Sort out ${plural(total, 'tab', 'tabs')}?`,
      warning: 'Everything is saved first, then the tabs are closed. You can undo it afterwards.',
      groups,
      total,
    };
  }
  const tabs = proposal.tabs.map((t) => ({ title: t.title, url: t.url }));
  return proposal.kind === 'archive'
    ? {
        title: `Archive ${plural(tabs.length, 'tab', 'tabs')}?`,
        warning: 'They are saved to your Archived snapshot, then closed. You can undo it afterwards.',
        groups: [{ label: 'Archive, then close', tabs }],
        total: tabs.length,
      }
    : {
        title: `Close ${plural(tabs.length, 'tab', 'tabs')}?`,
        warning: 'They are closed without being saved anywhere. You can reopen them with undo afterwards.',
        groups: [{ label: 'Close without saving', tabs }],
        total: tabs.length,
      };
}
