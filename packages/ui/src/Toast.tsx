'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CheckIcon } from './icons';

const ToastContext = createContext<((message: string) => void) | null>(null);

export const TOAST_MS = 3500;

/** Wrap the app once. Any component can then call `useToast()("Saved.")`. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: string) => {
    if (timer.current) clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const value = useMemo(() => show, [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* The live region stays mounted so screen readers announce new messages. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 left-1/2 z-[60] -translate-x-1/2"
      >
        {message ? (
          <div className="pointer-events-auto flex w-max max-w-[min(440px,calc(100vw-32px))] items-center gap-2.5 rounded-panel bg-ink px-4 py-3 text-sm leading-snug text-white shadow-toast">
            <span className="flex size-[22px] flex-none items-center justify-center rounded-full bg-lime text-forest">
              <CheckIcon size={13} />
            </span>
            <span>{message}</span>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast must be used inside <ToastProvider>');
  return show;
}
