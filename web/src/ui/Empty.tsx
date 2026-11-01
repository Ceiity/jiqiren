import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Blob } from './controls';
import { springSoft } from './motion';

export function Empty({ icon: Icon, title, subtitle, action, compact }: { icon: LucideIcon; title: ReactNode; subtitle?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <motion.div className="empty" style={compact ? { padding: '24px 12px' } : undefined} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={springSoft}>
      <motion.div className="empty-art" style={compact ? { width: 72, height: 72 } : undefined} initial={{ scale: 0.8, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', bounce: 0.4, duration: 0.6 }}>
        <Blob />
        <Icon strokeWidth={1.6} />
      </motion.div>
      <div className="empty-title">{title}</div>
      {subtitle && <div className="empty-sub">{subtitle}</div>}
      {action}
    </motion.div>
  );
}
