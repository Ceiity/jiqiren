import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { db, tx } from '../db/index.js';
import { AppError, badRequest, conflict, notFound, tooLarge } from '../lib/errors.js';
import { newId } from '../lib/ids.js';
import { HOUR, now } from '../lib/time.js';
import { sanitizeName } from '../lib/filetype.js';
import { storage } from '../storage/index.js';
import { getSettings } from './settings.js';
import { getUser } from './users.js';
import { ensureFolderPath, insertFile, resolveParent, fileToItem, type BlobRow } from './fs.js';

export interface UploadRow {
  id: string;
  owner_id: number;
  folder_id: string | null;
  relative_path: string;
  name: string;
  size: number;
  received: number;
  mime: string | null;
  fingerprint: string;
  status: 'uploading' | 'completing' | 'done' | 'canceled' | 'failed';
  temp_key: string;
  file_id: string | null;
  error: string | null;
  created_at: number;
  updated_at: number;
  expires_at: number;
}

const uploadTempDir = path.join(config.tempDir, 'uploads');
fs.mkdirSync(uploadTempDir, { recursive: true });
const tempPathOf = (key: string) => path.join(uploadTempDir, key);
const SESSION_TTL = 48 * HOUR;

/** in-process lock: one writer per upload session */
const busy = new Set<string>();
export const activeUploadCount = () => busy.size;

export const toUploadDto = (u: UploadRow) => ({
  id: u.id,
  name: u.name,
  size: u.size,
  received: u.received,
  status: u.status,
  folderId: u.folder_id,
  relativePath: u.relative_path,
  fileId: u.file_id,
  createdAt: u.created_at,
  updatedAt: u.updated_at,
});

const getUpload = (id: string) => db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(id) as UploadRow | undefined;

export function getOwnedUpload(ownerId: number, id: string): UploadRow {
  const u = getUpload(id);
  if (!u || u.owner_id !== ownerId) throw notFound('上传任务不存在或已过期');
  return u;
}

function pendingBytes(ownerId: number): number {
  const r = db
    .prepare("SELECT COALESCE(SUM(size),0) AS b FROM upload_sessions WHERE owner_id = ? AND status IN ('uploading','completing') AND expires_at > ?")
    .get(ownerId, now()) as { b: number };
  return r.b;
}

/** Normalises "a/b/file.txt" (folder upload) into directory part; rejects traversal. */
function normalizeRelativeDir(rel: unknown): string {
  if (rel === undefined || rel === null || rel === '') return '';
  if (typeof rel !== 'string' || rel.length > 1024) throw badRequest('相对路径无效');
  const parts = rel.replace(/\\/g, '/').split('/').filter((p) => p !== '');
  parts.pop(); // file name itself
  for (const p of parts) if (!sanitizeName(p)) throw badRequest('相对路径无效');
  return parts.join('/');
}

export function initUpload(
  ownerId: number,
  input: { name: unknown; size: unknown; folderId?: unknown; relativePath?: unknown; fingerprint?: unknown },
) {
  const name = sanitizeName(input.name);
  if (!name) throw badRequest('文件名无效');
  const size = Number(input.size);
  if (!Number.isSafeInteger(size) || size < 0) throw badRequest('文件大小无效');
  const settings = getSettings();
  if (settings.maxFileSizeMB > 0 && size > settings.maxFileSizeMB * 1024 * 1024) {
    throw tooLarge(`单个文件不能超过 ${settings.maxFileSizeMB} MB`, 'FILE_TOO_LARGE');
  }
  const folder = resolveParent(ownerId, input.folderId);
  const relDir = normalizeRelativeDir(input.relativePath);
  const fingerprint = typeof input.fingerprint === 'string' ? input.fingerprint.slice(0, 200) : '';

  // resume: same file, same destination, still in progress
  if (fingerprint) {
    const existing = db
      .prepare(
        "SELECT * FROM upload_sessions WHERE owner_id = ? AND fingerprint = ? AND status = 'uploading' AND size = ? AND COALESCE(folder_id,'') = ? AND relative_path = ? AND expires_at > ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(ownerId, fingerprint, size, folder?.id ?? '', relDir, now()) as UploadRow | undefined;
    if (existing && !busy.has(existing.id)) return { ...toUploadDto(existing), resumed: true };
  }

  const user = getUser(ownerId)!;
  if (user.quota_bytes > 0 && user.used_bytes + pendingBytes(ownerId) + size > user.quota_bytes) {
    throw conflict('存储空间不足，无法上传该文件', 'QUOTA_EXCEEDED');
  }

  const id = newId();
  const tempKey = `${id}.part`;
  fs.closeSync(fs.openSync(tempPathOf(tempKey), 'w'));
  const t = now();
  db.prepare(
    `INSERT INTO upload_sessions(id, owner_id, folder_id, relative_path, name, size, fingerprint, temp_key, created_at, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, ownerId, folder?.id ?? null, relDir, name, size, fingerprint, tempKey, t, t, t + SESSION_TTL);
  return { ...toUploadDto(getUpload(id)!), resumed: false };
}

/** Appends one chunk (streamed, never buffered) at `offset`. */
export async function writeChunk(ownerId: number, id: string, offset: number, body: Readable) {
  const u = getOwnedUpload(ownerId, id);
  if (u.status !== 'uploading') throw conflict('上传任务状态不允许写入', 'UPLOAD_STATE');
  if (u.expires_at < now()) throw conflict('上传任务已过期', 'UPLOAD_EXPIRED');
  if (!Number.isSafeInteger(offset) || offset !== u.received) {
    throw new AppError(409, 'OFFSET_MISMATCH', '分片偏移不一致', { received: u.received });
  }
  if (busy.has(id)) throw new AppError(409, 'UPLOAD_BUSY', '该任务正在写入', { received: u.received });
  busy.add(id);
  let written = 0;
  const maxBytes = Math.min(config.maxChunkBytes, u.size - u.received);
  try {
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        if (written > maxBytes) cb(new AppError(413, 'CHUNK_TOO_LARGE', '分片超出允许大小'));
        else cb(null, chunk);
      },
    });
    const out = fs.createWriteStream(tempPathOf(u.temp_key), { flags: 'r+', start: offset });
    try {
      await pipeline(body, limiter, out);
    } catch (err) {
      // keep whatever fully reached disk? we cannot know it was flushed in order → roll back to last ack
      await fsp.truncate(tempPathOf(u.temp_key), u.received).catch(() => {});
      throw err;
    }
    const received = u.received + written;
    db.prepare('UPDATE upload_sessions SET received = ?, updated_at = ?, expires_at = ? WHERE id = ?').run(
      received,
      now(),
      now() + SESSION_TTL,
      id,
    );
    return { received };
  } finally {
    busy.delete(id);
  }
}

async function hashFile(p: string): Promise<string> {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(p, { highWaterMark: 1024 * 1024 }), async function* (src) {
    for await (const chunk of src) h.update(chunk as Buffer);
  });
  return h.digest('hex');
}

/** Stores a finished local temp file as a deduplicated blob. Ownership of `tempPath` passes to this function. */
export async function storeBlob(tempPath: string, size: number): Promise<BlobRow> {
  const hash = await hashFile(tempPath);
  const existing = db.prepare('SELECT * FROM blobs WHERE hash = ? AND size = ? LIMIT 1').get(hash, size) as BlobRow | undefined;
  if (existing) {
    await fsp.rm(tempPath, { force: true });
    return existing;
  }
  const id = newId();
  const key = `${hash.slice(0, 4)}${id}`;
  await storage.putFromTempFile(tempPath, key, size);
  db.prepare('INSERT INTO blobs(id, hash, size, storage_key, ref_count, created_at) VALUES (?, ?, ?, ?, 0, ?)').run(id, hash, size, key, now());
  return db.prepare('SELECT * FROM blobs WHERE id = ?').get(id) as BlobRow;
}

export async function completeUpload(ownerId: number, id: string) {
  const u = getOwnedUpload(ownerId, id);
  if (u.status === 'done' && u.file_id) {
    const f = db.prepare('SELECT * FROM files WHERE id = ?').get(u.file_id);
    if (f) return fileToItem(f as never);
  }
  if (u.status !== 'uploading') throw conflict('上传任务状态不允许完成', 'UPLOAD_STATE');
  if (u.received !== u.size) throw new AppError(409, 'INCOMPLETE', '文件尚未上传完成', { received: u.received });
  if (busy.has(id)) throw new AppError(409, 'UPLOAD_BUSY', '该任务正在处理');
  busy.add(id);
  db.prepare("UPDATE upload_sessions SET status = 'completing', updated_at = ? WHERE id = ?").run(now(), id);
  try {
    const tempPath = tempPathOf(u.temp_key);
    const stat = await fsp.stat(tempPath);
    if (stat.size !== u.size) throw new AppError(409, 'SIZE_MISMATCH', '文件大小校验失败');
    const user = getUser(ownerId)!;
    if (user.quota_bytes > 0 && user.used_bytes + u.size > user.quota_bytes) {
      throw conflict('存储空间不足', 'QUOTA_EXCEEDED');
    }
    const blob = await storeBlob(tempPath, u.size);
    const file = tx(() => {
      // destination may have been deleted meanwhile → fall back to root
      let base = null;
      try {
        base = resolveParent(ownerId, u.folder_id);
      } catch {
        base = null;
      }
      const folder = u.relative_path ? ensureFolderPath(ownerId, base, u.relative_path) : base;
      const f = insertFile(ownerId, folder, u.name, blob, true);
      db.prepare("UPDATE upload_sessions SET status = 'done', file_id = ?, updated_at = ? WHERE id = ?").run(f.id, now(), id);
      return f;
    });
    return fileToItem(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const fatal = err instanceof AppError && ['SIZE_MISMATCH'].includes(err.code);
    db.prepare('UPDATE upload_sessions SET status = ?, error = ?, updated_at = ? WHERE id = ?').run(fatal ? 'failed' : 'uploading', msg, now(), id);
    throw err;
  } finally {
    busy.delete(id);
  }
}

export async function cancelUpload(ownerId: number, id: string) {
  const u = getOwnedUpload(ownerId, id);
  if (u.status === 'done') return;
  db.prepare("UPDATE upload_sessions SET status = 'canceled', updated_at = ? WHERE id = ?").run(now(), id);
  await fsp.rm(tempPathOf(u.temp_key), { force: true });
}

export function listActiveUploads(ownerId?: number) {
  const rows = ownerId
    ? db.prepare("SELECT * FROM upload_sessions WHERE owner_id = ? AND status IN ('uploading','completing') AND expires_at > ? ORDER BY updated_at DESC LIMIT 200").all(ownerId, now())
    : db.prepare("SELECT * FROM upload_sessions WHERE status IN ('uploading','completing') AND expires_at > ? ORDER BY updated_at DESC LIMIT 200").all(now());
  return (rows as UploadRow[]).map(toUploadDto);
}

/** Housekeeping: drop expired/finished sessions and their temp files. */
export async function sweepUploads() {
  const t = now();
  const stale = db
    .prepare("SELECT * FROM upload_sessions WHERE (status IN ('uploading','completing') AND expires_at < ?) OR (status IN ('done','canceled','failed') AND updated_at < ?)")
    .all(t, t - 7 * 24 * HOUR) as UploadRow[];
  for (const u of stale) {
    if (busy.has(u.id)) continue;
    await fsp.rm(tempPathOf(u.temp_key), { force: true });
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(u.id);
  }
  // completing sessions orphaned by a crash
  db.prepare("UPDATE upload_sessions SET status = 'uploading' WHERE status = 'completing' AND updated_at < ?").run(t - HOUR);
}
