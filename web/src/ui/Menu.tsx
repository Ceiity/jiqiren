import { AnimatePresence, motion } from 'framer-motion';
import { Check, type LucideIcon } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEvent, useIsMobile } from '../lib/hooks';
import { Dialog } from './Dialog';

export type MenuEntry =
  | { type?: 'item'; label: string; icon?: LucideIcon; onSelect: () => void; danger?: boolean; disabled?: boolean; checked?: boolean; shortcut?: string; hidden?: boolean }
  | { type: 'separator'; hidden?: boolean }
  | { type: 'label'; label: string; hidden?: boolean };

export interface MenuAnchor {
  x: number;
  y: number;
  /** element rect when anchored to a button */
  rect?: DOMRect;
  align?: 'start' | 'end';
}

export function anchorFrom(el: Element, align: 'start' | 'end' = 'start'): MenuAnchor {
  const rect = el.getBoundingClientRect();
  return { x: align === 'end' ? rect.right : rect.left, y: rect.bottom, rect, align };
}

interface MenuProps {
  anchor: MenuAnchor | null;
  onClose: () => void;
  items: MenuEntry[];
  title?: ReactNode;
  /** use bottom sheet on phones */
  sheetOnMobile?: boolean;
}

export function Menu({ anchor, onClose, items, title, sheetOnMobile = true }: MenuProps) {
  const mobile = useIsMobile();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const [focus, setFocus] = useState(-1);
  const visible = items.filter((i) => !i.hidden);
  const actionable = visible.map((i, idx) => ((i.type ?? 'item') === 'item' && !(i as { disabled?: boolean }).disabled ? idx : -1)).filter((i) => i >= 0);

  useLayoutEffect(() => {
    if (!anchor || !ref.current) {
      setPos(null);
      return;
    }
    const m = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.align === 'end' ? anchor.x - m.width : anchor.x;
    let top = anchor.y + (anchor.rect ? 6 : 2);
    let oy = 'top';
    if (top + m.height > vh - 8) {
      const above = (anchor.rect ? anchor.rect.top - 6 : anchor.y - 2) - m.height;
      if (above >= 8) {
        top = above;
        oy = 'bottom';
      } else top = Math.max(8, vh - 8 - m.height);
    }
    left = Math.min(Math.max(8, left), vw - 8 - m.width);
    const ox = anchor.align === 'end' ? 'right' : 'left';
    setPos({ left, top, origin: `${oy} ${ox}` });
    setFocus(-1);
  }, [anchor, items.length]);

  const onDown = useEvent((e: PointerEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) onClose();
  });
  const onKey = useEvent((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFocus((f) => {
        const cur = actionable.indexOf(f);
        const next = e.key === 'ArrowDown' ? (cur + 1) % actionable.length : (cur - 1 + actionable.length) % actionable.length;
        return actionable[next] ?? -1;
      });
    } else if (e.key === 'Enter' && focus >= 0) {
      e.preventDefault();
      const it = visible[focus] as { onSelect?: () => void };
      onClose();
      it.onSelect?.();
    }
  });
  const onResize = useEvent(() => onClose());
  const active = !!anchor && !(mobile && sheetOnMobile);
  useEffect(() => {
    if (!active) return;
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [active, onDown, onKey, onResize]);

  const list = visible.map((it, i) => {
    if (it.type === 'separator') return <div key={i} className="menu-sep" />;
    if (it.type === 'label') return <div key={i} className="menu-label">{it.label}</div>;
    const Icon = it.icon;
    return (
      <button
        key={i}
        role="menuitem"
        className={`menu-item${it.danger ? ' danger' : ''}${focus === i ? ' focused' : ''}`}
        disabled={it.disabled}
        onMouseEnter={() => setFocus(i)}
        onClick={() => {
          onClose();
          it.onSelect();
        }}
      >
        {Icon && <Icon />}
        <span className="grow ellipsis">{it.label}</span>
        {it.checked && <Check className="check" />}
        {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
      </button>
    );
  });

  if (mobile && sheetOnMobile) {
    return (
      <Dialog open={!!anchor} onClose={onClose} title={title} hideClose={!title}>
        <div className="col" style={{ paddingBottom: 8 }}>{list}</div>
      </Dialog>
    );
  }

  return createPortal(
    <AnimatePresence>
      {anchor && (
        <motion.div
          ref={ref}
          role="menu"
          className="menu"
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, ['--origin' as string]: pos?.origin }}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.12 } }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0.14 }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {list}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Convenience hook: const menu = useMenu(); <button onClick={e => menu.open(e.currentTarget)}> … <Menu {...menu.props} items={…}/> */
export function useMenu() {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  return {
    isOpen: !!anchor,
    openAt: (a: MenuAnchor) => setAnchor(a),
    open: (el: Element, align: 'start' | 'end' = 'end') => setAnchor(anchorFrom(el, align)),
    close: () => setAnchor(null),
    props: { anchor, onClose: () => setAnchor(null) },
  };
}
