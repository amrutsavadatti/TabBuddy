export interface ToastItem {
  id: string;
  message: string;
  createdAt: number;
}

export const TOAST_DURATION_MS = 3000;

export function addToast(
  toasts: ToastItem[],
  id: string,
  message: string,
  now: number = Date.now(),
): ToastItem[] {
  return [...toasts, { id, message, createdAt: now }];
}

export function removeToast(toasts: ToastItem[], id: string): ToastItem[] {
  return toasts.filter((t) => t.id !== id);
}

export function pruneExpiredToasts(
  toasts: ToastItem[],
  now: number = Date.now(),
  duration: number = TOAST_DURATION_MS,
): ToastItem[] {
  return toasts.filter((t) => now - t.createdAt < duration);
}
