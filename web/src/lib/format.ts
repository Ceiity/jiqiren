export function formatBytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n < 0) return '-';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(digits).replace(/\.0$/, '')} ${units[i]}`;
}

/** Splits into value + unit for "50.6 KB/s" style big-number displays. */
export function bytesParts(n: number): [string, string] {
  const s = formatBytes(n);
  const i = s.lastIndexOf(' ');
  return [s.slice(0, i), s.slice(i + 1)];
}

const rtf = typeof Intl !== 'undefined' ? new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' }) : null;

export function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const m = 60_000;
  const h = 60 * m;
  const d = 24 * h;
  if (abs < m) return diff < 0 ? '刚刚' : '即将';
  if (!rtf) return formatDate(ts);
  if (abs < h) return rtf.format(Math.round(diff / m), 'minute');
  if (abs < d) return rtf.format(Math.round(diff / h), 'hour');
  if (abs < 7 * d) return rtf.format(Math.round(diff / d), 'day');
  return formatDate(ts);
}

export function formatDate(ts: number, withTime = false): string {
  const d = new Date(ts);
  const now = new Date();
  const pad = (x: number) => String(x).padStart(2, '0');
  const date = d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}月${d.getDate()}日` : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date;
}

export function formatDateTime(ts: number): string {
  return formatDate(ts, true);
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '--';
  sec = Math.round(sec);
  if (sec < 60) return `${sec} 秒`;
  if (sec < 3600) return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
  const h = Math.floor(sec / 3600);
  return `${h} 小时 ${Math.floor((sec % 3600) / 60)} 分`;
}

export function formatClock(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat('zh-CN').format(n);
}

export function expiryText(ts: number | null): string {
  if (!ts) return '永久有效';
  if (ts <= Date.now()) return '已过期';
  const diff = ts - Date.now();
  const d = Math.floor(diff / 86400_000);
  if (d >= 1) return `${d} 天后到期`;
  const h = Math.floor(diff / 3600_000);
  if (h >= 1) return `${h} 小时后到期`;
  return `${Math.max(1, Math.floor(diff / 60_000))} 分钟后到期`;
}
