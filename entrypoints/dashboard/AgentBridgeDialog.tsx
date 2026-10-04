import { useState } from 'react';
import { Bot, Check, ChevronDown, Copy, History, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { StatusView } from '@/lib/agentBridgeStatus';

export const INSTALL_COMMAND = 'npm install -g tabbuddy@beta && tabbuddy install';
export const CONNECT_COMMAND = 'claude mcp add --scope user tabbuddy -- tabbuddy serve';
export const CONNECT_COMMAND_CODEX = 'codex mcp add tabbuddy -- tabbuddy serve';
export const CONNECT_CONFIG_JSON = `{
  "mcpServers": {
    "tabbuddy": {
      "command": "tabbuddy",
      "args": ["serve"]
    }
  }
}`;

type Client = 'claude-code' | 'codex' | 'other';

const CLIENTS: { id: Client; label: string }[] = [
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' },
  { id: 'other', label: 'Claude Desktop / other' },
];

const DOT: Record<StatusView['tone'], string> = {
  off: 'bg-muted-foreground/40',
  pending: 'bg-amber-400',
  good: 'bg-emerald-500',
  warn: 'bg-amber-500',
  bad: 'bg-destructive',
};

function Switch({ on, tone = 'primary' }: { on: boolean; tone?: 'primary' | 'amber' }) {
  const onColor = tone === 'amber' ? 'bg-amber-400' : 'bg-primary';
  return (
    <span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? onColor : 'bg-muted'}`}>
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          on ? 'left-[22px]' : 'left-0.5'
        }`}
      />
    </span>
  );
}

function CopyBox({ command, multiline = false }: { command: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the command is still on screen to select
    }
  };
  return (
    <div
      className={`flex gap-2 rounded-xl border border-border bg-muted/40 py-1.5 pl-3 pr-1.5 ${
        multiline ? 'items-start' : 'items-center'
      }`}
    >
      {multiline ? (
        <pre className="min-w-0 flex-1 select-all overflow-x-auto py-1 text-xs">
          <code>{command}</code>
        </pre>
      ) : (
        <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap text-xs">{command}</code>
      )}
      <Button size="sm" variant="outline" onClick={copy} aria-label={`Copy: ${command}`}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
        {n}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-sm font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

function ClientSteps({ client }: { client: Client }) {
  if (client === 'claude-code') {
    return (
      <>
        <CopyBox command={CONNECT_COMMAND} />
        <p className="text-xs text-muted-foreground">Run once in a terminal; it then works from any folder.</p>
      </>
    );
  }
  if (client === 'codex') {
    return <CopyBox command={CONNECT_COMMAND_CODEX} />;
  }
  return (
    <>
      <CopyBox command={CONNECT_CONFIG_JSON} multiline />
      <p className="text-xs text-muted-foreground">
        Add this to your client&apos;s MCP config (for Claude Desktop: Settings, Developer, Edit Config),
        then restart it. Any app that can run a local MCP server over stdio works.
      </p>
    </>
  );
}

export function AgentBridgeDialog({
  open,
  onOpenChange,
  enabled,
  onToggle,
  status,
  onCheckAgain,
  askInBrowser,
  onAskInBrowserChange,
  undoableCount,
  onOpenActivity,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  enabled: boolean;
  onToggle: () => void;
  status: StatusView;
  onCheckAgain: () => void;
  askInBrowser: boolean;
  onAskInBrowserChange: (value: boolean) => void;
  /** How many agent actions can still be undone. */
  undoableCount: number;
  onOpenActivity: () => void;
}) {
  const canRetry = enabled && (status.state === 'not_installed' || status.state === 'error');
  const connected = enabled && status.state === 'connected';
  // Once it works, the setup steps are out of the way; the dialog remounts on each open.
  const [setupOpen, setSetupOpen] = useState(!connected);
  const [client, setClient] = useState<Client>('claude-code');

  // Shown inside step 2 while the setup steps are open, otherwise at the top.
  const toggle = (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
        enabled ? 'bg-primary/10' : 'bg-muted/40'
      }`}
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        <Bot size={16} />
        {enabled ? 'Agent bridge is on' : 'Agent bridge is off'}
      </span>
      <Switch on={enabled} />
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Agent bridge</DialogTitle>
          <DialogDescription>
            Let an AI agent, like Claude Code, open your snapshots and help clean up tabs. It stays on
            this computer, and it is off until you turn it on.
          </DialogDescription>
        </DialogHeader>

        <div className="-mr-3 flex min-h-0 flex-col gap-4 overflow-y-auto pr-3 [&>*]:shrink-0">
          <div
            className={`overflow-hidden rounded-xl border transition-colors ${
              enabled ? 'border-primary/50' : 'border-border'
            }`}
          >
            {!setupOpen && toggle}
            <div
              className={`flex items-start gap-3 px-4 py-3 ${setupOpen ? '' : 'border-t border-border'}`}
              aria-live="polite"
            >
              <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[status.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">Status: {status.label}</p>
                {status.detail && <p className="mt-0.5 text-xs text-muted-foreground">{status.detail}</p>}
              </div>
              {canRetry && (
                <Button size="sm" variant="outline" onClick={onCheckAgain}>
                  <RefreshCw size={14} />
                  Check again
                </Button>
              )}
            </div>
          </div>

        <div className="rounded-xl border border-border">
          <button
            type="button"
            aria-expanded={setupOpen}
            onClick={() => setSetupOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
          >
            {connected ? 'Setup instructions' : 'Set up in 3 steps'}
            <ChevronDown size={16} className={`transition-transform ${setupOpen ? 'rotate-180' : ''}`} />
          </button>
          {setupOpen && (
            <ol className="flex flex-col gap-4 border-t border-border px-4 py-4">
              <Step n={1} title="Install it (in a terminal)">
                <CopyBox command={INSTALL_COMMAND} />
                <p className="text-xs text-muted-foreground">Needs Node 20 or later.</p>
              </Step>
              <Step n={2} title="Restart your browser, then turn the bridge on">
                <div className="overflow-hidden rounded-xl border border-border">{toggle}</div>
              </Step>
              <Step n={3} title="Connect your AI client">
                <div role="tablist" className="flex gap-1 rounded-lg bg-muted/60 p-1">
                  {CLIENTS.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="tab"
                      aria-selected={client === c.id}
                      onClick={() => setClient(c.id)}
                      className={`flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        client === c.id
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <ClientSteps client={client} />
              </Step>
            </ol>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ShieldCheck size={14} />
            You stay in control
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={askInBrowser}
            onClick={() => onAskInBrowserChange(!askInBrowser)}
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
              askInBrowser ? 'border-amber-400/60 bg-amber-400/15' : 'border-border bg-muted/40'
            }`}
          >
            <span className="text-sm">
              <span className="block font-medium">Ask me in the browser first</span>
              <span className="block text-xs text-muted-foreground">
                Before an agent closes or archives tabs, show a window with the list and wait for your
                click.
              </span>
            </span>
            <Switch on={askInBrowser} tone="amber" />
          </button>

          <Button
            variant="outline"
            className="justify-between"
            onClick={() => {
              onOpenChange(false);
              onOpenActivity();
            }}
          >
            <span className="flex items-center gap-2">
              <History size={16} />
              Agent activity
            </span>
            {undoableCount > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {undoableCount} to undo
              </span>
            )}
          </Button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
