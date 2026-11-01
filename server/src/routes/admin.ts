import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { clientIp, intParam, ok, requireAdmin, requireUser, strParam } from '../lib/http.js';
import { hashPassword } from '../lib/password.js';
import { activeDownloadCount } from '../lib/send-file.js';
import { now, DAY } from '../lib/time.js';
import { storage } from '../storage/index.js';
import { adminDeleteFiles, fileToItem, purgeUser, releaseKeys, type FileRow } from '../services/fs.js';
import { oplog } from '../services/oplog.js';
import { getSettings, systemSettingsSchema, updateSettings } from '../services/settings.js';
import { batchShares, listShares } from '../services/shares.js';
import { activeUploadCount, listActiveUploads } from '../services/uploads.js';
import { countAdmins, createUser, deleteUserSessions, getUser, toPublicUser, validatePassword } from '../services/users.js';

const startedAt = Date.now();

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? '参数错误');
  return r.data;
}

const GB = 1024 ** 3;

export default async function adminRoutes(app: FastifyInstance) {
  /* ---------- user-facing stats ---------- */

  app.get('/api/stats/overview', async (req) => {
    const u = requireUser(req);
    const cats = db
      .prepare('SELECT category, COUNT(*) AS c, COALESCE(SUM(size),0) AS b FROM files WHERE owner_id = ? AND deleted_at IS NULL GROUP BY category')
      .all(u.id) as { category: string; c: number; b: number }[];
    const folders = (db.prepare('SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND deleted_at IS NULL').get(u.id) as { c: number }).c;
    const trash = db
      .prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS b FROM files WHERE owner_id = ? AND deleted_at IS NOT NULL')
      .get(u.id) as { c: number; b: number };
    const recent = (db.prepare('SELECT * FROM files WHERE owner_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 12').all(u.id) as FileRow[]).map(fileToItem);
    const shares = db
      .prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'active' AND (expires_at IS NULL OR expires_at > ?) THEN 1 ELSE 0 END) AS active, COALESCE(SUM(view_count),0) AS views, COALESCE(SUM(download_count),0) AS downloads FROM shares WHERE owner_id = ?",
      )
      .get(now(), u.id) as { total: number; active: number | null; views: number; downloads: number };
    const byCat: Record<string, { count: number; bytes: number }> = {};
    for (const c of cats) byCat[c.category] = { count: c.c, bytes: c.b };
    return ok({
      usedBytes: u.used_bytes,
      quotaBytes: u.quota_bytes,
      fileCount: cats.reduce((a, c) => a + c.c, 0),
      folderCount: folders,
      categories: byCat,
      trash: { count: trash.c, bytes: trash.b },
      recent,
      shares: { total: shares.total, active: shares.active ?? 0, views: shares.views, downloads: shares.downloads },
    });
  });

  app.get('/api/stats/storage', async (req) => {
    const u = requireUser(req);
    const largest = (db.prepare('SELECT * FROM files WHERE owner_id = ? AND deleted_at IS NULL ORDER BY size DESC LIMIT 20').all(u.id) as FileRow[]).map(fileToItem);
    const cats = db
      .prepare('SELECT category, COUNT(*) AS c, COALESCE(SUM(size),0) AS b FROM files WHERE owner_id = ? AND deleted_at IS NULL GROUP BY category ORDER BY b DESC')
      .all(u.id) as { category: string; c: number; b: number }[];
    const trash = db.prepare('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS b FROM files WHERE owner_id = ? AND deleted_at IS NOT NULL').get(u.id) as { c: number; b: number };
    const growth = db
      .prepare(
        "SELECT strftime('%Y-%m-%d', created_at / 1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS c, COALESCE(SUM(size),0) AS b FROM files WHERE owner_id = ? AND created_at >= ? GROUP BY day ORDER BY day",
      )
      .all(u.id, now() - 30 * DAY) as { day: string; c: number; b: number }[];
    return ok({
      usedBytes: u.used_bytes,
      quotaBytes: u.quota_bytes,
      categories: cats.map((c) => ({ category: c.category, count: c.c, bytes: c.b })),
      trash: { count: trash.c, bytes: trash.b },
      largest,
      growth,
    });
  });

  /* ---------- admin: users ---------- */

  app.get('/api/admin/users', async (req) => {
    requireAdmin(req);
    const q = req.query as Record<string, string>;
    const search = strParam(q.q);
    const where = search ? "WHERE username LIKE ? ESCAPE '\\' OR nickname LIKE ? ESCAPE '\\'" : '';
    const params = search ? [`%${search.replace(/[%_\\]/g, '\\$&')}%`, `%${search.replace(/[%_\\]/g, '\\$&')}%`] : [];
    const offset = intParam(q.offset, 0);
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM users ${where}`).get(...params) as { c: number }).c;
    const rows = db.prepare(`SELECT * FROM users ${where} ORDER BY id LIMIT 100 OFFSET ?`).all(...params, offset) as Parameters<typeof toPublicUser>[0][];
    const counts = db.prepare('SELECT COUNT(*) AS c FROM files WHERE owner_id = ? AND deleted_at IS NULL');
    return ok({
      items: rows.map((r) => ({ ...toPublicUser(r), fileCount: (counts.get(r.id) as { c: number }).c })),
      total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
    });
  });

  app.post('/api/admin/users', async (req) => {
    const admin = requireAdmin(req);
    const body = parse(
      z.object({
        username: z.string(),
        password: z.string(),
        nickname: z.string().max(40).optional(),
        role: z.enum(['admin', 'user']).default('user'),
        quotaGB: z.number().min(0).optional(),
      }),
      req.body,
    );
    const u = await createUser({ ...body, quotaBytes: body.quotaGB === undefined ? undefined : Math.round(body.quotaGB * GB) });
    oplog({ id: admin.id, username: admin.username }, 'admin.user_create', u.username, undefined, clientIp(req));
    return ok(toPublicUser(u));
  });

  app.patch('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const target = getUser(Number((req.params as { id: string }).id));
    if (!target) throw notFound('用户不存在');
    const body = parse(
      z.object({
        nickname: z.string().trim().min(1).max(40).optional(),
        role: z.enum(['admin', 'user']).optional(),
        status: z.enum(['active', 'disabled']).optional(),
        quotaGB: z.number().min(0).optional(),
        password: z.string().optional(),
      }),
      req.body,
    );
    if (target.id === admin.id && (body.role === 'user' || body.status === 'disabled')) throw forbidden('不能降级或禁用自己的账号');
    if (target.role === 'admin' && (body.role === 'user' || body.status === 'disabled') && countAdmins() <= 1) throw forbidden('至少需要保留一个管理员');
    const sets: string[] = [];
    const params: unknown[] = [];
    if (body.nickname !== undefined) (sets.push('nickname = ?'), params.push(body.nickname));
    if (body.role !== undefined) (sets.push('role = ?'), params.push(body.role));
    if (body.status !== undefined) (sets.push('status = ?'), params.push(body.status));
    if (body.quotaGB !== undefined) (sets.push('quota_bytes = ?'), params.push(Math.round(body.quotaGB * GB)));
    if (body.password) {
      validatePassword(body.password);
      sets.push('password_hash = ?');
      params.push(await hashPassword(body.password));
    }
    if (sets.length) {
      sets.push('updated_at = ?');
      params.push(now());
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...params, target.id);
    }
    if (body.status === 'disabled' || body.password) deleteUserSessions(target.id);
    oplog({ id: admin.id, username: admin.username }, 'admin.user_update', target.username, Object.keys(body).join(','), clientIp(req));
    return ok(toPublicUser(getUser(target.id)!));
  });

  app.delete('/api/admin/users/:id', async (req) => {
    const admin = requireAdmin(req);
    const target = getUser(Number((req.params as { id: string }).id));
    if (!target) throw notFound('用户不存在');
    if (target.id === admin.id) throw forbidden('不能删除自己的账号');
    if (target.role === 'admin' && countAdmins() <= 1) throw forbidden('至少需要保留一个管理员');
    const keys = purgeUser(target.id);
    void releaseKeys(keys);
    oplog({ id: admin.id, username: admin.username }, 'admin.user_delete', target.username, undefined, clientIp(req));
    return ok(null);
  });

  /* ---------- admin: files ---------- */

  app.get('/api/admin/files', async (req) => {
    requireAdmin(req);
    const q = req.query as Record<string, string>;
    const where: string[] = ['f.deleted_at IS NULL'];
    const params: unknown[] = [];
    const search = strParam(q.q);
    if (search) {
      where.push("f.name LIKE ? ESCAPE '\\'");
      params.push(`%${search.replace(/[%_\\]/g, '\\$&')}%`);
    }
    const userId = intParam(q.userId, 0);
    if (userId) {
      where.push('f.owner_id = ?');
      params.push(userId);
    }
    const order = q.sort === 'size' ? 'f.size DESC' : 'f.updated_at DESC';
    const offset = intParam(q.offset, 0);
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM files f WHERE ${where.join(' AND ')}`).get(...params) as { c: number }).c;
    const rows = db
      .prepare(`SELECT f.*, u.username AS owner_name FROM files f JOIN users u ON u.id = f.owner_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 100 OFFSET ?`)
      .all(...params, offset) as (FileRow & { owner_name: string })[];
    return ok({
      items: rows.map((r) => ({ ...fileToItem(r), ownerId: r.owner_id, ownerName: r.owner_name })),
      total,
      nextOffset: offset + rows.length < total ? offset + rows.length : null,
    });
  });

  app.post('/api/admin/files/delete', async (req) => {
    const admin = requireAdmin(req);
    const body = parse(z.object({ fileIds: z.array(z.string()).min(1).max(1000) }), req.body);
    const keys = adminDeleteFiles(body.fileIds);
    void releaseKeys(keys);
    oplog({ id: admin.id, username: admin.username }, 'admin.file_delete', `${body.fileIds.length} 个文件`, undefined, clientIp(req));
    return ok({ deleted: body.fileIds.length });
  });

  /* ---------- admin: shares ---------- */

  app.get('/api/admin/shares', async (req) => {
    requireAdmin(req);
    const q = req.query as Record<string, string>;
    return ok(listShares({ q: strParam(q.q), state: strParam(q.state), offset: intParam(q.offset, 0), limit: 100 }));
  });

  app.post('/api/admin/shares/batch', async (req) => {
    const admin = requireAdmin(req);
    const body = parse(z.object({ ids: z.array(z.number().int()).min(1).max(1000), action: z.enum(['enable', 'disable', 'delete']) }), req.body);
    const r = batchShares(null, body.ids, body.action);
    oplog({ id: admin.id, username: admin.username }, `admin.share_${body.action}`, `${r.affected} 个分享`, undefined, clientIp(req));
    return ok(r);
  });

  /* ---------- admin: status / logs / settings ---------- */

  app.get('/api/admin/status', async (req) => {
    requireAdmin(req);
    const disk = (await storage.stat?.().catch(() => null)) ?? null;
    const totals = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM users) AS users,
                (SELECT COUNT(*) FROM users WHERE status = 'active') AS activeUsers,
                (SELECT COUNT(*) FROM files WHERE deleted_at IS NULL) AS files,
                (SELECT COUNT(*) FROM folders WHERE deleted_at IS NULL) AS folders,
                (SELECT COALESCE(SUM(used_bytes),0) FROM users) AS logicalBytes,
                (SELECT COALESCE(SUM(size),0) FROM blobs) AS physicalBytes,
                (SELECT COUNT(*) FROM blobs) AS blobs,
                (SELECT COUNT(*) FROM shares WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?)) AS activeShares,
                (SELECT COUNT(*) FROM shares) AS shares`,
      )
      .get(now()) as Record<string, number>;
    const mem = process.memoryUsage();
    return ok({
      totals,
      disk,
      storageDriver: storage.name,
      uploads: { active: activeUploadCount(), sessions: listActiveUploads().length },
      downloads: { active: activeDownloadCount() },
      process: { uptime: Math.round((Date.now() - startedAt) / 1000), rss: mem.rss, heapUsed: mem.heapUsed, node: process.version },
      system: { platform: `${os.type()} ${os.release()}`, cpus: os.cpus().length, load: os.loadavg(), totalMem: os.totalmem(), freeMem: os.freemem() },
      paths: { data: config.dataDir, storage: config.storageDriver === 'local' ? config.storageDir : `s3://${config.s3.bucket}` },
    });
  });

  app.get('/api/admin/uploads', async (req) => {
    requireAdmin(req);
    return ok(listActiveUploads());
  });

  app.get('/api/admin/logs', async (req) => {
    requireAdmin(req);
    const q = req.query as Record<string, string>;
    const offset = intParam(q.offset, 0);
    const action = strParam(q.action);
    const where = action ? 'WHERE action LIKE ?' : '';
    const params = action ? [`${action.replace(/[%_]/g, '')}%`] : [];
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM operation_logs ${where}`).get(...params) as { c: number }).c;
    const rows = db.prepare(`SELECT * FROM operation_logs ${where} ORDER BY id DESC LIMIT 100 OFFSET ?`).all(...params, offset);
    return ok({ items: rows, total, nextOffset: offset + rows.length < total ? offset + rows.length : null });
  });

  app.get('/api/admin/settings', async (req) => {
    requireAdmin(req);
    return ok({ settings: getSettings(), env: { storageDriver: config.storageDriver, storagePath: config.storageDriver === 'local' ? config.storageDir : `s3://${config.s3.bucket}`, dataDir: config.dataDir, maxChunkMB: config.maxChunkBytes / 1024 / 1024 } });
  });

  app.put('/api/admin/settings', async (req) => {
    const admin = requireAdmin(req);
    const body = parse(systemSettingsSchema.partial(), req.body);
    const s = updateSettings(body);
    oplog({ id: admin.id, username: admin.username }, 'admin.settings_update', Object.keys(body).join(','), undefined, clientIp(req));
    return ok(s);
  });
}
