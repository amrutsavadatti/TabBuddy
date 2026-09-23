import { useState } from 'react';
import { Check, Ellipsis, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { isArchivedSnapshot } from '@/lib/archive';
import {
  getCategoryColor,
  getSnapshotsInCategory,
  getUncategorizedSnapshots,
} from '@/lib/categories';
import type { Category, Snapshot } from '@/lib/types';

export const UNCATEGORIZED_ID = 'uncategorized';
export const UNCATEGORIZED_COLOR = 'hsl(0 0% 60%)';
const PREVIEW_COUNT = 3;

const COLOR_CHOICES = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

function ManageCategoryDialog({
  category,
  onRename,
  onRecolor,
  onDelete,
}: {
  category: Category;
  onRename: (name: string) => Promise<void>;
  onRecolor: (color: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    try {
      await onRename(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't rename that category.");
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) {
          setName(category.name);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          title="Rename, recolor or delete"
          aria-label={`Manage ${category.name}`}
        >
          <Ellipsis size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Manage category</DialogTitle>
          <DialogDescription>
            Deleting a category never deletes the snapshots in it.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="w-full rounded-full border border-border bg-background px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim() || name.trim() === category.name}
          >
            Save
          </Button>
        </form>
        {error && <p className="text-xs text-destructive">{error}</p>}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Color</p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onRecolor(null)}
              title="Automatic"
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                category.color === null ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted'
              }`}
            >
              Auto
            </button>
            {COLOR_CHOICES.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onRecolor(color)}
                title={color}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: color }}
              >
                {category.color === color && <Check size={14} className="text-white" />}
              </button>
            ))}
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="text-destructive">
              <Trash2 size={14} className="mr-1" /> Delete category
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{category.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                Its snapshots are kept — they just lose this tag.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => onDelete()}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function CategoryStack({
  name,
  color,
  snapshots,
  manage,
  onOpen,
}: {
  name: string;
  color: string;
  snapshots: Snapshot[];
  manage?: React.ReactNode;
  onOpen: () => void;
}) {
  const previews = snapshots.slice(0, PREVIEW_COUNT);
  const extra = snapshots.length - previews.length;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Open ${name}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group relative cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <div className="relative h-44">
        <div
          className="absolute inset-x-3 top-3 bottom-[-6px] rotate-[3deg] rounded-xl border border-border bg-card/60 shadow-sm transition-transform duration-200 group-hover:rotate-[6deg]"
          style={{ borderTopColor: color, borderTopWidth: 4 }}
        />
        <div
          className="absolute inset-x-1.5 top-1.5 bottom-[-3px] -rotate-[2deg] rounded-xl border border-border bg-card/85 shadow-sm transition-transform duration-200 group-hover:-rotate-[4deg]"
          style={{ borderTopColor: color, borderTopWidth: 4 }}
        />
        <div
          className="absolute inset-0 flex flex-col gap-2 rounded-xl border border-border bg-card p-4 text-card-foreground shadow-md transition-transform duration-200 group-hover:-translate-y-0.5"
          style={{ borderTopColor: color, borderTopWidth: 4 }}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-lg font-semibold tracking-tight" title={name}>
              {name}
            </h3>
            {manage && (
              // Stops clicks/keys inside the manage dialog (rendered in a portal but
              // still a React child) from also opening the stack.
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {manage}
              </div>
            )}
          </div>
          <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {snapshots.length} snapshot{snapshots.length === 1 ? '' : 's'}
          </span>
          {snapshots.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Empty — tag snapshots with the tag icon on their card.
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {previews.map((s) => (
                <li key={s.id} className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="truncate">{s.name}</span>
                </li>
              ))}
              {extra > 0 && <li className="pl-3">+{extra} more</li>}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function CategoriesView({
  snapshots,
  categories,
  onRename,
  onRecolor,
  onDelete,
  onOpen,
}: {
  snapshots: Snapshot[];
  categories: Category[];
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const taggable = snapshots.filter((s) => !isArchivedSnapshot(s));
  const uncategorized = getUncategorizedSnapshots(taggable, categories);

  return (
    <div className="flex flex-col gap-6">
      {categories.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No categories yet. Click the tag icon on any snapshot card to create one — a snapshot
          can belong to several.
        </p>
      )}
      <div className="grid grid-cols-1 gap-x-4 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {categories.map((category) => (
          <CategoryStack
            key={category.id}
            name={category.name}
            color={getCategoryColor(category)}
            snapshots={getSnapshotsInCategory(taggable, category.id)}
            onOpen={() => onOpen(category.id)}
            manage={
              <ManageCategoryDialog
                category={category}
                onRename={(name) => onRename(category.id, name)}
                onRecolor={(color) => onRecolor(category.id, color)}
                onDelete={() => onDelete(category.id)}
              />
            }
          />
        ))}
        {uncategorized.length > 0 && (
          <CategoryStack
            name="Uncategorized"
            color={UNCATEGORIZED_COLOR}
            snapshots={uncategorized}
            onOpen={() => onOpen(UNCATEGORIZED_ID)}
          />
        )}
      </div>
    </div>
  );
}
