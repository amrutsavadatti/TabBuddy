import { describe, expect, it, vi } from 'vitest';
import { PROPOSAL_TTL_MS, type ProposalTab } from '../bridge/protocol';
import { createProposal, takeProposal, type TabProposal } from './proposals';

const tab = (id: number): ProposalTab => ({ tabId: id, windowId: 1, title: `Tab ${id}`, url: `https://s${id}.test/` });
const input = (ids: number[] = [1]) => ({ kind: 'archive' as const, tabs: ids.map(tab), includeProtected: false });

describe('createProposal', () => {
  it('gives each proposal its own id and a five-minute life', async () => {
    const a = await createProposal(input(), 1_000);
    const b = await createProposal(input(), 1_000);
    expect(a.id).not.toBe(b.id);
    expect(a.createdAt).toBe(1_000);
    expect(a.expiresAt).toBe(1_000 + PROPOSAL_TTL_MS);
    expect(PROPOSAL_TTL_MS).toBe(5 * 60_000);
  });

  it('drops expired proposals when a new one is made', async () => {
    const old = await createProposal(input(), 0);
    await createProposal(input(), PROPOSAL_TTL_MS + 1);
    await expect(takeProposal(old.id, PROPOSAL_TTL_MS + 1)).rejects.toMatchObject({ code: 'proposal_expired' });
  });

  it('keeps at most 20 proposals, dropping the oldest', async () => {
    const made = [];
    for (let i = 0; i < 25; i++) made.push(await createProposal(input([i]), i));
    await expect(takeProposal(made[0]!.id, 30)).rejects.toMatchObject({ code: 'proposal_expired' });
    await expect(takeProposal(made[4]!.id, 30)).rejects.toMatchObject({ code: 'proposal_expired' });
    expect(((await takeProposal(made[5]!.id, 30)) as TabProposal).tabs[0]!.tabId).toBe(5);
    expect(((await takeProposal(made[24]!.id, 30)) as TabProposal).tabs[0]!.tabId).toBe(24);
  });
});

describe('takeProposal', () => {
  it('returns the proposal exactly as made', async () => {
    const made = await createProposal({ ...input([7, 8]), includeProtected: true }, 500);
    const taken = (await takeProposal(made.id, 600)) as TabProposal;
    expect(taken).toEqual(made);
    expect(taken.tabs.map((t) => t.tabId)).toEqual([7, 8]);
    expect(taken.includeProtected).toBe(true);
  });

  it('can be used once only', async () => {
    const made = await createProposal(input(), 0);
    await takeProposal(made.id, 1);
    await expect(takeProposal(made.id, 2)).rejects.toMatchObject({ code: 'proposal_expired' });
  });

  it('refuses an expired proposal, right at the deadline', async () => {
    const made = await createProposal(input(), 0);
    await expect(takeProposal(made.id, PROPOSAL_TTL_MS)).rejects.toMatchObject({ code: 'proposal_expired' });
  });

  it('still allows one a moment before the deadline', async () => {
    const made = await createProposal(input(), 0);
    await expect(takeProposal(made.id, PROPOSAL_TTL_MS - 1)).resolves.toMatchObject({ id: made.id });
  });

  it('treats an id it never issued like an expired one', async () => {
    await expect(takeProposal('never-issued')).rejects.toMatchObject({
      code: 'proposal_expired',
      message: expect.stringContaining('Propose again'),
    });
  });

  it('uses the real clock by default', async () => {
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(10_000);
    const made = await createProposal(input());
    expect(made.createdAt).toBe(10_000);
    spy.mockReturnValue(10_000 + PROPOSAL_TTL_MS + 1);
    await expect(takeProposal(made.id)).rejects.toMatchObject({ code: 'proposal_expired' });
  });
});
