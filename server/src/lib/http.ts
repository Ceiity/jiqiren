import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { forbidden, unauthorized } from './errors.js';
import type { SessionInfo, UserRow } from '../services/users.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: SessionInfo | null;
  }
}

export const ok = <T>(data: T) => ({ ok: true as const, data });

export function requireUser(req: FastifyRequest): UserRow {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

export function requireAdmin(req: FastifyRequest): UserRow {
  const u = requireUser(req);
  if (u.role !== 'admin') throw forbidden('需要管理员权限');
  return u;
}

export function isSecure(req: FastifyRequest): boolean {
  if (config.cookieSecure === 'true') return true;
  if (config.cookieSecure === 'false') return false;
  return req.protocol === 'https';
}

export function setCookie(req: FastifyRequest, reply: FastifyReply, name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean; path?: string } = {}) {
  reply.setCookie(name, value, {
    path: opts.path ?? '/',
    httpOnly: opts.httpOnly ?? true,
    sameSite: 'lax',
    secure: isSecure(req),
    maxAge: opts.maxAge,
  });
}

export const clientIp = (req: FastifyRequest) => req.ip;
export const userAgent = (req: FastifyRequest) => String(req.headers['user-agent'] ?? '').slice(0, 300);

export function intParam(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export const strParam = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
