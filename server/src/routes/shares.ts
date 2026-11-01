import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { clientIp, intParam, ok, requireUser, setCookie, strParam, userAgent } from '../lib/http.js';
import { sendStoredFile } from '../lib/send-file.js';
import { oplog } from '../services/oplog.js';
import { getBlob, subtreeFiles } from '../services/fs.js';
import {
  assertCanDownload,
  assertCanPreview,
  batchShares,
  countDownload,
  countView,
  createShare,
  getOwnedShare,
  grantCookieName,
  isUnlocked,
  listShareFolder,
  listShares,
  loadPublicShare,
  logShareAccess,
  publicShareMeta,
  requireUnlocked,
  shareFile,
  shareFolder,
  shareInputSchema,
  shareStats,
  toShareDto,
  unlockShare,
  updateShare,
} from '../services/shares.js';
import { getThumbnail } from '../services/thumbs.js';
import { sendZip } from '../services/zip.js';

const createSchema = shareInputSchema.extend({
  targetType: z.enum(['file', 'folder']),
  targetId: z.string().min(1).max(64),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? '参数错误');
  return r.data;
}

/** dedupe view counting per (ip, share) for 30 minutes */
const recentViews = new Map<string, number>();
setInterval(() => {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [k, t] of recentViews) if (t < cutoff) recentViews.delete(k);
}, 5 * 60_000).unref();

export default async function shareRoutes(app: FastifyInstance) {
  /* ---------- owner API ---------- */

  app.get('/api/shares', async (req) => {
    const u = requireUser(req);
    const q = req.query as Record<string, string>;
    return ok(listShares({ ownerId: u.id, q: strParam(q.q)?.slice(0, 100), state: strParam(q.state), offset: intParam(q.offset, 0), limit: intParam(q.limit, 50, 1, 200) }));
  });

  app.post('/api/shares', async (req) => {
    const u = requireUser(req);
    const body = parse(createSchema, req.body);
    const s = await createShare(u.id, body.targetType, body.targetId, body);
    oplog({ id: u.id, username: u.username }, 'share.create', s.name, s.token, clientIp(req));
    return ok(toShareDto(s));
  });

  app.get('/api/shares/:id', async (req) => {
    const u = requireUser(req);
    const s = getOwnedShare(u.id, Number((req.params as { id: string }).id));
    return ok({ ...toShareDto(s), stats: shareStats(s) });
  });

  app.patch('/api/shares/:id', async (req) => {
    const u = requireUser(req);
    const s = getOwnedShare(u.id, Number((req.params as { id: string }).id));
    const body = parse(shareInputSchema.extend({ status: z.enum(['active', 'disabled']).optional() }), req.body);
    const next = await updateShare(s, body);
    oplog({ id: u.id, username: u.username }, 'share.update', next.name, next.token, clientIp(req));
    return ok(toShareDto(next));
  });

  app.delete('/api/shares/:id', async (req) => {
    const u = requireUser(req);
    const s = getOwnedShare(u.id, Number((req.params as { id: string }).id));
    batchShares(u.id, [s.id], 'delete');
    oplog({ id: u.id, username: u.username }, 'share.delete', s.name, s.token, clientIp(req));
    return ok(null);
  });

  app.post('/api/shares/batch', async (req) => {
    const u = requireUser(req);
    const body = parse(z.object({ ids: z.array(z.number().int()).min(1).max(1000), action: z.enum(['enable', 'disable', 'delete']) }), req.body);
    const r = batchShares(u.id, body.ids, body.action);
    oplog({ id: u.id, username: u.username }, `share.batch_${body.action}`, `${r.affected} 个分享`, undefined, clientIp(req));
    return ok(r);
  });

  /* ---------- public API (no login) ---------- */

  const pubLimit = { config: { rateLimit: { max: 240, timeWindow: '1 minute' } } };
  const tokenOf = (req: FastifyRequest) => (req.params as { token: string }).token;
  const grantOf = (req: FastifyRequest, token: string) => req.cookies[grantCookieName(token)];

  app.get('/api/public/s/:token', pubLimit, async (req) => {
    const token = tokenOf(req);
    const s = loadPublicShare(token);
    const unlocked = isUnlocked(s, grantOf(req, token));
    const key = `${clientIp(req)}|${s.id}`;
    if (!recentViews.has(key)) {
      recentViews.set(key, Date.now());
      countView(s);
      logShareAccess(s.id, 'view', clientIp(req), userAgent(req));
    }
    return ok(publicShareMeta(s, unlocked));
  });

  app.post('/api/public/s/:token/unlock', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const token = tokenOf(req);
    const s = loadPublicShare(token);
    const { password } = (req.body ?? {}) as { password?: string };
    if (typeof password !== 'string' || !password) throw badRequest('请输入访问密码');
    const r = await unlockShare(s, password.slice(0, 64));
    if (!r) {
      logShareAccess(s.id, 'unlock_failed', clientIp(req), userAgent(req));
      throw badRequest('访问密码错误', 'BAD_SHARE_PASSWORD');
    }
    if (r.grant) setCookie(req, reply, grantCookieName(token), r.grant, { maxAge: r.maxAge });
    logShareAccess(s.id, 'unlock', clientIp(req), userAgent(req));
    return ok(publicShareMeta(s, true));
  });

  app.get('/api/public/s/:token/list', pubLimit, async (req) => {
    const token = tokenOf(req);
    const s = loadPublicShare(token);
    requireUnlocked(s, grantOf(req, token));
    const q = req.query as Record<string, string>;
    return ok(
      listShareFolder(s, strParam(q.folderId), {
        offset: intParam(q.offset, 0),
        limit: intParam(q.limit, 100, 1, 500),
        sort: q.sort === 'size' || q.sort === 'updated' ? q.sort : 'name',
        order: q.order === 'desc' ? 'desc' : 'asc',
      }),
    );
  });

  const sendShared = async (req: FastifyRequest, reply: FastifyReply) => {
    const token = tokenOf(req);
    const s = loadPublicShare(token);
    requireUnlocked(s, grantOf(req, token));
    const f = shareFile(s, (req.params as { fileId: string }).fileId);
    const download = (req.query as Record<string, string>).download === '1';
    if (download) assertCanDownload(s);
    else assertCanPreview(s);
    const blob = getBlob(f.blob_id)!;
    const r = await sendStoredFile(
      req,
      reply,
      { name: f.name, mime: f.mime, ext: f.ext, size: f.size, updatedAt: f.updated_at, storageKey: blob.storage_key, etag: blob.hash },
      { inline: !download, cacheControl: 'private, no-cache' },
    );
    if (download && r.fresh && req.method === 'GET') {
      countDownload(s);
      logShareAccess(s.id, 'download', clientIp(req), userAgent(req), f.id);
    }
    return reply;
  };
  app.get('/api/public/s/:token/files/:fileId/content', pubLimit, sendShared);

  app.get('/api/public/s/:token/files/:fileId/thumb', pubLimit, async (req, reply) => {
    const token = tokenOf(req);
    const s = loadPublicShare(token);
    requireUnlocked(s, grantOf(req, token));
    const f = shareFile(s, (req.params as { fileId: string }).fileId);
    const size = intParam((req.query as Record<string, string>).s, 256, 64, 1024);
    const p = await getThumbnail(f, getBlob(f.blob_id)!, size);
    if (!p) throw notFound('无法生成缩略图', 'NO_THUMB');
    reply.header('Content-Type', 'image/webp').header('Cache-Control', 'private, max-age=3600').header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(p));
  });

  app.get('/api/public/s/:token/zip', pubLimit, async (req, reply) => {
    const token = tokenOf(req);
    const s = loadPublicShare(token);
    requireUnlocked(s, grantOf(req, token));
    assertCanDownload(s);
    const folder = shareFolder(s, strParam((req.query as Record<string, string>).folderId));
    const entries = subtreeFiles(folder);
    countDownload(s);
    logShareAccess(s.id, 'download', clientIp(req), userAgent(req));
    sendZip(reply, folder.name, entries);
    return reply;
  });
}
