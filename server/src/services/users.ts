import { db } from '../db/index.js';
import { newSecret, sha256 } from '../lib/ids.js';
import { DAY, now } from '../lib/time.js';
import { config } from '../config.js';
import { hashPassword } from '../lib/password.js';
import { badRequest, conflict } from '../lib/errors.js';
import { getSettings, parsePreferences, type Preferences } from './settings.js';

export interface UserRow {
  id: number;
  username: string;
  nickname: string;
  password_hash: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  quota_bytes: number;
  used_bytes: number;
  avatar_version: number;
  preferences: string;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface PublicUser {
  id: number;
  username: string;
  nickname: string;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  quotaBytes: number;
  usedBytes: number;
  avatarUrl: string | null;
  createdAt: number;
  lastLoginAt: number | null;
}

export const avatarUrl = (u: Pick<UserRow, 'id' | 'avatar_version'>) =>
  u.avatar_version ? `/api/avatars/${u.id}?v=${u.avatar_version}` : null;

export function toPublicUser(u: UserRow): PublicUser {
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    role: u.role,
    status: u.status,
    quotaBytes: u.quota_bytes,
    usedBytes: u.used_bytes,
    avatarUrl: avatarUrl(u),
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
  };
}

export const getUser = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
export const getUserByName = (username: string) =>
  db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
export const countAdmins = () =>
  (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number }).c;

export function validateUsername(username: unknown): string {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{3,32}$/.test(username)) {
    throw badRequest('用户名需为 3-32 位字母、数字、下划线、点或短横线');
  }
  return username;
}
export function validatePassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw badRequest('密码长度需为 8-128 位');
  }
  return password;
}

export async function createUser(input: {
  username: string;
  password: string;
  nickname?: string;
  role?: 'admin' | 'user';
  quotaBytes?: number;
}): Promise<UserRow> {
  const username = validateUsername(input.username);
  validatePassword(input.password);
  if (getUserByName(username)) throw conflict('用户名已存在', 'USERNAME_TAKEN');
  const passwordHash = await hashPassword(input.password);
  const quota = input.quotaBytes ?? Math.round(getSettings().defaultQuotaGB * 1024 ** 3);
  const t = now();
  const info = db
    .prepare(
      'INSERT INTO users(username, nickname, password_hash, role, quota_bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(username, (input.nickname || username).slice(0, 40), passwordHash, input.role ?? 'user', quota, t, t);
  return getUser(Number(info.lastInsertRowid))!;
}

export function getPreferences(u: UserRow): Preferences {
  return parsePreferences(u.preferences);
}

/* ---------- sessions ---------- */

export interface SessionInfo {
  user: UserRow;
  csrf: string;
  sessionId: string;
}

export function createSession(userId: number, ip: string, ua: string) {
  const token = newSecret();
  const csrf = newSecret();
  const t = now();
  db.prepare(
    'INSERT INTO sessions(id, user_id, csrf, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(sha256(token), userId, csrf, ip, ua.slice(0, 300), t, t + config.sessionDays * DAY);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(t, userId);
  return { token, csrf, maxAge: config.sessionDays * 86400 };
}

export function resolveSession(token: string | undefined): SessionInfo | null {
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as
    | { id: string; user_id: number; csrf: string; expires_at: number }
    | undefined;
  if (!row || row.expires_at < now()) return null;
  const user = getUser(row.user_id);
  if (!user || user.status !== 'active') return null;
  return { user, csrf: row.csrf, sessionId: id };
}

export const deleteSession = (sessionId: string) => db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
export const deleteUserSessions = (userId: number, exceptSessionId?: string) =>
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, exceptSessionId ?? '');

export function adjustUsage(userId: number, delta: number) {
  if (delta === 0) return;
  db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes + ?) WHERE id = ?').run(delta, userId);
}
