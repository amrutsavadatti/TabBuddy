import { useState } from 'react';
import { Bot, Check, Copy, History, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { StatusView } from '@/lib/agentBridgeStatus';

export const INSTALL_COMMAND = 'npm install -g tabbuddy-bridge && tabbuddy-bridge install';
export const CONNECT_COMMAND = 'claude mcp add tabbuddy -- tabbuddy-bridge serve';

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

function CopyLine({ label, command }: { label: string; command: string }) {
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
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 py-1.5 pl-3 pr-1.5">
        <code className="min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap text-xs">{command}</code>
        <Button size="sm" variant="outline" onClick={copy} aria-label={`Copy: ${command}`}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
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

        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={onToggle}
          className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
            enabled ? 'border-primary/50 bg-primary/10' : 'border-border bg-muted/40'
          }`}
        >
          <span className="flex items-center gap-2 text-sm font-medium">
            <Bot size={16} />
            {enabled ? 'Agent bridge is on' : 'Agent bridge is off'}
          </span>
          <Switch on={enabled} />
        </button>

        <div className="flex items-start gap-3 rounded-xl border border-border px-4 py-3" aria-live="polite">
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

        <div className="flex flex-col gap-3">
          <CopyLine label="1. Install the bridge (in a terminal), then restart your browser" command={INSTALL_COMMAND} />
          <CopyLine label="2. Connect Claude Code to it" command={CONNECT_COMMAND} />
        </div>

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
      </DialogContent>
    </Dialog>
  );
}
