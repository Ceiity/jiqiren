import mime from 'mime-types';

export type Category = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

const DOC_EXT = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'markdown',
  'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'log', 'epub', 'pages', 'numbers', 'key',
  'html', 'htm', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'sh', 'sql',
]);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'dmg']);

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0 || i === name.length - 1) return '';
  return name.slice(i + 1).toLowerCase().slice(0, 16);
}

export function detectType(name: string): { ext: string; mime: string; category: Category } {
  const ext = extOf(name);
  const m = (ext && mime.lookup(ext)) || 'application/octet-stream';
  let category: Category = 'other';
  if (m.startsWith('image/')) category = 'image';
  else if (m.startsWith('video/')) category = 'video';
  else if (m.startsWith('audio/')) category = 'audio';
  else if (DOC_EXT.has(ext) || m.startsWith('text/')) category = 'document';
  else if (ARCHIVE_EXT.has(ext)) category = 'archive';
  return { ext, mime: m, category };
}

/**
 * MIME types we are willing to serve inline (same origin). Everything else is forced to download
 * as application/octet-stream so user content can never execute as HTML/SVG/JS in our origin.
 */
const INLINE_SAFE = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp', 'image/x-icon',
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska',
  'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/wave',
  'audio/webm', 'audio/flac', 'audio/x-flac', 'audio/x-m4a',
  'application/pdf',
]);

export function inlineContentType(m: string, ext: string): string | null {
  if (INLINE_SAFE.has(m)) return m;
  // text-like files are delivered as plain text, never as HTML/JS
  if (m.startsWith('text/') || ['json', 'md', 'markdown', 'yaml', 'yml', 'toml', 'ini', 'log', 'csv', 'xml', 'svg', 'sh', 'py', 'ts', 'js'].includes(ext)) {
    return 'text/plain; charset=utf-8';
  }
  return null;
}

const FORBIDDEN_NAMES = new Set(['.', '..']);

/** Validates and normalises a user-provided file/folder name. Returns null when invalid. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const name = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!name || name.length > 255) return null;
  if (FORBIDDEN_NAMES.has(name)) return null;
  if (/[\\/]/.test(name)) return null;
  return name;
}

export function splitName(name: string): [string, string] {
  const i = name.lastIndexOf('.');
  if (i <= 0) return [name, ''];
  return [name.slice(0, i), name.slice(i)];
}
