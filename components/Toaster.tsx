import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { addToast, removeToast, TOAST_DURATION_MS, type ToastItem } from '@/lib/toastQueue';

const ToastContext = createContext<((message: string) => void) | null>(null);

/** Call to acknowledge a completed action, e.g. showToast('Snapshot deleted').
 * For destructive or easy-to-miss actions only — not every click. */
export function useToast(): (message: string) => void {
  const showToast = useContext(ToastContext);
  if (!showToast) throw new Error('useToast must be used inside a ToastProvider');
  return showToast;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((message: string) => {
    const id = `toast-${++counter.current}`;
    setToasts((prev) => addToast(prev, id, message));
    setTimeout(() => setToasts((prev) => removeToast(prev, id)), TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[100] flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-lg"
          >
            <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
