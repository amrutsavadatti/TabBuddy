import { useState } from 'react';
import { EyeOff, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getAccentColor } from '@/lib/color';
import { SLOT_COUNT, type QuickLinkSlots } from '@/lib/quickLinkSlots';
import type { TopSite } from '@/lib/siteStats';

const AUTO_SLOTS = 3;

interface CircleSite {
  domain: string;
  favIconUrl?: string;
}

interface CornerAction {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function SiteCircle({
  site,
  onOpen,
  action,
}: {
  site: CircleSite;
  onOpen: () => void;
  action?: CornerAction;
}) {
  const [iconFailed, setIconFailed] = useState(false);
  const accent = getAccentColor(site.domain);
  const accent2 = getAccentColor([...site.domain].reverse().join(''));
  const showIcon = site.favIconUrl && !iconFailed;

  return (
    <div className="group relative flex w-24 flex-col items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        title={`Open ${site.domain}`}
        className="flex w-full flex-col items-center gap-2 outline-none"
      >
        <span
          className="rounded-full p-[3px] shadow-sm transition-all duration-200 group-hover:-translate-y-1 group-hover:scale-105 group-hover:shadow-xl group-focus-within:ring-2 group-focus-within:ring-primary"
          style={{ backgroundImage: `linear-gradient(135deg, ${accent}, ${accent2})` }}
        >
          <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-card">
            {showIcon ? (
              <img
                src={site.favIconUrl}
                alt=""
                className="h-8 w-8 rounded-md"
                onError={() => setIconFailed(true)}
              />
            ) : (
              <span
                className="flex h-full w-full items-center justify-center text-2xl font-semibold text-white"
                style={{ backgroundImage: `linear-gradient(135deg, ${accent}, ${accent2})` }}
              >
                {site.domain.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </span>
        <span className="w-full truncate text-center text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
          {site.domain}
        </span>
      </button>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          title={action.label}
          aria-label={`${action.label}: ${site.domain}`}
          className="absolute right-2 top-0 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
        >
          {action.icon}
        </button>
      )}
    </div>
  );
}

function EmptyAutoCircle() {
  return (
    <div
      className="flex w-24 flex-col items-center gap-2"
      title="Your most visited sites will show up here"
    >
      <span className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-2 border-dashed border-border bg-card/40" />
      <span className="h-3 w-12 rounded-full bg-muted/60" />
    </div>
  );
}

function AddCircle({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Add a site"
      className="group flex w-24 flex-col items-center gap-2 outline-none"
    >
      <span className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-2 border-dashed border-border bg-card/40 text-muted-foreground transition-all duration-200 group-hover:-translate-y-1 group-hover:border-primary group-hover:text-primary group-focus-visible:ring-2 group-focus-visible:ring-primary">
        <Plus size={26} />
      </span>
      <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
        Add a site
      </span>
    </button>
  );
}

function SlotDialog({
  open,
  index,
  current,
  suggestions,
  onClose,
  onSave,
  onClear,
}: {
  open: boolean;
  index: number | null;
  current: { domain: string; url: string } | null;
  suggestions: string[];
  onClose: () => void;
  onSave: (index: number, input: string) => Promise<string | null>;
  onClear: (index: number) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (input: string) => {
    if (index === null || busy) return;
    setBusy(true);
    setError(null);
    const message = await onSave(index, input);
    setBusy(false);
    if (message) setError(message);
    else onClose();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
        else {
          setValue(current?.url ?? '');
          setError(null);
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{current ? 'Change quick link' : 'Add a quick link'}</DialogTitle>
          <DialogDescription>
            Type a website, or pick one you visit a lot. A full address opens that exact page.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="github.com"
            aria-invalid={error !== null}
            className={`w-full rounded-full border bg-background px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40 ${
              error ? 'border-destructive' : 'border-border'
            }`}
          />
          <Button type="submit" size="sm" disabled={!value.trim() || busy}>
            Save
          </Button>
        </form>
        {error && <p className="-mt-2 text-xs text-destructive">{error}</p>}

        {suggestions.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Your most visited</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((domain) => (
                <button
                  key={domain}
                  type="button"
                  onClick={() => submit(domain)}
                  className="rounded-full border border-border px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
                >
                  {domain}
                </button>
              ))}
            </div>
          </div>
        )}

        {current && index !== null && (
          <Button
            variant="outline"
            className="text-destructive"
            onClick={async () => {
              await onClear(index);
              onClose();
            }}
          >
            Remove from quick links
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A centred row of circular shortcuts: the three most visited sites, then
 * three the user chose. */
export function QuickLinks({
  sites,
  slots,
  slotIcons,
  suggestions,
  onOpen,
  onSaveSlot,
  onClearSlot,
  onHideSite,
  className,
}: {
  sites: TopSite[];
  slots: QuickLinkSlots;
  /** Favicons seen for the chosen sites, by domain. */
  slotIcons: Record<string, string | undefined>;
  suggestions: string[];
  onOpen: (domain: string, url?: string) => void;
  onSaveSlot: (index: number, input: string) => Promise<string | null>;
  onClearSlot: (index: number) => Promise<void>;
  onHideSite: (domain: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <section
      aria-label="Quick links"
      className={`mb-8 flex flex-wrap items-start justify-center gap-x-4 gap-y-4 ${className ?? ''}`}
    >
      {Array.from({ length: AUTO_SLOTS }, (_, i) => {
        const site = sites[i];
        return (
          <div
            key={site?.domain ?? `auto-${i}`}
            className="fan-out"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            {site ? (
              <SiteCircle
                site={site}
                onOpen={() => onOpen(site.domain)}
                action={{
                  label: 'Hide this site',
                  icon: <EyeOff size={12} />,
                  onClick: () => onHideSite(site.domain),
                }}
              />
            ) : (
              <EmptyAutoCircle />
            )}
          </div>
        );
      })}

      <span aria-hidden className="mx-2 mt-2 hidden h-16 w-px self-start bg-border sm:block" />

      {Array.from({ length: SLOT_COUNT }, (_, i) => {
        const slot = slots[i] ?? null;
        return (
          <div
            key={slot?.domain ?? `slot-${i}`}
            className="fan-out"
            style={{ animationDelay: `${(AUTO_SLOTS + i) * 60}ms` }}
          >
            {slot ? (
              <SiteCircle
                site={{ domain: slot.domain, favIconUrl: slotIcons[slot.domain] }}
                onOpen={() => onOpen(slot.domain, slot.url)}
                action={{
                  label: 'Change or remove',
                  icon: <Pencil size={12} />,
                  onClick: () => setEditing(i),
                }}
              />
            ) : (
              <AddCircle onClick={() => setEditing(i)} />
            )}
          </div>
        );
      })}

      <SlotDialog
        open={editing !== null}
        index={editing}
        current={editing !== null ? (slots[editing] ?? null) : null}
        suggestions={suggestions}
        onClose={() => setEditing(null)}
        onSave={onSaveSlot}
        onClear={onClearSlot}
      />
    </section>
  );
}
