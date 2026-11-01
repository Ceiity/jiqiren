import path from 'node:path';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number in env ${name}`);
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: int('PORT', 8080),
  dataDir,
  dbPath: path.resolve(process.env.DB_PATH ?? path.join(dataDir, 'db', 'nailong.sqlite')),
  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
  storageDir: path.resolve(process.env.STORAGE_DIR ?? path.join(dataDir, 'storage')),
  tempDir: path.resolve(process.env.TEMP_DIR ?? path.join(dataDir, 'tmp')),
  cacheDir: path.resolve(process.env.CACHE_DIR ?? path.join(dataDir, 'cache')),
  logDir: path.resolve(process.env.LOG_DIR ?? path.join(dataDir, 'logs')),
  /**
   * Reverse-proxy trust: a hop count (1 = only the bundled nginx, 2 = nginx behind another HTTPS proxy),
   * or true/false. Determines client IP (rate limits, logs) and https detection for Secure cookies.
   */
  trustProxy: ((): boolean | number => {
    const raw = (process.env.TRUST_PROXY ?? '1').trim().toLowerCase();
    if (raw === 'true') return true;
    if (raw === 'false' || raw === '0') return false;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 1;
  })(),
  /** set cookies with Secure flag. 'auto' = based on request protocol */
  cookieSecure: (process.env.COOKIE_SECURE ?? 'auto') as 'auto' | 'true' | 'false',
  sessionDays: int('SESSION_DAYS', 30),
  setupToken: process.env.SETUP_TOKEN ?? '',
  maxChunkBytes: int('MAX_CHUNK_MB', 64) * 1024 * 1024,
  ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
  s3: {
    endpoint: process.env.S3_ENDPOINT ?? '',
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET ?? '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: bool('S3_FORCE_PATH_STYLE', true),
  },
};
