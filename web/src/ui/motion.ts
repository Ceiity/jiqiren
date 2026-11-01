import type { Transition, Variants } from 'framer-motion';

/** Alert spring: ~275ms, slight bounce (FlClash dialog feel). */
export const springDialog: Transition = { type: 'spring', duration: 0.34, bounce: 0.18 };
export const springSoft: Transition = { type: 'spring', duration: 0.4, bounce: 0.12 };
export const springSnappy: Transition = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 };
export const easeStandard = [0.2, 0, 0, 1] as const;
export const easeEmphasized = [0.3, 0, 0, 1] as const;

export const fadeTab: Variants = {
  initial: { opacity: 0, y: 6 },
  enter: { opacity: 1, y: 0, transition: { duration: 0.24, ease: easeStandard } },
};

export const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
};

export const cardIn: Variants = {
  hidden: { opacity: 0, y: 10, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.32, ease: easeEmphasized } },
};
