/** 奶龙云盘 mark: a cloud with two little dragon horns. */
export function Logo({ size = 32, emoji }: { size?: number; emoji?: string }) {
  if (emoji) {
    return (
      <span className="logo-emoji" style={{ width: size, height: size, fontSize: size * 0.62 }}>
        {emoji}
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo">
      <rect width="32" height="32" rx="9.5" fill="var(--primary)" />
      <path d="M11.2 11.6 10.4 7.6l3.2 2.6M20.8 11.6l.8-4-3.2 2.6" fill="none" stroke="var(--on-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M10.6 23.4h11.2a4.4 4.4 0 0 0 .7-8.75 6.6 6.6 0 0 0-12.7 1.4 3.7 3.7 0 0 0 .8 7.35Z"
        fill="var(--on-primary)"
      />
      <circle cx="13.6" cy="18.2" r="1.05" fill="var(--primary)" />
      <circle cx="18.6" cy="18.2" r="1.05" fill="var(--primary)" />
    </svg>
  );
}
