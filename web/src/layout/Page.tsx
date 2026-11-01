import { motion } from 'framer-motion';
import { createContext, useContext, useRef, type ReactNode, type RefObject } from 'react';
import { fadeTab } from '../ui/motion';

const ScrollCtx = createContext<RefObject<HTMLDivElement> | null>(null);
export const usePageScroll = () => useContext(ScrollCtx);

interface PageProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** content that sticks under the title (toolbars) */
  toolbar?: ReactNode;
  className?: string;
  wide?: boolean;
}

/** A top-level page: FlClash page bar (title + round actions) above a scrolling body. */
export function Page({ title, subtitle, actions, children, toolbar, className = '', wide }: PageProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <ScrollCtx.Provider value={ref}>
      <div className={`page ${className}`} ref={ref}>
        <header className="page-bar">
          <div className="page-titles">
            <h1 className="page-title">{title}</h1>
            {subtitle && <div className="page-subtitle">{subtitle}</div>}
          </div>
          {actions && <div className="page-actions">{actions}</div>}
        </header>
        {toolbar && <div className="page-toolbar">{toolbar}</div>}
        <motion.div className={`page-body${wide ? ' wide' : ''}`} variants={fadeTab} initial="initial" animate="enter">
          {children}
        </motion.div>
      </div>
    </ScrollCtx.Provider>
  );
}
