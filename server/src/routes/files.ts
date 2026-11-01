import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { db } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { clientIp, intParam, ok, requireUser, strParam } from '../lib/http.js';
import { newSecret, sha256 } from '../lib/ids.js';
import { sendStoredFile } from '../lib/send-file.js';
import { now } from '../lib/time.js';
import { oplog } from '../services/oplog.js';
import {
  breadcrumbs,
  copyItems,
  createFolder,
  emptyTrash,
  fileToItem,
  folderStats,
  folderToItem,
  getBlob,
  getFolderRaw,
  getOwnedFile,
  getOwnedFolder,
  listItems,
  listSubfolders,
  listTrash,
  moveItems,
  purgeItems,
  releaseKeys,
  renameItem,
  restoreItems,
  subtreeFiles,
  trashItems,
  type FileRow,
  type Selection,
  type SortKey,
} from '../services/fs.js';
import { getThumbnail } from '../services/thumbs.js';
import { cancelUpload, completeUpload, getOwnedUpload, initUpload, listActiveUploads, toUploadDto, writeChunk } from '../services/uploads.js';
import { sendZip, type ZipEntry } from '../services/zip.js';
import type { Category } from '../lib/filetype.js';

const SORTS: SortKey[] = ['name', 'size', 'updated', 'type'];
const CATEGORIES = ['all', 'image', 'video', 'audio', 'document', 'archive', 'other'];

const actor = (u: { id: number; username: string }) => ({ id: u.id, username: u.username });

export default async function fileRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  /* ---------- browse ---------- */

  app.get('/api/fs/list', async (req) => {
    const u = requireUser(req);
    const q = req.query as Record<string, string>;
    const sort = SORTS.includes(q.sort as SortKey) ? (q.sort as SortKey) : 'name';
    const category = CATEGORIES.includes(q.category) ? (q.category as Category | 'all') : 'all';
    return ok(
      listItems(u.id, {
        folderId: strParam(q.folderId) ?? null,
        category,
        q: strParam(q.q)?.slice(0, 100),
        sort,
        order: q.order === 'desc' ? 'desc' : 'asc',
        offset: intParam(q.offset, 0),
        limit: intParam(q.limit, 100, 1, 500),
      }),
    );
  });

  app.get('/api/fs/tree', async (req) => {
    const u = requireUser(req);
    const q = req.query as Record<string, string>;
    return ok(listSubfolders(u.id, strParam(q.parentId) ?? null));
  });

  app.get('/api/fs/folders/:id', async (req) => {
    const u = requireUser(req);
    const f = getOwnedFolder(u.id, (req.params as { id: string }).id);
    const stats = folderStats(f);
    return ok({ ...folderToItem(f, stats.bytes), ...stats, breadcrumbs: breadcrumbs(f) });
  });

  app.get('/api/fs/files/:id', async (req) => {
    const u = requireUser(req);
    const f = getOwnedFile(u.id, (req.params as { id: string }).id);
    const blob = getBlob(f.blob_id)!;
    const folder = f.folder_id ? getFolderRaw(f.folder_id) ?? null : null;
    const shares = (db.prepare("SELECT COUNT(*) AS c FROM shares WHERE target_type = 'file' AND target_id = ?").get(f.id) as { c: number }).c;
    return ok({ ...fileToItem(f), hash: blob.hash, breadcrumbs: breadcrumbs(folder), shareCount: shares });
  });

  app.post('/api/fs/folders', async (req) => {
    const u = requireUser(req);
    const { parentId, name } = (req.body ?? {}) as { parentId?: string; name?: string };
    const f = createFolder(u.id, parentId ?? null, name);
    oplog(actor(u), 'folder.create', f.name, undefined, clientIp(req));
    return ok(folderToItem(f));
  });

  app.patch('/api/fs/:kind/:id', async (req) => {
    const u = requireUser(req);
    const { kind, id } = req.params as { kind: string; id: string };
    if (kind !== 'files' && kind !== 'folders') throw notFound();
    const { name } = (req.body ?? {}) as { name?: string };
    const item = renameItem(u.id, kind === 'files' ? 'file' : 'folder', id, name);
    oplog(actor(u), 'item.rename', item.name, undefined, clientIp(req));
    return ok(item);
  });

  app.post('/api/fs/move', async (req) => {
    const u = requireUser(req);
    const body = (req.body ?? {}) as Selection & { targetFolderId?: string | null };
    const r = moveItems(u.id, body, body.targetFolderId ?? null);
    oplog(actor(u), 'item.move', `${r.moved} 项`, undefined, clientIp(req));
    return ok(r);
  });

  app.post('/api/fs/copy', async (req) => {
    const u = requireUser(req);
    const body = (req.body ?? {}) as Selection & { targetFolderId?: string | null };
    const r = copyItems(u.id, body, body.targetFolderId ?? null);
    oplog(actor(u), 'item.copy', `${r.copied} 项`, undefined, clientIp(req));
    return ok(r);
  });

  app.post('/api/fs/trash', async (req) => {
    const u = requireUser(req);
    const r = trashItems(u.id, (req.body ?? {}) as Selection);
    oplog(actor(u), 'item.trash', `${r.trashed} 项`, undefined, clientIp(req));
    return ok(r);
  });

  /* ---------- trash ---------- */

  app.get('/api/trash', async (req) => {
    const u = requireUser(req);
    const q = req.query as Record<string, string>;
    return ok(listTrash(u.id, intParam(q.offset, 0), intParam(q.limit, 100, 1, 500)));
  });

  app.post('/api/trash/restore', async (req) => {
    const u = requireUser(req);
    const r = restoreItems(u.id, (req.body ?? {}) as Selection);
    oplog(actor(u), 'trash.restore', `${r.restored} 项`, undefined, clientIp(req));
    return ok(r);
  });

  app.post('/api/trash/delete', async (req) => {
    const u = requireUser(req);
    const r = purgeItems(u.id, (req.body ?? {}) as Selection);
    void releaseKeys(r.keys);
    oplog(actor(u), 'trash.delete', `${r.deleted} 项`, undefined, clientIp(req));
    return ok({ deleted: r.deleted });
  });

  app.post('/api/trash/empty', async (req) => {
    const u = requireUser(req);
    const r = emptyTrash(u.id);
    void releaseKeys(r.keys);
    oplog(actor(u), 'trash.empty', `${r.deleted} 项`, undefined, clientIp(req));
    return ok({ deleted: r.deleted });
  });

  /* ---------- uploads ---------- */

  app.get('/api/uploads', async (req) => ok(listActiveUploads(requireUser(req).id)));

  app.post('/api/uploads', async (req) => {
    const u = requireUser(req);
    return ok(initUpload(u.id, (req.body ?? {}) as { name: unknown; size: unknown }));
  });

  app.get('/api/uploads/:id', async (req) => {
    const u = requireUser(req);
    return ok(toUploadDto(getOwnedUpload(u.id, (req.params as { id: string }).id)));
  });

  app.put('/api/uploads/:id', { bodyLimit: Number.MAX_SAFE_INTEGER }, async (req) => {
    const u = requireUser(req);
    if (!req.headers['content-type']?.startsWith('application/octet-stream')) throw badRequest('Content-Type 必须为 application/octet-stream');
    const offset = Number((req.query as Record<string, string>).offset);
    return ok(await writeChunk(u.id, (req.params as { id: string }).id, offset, req.body as Readable));
  });

  app.post('/api/uploads/:id/complete', async (req) => {
    const u = requireUser(req);
    const file = await completeUpload(u.id, (req.params as { id: string }).id);
    oplog(actor(u), 'file.upload', file.name, `${file.size} bytes`, clientIp(req));
    return ok(file);
  });

  app.delete('/api/uploads/:id', async (req) => {
    const u = requireUser(req);
    await cancelUpload(u.id, (req.params as { id: string }).id);
    return ok(null);
  });

  /* ---------- content ---------- */

  const sendOwned = async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const u = requireUser(req);
    const f = getOwnedFile(u.id, (req.params as { id: string }).id);
    const blob = getBlob(f.blob_id)!;
    const download = (req.query as Record<string, string>).download === '1';
    await sendStoredFile(req, reply, { name: f.name, mime: f.mime, ext: f.ext, size: f.size, updatedAt: f.updated_at, storageKey: blob.storage_key, etag: blob.hash }, { inline: !download });
    return reply;
  };
  app.get('/api/fs/files/:id/content', sendOwned);

  app.get('/api/fs/files/:id/thumb', async (req, reply) => {
    const u = requireUser(req);
    const f = getOwnedFile(u.id, (req.params as { id: string }).id);
    const size = intParam((req.query as Record<string, string>).s, 256, 64, 1024);
    const p = await getThumbnail(f, getBlob(f.blob_id)!, size);
    if (!p) throw notFound('无法生成缩略图', 'NO_THUMB');
    const fs = await import('node:fs');
    reply.header('Content-Type', 'image/webp').header('Cache-Control', 'private, max-age=604800, immutable').header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(p));
  });

  /* ---------- zip download (ticket so the browser downloads natively) ---------- */

  app.post('/api/download/zip', async (req) => {
    const u = requireUser(req);
    const body = (req.body ?? {}) as Selection;
    const fileIds = (body.fileIds ?? []).slice(0, 5000);
    const folderIds = (body.folderIds ?? []).slice(0, 500);
    if (!fileIds.length && !folderIds.length) throw badRequest('未选择任何项目');
    for (const id of fileIds) getOwnedFile(u.id, id);
    for (const id of folderIds) getOwnedFolder(u.id, id);
    const ticket = newSecret();
    db.prepare('INSERT INTO download_tickets(id, user_id, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
      sha256(ticket),
      u.id,
      JSON.stringify({ fileIds, folderIds }),
      now(),
      now() + 5 * 60_000,
    );
    return ok({ url: `/api/download/zip/${ticket}` });
  });

  app.get('/api/download/zip/:ticket', async (req, reply) => {
    const u = requireUser(req);
    const row = db.prepare('SELECT * FROM download_tickets WHERE id = ?').get(sha256((req.params as { ticket: string }).ticket)) as
      | { user_id: number; payload: string; expires_at: number }
      | undefined;
    if (!row || row.user_id !== u.id || row.expires_at < now()) throw notFound('下载链接已失效');
    const { fileIds, folderIds } = JSON.parse(row.payload) as { fileIds: string[]; folderIds: string[] };
    const entries: ZipEntry[] = [];
    let zipName = '奶龙云盘下载';
    for (const id of folderIds) {
      const folder = getOwnedFolder(u.id, id);
      if (folderIds.length === 1 && !fileIds.length) zipName = folder.name;
      for (const e of subtreeFiles(folder)) entries.push({ file: e.file, relPath: `${folder.name}/${e.relPath}` });
    }
    for (const id of fileIds) {
      const f: FileRow = getOwnedFile(u.id, id);
      entries.push({ file: f, relPath: f.name });
    }
    oplog(actor(u), 'file.download_zip', zipName, `${entries.length} 个文件`, clientIp(req));
    sendZip(reply, zipName, entries);
    return reply;
  });
}
