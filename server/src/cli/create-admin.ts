/**
 * Interactive admin creation / password reset:
 *   node dist/cli/create-admin.js [username]
 * Password is read from the ADMIN_PASSWORD env or prompted (never hard-coded).
 */
import readline from 'node:readline';
import { db, migrate } from '../db/index.js';
import { createUser, getUserByName } from '../services/users.js';
import { hashPassword } from '../lib/password.js';

function ask(q: string, hidden = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.includes(q)) process.stdout.write(s);
      else process.stdout.write('*');
    };
  }
  return new Promise((r) =>
    rl.question(q, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      r(a);
    }),
  );
}

migrate(() => {});
const username = process.argv[2] || (await ask('管理员用户名: '));
const password = process.env.ADMIN_PASSWORD || (await ask('密码 (至少 8 位): ', true));
const existing = getUserByName(username);
if (existing) {
  if (password.length < 8) throw new Error('密码至少 8 位');
  db.prepare("UPDATE users SET password_hash = ?, role = 'admin', status = 'active', updated_at = ? WHERE id = ?").run(await hashPassword(password), Date.now(), existing.id);
  console.log(`已重置用户 ${username} 的密码并设为管理员`);
} else {
  await createUser({ username, password, role: 'admin', quotaBytes: 0 });
  console.log(`管理员 ${username} 创建成功`);
}
db.close();
