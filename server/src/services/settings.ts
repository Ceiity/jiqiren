import { z } from 'zod';
import { db } from '../db/index.js';
import { now } from '../lib/time.js';

export const systemSettingsSchema = z.object({
  siteName: z.string().trim().min(1).max(40),
  siteIcon: z.string().trim().max(8),
  publicUrl: z.string().trim().max(200).refine((v) => v === '' || /^https?:\/\/[^\s]+$/.test(v), '请输入 http(s):// 开头的地址'),
  allowRegister: z.boolean(),
  defaultQuotaGB: z.number().min(0).max(1_000_000),
  maxFileSizeMB: z.number().min(0).max(10_000_000),
  trashRetentionDays: z.number().int().min(0).max(3650),
  shareMaxExpireDays: z.number().int().min(0).max(36500),
});
export type SystemSettings = z.infer<typeof systemSettingsSchema>;

export const defaultSystemSettings: SystemSettings = {
  siteName: '奶龙云盘',
  siteIcon: '',
  publicUrl: '',
  allowRegister: false,
  defaultQuotaGB: 10,
  maxFileSizeMB: 0,
  trashRetentionDays: 30,
  shareMaxExpireDays: 0,
};

let cache: SystemSettings | null = null;

export function getSettings(): SystemSettings {
  if (cache) return cache;
  const rows = db.prepare('SELECT key, value FROM system_settings').all() as { key: string; value: string }[];
  const merged: Record<string, unknown> = { ...defaultSystemSettings };
  for (const r of rows) {
    try {
      merged[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt value */
    }
  }
  const parsed = systemSettingsSchema.safeParse(merged);
  cache = parsed.success ? parsed.data : defaultSystemSettings;
  return cache;
}

export function updateSettings(patch: Partial<SystemSettings>): SystemSettings {
  const next = systemSettingsSchema.parse({ ...getSettings(), ...patch });
  const stmt = db.prepare(
    'INSERT INTO system_settings(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  );
  db.transaction(() => {
    for (const [k, v] of Object.entries(next)) stmt.run(k, JSON.stringify(v), now());
  })();
  cache = next;
  return next;
}

/* ---------- per-user preferences ---------- */

export const preferencesSchema = z.object({
  themeMode: z.enum(['system', 'light', 'dark']).default('system'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#007AFF'),
  colorStyle: z.enum(['vivid', 'tinted', 'soft', 'monochrome']).default('vivid'),
  motion: z.enum(['full', 'reduced', 'off']).default('full'),
  density: z.enum(['comfortable', 'compact']).default('comfortable'),
  defaultView: z.enum(['grid', 'list']).default('grid'),
  sidebarExpanded: z.boolean().default(true),
  uploadConcurrency: z.number().int().min(1).max(8).default(3),
  chunkSizeMB: z.number().int().min(1).max(64).default(8),
  uploadRetries: z.number().int().min(0).max(10).default(3),
  defaultUploadFolderId: z.string().nullable().default(null),
  downloadBehavior: z.enum(['direct', 'preview']).default('preview'),
  zipMultiple: z.boolean().default(true),
  shareDefaultExpire: z.enum(['never', '1h', '1d', '7d', '30d']).default('7d'),
  shareDefaultAllowDownload: z.boolean().default(true),
  shareDefaultPassword: z.enum(['none', 'random']).default('none'),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export function parsePreferences(raw: string): Preferences {
  let obj: unknown = {};
  try {
    obj = JSON.parse(raw);
  } catch {
    /* default */
  }
  const r = preferencesSchema.safeParse(obj);
  return r.success ? r.data : preferencesSchema.parse({});
}
