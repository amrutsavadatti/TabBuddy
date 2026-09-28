import { useEffect, useRef, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { PlayingNow, usePlayingTabs } from '@/components/PlayingNow';

/** A header pill that appears only while a tab is making sound. Click it for
 * the same list as the toolbar popup: jump to a tab, or mute it. */
export function PlayingPill() {
  const { tabs, refresh } = usePlayingTabs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape.
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

  // The sound stopped: there is nothing left to show, so close the list too.
  const nothingPlaying = tabs.length === 0;
  useEffect(() => {
    if (nothingPlaying) setOpen(false);
  }, [nothingPlaying]);

  if (nothingPlaying) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Tabs playing sound"
        className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-emerald-400 bg-emerald-400 px-3.5 py-1.5 text-sm font-medium text-emerald-950 transition-colors hover:bg-emerald-300"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-900 opacity-40" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-900" />
        </span>
        <Volume2 size={15} />
        {tabs.length} playing
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl shadow-2xl">
          <PlayingNow tabs={tabs} onChanged={refresh} onJumped={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
