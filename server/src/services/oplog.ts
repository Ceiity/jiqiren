import { db } from '../db/index.js';
import { now } from '../lib/time.js';

export interface Actor {
  id: number;
  username: string;
}

const insert = () =>
  db.prepare('INSERT INTO operation_logs(user_id, username, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');

export function oplog(actor: Actor | null, action: string, target?: string, detail?: string, ip?: string) {
  insert().run(actor?.id ?? null, actor?.username ?? null, action, target ?? null, detail ?? null, ip ?? null, now());
}
