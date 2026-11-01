// End-to-end API smoke test against a running server: node test/e2e.mjs [baseUrl]
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = process.argv[2] ?? 'http://localhost:8080';
const SETUP = process.env.SETUP_TOKEN ?? 'devsetuptoken123';

class Client {
  cookies = new Map();
  csrf = '';
  async req(method, path, body, headers = {}) {
    const h = { ...headers };
    if (this.cookies.size) h.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf) h['x-csrf-token'] = this.csrf;
    let payload = body;
    if (body && !(body instanceof Uint8Array) && typeof body === 'object') {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, { method, headers: h, body: payload, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      this.cookies.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return res;
  }
  async json(method, path, body, headers) {
    const res = await this.req(method, path, body, headers);
    const j = await res.json();
    return { status: res.status, ...j };
  }
}

const log = (...a) => console.log('✓', ...a);
const admin = new Client();

// setup
let r = await admin.json('GET', '/api/public/config');
if (r.data.needsSetup) {
  r = await admin.json('POST', '/api/setup', { token: 'wrong', username: 'admin', password: 'password123' });
  assert.equal(r.status, 403);
  r = await admin.json('POST', '/api/setup', { token: SETUP, username: 'admin', password: 'password123', nickname: '奶龙' });
  assert.equal(r.status, 200, JSON.stringify(r));
  log('setup admin');
}
r = await admin.json('POST', '/api/auth/login', { username: 'admin', password: 'bad-password' });
assert.equal(r.status, 401);
r = await admin.json('POST', '/api/auth/login', { username: 'admin', password: 'password123' });
assert.equal(r.status, 200);
admin.csrf = r.data.csrf;
log('login');

// csrf required
const savedCsrf = admin.csrf;
admin.csrf = '';
r = await admin.json('POST', '/api/fs/folders', { name: 'x' });
assert.equal(r.status, 403);
admin.csrf = savedCsrf;
r = await admin.json('POST', '/api/fs/folders', { name: 'x' }, { origin: 'http://evil.example' });
assert.equal(r.status, 403);
log('csrf + origin protection');

// folders
const stamp = Date.now().toString(36);
r = await admin.json('POST', '/api/fs/folders', { name: `测试-${stamp}` });
assert.equal(r.status, 200, JSON.stringify(r));
const root = r.data;
r = await admin.json('POST', '/api/fs/folders', { name: '../evil' });
assert.equal(r.status, 400);
r = await admin.json('POST', '/api/fs/folders', { name: '子文件夹', parentId: root.id });
const sub = r.data;
log('folders + name validation');

// chunked upload with resume
async function upload(client, name, buf, folderId, chunk = 64 * 1024, relativePath) {
  let s = await client.json('POST', '/api/uploads', { name, size: buf.length, folderId, fingerprint: `${name}-${buf.length}`, relativePath });
  assert.equal(s.status, 200, JSON.stringify(s));
  let { id, received } = s.data;
  while (received < buf.length) {
    const part = buf.subarray(received, Math.min(received + chunk, buf.length));
    const res = await client.json('PUT', `/api/uploads/${id}?offset=${received}`, part, { 'content-type': 'application/octet-stream' });
    assert.equal(res.status, 200, JSON.stringify(res));
    received = res.data.received;
  }
  const done = await client.json('POST', `/api/uploads/${id}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done));
  return done.data;
}
const big = crypto.randomBytes(1_000_000);
// simulate interrupted upload: send first 3 chunks then re-init with same fingerprint
let s = await admin.json('POST', '/api/uploads', { name: 'big.bin', size: big.length, folderId: root.id, fingerprint: 'big-fp' });
let off = 0;
for (let i = 0; i < 3; i++) {
  const res = await admin.json('PUT', `/api/uploads/${s.data.id}?offset=${off}`, big.subarray(off, off + 100_000), { 'content-type': 'application/octet-stream' });
  off = res.data.received;
}
r = await admin.json('PUT', `/api/uploads/${s.data.id}?offset=0`, big.subarray(0, 10), { 'content-type': 'application/octet-stream' });
assert.equal(r.status, 409);
assert.equal(r.error.received, 300_000);
const again = await admin.json('POST', '/api/uploads', { name: 'big.bin', size: big.length, folderId: root.id, fingerprint: 'big-fp' });
assert.equal(again.data.id, s.data.id);
assert.equal(again.data.received, 300_000);
assert.equal(again.data.resumed, true);
off = again.data.received;
while (off < big.length) {
  const res = await admin.json('PUT', `/api/uploads/${s.data.id}?offset=${off}`, big.subarray(off, off + 250_000), { 'content-type': 'application/octet-stream' });
  off = res.data.received;
}
const bigFile = (await admin.json('POST', `/api/uploads/${s.data.id}/complete`)).data;
assert.equal(bigFile.size, big.length);
log('resumable chunked upload');

// range download
let res = await admin.req('GET', `/api/fs/files/${bigFile.id}/content?download=1`, undefined, { range: 'bytes=100-199' });
assert.equal(res.status, 206);
const slice = Buffer.from(await res.arrayBuffer());
assert.ok(slice.equals(big.subarray(100, 200)));
assert.match(res.headers.get('content-disposition'), /attachment/);
res = await admin.req('GET', `/api/fs/files/${bigFile.id}/content?download=1`);
const full = Buffer.from(await res.arrayBuffer());
assert.ok(full.equals(big));
log('range + full download integrity');

// html is never served inline as html
const html = await upload(admin, 'x.html', Buffer.from('<script>alert(1)</script>'), root.id);
res = await admin.req('GET', `/api/fs/files/${html.id}/content`);
assert.match(res.headers.get('content-type'), /^text\/plain/);
assert.match(res.headers.get('content-security-policy'), /sandbox/);
log('xss-safe inline content types');

// unicode filename + dedupe + auto rename
const t1 = await upload(admin, '中文 文件.txt', Buffer.from('hello 奶龙'), sub.id);
const t2 = await upload(admin, '中文 文件.txt', Buffer.from('hello 奶龙'), sub.id);
assert.equal(t2.name, '中文 文件 (1).txt');
res = await admin.req('GET', `/api/fs/files/${t1.id}/content?download=1`);
assert.match(res.headers.get('content-disposition'), /filename\*=UTF-8''%E4%B8%AD/);
log('auto-rename + RFC5987 filename');

// folder upload with relative path
const nested = await upload(admin, 'deep.txt', Buffer.from('deep'), root.id, 1024, 'pics/2024/deep.txt');
r = await admin.json('GET', `/api/fs/files/${nested.id}`);
assert.deepEqual(r.data.breadcrumbs.map((b) => b.name).slice(-3), [root.name, 'pics', '2024']);
r = await admin.json('POST', '/api/uploads', { name: 'a.txt', size: 1, relativePath: '../../etc/a.txt' });
assert.equal(r.status, 400);
log('folder upload relative paths + traversal rejected');

// list / search
r = await admin.json('GET', `/api/fs/list?folderId=${root.id}`);
assert.ok(r.data.items.length >= 3);
r = await admin.json('GET', `/api/fs/list?q=${encodeURIComponent('文件')}`);
assert.ok(r.data.items.some((i) => i.id === t1.id));
r = await admin.json('GET', `/api/fs/list?q=deep`);
assert.ok(r.data.items.some((i) => i.id === nested.id));
log('list + search (fts + like)');

// move / copy / rename / trash / restore
r = await admin.json('POST', '/api/fs/move', { folderIds: [root.id], targetFolderId: sub.id });
assert.equal(r.status, 400);
r = await admin.json('PATCH', `/api/fs/files/${t2.id}`, { name: 'renamed.md' });
assert.equal(r.data.name, 'renamed.md');
r = await admin.json('POST', '/api/fs/copy', { folderIds: [sub.id], targetFolderId: null });
assert.equal(r.status, 200);
r = await admin.json('POST', '/api/fs/trash', { folderIds: [sub.id] });
r = await admin.json('GET', `/api/fs/files/${t1.id}`);
assert.equal(r.status, 404);
r = await admin.json('POST', '/api/trash/restore', { folderIds: [sub.id] });
r = await admin.json('GET', `/api/fs/files/${t1.id}`);
assert.equal(r.status, 200);
log('move guard, rename, copy, trash, restore');

// shares
r = await admin.json('POST', '/api/shares', { targetType: 'folder', targetId: root.id, password: 'pw1234', allowDownload: true, expiresAt: Date.now() + 3600_000, note: '测试分享' });
assert.equal(r.status, 200, JSON.stringify(r));
const share = r.data;
assert.match(share.token, /^[A-Za-z0-9]{10}$/);
const guest = new Client();
r = await guest.json('GET', `/api/public/s/${share.token}`);
assert.equal(r.data.needPassword, true);
assert.equal(r.data.unlocked, false);
assert.equal(r.data.item, null);
r = await guest.json('GET', `/api/public/s/${share.token}/list`);
assert.equal(r.status, 401);
res = await guest.req('GET', `/api/public/s/${share.token}/files/${bigFile.id}/content?download=1`);
assert.equal(res.status, 401);
r = await guest.json('POST', `/api/public/s/${share.token}/unlock`, { password: 'nope' });
assert.equal(r.status, 400);
r = await guest.json('POST', `/api/public/s/${share.token}/unlock`, { password: 'pw1234' });
assert.equal(r.status, 200);
r = await guest.json('GET', `/api/public/s/${share.token}/list`);
assert.ok(r.data.items.length >= 3);
r = await guest.json('GET', `/api/public/s/${share.token}/list?folderId=${sub.id}`);
assert.equal(r.status, 200);
// file outside the shared folder must be refused
const outside = await upload(admin, 'outside.txt', Buffer.from('secret'), null);
res = await guest.req('GET', `/api/public/s/${share.token}/files/${outside.id}/content?download=1`);
assert.equal(res.status, 404);
r = await guest.json('GET', `/api/public/s/${share.token}/list?folderId=${(await admin.json('POST', '/api/fs/folders', { name: `out-${stamp}` })).data.id}`);
assert.equal(r.status, 404);
res = await guest.req('GET', `/api/public/s/${share.token}/files/${bigFile.id}/content?download=1`, undefined, { range: 'bytes=0-9' });
assert.equal(res.status, 206);
res = await guest.req('GET', `/api/public/s/${share.token}/zip`);
assert.equal(res.status, 200);
assert.equal(res.headers.get('content-type'), 'application/zip');
const zipBuf = Buffer.from(await res.arrayBuffer());
assert.equal(zipBuf.subarray(0, 2).toString(), 'PK');
log('share: password gate, subtree isolation, range, zip');

// password change invalidates grants
await admin.json('PATCH', `/api/shares/${share.id}`, { password: 'newpass' });
r = await guest.json('GET', `/api/public/s/${share.token}/list`);
assert.equal(r.status, 401);
// disabling share blocks downloads immediately
await guest.json('POST', `/api/public/s/${share.token}/unlock`, { password: 'newpass' });
await admin.json('POST', '/api/shares/batch', { ids: [share.id], action: 'disable' });
res = await guest.req('GET', `/api/public/s/${share.token}/files/${bigFile.id}/content?download=1`);
assert.equal(res.status, 410);
await admin.json('POST', '/api/shares/batch', { ids: [share.id], action: 'enable' });
res = await guest.req('GET', `/api/public/s/${share.token}/files/${bigFile.id}/content?download=1`);
assert.equal(res.status, 200);
await res.arrayBuffer();
log('password change revokes access; disable/enable immediate');

// download limit
r = await admin.json('POST', '/api/shares', { targetType: 'file', targetId: t1.id, maxDownloads: 1, allowPreview: false });
const s2 = r.data;
res = await guest.req('GET', `/api/public/s/${s2.token}/files/${t1.id}/content`);
assert.equal(res.status, 403);
res = await guest.req('GET', `/api/public/s/${s2.token}/files/${t1.id}/content?download=1`);
assert.equal(res.status, 200);
await res.arrayBuffer();
res = await guest.req('GET', `/api/public/s/${s2.token}/files/${t1.id}/content?download=1`);
assert.equal(res.status, 410);
r = await guest.json('GET', `/api/public/s/AAAAAAAAAA`);
assert.equal(r.status, 404);
log('preview permission, download limit, unknown token');

// zip ticket
r = await admin.json('POST', '/api/download/zip', { folderIds: [root.id], fileIds: [outside.id] });
res = await admin.req('GET', r.data.url);
assert.equal(res.status, 200);
await res.arrayBuffer();
res = await guest.req('GET', r.data.url);
assert.equal(res.status, 401);
log('zip ticket download (owner only)');

// stats & admin
r = await admin.json('GET', '/api/stats/overview');
assert.ok(r.data.fileCount >= 5);
r = await admin.json('GET', '/api/admin/status');
assert.equal(r.status, 200);
r = await admin.json('POST', '/api/admin/users', { username: `u${stamp}`, password: 'password123', quotaGB: 0.000001 });
assert.equal(r.status, 200, JSON.stringify(r));
const user = new Client();
r = await user.json('POST', '/api/auth/login', { username: `u${stamp}`, password: 'password123' });
user.csrf = r.data.csrf;
r = await user.json('POST', '/api/uploads', { name: 'q.bin', size: 5000 });
assert.equal(r.status, 409);
assert.equal(r.error.code, 'QUOTA_EXCEEDED');
r = await user.json('GET', `/api/fs/files/${t1.id}`);
assert.equal(r.status, 404);
r = await user.json('GET', '/api/admin/users');
assert.equal(r.status, 403);
log('quota, cross-user isolation, admin guard');

console.log('\nALL E2E CHECKS PASSED');
