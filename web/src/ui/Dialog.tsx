import { AnimatePresence, motion, useDragControls, type PanInfo } from 'framer-motion';
import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEvent, useIsMobile } from '../lib/hooks';
import { springDialog, springSoft } from './motion';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  width?: number;
  /** render as bottom sheet on phones (default true) */
  sheetOnMobile?: boolean;
  dismissible?: boolean;
  className?: string;
  bodyClassName?: string;
  hideClose?: boolean;
}

const openStack: string[] = [];

export function Dialog({ open, onClose, title, subtitle, icon, children, actions, width, sheetOnMobile = true, dismissible = true, className = '', bodyClassName = '', hideClose }: DialogProps) {
  const mobile = useIsMobile();
  const id = useId();
  const asSheet = mobile && sheetOnMobile;
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useDragControls();

  const close = useEvent(() => onClose());
  useEffect(() => {
    if (!open) return;
    openStack.push(id);
    const prevFocus = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>('[autofocus], input, textarea, select, button:not([data-skip-focus])');
      (el ?? panelRef.current)?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack[openStack.length - 1] === id && dismissible) {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      const i = openStack.indexOf(id);
      if (i >= 0) openStack.splice(i, 1);
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [open, id, close, dismissible]);

  const head = (title || icon) && (
    <div className="dialog-head">
      {icon}
      <div className="titles">
        {title && <h2 className="dialog-title">{title}</h2>}
        {subtitle && <p className="dialog-sub">{subtitle}</p>}
      </div>
      {!hideClose && dismissible && (
        <button className="icon-btn" onClick={onClose} aria-label="关闭" data-skip-focus>
          <X />
        </button>
      )}
    </div>
  );

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            className="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            onClick={() => dismissible && onClose()}
          />
          {asSheet ? (
            <motion.div
              key="sheet"
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              tabIndex={-1}
              className={`sheet ${className}`}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%', transition: { duration: 0.24, ease: [0.3, 0, 0.8, 0.15] } }}
              transition={springSoft}
              drag={dismissible ? 'y' : false}
              dragListener={false}
              dragControls={drag}
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.6 }}
              onDragEnd={onDragEnd}
            >
              <div className="sheet-grip" onPointerDown={(e) => drag.start(e)} style={{ touchAction: 'none', cursor: 'grab' }} />
              <div onPointerDown={(e) => drag.start(e)} style={{ touchAction: 'none' }}>
                {head}
              </div>
              <div className={`dialog-body ${bodyClassName}`}>{children}</div>
              {actions && <div className="dialog-actions">{actions}</div>}
            </motion.div>
          ) : (
            <div className="dialog-wrap" key="wrap">
              <motion.div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                tabIndex={-1}
                className={`dialog ${className}`}
                style={{ ['--dialog-w' as string]: width ? `${width}px` : undefined }}
                initial={{ opacity: 0, scale: 0.9, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.94, y: 6, transition: { duration: 0.16, ease: [0.3, 0, 0.8, 0.15] } }}
                transition={springDialog}
              >
                {head}
                <div className={`dialog-body ${bodyClassName}`}>{children}</div>
                {actions && <div className="dialog-actions">{actions}</div>}
              </motion.div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
