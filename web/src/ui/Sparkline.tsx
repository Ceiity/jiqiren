import { motion } from 'framer-motion';
import { useId } from 'react';

/** Smooth area chart (FlClash traffic card style): primary line over a fading primary wash. */
export function Sparkline({ data, height = 64, className = '' }: { data: number[]; height?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const w = 300;
  const h = height;
  const pts = data.length > 1 ? data : [0, ...(data.length ? data : [0])];
  const max = Math.max(...pts, 1);
  const step = w / (pts.length - 1);
  const xy = pts.map((v, i) => [i * step, h - 6 - (v / max) * (h - 16)] as const);
  let d = `M ${xy[0][0]} ${xy[0][1]}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const [x0, y0] = xy[i - 1] ?? xy[i];
    const [x1, y1] = xy[i];
    const [x2, y2] = xy[i + 1];
    const [x3, y3] = xy[i + 2] ?? xy[i + 1];
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = y1 + (y2 - y0) / 6;
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = y2 - (y3 - y1) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${x2} ${y2}`;
  }
  const area = `${d} L ${w} ${h} L 0 ${h} Z`;
  return (
    <svg className={`sparkline ${className}`} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height }} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path d={area} fill={`url(#g${id})`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.2 }} />
      <motion.path d={d} fill="none" stroke="var(--primary)" strokeWidth="2.2" strokeLinecap="round" vectorEffect="non-scaling-stroke" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: [0.3, 0, 0, 1] }} />
    </svg>
  );
}

export function lastNDays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate() - i);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`);
  }
  return out;
}
