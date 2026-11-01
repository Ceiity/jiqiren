import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { config } from './config.js';
import { AppError } from './lib/errors.js';
import { resolveSession } from './services/users.js';
import authRoutes from './routes/auth.js';
import fileRoutes from './routes/files.js';
import shareRoutes from './routes/shares.js';
import adminRoutes from './routes/admin.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** endpoints usable without an authenticated session (CSRF token not yet available) */
const CSRF_EXEMPT = [/^\/api\/auth\/(login|register|logout)$/, /^\/api\/setup$/, /^\/api\/public\//];

export async function buildApp() {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.cookie', 'req.headers["x-csrf-token"]'],
    },
    disableRequestLogging: config.env === 'production',
  });

  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 2000, timeWindow: '1 minute' });
  await app.register(multipart);

  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req) => {
    req.auth = resolveSession(req.cookies.nl_session);
    if (!MUTATING.has(req.method)) return;
    // Origin check: reject cross-site state-changing requests outright
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try {
        originHost = new URL(origin).host;
      } catch {
        /* invalid */
      }
      const host = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() || req.headers.host;
      if (!originHost || originHost !== host) throw new AppError(403, 'BAD_ORIGIN', '跨站请求被拒绝');
    }
    // double-submit CSRF token for authenticated sessions
    if (req.auth && !CSRF_EXEMPT.some((r) => r.test(req.url.split('?')[0]))) {
      if (req.headers['x-csrf-token'] !== req.auth.csrf) throw new AppError(403, 'BAD_CSRF', '请求校验失败，请刷新页面后重试');
    }
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'same-origin');
    if (!reply.hasHeader('X-Content-Type-Options')) reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  app.setErrorHandler((err: FastifyError | AppError, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.status).send({ ok: false, error: { code: err.code, message: err.message, ...err.extra } });
    }
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ ok: false, error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } });
    if (status >= 500) req.log.error(err);
    const message = status >= 500 ? '服务器内部错误' : err.message;
    return reply.code(status).send({ ok: false, error: { code: (err as FastifyError).code ?? 'ERROR', message } });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } }));

  app.get('/api/health', async () => ({ ok: true, data: { status: 'up', time: Date.now() } }));

  await app.register(authRoutes);
  await app.register(fileRoutes);
  await app.register(shareRoutes);
  await app.register(adminRoutes);
  return app;
}
