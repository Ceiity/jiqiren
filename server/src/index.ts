import fs from 'node:fs';
import { config } from './config.js';
import { db, migrate } from './db/index.js';
import { buildApp } from './app.js';
import { ensureSetupToken } from './services/setup.js';
import { sweepUploads } from './services/uploads.js';
import { purgeExpiredTrash, releaseKeys } from './services/fs.js';
import { getSettings } from './services/settings.js';
import { now } from './lib/time.js';

for (const d of [config.dataDir, config.tempDir, config.cacheDir, config.logDir]) fs.mkdirSync(d, { recursive: true });

migrate();
const app = await buildApp();
ensureSetupToken((m) => app.log.warn(m));

async function housekeeping() {
  try {
    await sweepUploads();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
    db.prepare('DELETE FROM share_grants WHERE expires_at < ?').run(now());
    db.prepare('DELETE FROM download_tickets WHERE expires_at < ?').run(now());
    db.prepare('DELETE FROM share_access_logs WHERE created_at < ?').run(now() - 180 * 86400_000);
    db.prepare('DELETE FROM operation_logs WHERE created_at < ?').run(now() - 365 * 86400_000);
    await releaseKeys(purgeExpiredTrash(getSettings().trashRetentionDays));
  } catch (err) {
    app.log.error(err, 'housekeeping failed');
  }
}
setTimeout(housekeeping, 10_000).unref();
setInterval(housekeeping, 30 * 60_000).unref();

await app.listen({ host: config.host, port: config.port });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} received, shutting down`);
    await app.close();
    db.close();
    process.exit(0);
  });
}
