import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { clientIp, ok, requireUser, setCookie, userAgent } from '../lib/http.js';
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password.js';
import { now } from '../lib/time.js';
import { oplog } from '../services/oplog.js';
import { getSettings, preferencesSchema } from '../services/settings.js';
import {
  countAdmins,
  createSession,
  createUser,
  deleteSession,
  deleteUserSessions,
  getPreferences,
  getUser,
  getUserByName,
  toPublicUser,
  validatePassword,
} from '../services/users.js';
import { setupState, checkSetupToken, clearSetupToken } from '../services/setup.js';

const avatarDir = path.join(config.dataDir, 'avatars');
fs.mkdirSync(avatarDir, { recursive: true });

export default async function authRoutes(app: FastifyInstance) {
  const loginLimit = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/public/config', async () => {
    const s = getSettings();
    return ok({ siteName: s.siteName, siteIcon: s.siteIcon, allowRegister: s.allowRegister, needsSetup: setupState().needsSetup });
  });

  app.post('/api/setup', loginLimit, async (req, reply) => {
    const body = (req.body ?? {}) as { token?: string; username?: string; password?: string; nickname?: string };
    if (!setupState().needsSetup) throw forbidden('系统已完成初始化');
    if (!checkSetupToken(String(body.token ?? ''))) throw forbidden('初始化令牌无效', 'BAD_SETUP_TOKEN');
    const user = await createUser({
      username: String(body.username ?? ''),
      password: String(body.password ?? ''),
      nickname: body.nickname,
      role: 'admin',
      quotaBytes: 0,
    });
    clearSetupToken();
    oplog({ id: user.id, username: user.username }, 'system.setup', user.username, '创建初始管理员', clientIp(req));
    const s = createSession(user.id, clientIp(req), userAgent(req));
    setCookie(req, reply, 'nl_session', s.token, { maxAge: s.maxAge });
    setCookie(req, reply, 'nl_csrf', s.csrf, { maxAge: s.maxAge, httpOnly: false });
    return ok({ user: toPublicUser(user), preferences: getPreferences(user), csrf: s.csrf });
  });

  app.post('/api/auth/login', loginLimit, async (req, reply) => {
    const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) throw badRequest('请输入用户名和密码');
    const user = getUserByName(username.trim());
    if (!user) {
      await burnPasswordCheck(password);
      throw unauthorized('用户名或密码错误');
    }
    if (!(await verifyPassword(user.password_hash, password))) {
      oplog({ id: user.id, username: user.username }, 'auth.login_failed', user.username, undefined, clientIp(req));
      throw unauthorized('用户名或密码错误');
    }
    if (user.status !== 'active') throw forbidden('账号已被禁用，请联系管理员', 'ACCOUNT_DISABLED');
    const s = createSession(user.id, clientIp(req), userAgent(req));
    setCookie(req, reply, 'nl_session', s.token, { maxAge: s.maxAge });
    setCookie(req, reply, 'nl_csrf', s.csrf, { maxAge: s.maxAge, httpOnly: false });
    oplog({ id: user.id, username: user.username }, 'auth.login', user.username, undefined, clientIp(req));
    return ok({ user: toPublicUser(getUser(user.id)!), preferences: getPreferences(user), csrf: s.csrf });
  });

  app.post('/api/auth/register', loginLimit, async (req, reply) => {
    if (!getSettings().allowRegister || setupState().needsSetup) throw forbidden('当前未开放注册');
    const body = (req.body ?? {}) as { username?: string; password?: string; nickname?: string };
    const user = await createUser({ username: String(body.username ?? ''), password: String(body.password ?? ''), nickname: body.nickname });
    oplog({ id: user.id, username: user.username }, 'auth.register', user.username, undefined, clientIp(req));
    const s = createSession(user.id, clientIp(req), userAgent(req));
    setCookie(req, reply, 'nl_session', s.token, { maxAge: s.maxAge });
    setCookie(req, reply, 'nl_csrf', s.csrf, { maxAge: s.maxAge, httpOnly: false });
    return ok({ user: toPublicUser(user), preferences: getPreferences(user), csrf: s.csrf });
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.auth) deleteSession(req.auth.sessionId);
    reply.clearCookie('nl_session', { path: '/' });
    reply.clearCookie('nl_csrf', { path: '/' });
    return ok(null);
  });

  app.get('/api/me', async (req) => {
    const u = requireUser(req);
    return ok({ user: toPublicUser(u), preferences: getPreferences(u), csrf: req.auth!.csrf });
  });

  app.patch('/api/me', async (req) => {
    const u = requireUser(req);
    const { nickname } = (req.body ?? {}) as { nickname?: string };
    if (typeof nickname !== 'string' || !nickname.trim() || nickname.trim().length > 40) throw badRequest('昵称长度需为 1-40 个字符');
    db.prepare('UPDATE users SET nickname = ?, updated_at = ? WHERE id = ?').run(nickname.trim(), now(), u.id);
    return ok(toPublicUser(getUser(u.id)!));
  });

  app.put('/api/me/preferences', async (req) => {
    const u = requireUser(req);
    const merged = { ...getPreferences(u), ...((req.body ?? {}) as object) };
    const parsed = preferencesSchema.safeParse(merged);
    if (!parsed.success) throw badRequest('偏好设置格式错误');
    db.prepare('UPDATE users SET preferences = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(parsed.data), now(), u.id);
    return ok(parsed.data);
  });

  app.post('/api/me/password', loginLimit, async (req) => {
    const u = requireUser(req);
    const { oldPassword, newPassword } = (req.body ?? {}) as { oldPassword?: string; newPassword?: string };
    if (!(await verifyPassword(u.password_hash, String(oldPassword ?? '')))) throw badRequest('当前密码不正确', 'BAD_PASSWORD');
    validatePassword(newPassword);
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(await hashPassword(newPassword!), now(), u.id);
    deleteUserSessions(u.id, req.auth!.sessionId);
    oplog({ id: u.id, username: u.username }, 'user.password_changed', u.username, undefined, clientIp(req));
    return ok(null);
  });

  app.post('/api/me/avatar', async (req) => {
    const u = requireUser(req);
    const part = await req.file({ limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
    if (!part) throw badRequest('请选择图片');
    const chunks: Buffer[] = [];
    for await (const c of part.file) chunks.push(c as Buffer);
    if (part.file.truncated) throw badRequest('头像图片不能超过 10MB');
    let out: Buffer;
    try {
      out = await sharp(Buffer.concat(chunks), { limitInputPixels: 50_000_000 }).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
    } catch {
      throw badRequest('无法识别的图片格式');
    }
    fs.writeFileSync(path.join(avatarDir, `${u.id}.webp`), out);
    db.prepare('UPDATE users SET avatar_version = ?, updated_at = ? WHERE id = ?').run(now(), now(), u.id);
    return ok(toPublicUser(getUser(u.id)!));
  });

  app.delete('/api/me/avatar', async (req) => {
    const u = requireUser(req);
    fs.rmSync(path.join(avatarDir, `${u.id}.webp`), { force: true });
    db.prepare('UPDATE users SET avatar_version = 0, updated_at = ? WHERE id = ?').run(now(), u.id);
    return ok(toPublicUser(getUser(u.id)!));
  });

  // avatars are public (shown on share pages)
  app.get('/api/avatars/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const u = Number.isInteger(id) ? getUser(id) : undefined;
    const p = path.join(avatarDir, `${id}.webp`);
    if (!u || !u.avatar_version || !fs.existsSync(p)) throw notFound();
    reply.header('Content-Type', 'image/webp').header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(p));
  });

  app.get('/api/auth/admins', async () => ok({ count: countAdmins() }));
}
