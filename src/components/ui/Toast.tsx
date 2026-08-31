import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { springSoft } from '@/components/motion/transitions';
import { uid } from '@/lib/id';

/**
 * Notifications éphémères — le remplacement des `alert()` du prototype.
 * Elles n'interrompent jamais : on peut continuer à travailler pendant
 * qu'elles s'affichent, ce qui compte pour une session de révision longue.
 */

export type ToastTone = 'info' | 'success' | 'error';

interface Toast {
  id: string;
  message: string;
  tone: ToastTone;
}

interface ToastContextValue {
  notify: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast doit être utilisé dans un <ToastProvider>');
  return context;
}

const TONE_STYLES: Record<ToastTone, { border: string; icon: string }> = {
  info: { border: 'var(--line-strong)', icon: 'ℹ️' },
  success: { border: 'var(--success)', icon: '✓' },
  error: { border: 'var(--danger)', icon: '⚠️' },
};

const VISIBLE_MS = 4000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const reduced = useReducedMotion();
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = uid('tst');
      setToasts((current) => [...current, { id, message, tone }]);
      timers.current.set(id, window.setTimeout(() => dismiss(id), VISIBLE_MS));
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          // `pointer-events-none` sur le conteneur : la pile de notifications
          // ne doit jamais intercepter un clic destiné à l'application.
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 pb-safe sm:items-end sm:p-6"
          aria-live="polite"
        >
          <AnimatePresence initial={false}>
            {toasts.map((toast) => (
              <motion.div
                key={toast.id}
                layout={!reduced}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
                transition={reduced ? { duration: 0 } : springSoft}
                onClick={() => dismiss(toast.id)}
                className="pointer-events-auto flex w-full max-w-sm cursor-pointer items-start gap-2.5 rounded-[var(--radius-control)] border bg-[var(--surface)] px-4 py-3 text-[0.88rem] leading-snug shadow-[var(--shadow-lift)]"
                style={{ borderColor: TONE_STYLES[toast.tone].border }}
              >
                <span aria-hidden className="mt-px shrink-0">
                  {TONE_STYLES[toast.tone].icon}
                </span>
                <span className="text-[var(--ink)]">{toast.message}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
