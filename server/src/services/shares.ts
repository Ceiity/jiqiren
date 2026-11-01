import { z } from 'zod';
import { db, tx } from '../db/index.js';
import { badRequest, forbidden, gone, notFound, AppError } from '../lib/errors.js';
import { newSecret, newShareToken, sha256 } from '../lib/ids.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { DAY, HOUR, now } from '../lib/time.js';
import { getSettings } from './settings.js';
import { avatarUrl, getUser } from './users.js';
import {
  breadcrumbs,
  fileToItem,
  folderStats,
  folderToItem,
  getFileRaw,
  getFolderRaw,
  getOwnedFile,
  getOwnedFolder,
  type FileRow,
  type FolderRow,
  type SortKey,
} from './fs.js';

export interface ShareRow {
  id: number;
  token: string;
  owner_id: number;
  target_type: 'file' | 'folder';
  target_id: string;
  name: string;
  note: string;
  password_hash: string | null;
  password_version: number;
  allow_download: number;
  allow_preview: number;
  max_downloads: number | null;
  max_views: number | null;
  view_count: number;
  download_count: number;
  expires_at: number | null;
  status: 'active' | 'disabled';
  created_at: number;
  updated_at: number;
  last_access_at: number | null;
}

export type ShareState = 'active' | 'disabled' | 'expired' | 'exhausted' | 'missing';

export function shareState(s: ShareRow): ShareState {
  if (s.status === 'disabled') return 'disabled';
  if (s.expires_at && s.expires_at <= now()) return 'expired';
  if (s.max_views && s.view_count >= s.max_views) return 'exhausted';
  if (s.max_downloads && s.download_count >= s.max_downloads) return 'exhausted';
  const target = s.target_type === 'file' ? getFileRaw(s.target_id) : getFolderRaw(s.target_id);
  if (!target || target.deleted_at || target.owner_id !== s.owner_id) return 'missing';
  return 'active';
}

export function toShareDto(s: ShareRow) {
  const target = s.target_type === 'file' ? getFileRaw(s.target_id) : getFolderRaw(s.target_id);
  return {
    id: s.id,
    token: s.token,
    url: `/s/${s.token}`,
    targetType: s.target_type,
    targetId: s.target_id,
    name: target?.name ?? s.name,
    category: s.target_type === 'file' ? (target as FileRow | undefined)?.category ?? 'other' : 'folder',
    size: s.target_type === 'file' ? (target as FileRow | undefined)?.size ?? 0 : null,
    note: s.note,
    hasPassword: !!s.password_hash,
    allowDownload: !!s.allow_download,
    allowPreview: !!s.allow_preview,
    maxDownloads: s.max_downloads,
    maxViews: s.max_views,
    viewCount: s.view_count,
    downloadCount: s.download_count,
    expiresAt: s.expires_at,
    status: s.status,
    state: shareState(s),
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    lastAccessAt: s.last_access_at,
  };
}

export const shareInputSchema = z.object({
  expiresAt: z.number().int().nullable().optional(),
  password: z.string().max(64).nullable().optional(),
  allowDownload: z.boolean().optional(),
  allowPreview: z.boolean().optional(),
  maxDownloads: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  maxViews: z.number().int().min(1).max(1_000_000_000).nullable().optional(),
  note: z.string().max(500).optional(),
});
export type ShareInput = z.infer<typeof shareInputSchema>;

function checkExpiry(expiresAt: number | null | undefined) {
  if (expiresAt === undefined || expiresAt === null) {
    const max = getSettings().shareMaxExpireDays;
    if (max > 0 && expiresAt === null) throw badRequest(`分享有效期最长 ${max} 天，不允许永久有效`);
    return;
  }
  if (expiresAt <= now()) throw badRequest('到期时间必须晚于当前时间');
  const max = getSettings().shareMaxExpireDays;
  if (max > 0 && expiresAt > now() + max * DAY + HOUR) throw badRequest(`分享有效期最长 ${max} 天`);
}

export const getShare = (id: number) => db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as ShareRow | undefined;
export const getShareByToken = (token: string) =>
  /^[A-Za-z0-9]{6,32}$/.test(token) ? (db.prepare('SELECT * FROM shares WHERE token = ?').get(token) as ShareRow | undefined) : undefined;

export function getOwnedShare(ownerId: number, id: number): ShareRow {
  const s = getShare(id);
  if (!s || s.owner_id !== ownerId) throw notFound('分享不存在');
  return s;
}

export async function createShare(ownerId: number, targetType: 'file' | 'folder', targetId: string, input: ShareInput) {
  const target = targetType === 'file' ? getOwnedFile(ownerId, targetId) : getOwnedFolder(ownerId, targetId);
  const expiresAt = input.expiresAt === undefined ? null : input.expiresAt;
  checkExpiry(expiresAt);
  const pw = input.password?.trim() ? await hashPassword(input.password.trim()) : null;
  const t = now();
  let token = newShareToken();
  while (getShareByToken(token)) token = newShareToken();
  const info = db
    .prepare(
      `INSERT INTO shares(token, owner_id, target_type, target_id, name, note, password_hash, allow_download, allow_preview, max_downloads, max_views, expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      token,
      ownerId,
      targetType,
      target.id,
      target.name,
      input.note ?? '',
      pw,
      input.allowDownload === false ? 0 : 1,
      input.allowPreview === false ? 0 : 1,
      input.maxDownloads ?? null,
      input.maxViews ?? null,
      expiresAt,
      t,
      t,
    );
  return getShare(Number(info.lastInsertRowid))!;
}

export async function updateShare(s: ShareRow, input: ShareInput & { status?: 'active' | 'disabled' }) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.expiresAt !== undefined) {
    checkExpiry(input.expiresAt);
    sets.push('expires_at = ?');
    params.push(input.expiresAt);
  }
  if (input.password !== undefined) {
    const pw = input.password && input.password.trim() ? await hashPassword(input.password.trim()) : null;
    sets.push('password_hash = ?', 'password_version = password_version + 1');
    params.push(pw);
  }
  const map: [keyof ShareInput | 'status', string, (v: unknown) => unknown][] = [
    ['allowDownload', 'allow_download', (v) => (v ? 1 : 0)],
    ['allowPreview', 'allow_preview', (v) => (v ? 1 : 0)],
    ['maxDownloads', 'max_downloads', (v) => v],
    ['maxViews', 'max_views', (v) => v],
    ['note', 'note', (v) => v],
    ['status', 'status', (v) => v],
  ];
  for (const [k, col, conv] of map) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) {
      sets.push(`${col} = ?`);
      params.push(conv(v));
    }
  }
  if (!sets.length) return s;
  sets.push('updated_at = ?');
  params.push(now());
  db.prepare(`UPDATE shares SET ${sets.join(', ')} WHERE id = ?`).run(...params, s.id);
  if (input.password !== undefined) db.prepare('DELETE FROM share_grants WHERE share_id = ?').run(s.id);
  return getShare(s.id)!;
}

export function listShares(opts: { ownerId?: number; q?: string; state?: string; offset?: number; limit?: number }) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.ownerId) {
    where.push('s.owner_id = ?');
    params.push(opts.ownerId);
  }
  if (opts.q) {
    where.push("(s.name LIKE ? ESCAPE '\\' OR s.token = ? OR s.note LIKE ? ESCAPE '\\')");
    const like = `%${opts.q.replace(/[%_\\]/g, '\\$&')}%`;
    params.push(like, opts.q, like);
  }
  const t = now();
  if (opts.state === 'active') {
    where.push("s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?)");
    params.push(t);
  } else if (opts.state === 'disabled') where.push("s.status = 'disabled'");
  else if (opts.state === 'expired') {
    where.push('s.expires_at IS NOT NULL AND s.expires_at <= ?');
    params.push(t);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM shares s ${whereSql}`).get(...params) as { c: number }).c;
  const rows = db
    .prepare(`SELECT s.*, u.username AS owner_name FROM shares s JOIN users u ON u.id = s.owner_id ${whereSql} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as (ShareRow & { owner_name: string })[];
  return {
    items: rows.map((r) => ({ ...toShareDto(r), ownerName: r.owner_name })),
    total,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  };
}

export function shareStats(s: ShareRow) {
  const since = now() - 14 * DAY;
  const daily = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS day, action, COUNT(*) AS c
       FROM share_access_logs WHERE share_id = ? AND created_at >= ? GROUP BY day, action ORDER BY day`,
    )
    .all(s.id, since) as { day: string; action: string; c: number }[];
  const recent = db
    .prepare('SELECT action, file_id, ip, user_agent, created_at FROM share_access_logs WHERE share_id = ? ORDER BY id DESC LIMIT 50')
    .all(s.id) as { action: string; file_id: string | null; ip: string; user_agent: string; created_at: number }[];
  const fileNames = new Map<string, string>();
  for (const r of recent) if (r.file_id && !fileNames.has(r.file_id)) fileNames.set(r.file_id, getFileRaw(r.file_id)?.name ?? '已删除的文件');
  return {
    daily,
    recent: recent.map((r) => ({
      action: r.action,
      fileName: r.file_id ? fileNames.get(r.file_id) : null,
      ip: r.ip,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    })),
  };
}

export function logShareAccess(shareId: number, action: string, ip: string, ua: string, fileId?: string) {
  db.prepare('INSERT INTO share_access_logs(share_id, action, file_id, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    shareId,
    action,
    fileId ?? null,
    ip,
    ua.slice(0, 300),
    now(),
  );
}

/* ---------- public access ---------- */

export const grantCookieName = (token: string) => `nls_${token}`;

/** Returns a share that is currently accessible, or throws the appropriate public error. */
export function loadPublicShare(token: string): ShareRow {
  const s = getShareByToken(token);
  if (!s) throw notFound('分享链接不存在或已被删除', 'SHARE_NOT_FOUND');
  const state = shareState(s);
  if (state === 'disabled') throw gone('该分享已被分享者关闭', 'SHARE_DISABLED');
  if (state === 'expired') throw gone('该分享已过期', 'SHARE_EXPIRED');
  if (state === 'exhausted') throw gone('该分享的访问或下载次数已达上限', 'SHARE_EXHAUSTED');
  if (state === 'missing') throw gone('分享的文件已被删除', 'SHARE_MISSING');
  const owner = getUser(s.owner_id);
  if (!owner || owner.status !== 'active') throw gone('该分享已失效', 'SHARE_DISABLED');
  return s;
}

export function isUnlocked(s: ShareRow, grantToken: string | undefined): boolean {
  if (!s.password_hash) return true;
  if (!grantToken || grantToken.length > 100) return false;
  const g = db.prepare('SELECT * FROM share_grants WHERE id = ?').get(sha256(grantToken)) as
    | { share_id: number; password_version: number; expires_at: number }
    | undefined;
  return !!g && g.share_id === s.id && g.password_version === s.password_version && g.expires_at > now();
}

export function requireUnlocked(s: ShareRow, grantToken: string | undefined) {
  if (!isUnlocked(s, grantToken)) throw new AppError(401, 'SHARE_LOCKED', '需要输入访问密码');
}

export async function unlockShare(s: ShareRow, password: string): Promise<{ grant: string; maxAge: number } | null> {
  if (!s.password_hash) return { grant: '', maxAge: 0 };
  const ok = await verifyPassword(s.password_hash, password);
  if (!ok) return null;
  const grant = newSecret();
  const ttl = 12 * HOUR;
  db.prepare('INSERT INTO share_grants(id, share_id, password_version, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    sha256(grant),
    s.id,
    s.password_version,
    now(),
    now() + ttl,
  );
  return { grant, maxAge: ttl / 1000 };
}

/** Folder within the share's subtree, or throws. */
export function shareFolder(s: ShareRow, folderId: string | undefined): FolderRow {
  if (s.target_type !== 'folder') throw badRequest('该分享不是文件夹');
  const root = getFolderRaw(s.target_id)!;
  if (!folderId || folderId === root.id) return root;
  const f = getFolderRaw(folderId);
  if (!f || f.owner_id !== s.owner_id || f.deleted_at || !f.path.startsWith(root.path)) throw notFound('文件夹不存在');
  return f;
}

/** File reachable through the share (target itself or inside shared folder subtree), or throws. */
export function shareFile(s: ShareRow, fileId: string): FileRow {
  const f = getFileRaw(fileId);
  if (!f || f.deleted_at || f.owner_id !== s.owner_id) throw notFound('文件不存在');
  if (s.target_type === 'file') {
    if (f.id !== s.target_id) throw notFound('文件不存在');
    return f;
  }
  const root = getFolderRaw(s.target_id)!;
  if (!f.folder_id) throw notFound('文件不存在');
  const parent = getFolderRaw(f.folder_id);
  if (!parent || parent.deleted_at || !parent.path.startsWith(root.path)) throw notFound('文件不存在');
  return f;
}

export function publicShareMeta(s: ShareRow, unlocked: boolean) {
  const owner = getUser(s.owner_id)!;
  const base = {
    token: s.token,
    targetType: s.target_type,
    name: s.name,
    note: s.note,
    createdAt: s.created_at,
    expiresAt: s.expires_at,
    needPassword: !!s.password_hash,
    unlocked,
    allowDownload: !!s.allow_download,
    allowPreview: !!s.allow_preview,
    viewCount: s.view_count,
    downloadCount: s.download_count,
    maxDownloads: s.max_downloads,
    sharer: { nickname: owner.nickname, avatarUrl: avatarUrl(owner) },
  };
  if (!unlocked) return { ...base, item: null };
  if (s.target_type === 'file') {
    const f = getFileRaw(s.target_id)!;
    return { ...base, name: f.name, item: fileToItem(f) };
  }
  const folder = getFolderRaw(s.target_id)!;
  const stats = folderStats(folder);
  return { ...base, name: folder.name, item: { ...folderToItem(folder, stats.bytes), fileCount: stats.files, folderCount: stats.folders } };
}

export function listShareFolder(s: ShareRow, folderId: string | undefined, opts: { offset?: number; limit?: number; sort?: SortKey; order?: 'asc' | 'desc' }) {
  const root = getFolderRaw(s.target_id)!;
  const folder = shareFolder(s, folderId);
  const limit = Math.min(opts.limit ?? 100, 500);
  const offset = opts.offset ?? 0;
  const folderCount = (db.prepare('SELECT COUNT(*) AS c FROM folders WHERE parent_id = ? AND deleted_at IS NULL').get(folder.id) as { c: number }).c;
  const fileCount = (db.prepare('SELECT COUNT(*) AS c FROM files WHERE folder_id = ? AND deleted_at IS NULL').get(folder.id) as { c: number }).c;
  const items = [];
  if (offset < folderCount) {
    items.push(
      ...(db.prepare('SELECT * FROM folders WHERE parent_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?').all(folder.id, limit, offset) as FolderRow[]).map(
        (f) => folderToItem(f),
      ),
    );
  }
  const rem = limit - items.length;
  if (rem > 0) {
    const sort = opts.sort === 'size' ? 'size' : opts.sort === 'updated' ? 'updated_at' : 'name COLLATE NOCASE';
    const dir = opts.order === 'desc' ? 'DESC' : 'ASC';
    items.push(
      ...(db.prepare(`SELECT * FROM files WHERE folder_id = ? AND deleted_at IS NULL ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`).all(folder.id, rem, Math.max(0, offset - folderCount)) as FileRow[]).map(fileToItem),
    );
  }
  // breadcrumbs limited to inside the share
  const crumbs = breadcrumbs(folder);
  const startIdx = crumbs.findIndex((c) => c.id === root.id);
  const total = folderCount + fileCount;
  return {
    folder: folderToItem(folder),
    breadcrumbs: startIdx >= 0 ? crumbs.slice(startIdx) : [{ id: root.id, name: root.name }],
    items,
    total,
    nextOffset: offset + items.length < total ? offset + items.length : null,
  };
}

export function countView(s: ShareRow) {
  db.prepare('UPDATE shares SET view_count = view_count + 1, last_access_at = ? WHERE id = ?').run(now(), s.id);
}

export function countDownload(s: ShareRow) {
  db.prepare('UPDATE shares SET download_count = download_count + 1, last_access_at = ? WHERE id = ?').run(now(), s.id);
}

export function batchShares(ownerId: number | null, ids: number[], action: 'enable' | 'disable' | 'delete') {
  return tx(() => {
    let n = 0;
    for (const id of ids) {
      const s = getShare(id);
      if (!s || (ownerId !== null && s.owner_id !== ownerId)) continue;
      if (action === 'delete') db.prepare('DELETE FROM shares WHERE id = ?').run(id);
      else db.prepare('UPDATE shares SET status = ?, updated_at = ? WHERE id = ?').run(action === 'enable' ? 'active' : 'disabled', now(), id);
      n++;
    }
    return { affected: n };
  });
}

export function assertCanDownload(s: ShareRow) {
  if (!s.allow_download) throw forbidden('分享者未允许下载', 'DOWNLOAD_NOT_ALLOWED');
}
export function assertCanPreview(s: ShareRow) {
  if (!s.allow_preview) throw forbidden('分享者未允许在线预览', 'PREVIEW_NOT_ALLOWED');
}
