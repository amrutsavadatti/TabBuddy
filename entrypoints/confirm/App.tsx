import { useEffect, useState } from 'react';
import { ShieldQuestion } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { describeProposal, type ConfirmView } from '@/lib/agentConfirmView';
import { recordDecision } from '@/lib/agentConfirmation';
import { peekProposal } from '@/lib/proposals';

type Load = { state: 'loading' } | { state: 'gone' } | { state: 'ready'; view: ConfirmView };

function proposalIdFromQuery(): string | null {
  return new URLSearchParams(window.location.search).get('proposalId');
}

function App() {
  const proposalId = proposalIdFromQuery();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [answered, setAnswered] = useState(false);

  useEffect(() => {
    if (!proposalId) {
      setLoad({ state: 'gone' });
      return;
    }
    peekProposal(proposalId).then(
      (proposal) => setLoad(proposal ? { state: 'ready', view: describeProposal(proposal) } : { state: 'gone' }),
      () => setLoad({ state: 'gone' }),
    );
  }, [proposalId]);

  const answer = async (decision: 'confirm' | 'cancel') => {
    if (!proposalId || answered) return;
    setAnswered(true);
    await recordDecision(proposalId, decision);
    window.close();
  };

  if (load.state === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>
    );
  }

  if (load.state === 'gone') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          This request has expired or was already answered. Nothing was changed.
        </p>
        <Button size="sm" variant="outline" onClick={() => window.close()}>
          Close
        </Button>
      </div>
    );
  }

  const { view } = load;
  return (
    <div className="flex h-screen flex-col gap-3 p-5">
      <div className="flex items-start gap-3">
        <ShieldQuestion size={28} className="mt-0.5 shrink-0 text-primary" />
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            An AI agent asks to
          </p>
          <h1 className="text-lg font-semibold leading-snug">{view.title}</h1>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{view.warning}</p>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card p-3">
        {view.groups.map((group) => (
          <section key={group.label} className="mb-3 last:mb-0">
            <h2 className="mb-1 text-xs font-semibold text-muted-foreground">
              {group.label} ({group.tabs.length})
            </h2>
            <ul className="flex flex-col gap-1">
              {group.tabs.map((tab, i) => (
                <li key={`${tab.url}-${i}`} className="min-w-0 rounded-lg px-2 py-1 hover:bg-muted">
                  <p className="truncate text-sm font-medium">{tab.title || tab.url}</p>
                  <p className="truncate text-xs text-muted-foreground">{tab.url}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => answer('cancel')} disabled={answered}>
          Cancel
        </Button>
        <Button onClick={() => answer('confirm')} disabled={answered}>
          Confirm
        </Button>
      </div>
    </div>
  );
}

export default App;
