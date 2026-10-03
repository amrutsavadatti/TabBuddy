import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle } from 'lucide-react';
import { NudgeCard, usePendingNudge } from '@/components/NudgeCard';

/** A rounded card peeking in from the right edge while a nudge is waiting for
 * an answer, so an ignored nudge can't go unnoticed. Starts collapsed (just the
 * pulsing handle); click to slide it out and decide here. */
export function NudgePeek() {
  const tab = usePendingNudge();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Collapse on an outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Answered or gone: next nudge starts collapsed again.
  const pending = tab !== null;
  useEffect(() => {
    if (!pending) setOpen(false);
  }, [pending]);

  if (!tab) return null;

  // Portalled to <body> and above the snapshot cards (z-30) and the hover
  // preview (z-40), but still under modal dialogs (z-50), so no ancestor
  // stacking context can bury it.
  return createPortal(
    <div
      ref={rootRef}
      className="fixed right-0 top-1/3 z-[45] flex items-stretch transition-transform duration-300 ease-out motion-reduce:transition-none"
      style={{ transform: open ? 'none' : 'translateX(calc(100% - 2.75rem))' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="A tab needs a decision"
        title="A tab needs a decision"
        className="relative flex w-11 shrink-0 items-center justify-center rounded-l-2xl border border-r-0 border-border bg-yellow-400 text-yellow-950 shadow-lg"
      >
        {!open && (
          <span className="absolute inset-0 animate-ping rounded-l-2xl bg-yellow-400 opacity-40 motion-reduce:animate-none" />
        )}
        <HelpCircle size={20} className="relative" />
      </button>
      <div
        inert={!open}
        className="w-72 border-y border-l-0 border-border bg-background p-3 shadow-2xl"
      >
        <NudgeCard tab={tab} onJumped={() => setOpen(false)} />
      </div>
    </div>,
    document.body,
  );
}
