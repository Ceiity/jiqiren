import { AnimatePresence, motion } from 'framer-motion';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { springSoft } from './motion';

type Kind = 'info' | 'success' | 'error';
interface ToastItem {
  id: number;
  kind: Kind;
  message: string;
  action?: { label: string; onClick: () => void };
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, kind: Kind = 'info', opts: { action?: ToastItem['action']; duration?: number } = {}) {
  const id = ++seq;
  items = [...items.slice(-3), { id, kind, message, action: opts.action }];
  emit();
  setTimeout(() => dismiss(id), opts.duration ?? (kind === 'error' ? 5000 : 3200));
  return id;
}
toast.success = (m: string, o?: Parameters<typeof toast>[2]) => toast(m, 'success', o);
toast.error = (m: string, o?: Parameters<typeof toast>[2]) => toast(m, 'error', o);
export function toastError(e: unknown) {
  toast.error(e instanceof Error ? e.message : String(e));
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const ICON = { info: Info, success: CheckCircle2, error: XCircle };

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {list.map((t) => {
          const Icon = ICON[t.kind];
          return (
            <motion.div
              key={t.id}
              layout
              className={`toast ${t.kind}`}
              initial={{ opacity: 0, y: 24, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95, transition: { duration: 0.16 } }}
              transition={springSoft}
            >
              <Icon />
              <span className="toast-msg">{t.message}</span>
              {t.action && (
                <button
                  className="btn btn-text"
                  onClick={() => {
                    t.action!.onClick();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="关闭">
                <X />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
