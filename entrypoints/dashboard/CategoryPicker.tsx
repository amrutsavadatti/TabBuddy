import { useState } from 'react';
import { Check, Plus, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getCategoryColor } from '@/lib/categories';
import type { Category, Snapshot } from '@/lib/types';

const MAX_CHIPS = 2;

/** Always renders exactly one fixed-height line, whether the snapshot has no
 * categories or many, so tagging never changes a card's height. */
export function CategoryChips({
  snapshot,
  categories,
}: {
  snapshot: Snapshot;
  categories: Category[];
}) {
  const assigned = categories.filter((c) => snapshot.categoryIds.includes(c.id));
  const shown = assigned.slice(0, MAX_CHIPS);
  const extra = assigned.length - shown.length;

  return (
    <div className="flex h-6 min-w-0 items-center gap-1.5 overflow-hidden">
      {assigned.length === 0 ? (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
          <Tag size={12} /> No category
        </span>
      ) : (
        <>
          {shown.map((c) => (
            <span
              key={c.id}
              className="inline-flex min-w-0 shrink items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs font-medium"
              title={c.name}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: getCategoryColor(c) }}
              />
              <span className="truncate">{c.name}</span>
            </span>
          ))}
          {extra > 0 && (
            <span
              className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
              title={assigned
                .slice(MAX_CHIPS)
                .map((c) => c.name)
                .join(', ')}
            >
              +{extra}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export function CategoryPicker({
  snapshot,
  categories,
  onToggle,
  onCreate,
}: {
  snapshot: Snapshot;
  categories: Category[];
  onToggle: (categoryId: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onCreate(name);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog onOpenChange={(open) => open && setDraft('')}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" title="Categories">
          <Tag size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Categories</DialogTitle>
          <DialogDescription>
            Tag "{snapshot.name}" with any number of categories.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {categories.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              No categories yet — create your first one below.
            </p>
          )}
          {categories.map((c) => {
            const on = snapshot.categoryIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onToggle(c.id)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition-colors ${
                  on ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
                }`}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full"
                  style={{ backgroundColor: getCategoryColor(c) }}
                />
                <span className="flex-1 truncate font-medium">{c.name}</span>
                {on && <Check size={16} className="text-primary" />}
              </button>
            );
          })}
        </div>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="New category…"
            maxLength={40}
            className="w-full rounded-full border border-border bg-background px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button type="submit" size="sm" disabled={!draft.trim() || busy}>
            <Plus size={14} className="mr-1" /> Add
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
