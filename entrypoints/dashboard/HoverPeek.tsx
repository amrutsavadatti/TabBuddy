import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { computePeekPlacement, type Box, type PeekPlacement } from '@/lib/peekPosition';
import type { Snapshot } from '@/lib/types';

const MAX_TABS = 8;

/** Floating preview of a snapshot's tabs. Fixed-position and portalled to the
 * page, so it sits on top of neighbouring cards, never changes the layout,
 * and never gets clipped. Its z-index is below modal dialogs (z-50), so even
 * if it were ever left open it could not cover one. Positioned by computePeekPlacement. */
export function HoverPeek({ anchor, snapshot }: { anchor: Box; snapshot: Snapshot }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<PeekPlacement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlacement(
      computePeekPlacement(
        anchor,
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [anchor, snapshot.tabs.length]);

  const tabs = snapshot.tabs.slice(0, MAX_TABS);
  const extra = snapshot.tabs.length - tabs.length;

  return createPortal(
    <div
      ref={ref}
      style={{
        left: placement?.left ?? 0,
        top: placement?.top ?? 0,
        visibility: placement ? 'visible' : 'hidden',
      }}
      className="pointer-events-none fixed z-40 w-80 rounded-xl border border-border bg-card p-3 text-card-foreground shadow-2xl"
    >
      {placement && placement.placement !== 'center' && (
        <span
          className={`absolute h-3 w-3 rotate-45 border-border bg-card ${
            placement.placement === 'below'
              ? '-top-1.5 border-l border-t'
              : '-bottom-1.5 border-b border-r'
          }`}
          style={{ left: placement.arrowLeft - 6 }}
        />
      )}
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {snapshot.name} · {snapshot.tabs.length} tab{snapshot.tabs.length === 1 ? '' : 's'}
      </p>
      <ul className="flex flex-col gap-1.5">
        {tabs.map((tab, index) => (
          <li key={index} className="flex items-center gap-2 text-xs">
            {tab.favIconUrl ? (
              <img src={tab.favIconUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm" />
            ) : (
              <div className="h-4 w-4 shrink-0 rounded-sm bg-muted" />
            )}
            <span className="truncate">{tab.title || tab.url}</span>
          </li>
        ))}
        {extra > 0 && <li className="text-xs text-muted-foreground">+{extra} more</li>}
      </ul>
    </div>,
    document.body,
  );
}
