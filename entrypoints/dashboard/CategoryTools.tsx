import { useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
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
import type { Category } from '@/lib/types';

export const CATEGORY_DROP_PREFIX = 'category:';

function DropChip({ category }: { category: Category }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${CATEGORY_DROP_PREFIX}${category.id}` });
  const color = getCategoryColor(category);
  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[120px] max-w-[200px] items-center gap-2 rounded-xl border-t-4 border-border bg-card px-3 py-2.5 text-sm font-medium shadow-sm transition-all duration-150 ${
        isOver ? 'z-10 scale-105 shadow-xl ring-2 ring-primary' : ''
      }`}
      style={{ borderTopColor: color }}
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="truncate">{category.name}</span>
    </div>
  );
}

/** Row of drop targets shown while browsing a category. Dropping a card on
 * one adds that category to the snapshot. */
export function CategoryDropStrip({
  categories,
  notice,
}: {
  categories: Category[];
  notice: string | null;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-dashed border-border bg-card/50 p-3">
      <p className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Drag a card by its grip handle onto a category to add it</span>
        {notice && <span className="text-primary">{notice}</span>}
      </p>
      {categories.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No other categories yet — create one with the tag icon on a card.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <DropChip key={c.id} category={c} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BulkCategoryDialog({
  categories,
  selectedCount,
  onApply,
  onCreate,
}: {
  categories: Category[];
  selectedCount: number;
  onApply: (categoryIds: string[]) => Promise<void>;
  onCreate: (name: string) => Promise<Category>;
}) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const create = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const category = await onCreate(name);
      setChosen((prev) => new Set(prev).add(category.id));
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      await onApply([...chosen]);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setChosen(new Set());
          setDraft('');
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={selectedCount === 0}>
          <Tag size={14} className="mr-1" /> Add to category
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add to category</DialogTitle>
          <DialogDescription>
            Tag {selectedCount} selected snapshot{selectedCount === 1 ? '' : 's'}. Existing tags are kept.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {categories.length === 0 && (
            <p className="py-2 text-sm text-muted-foreground">
              No categories yet — create your first one below.
            </p>
          )}
          {categories.map((c) => {
            const on = chosen.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggle(c.id)}
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
          <Button type="submit" size="sm" variant="outline" disabled={!draft.trim() || busy}>
            <Plus size={14} className="mr-1" /> New
          </Button>
        </form>

        <Button onClick={apply} disabled={chosen.size === 0 || busy}>
          Add to {chosen.size || ''} categor{chosen.size === 1 ? 'y' : 'ies'}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
