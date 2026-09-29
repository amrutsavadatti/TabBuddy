import { PROPOSAL_TTL_MS, type ProposalTab } from '../bridge/protocol';
import { BridgeFailure } from './bridgeFailure';

interface ProposalBase {
  id: string;
  createdAt: number;
  expiresAt: number;
}

/** Archive or close a set of open tabs. */
export interface TabProposal extends ProposalBase {
  kind: 'archive' | 'close';
  tabs: ProposalTab[];
  /** The proposal deliberately included pinned, playing or snapshot-owned tabs. */
  includeProtected: boolean;
  /** What the user asked for, as the agent phrased it, carried through to the activity log. */
  request?: string;
}

/** Remove saved tabs from a snapshot, by position. */
export interface RemoveFromSnapshotProposal extends ProposalBase {
  kind: 'removeFromSnapshot';
  snapshotId: string;
  snapshotName: string;
  /** The snapshot's updatedAt when proposed: if it differs at confirm time, positions can't be trusted. */
  snapshotUpdatedAt: number;
  entries: { index: number; title: string; url: string }[];
  request?: string;
}

/** One bucket of a triage plan. */
export type TriageStep =
  | { action: 'close'; tabs: ProposalTab[] }
  | { action: 'archive'; tabs: ProposalTab[] }
  | { action: 'fileInto'; snapshotId: string; snapshotName: string; tabs: ProposalTab[] }
  | { action: 'newSnapshot'; name: string; categoryNames: string[]; tabs: ProposalTab[] };

/** Several buckets confirmed together: everything is saved first, then the tabs are closed. */
export interface TriageProposal extends ProposalBase {
  kind: 'triage';
  steps: TriageStep[];
  includeProtected: boolean;
  request?: string;
}

export type Proposal = TabProposal | RemoveFromSnapshotProposal | TriageProposal;

export type NewProposal =
  | Omit<TabProposal, keyof ProposalBase>
  | Omit<RemoveFromSnapshotProposal, keyof ProposalBase>
  | Omit<TriageProposal, keyof ProposalBase>;

const PROPOSALS_KEY = 'agentProposals';
/** Old proposals are dropped beyond this many, oldest first. */
const MAX_STORED = 20;

type ProposalMap = Record<string, Proposal>;

/** Proposals live in `storage.session`: they survive the service worker
 * restarting between "propose" and "confirm", and are cleared when the browser
 * restarts (tab ids mean nothing after that anyway). */
async function read(): Promise<ProposalMap> {
  const result = await browser.storage.session.get(PROPOSALS_KEY);
  return (result[PROPOSALS_KEY] as ProposalMap | undefined) ?? {};
}

async function write(map: ProposalMap): Promise<void> {
  await browser.storage.session.set({ [PROPOSALS_KEY]: map });
}

function withoutExpired(map: ProposalMap, now: number): ProposalMap {
  return Object.fromEntries(Object.entries(map).filter(([, p]) => p.expiresAt > now));
}

/** Stores a new proposal that can be confirmed once, for five minutes. */
export async function createProposal(input: NewProposal, now: number = Date.now()): Promise<Proposal> {
  const proposal = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    expiresAt: now + PROPOSAL_TTL_MS,
  } as Proposal;
  const live = Object.values(withoutExpired(await read(), now)).sort((a, b) => a.createdAt - b.createdAt);
  const kept = live.slice(Math.max(0, live.length - (MAX_STORED - 1)));
  await write(Object.fromEntries([...kept, proposal].map((p) => [p.id, p])));
  return proposal;
}

/** Returns the proposal and removes it, so it cannot be confirmed twice, even
 * if carrying it out then fails. An unknown, used or expired proposal all read
 * as expired: the caller should propose again. */
export async function takeProposal(id: string, now: number = Date.now()): Promise<Proposal> {
  const map = await read();
  const proposal = map[id];
  delete map[id];
  await write(withoutExpired(map, now));
  if (!proposal || proposal.expiresAt <= now) {
    throw new BridgeFailure(
      'proposal_expired',
      'That proposal has expired or was already used. Propose again to get a fresh one.',
    );
  }
  return proposal;
}

/** Reads a proposal without using it up. Null if it is unknown, used or expired. */
export async function peekProposal(id: string, now: number = Date.now()): Promise<Proposal | null> {
  const proposal = (await read())[id];
  return proposal && proposal.expiresAt > now ? proposal : null;
}
