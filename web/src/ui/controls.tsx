import { motion } from 'framer-motion';
import { Check, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { springSnappy } from './motion';

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? ' on' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    />
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: LucideIcon;
  title?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  fill,
  className = '',
  size,
  iconsAbove,
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  fill?: boolean;
  className?: string;
  size?: 'small';
  iconsAbove?: boolean;
}) {
  const id = useId();
  return (
    <div className={`segmented${fill ? ' fill' : ''}${size ? ' ' + size : ''}${iconsAbove ? ' vertical-icons' : ''} ${className}`} role="radiogroup">
      {options.map((o) => {
        const Icon = o.icon;
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} title={o.title} className={on ? 'on' : ''} onClick={() => onChange(o.value)}>
            {on && <motion.span layoutId={`seg-${id}`} className="seg-indicator" transition={springSnappy} />}
            {Icon && <Icon />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function CheckCircle({ on, onClick, label }: { on: boolean; onClick?: (e: React.MouseEvent) => void; label?: string }) {
  return (
    <span
      role="checkbox"
      aria-checked={on}
      aria-label={label}
      tabIndex={onClick ? 0 : -1}
      className={`check-circle${on ? ' on' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === ' ' || e.key === 'Enter')) {
          e.preventDefault();
          onClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      {on && <Check />}
    </span>
  );
}

/** FlClash-like scalloped "flower" badge (the dashboard's big round action). */
export function Scallop({ size = 72, color = 'var(--primary)', children, className = '', lobes = 9 }: { size?: number; color?: string; children?: ReactNode; className?: string; lobes?: number }) {
  const r = 50;
  const amp = 4.2;
  const pts: string[] = [];
  for (let i = 0; i <= 360; i += 3) {
    const a = (i * Math.PI) / 180;
    const rr = r - amp - amp * Math.cos(lobes * a);
    pts.push(`${(50 + rr * Math.cos(a)).toFixed(2)},${(50 + rr * Math.sin(a)).toFixed(2)}`);
  }
  return (
    <span className={`scallop ${className}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden>
        <polygon points={pts.join(' ')} fill={color} />
      </svg>
      <span className="scallop-content">{children}</span>
    </span>
  );
}

export function Blob({ className = 'blob' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden>
      <path
        fill="currentColor"
        d="M50 4c11 0 17 7 26 10s20 6 20 20c0 9-6 13-6 21s7 13 3 23c-4 11-16 11-25 15S56 98 47 96c-10-2-14-9-23-12S6 80 5 68c-1-9 5-14 5-22S3 33 8 23 22 12 31 9 40 4 50 4z"
      />
    </svg>
  );
}

export function Ring({ value, size = 120, stroke = 12, children, track = 'var(--block)', color = 'var(--primary)' }: { value: number; size?: number; stroke?: number; children?: ReactNode; track?: string; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(Math.max(value, 0), 1);
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - v) }}
          transition={{ duration: 0.9, ease: [0.3, 0, 0, 1] }}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

export function Progress({ value, state, indeterminate }: { value: number; state?: 'success' | 'error' | 'paused' | 'active'; indeterminate?: boolean }) {
  return (
    <div className={`progress ${state ?? ''}${indeterminate ? ' indeterminate' : ''}`} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {url ? <img src={url} alt="" /> : (name || '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function SelectionBadge() {
  return (
    <span className="selection-badge">
      <Check />
    </span>
  );
}

export function SetRow({
  icon: Icon,
  title,
  sub,
  value,
  children,
  onClick,
  chevron,
  danger,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
}) {
  const inner = (
    <>
      {Icon && (
        <span className="glyph-well">
          <Icon />
        </span>
      )}
      <span className="set-row-text">
        <span className="set-row-title">{title}</span>
        {sub && <span className="set-row-sub">{sub}</span>}
      </span>
      {value !== undefined && <span className="set-row-value">{value}</span>}
      {children}
      {chevron && (
        <svg className="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </>
  );
  const cls = `set-row${Icon ? ' has-icon' : ''}${danger ? ' danger' : ''}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
