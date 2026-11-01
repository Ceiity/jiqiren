import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';
import { flushSync } from 'react-dom';
import { buildScheme } from './scheme';
import { usePrefs } from '../lib/session';

const mq = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function useSystemDark() {
  const [dark, setDark] = useState(() => mq?.matches ?? false);
  useEffect(() => {
    if (!mq) return;
    const fn = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return dark;
}

export function useResolvedDark() {
  const [prefs] = usePrefs();
  const sys = useSystemDark();
  return prefs.themeMode === 'system' ? sys : prefs.themeMode === 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs] = usePrefs();
  const dark = useResolvedDark();

  useLayoutEffect(() => {
    const scheme = buildScheme(prefs.accentColor, dark ? 'dark' : 'light', prefs.colorStyle);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(scheme)) root.style.setProperty(k, v);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.motion = prefs.motion;
    root.dataset.density = prefs.density;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', scheme['--page']);
    try {
      localStorage.setItem('nl_boot_theme', JSON.stringify({ dark, page: scheme['--page'], fg: scheme['--on-surface'] }));
    } catch {
      /* ignore */
    }
  }, [prefs.accentColor, prefs.colorStyle, prefs.motion, prefs.density, dark]);

  return <MotionConfig reducedMotion={prefs.motion === 'full' ? 'user' : 'always'}>{children}</MotionConfig>;
}

/**
 * Runs a theme mutation with a circular reveal from (x, y) using the View Transitions API.
 * Falls back to the plain CSS colour transition where unsupported or when motion is reduced.
 */
export function withThemeTransition(apply: () => void, origin?: { x: number; y: number }) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion !== 'full';
  if (!doc.startViewTransition || reduce) {
    apply();
    return;
  }
  const x = origin?.x ?? window.innerWidth / 2;
  const y = origin?.y ?? window.innerHeight / 2;
  const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
  const t = doc.startViewTransition(() => {
    // flush synchronously so the new snapshot has the new theme
    flushSync(apply);
  });
  t.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 420, easing: 'cubic-bezier(0.3, 0, 0, 1)', pseudoElement: '::view-transition-new(root)' },
      );
    })
    .catch(() => {});
}
