import crypto from 'node:crypto';
import { config } from '../config.js';
import { countAdmins } from './users.js';
import { newSecret } from '../lib/ids.js';

/**
 * First-run initialisation: while no admin exists, a one-time setup token is required to create one.
 * It comes from SETUP_TOKEN or is generated at boot and printed to the server log — never hard-coded.
 */
let token: string | null = null;

export function setupState() {
  return { needsSetup: countAdmins() === 0 };
}

export function ensureSetupToken(log: (m: string) => void) {
  if (!setupState().needsSetup) return;
  token = config.setupToken || newSecret().slice(0, 24);
  log('==============================================================');
  log(' 奶龙云盘尚未初始化。请在浏览器打开站点，使用以下初始化令牌创建管理员：');
  log(config.setupToken ? ' (使用环境变量 SETUP_TOKEN 中的值)' : ` SETUP TOKEN: ${token}`);
  log(' 也可以执行: docker compose exec api node dist/cli/create-admin.js');
  log('==============================================================');
}

export function checkSetupToken(input: string): boolean {
  if (!token || !input) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(input);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function clearSetupToken() {
  token = null;
}
