import { db, tx } from '../db/index.js';
import { newId } from '../lib/ids.js';
import { now } from '../lib/time.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { detectType, sanitizeName, splitName, type Category } from '../lib/filetype.js';
import { storage } from '../storage/index.js';
import { adjustUsage, getUser } from './users.js';

export interface FolderRow {
  id: string;
  owner_id: number;
  parent_id: string | null;
  name: string;
  path: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  trash_batch: string | null;
  trash_root: number;
}

export interface FileRow {
  id: string;
  owner_id: number;
  folder_id: string | null;
  name: string;
  ext: string;
  mime: string;
  category: Category;
  size: number;
  blob_id: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  trash_batch: string | null;
  trash_root: number;
}

export interface BlobRow {
  id: string;
  hash: string;
  size: number;
  storage_key: string;
  ref_count: number;
}

export interface FsItem {
  kind: 'folder' | 'file';
  id: string;
  name: string;
  size: number;
  mime: string | null;
  ext: string | null;
  category: Category | 'folder';
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
  hasThumb?: boolean;
}

export const fileToItem = (f: FileRow): FsItem => ({
  kind: 'file',
  id: f.id,
  name: f.name,
  size: f.size,
  mime: f.mime,
  ext: f.ext,
  category: f.category,
  parentId: f.folder_id,
  createdAt: f.created_at,
  updatedAt: f.updated_at,
  deletedAt: f.deleted_at,
  hasThumb: f.category === 'image' || f.category === 'video',
});

export const folderToItem = (f: FolderRow, size = 0): FsItem => ({
  kind: 'folder',
  id: f.id,
  name: f.name,
  size,
  mime: null,
  ext: null,
  category: 'folder',
  parentId: f.parent_id,
  createdAt: f.created_at,
  updatedAt: f.updated_at,
  deletedAt: f.deleted_at,
});

/* ---------- lookups ---------- */

export const getFolderRaw = (id: string) => db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow | undefined;
export const getFileRaw = (id: string) => db.prepare('SELECT * FROM files WHERE id = ?').get(id) as FileRow | undefined;
export const getBlob = (id: string) => db.prepare('SELECT * FROM blobs WHERE id = ?').get(id) as BlobRow | undefined;

export function getOwnedFolder(ownerId: number, id: string, opts: { allowDeleted?: boolean } = {}): FolderRow {
  const f = getFolderRaw(id);
  if (!f || f.owner_id !== ownerId || (!opts.allowDeleted && f.deleted_at)) throw notFound('文件夹不存在');
  return f;
}

export function getOwnedFile(ownerId: number, id: string, opts: { allowDeleted?: boolean } = {}): FileRow {
  const f = getFileRaw(id);
  if (!f || f.owner_id !== ownerId || (!opts.allowDeleted && f.deleted_at)) throw notFound('文件不存在');
  return f;
}

/** Resolves an optional parent folder id ("" / null / "root" = root). */
export function resolveParent(ownerId: number, folderId: unknown): FolderRow | null {
  if (folderId === undefined || folderId === null || folderId === '' || folderId === 'root') return null;
  if (typeof folderId !== 'string') throw badRequest('无效的文件夹');
  return getOwnedFolder(ownerId, folderId);
}

export function breadcrumbs(folder: FolderRow | null): { id: string; name: string }[] {
  if (!folder) return [];
  const ids = folder.path.split('/').filter(Boolean);
  if (!ids.length) return [];
  const rows = db
    .prepare(`SELECT id, name FROM folders WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as { id: string; name: string }[];
  const byId = new Map(rows.map((r) => [r.id, r.name]));
  return ids.map((id) => ({ id, name: byId.get(id) ?? '?' }));
}

/* ---------- names ---------- */

function nameTaken(ownerId: number, parentId: string | null, name: string, exclude?: string): boolean {
  const f = db
    .prepare(
      "SELECT 1 FROM folders WHERE owner_id = ? AND COALESCE(parent_id, '') = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL AND id != ?",
    )
    .get(ownerId, parentId ?? '', name, exclude ?? '');
  if (f) return true;
  const fi = db
    .prepare(
      "SELECT 1 FROM files WHERE owner_id = ? AND COALESCE(folder_id, '') = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL AND id != ?",
    )
    .get(ownerId, parentId ?? '', name, exclude ?? '');
  return !!fi;
}

/** "a.txt" -> "a (1).txt", "a (2).txt", … until free. */
export function uniqueName(ownerId: number, parentId: string | null, name: string, isFolder = false): string {
  if (!nameTaken(ownerId, parentId, name)) return name;
  const [base, ext] = isFolder ? [name, ''] : splitName(name);
  for (let i = 1; i < 10_000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!nameTaken(ownerId, parentId, candidate)) return candidate;
  }
  return `${base} (${newId().slice(0, 6)})${ext}`;
}

/* ---------- folders ---------- */

export function createFolder(ownerId: number, parentId: string | null, rawName: unknown, opts: { autoRename?: boolean } = {}): FolderRow {
  const name = sanitizeName(rawName);
  if (!name) throw badRequest('文件夹名称无效');
  const parent = resolveParent(ownerId, parentId);
  return tx(() => {
    let finalName = name;
    if (nameTaken(ownerId, parent?.id ?? null, name)) {
      if (!opts.autoRename) throw conflict('同名文件或文件夹已存在', 'NAME_EXISTS');
      finalName = uniqueName(ownerId, parent?.id ?? null, name, true);
    }
    const id = newId();
    const path = `${parent?.path ?? '/'}${id}/`;
    const t = now();
    db.prepare(
      'INSERT INTO folders(id, owner_id, parent_id, name, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, ownerId, parent?.id ?? null, finalName, path, t, t);
    if (parent) touchFolder(parent.id);
    return getFolderRaw(id)!;
  });
}

const touchFolder = (id: string | null) => {
  if (id) db.prepare('UPDATE folders SET updated_at = ? WHERE id = ?').run(now(), id);
};

/** mkdir -p for "a/b/c" relative to `base`. Returns the deepest folder. Synchronous → atomic in Node. */
export function ensureFolderPath(ownerId: number, base: FolderRow | null, relativeDir: string): FolderRow | null {
  const parts = relativeDir.split('/').map((p) => sanitizeName(p));
  if (parts.some((p) => !p)) throw badRequest('文件夹路径无效');
  let current = base;
  for (const part of parts as string[]) {
    const existing = db
      .prepare(
        "SELECT * FROM folders WHERE owner_id = ? AND COALESCE(parent_id, '') = ? AND name = ? COLLATE NOCASE AND deleted_at IS NULL",
      )
      .get(ownerId, current?.id ?? '', part) as FolderRow | undefined;
    if (existing) {
      current = existing;
      continue;
    }
    // a file with that name exists → create folder under an unique name
    current = createFolder(ownerId, current?.id ?? null, part, { autoRename: true });
  }
  return current;
}

/* ---------- listing ---------- */

export type SortKey = 'name' | 'size' | 'updated' | 'type';

export interface ListOptions {
  folderId?: string | null;
  category?: Category | 'all';
  q?: string;
  sort?: SortKey;
  order?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  /** if true, list files across the whole drive (category views & search) */
  flat?: boolean;
}

function orderSql(sort: SortKey, order: 'asc' | 'desc', alias = ''): string {
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  const p = alias ? `${alias}.` : '';
  switch (sort) {
    case 'size':
      return `${p}size ${dir}, ${p}name COLLATE NOCASE ASC`;
    case 'updated':
      return `${p}updated_at ${dir}, ${p}name COLLATE NOCASE ASC`;
    case 'type':
      return `${p}ext ${dir}, ${p}name COLLATE NOCASE ASC`;
    default:
      return `${p}name COLLATE NOCASE ${dir}`;
  }
}

function ftsQuery(q: string): string | null {
  const clean = q.replace(/"/g, '""').trim();
  if ([...clean].length < 3) return null;
  return `"${clean}"`;
}

export function listItems(ownerId: number, opts: ListOptions) {
  const sort = opts.sort ?? 'name';
  const order = opts.order ?? 'asc';
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = (opts.q ?? '').trim();
  const flat = !!opts.flat || !!q || (opts.category && opts.category !== 'all');

  if (flat) {
    // files only (plus folders on search), across the whole drive
    const where: string[] = ['f.owner_id = ?', 'f.deleted_at IS NULL'];
    const params: unknown[] = [ownerId];
    if (opts.category && opts.category !== 'all') {
      where.push('f.category = ?');
      params.push(opts.category);
    }
    let join = '';
    if (q) {
      const fts = ftsQuery(q);
      if (fts) {
        join = 'JOIN files_fts ON files_fts.rowid = f.rowid';
        where.push('files_fts MATCH ?');
        params.push(fts);
      } else {
        where.push("f.name LIKE ? ESCAPE '\\'");
        params.push(`%${q.replace(/[%_\\]/g, '\\$&')}%`);
      }
    }
    const whereSql = where.join(' AND ');
    const total = (db.prepare(`SELECT COUNT(*) AS c FROM files f ${join} WHERE ${whereSql}`).get(...params) as { c: number }).c;
    let folderItems: FsItem[] = [];
    let folderTotal = 0;
    if (q && (!opts.category || opts.category === 'all')) {
      const fp = [ownerId, `%${q.replace(/[%_\\]/g, '\\$&')}%`];
      folderTotal = (db.prepare("SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND deleted_at IS NULL AND name LIKE ? ESCAPE '\\'").get(...fp) as { c: number }).c;
      if (offset < folderTotal) {
        folderItems = (
          db
            .prepare(`SELECT * FROM folders WHERE owner_id = ? AND deleted_at IS NULL AND name LIKE ? ESCAPE '\\' ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`)
            .all(...fp, limit, offset) as FolderRow[]
        ).map((f) => folderToItem(f));
      }
    }
    const fileOffset = Math.max(0, offset - folderTotal);
    const fileLimit = limit - folderItems.length;
    const rows = fileLimit > 0
      ? (db
          .prepare(`SELECT f.* FROM files f ${join} WHERE ${whereSql} ORDER BY ${orderSql(sort, order, 'f')} LIMIT ? OFFSET ?`)
          .all(...params, fileLimit, fileOffset) as FileRow[])
      : [];
    const items = [...folderItems, ...rows.map(fileToItem)];
    const all = total + folderTotal;
    return { items, total: all, nextOffset: offset + items.length < all ? offset + items.length : null };
  }

  const parent = resolveParent(ownerId, opts.folderId);
  const pid = parent?.id ?? '';
  const folderCount = (db
    .prepare("SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND COALESCE(parent_id,'') = ? AND deleted_at IS NULL")
    .get(ownerId, pid) as { c: number }).c;
  const fileCount = (db
    .prepare("SELECT COUNT(*) AS c FROM files WHERE owner_id = ? AND COALESCE(folder_id,'') = ? AND deleted_at IS NULL")
    .get(ownerId, pid) as { c: number }).c;

  const items: FsItem[] = [];
  if (offset < folderCount) {
    const folderSort = sort === 'size' || sort === 'type' ? 'name' : sort;
    const rows = db
      .prepare(
        `SELECT * FROM folders WHERE owner_id = ? AND COALESCE(parent_id,'') = ? AND deleted_at IS NULL ORDER BY ${orderSql(folderSort, folderSort === 'name' && sort !== 'name' ? 'asc' : order)} LIMIT ? OFFSET ?`,
      )
      .all(ownerId, pid, limit, offset) as FolderRow[];
    items.push(...rows.map((f) => folderToItem(f)));
  }
  const remaining = limit - items.length;
  if (remaining > 0) {
    const fileOffset = Math.max(0, offset - folderCount);
    const rows = db
      .prepare(
        `SELECT * FROM files WHERE owner_id = ? AND COALESCE(folder_id,'') = ? AND deleted_at IS NULL ORDER BY ${orderSql(sort, order)} LIMIT ? OFFSET ?`,
      )
      .all(ownerId, pid, remaining, fileOffset) as FileRow[];
    items.push(...rows.map(fileToItem));
  }
  const total = folderCount + fileCount;
  return {
    folder: parent ? folderToItem(parent) : null,
    breadcrumbs: breadcrumbs(parent),
    items,
    total,
    nextOffset: offset + items.length < total ? offset + items.length : null,
  };
}

export function listSubfolders(ownerId: number, parentId: string | null) {
  const parent = resolveParent(ownerId, parentId);
  const rows = db
    .prepare(
      "SELECT f.*, EXISTS(SELECT 1 FROM folders c WHERE c.parent_id = f.id AND c.deleted_at IS NULL) AS has_children FROM folders f WHERE f.owner_id = ? AND COALESCE(f.parent_id,'') = ? AND f.deleted_at IS NULL ORDER BY f.name COLLATE NOCASE LIMIT 1000",
    )
    .all(ownerId, parent?.id ?? '') as (FolderRow & { has_children: number })[];
  return rows.map((r) => ({ id: r.id, name: r.name, hasChildren: !!r.has_children }));
}

/** Files (live) inside a folder subtree, with relative path, for zips. */
export function subtreeFiles(folder: FolderRow): { file: FileRow; relPath: string }[] {
  const folders = db
    .prepare('SELECT * FROM folders WHERE path LIKE ? AND deleted_at IS NULL')
    .all(`${folder.path}%`) as FolderRow[];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const relOf = (fid: string): string => {
    const parts: string[] = [];
    let cur = byId.get(fid);
    while (cur && cur.id !== folder.id) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.join('/');
  };
  const out: { file: FileRow; relPath: string }[] = [];
  const stmt = db.prepare('SELECT * FROM files WHERE folder_id = ? AND deleted_at IS NULL');
  for (const f of folders) {
    const rel = relOf(f.id);
    for (const file of stmt.iterate(f.id) as IterableIterator<FileRow>) {
      out.push({ file, relPath: rel ? `${rel}/${file.name}` : file.name });
    }
  }
  return out;
}

export function folderStats(folder: FolderRow) {
  const r = db
    .prepare(
      'SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files WHERE deleted_at IS NULL AND folder_id IN (SELECT id FROM folders WHERE path LIKE ? AND deleted_at IS NULL)',
    )
    .get(`${folder.path}%`) as { files: number; bytes: number };
  const sub = db.prepare('SELECT COUNT(*) AS c FROM folders WHERE path LIKE ? AND deleted_at IS NULL AND id != ?').get(`${folder.path}%`, folder.id) as { c: number };
  return { files: r.files, bytes: r.bytes, folders: sub.c };
}

/* ---------- create file from blob ---------- */

export function insertFile(ownerId: number, folder: FolderRow | null, name: string, blob: BlobRow, autoRename = true): FileRow {
  return tx(() => {
    let finalName = name;
    if (nameTaken(ownerId, folder?.id ?? null, name)) {
      if (!autoRename) throw conflict('同名文件已存在', 'NAME_EXISTS');
      finalName = uniqueName(ownerId, folder?.id ?? null, name);
    }
    const { ext, mime, category } = detectType(finalName);
    const id = newId();
    const t = now();
    db.prepare(
      'INSERT INTO files(id, owner_id, folder_id, name, ext, mime, category, size, blob_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(id, ownerId, folder?.id ?? null, finalName, ext, mime, category, blob.size, blob.id, t, t);
    db.prepare('UPDATE blobs SET ref_count = ref_count + 1 WHERE id = ?').run(blob.id);
    adjustUsage(ownerId, blob.size);
    touchFolder(folder?.id ?? null);
    return getFileRaw(id)!;
  });
}

/* ---------- rename / move / copy ---------- */

export function renameItem(ownerId: number, kind: 'file' | 'folder', id: string, rawName: unknown) {
  const name = sanitizeName(rawName);
  if (!name) throw badRequest('名称无效');
  return tx(() => {
    if (kind === 'folder') {
      const f = getOwnedFolder(ownerId, id);
      if (nameTaken(ownerId, f.parent_id, name, f.id)) throw conflict('同名文件或文件夹已存在', 'NAME_EXISTS');
      db.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').run(name, now(), id);
      return folderToItem(getFolderRaw(id)!);
    }
    const f = getOwnedFile(ownerId, id);
    if (nameTaken(ownerId, f.folder_id, name, f.id)) throw conflict('同名文件或文件夹已存在', 'NAME_EXISTS');
    const { ext, mime, category } = detectType(name);
    db.prepare('UPDATE files SET name = ?, ext = ?, mime = ?, category = ?, updated_at = ? WHERE id = ?').run(name, ext, mime, category, now(), id);
    return fileToItem(getFileRaw(id)!);
  });
}

export interface Selection {
  fileIds?: string[];
  folderIds?: string[];
}

function normSelection(sel: Selection) {
  const fileIds = [...new Set((sel.fileIds ?? []).filter((x) => typeof x === 'string'))];
  const folderIds = [...new Set((sel.folderIds ?? []).filter((x) => typeof x === 'string'))];
  if (fileIds.length + folderIds.length === 0) throw badRequest('未选择任何项目');
  if (fileIds.length + folderIds.length > 5000) throw badRequest('一次最多操作 5000 个项目');
  return { fileIds, folderIds };
}

export function moveItems(ownerId: number, sel: Selection, targetFolderId: string | null) {
  const { fileIds, folderIds } = normSelection(sel);
  const target = resolveParent(ownerId, targetFolderId);
  return tx(() => {
    let moved = 0;
    for (const id of folderIds) {
      const f = getOwnedFolder(ownerId, id);
      if (f.parent_id === (target?.id ?? null)) continue;
      if (target && target.path.startsWith(f.path)) throw badRequest(`不能将「${f.name}」移动到其自身或子文件夹中`);
      const name = uniqueName(ownerId, target?.id ?? null, f.name, true);
      const newPath = `${target?.path ?? '/'}${f.id}/`;
      db.prepare('UPDATE folders SET path = ? || substr(path, ?) WHERE path LIKE ?').run(newPath, f.path.length + 1, `${f.path}%`);
      db.prepare('UPDATE folders SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?').run(target?.id ?? null, name, now(), f.id);
      moved++;
    }
    for (const id of fileIds) {
      const f = getOwnedFile(ownerId, id);
      if (f.folder_id === (target?.id ?? null)) continue;
      const name = uniqueName(ownerId, target?.id ?? null, f.name);
      db.prepare('UPDATE files SET folder_id = ?, name = ?, updated_at = ? WHERE id = ?').run(target?.id ?? null, name, now(), f.id);
      moved++;
    }
    touchFolder(target?.id ?? null);
    return { moved };
  });
}

function checkQuota(ownerId: number, extra: number) {
  const u = getUser(ownerId)!;
  if (u.quota_bytes > 0 && u.used_bytes + extra > u.quota_bytes) {
    throw conflict('存储空间不足', 'QUOTA_EXCEEDED');
  }
}

export function copyItems(ownerId: number, sel: Selection, targetFolderId: string | null) {
  const { fileIds, folderIds } = normSelection(sel);
  const target = resolveParent(ownerId, targetFolderId);
  return tx(() => {
    // quota pre-check
    let bytes = 0;
    const files = fileIds.map((id) => getOwnedFile(ownerId, id));
    const folders = folderIds.map((id) => getOwnedFolder(ownerId, id));
    for (const f of files) bytes += f.size;
    for (const f of folders) {
      if (target && target.path.startsWith(f.path)) throw badRequest(`不能将「${f.name}」复制到其自身或子文件夹中`);
      bytes += folderStats(f).bytes;
    }
    checkQuota(ownerId, bytes);
    let copied = 0;
    const copyFile = (f: FileRow, dest: FolderRow | null) => {
      insertFile(ownerId, dest, f.name, getBlob(f.blob_id)!);
      copied++;
    };
    const copyFolder = (src: FolderRow, dest: FolderRow | null) => {
      const created = createFolder(ownerId, dest?.id ?? null, src.name, { autoRename: true });
      copied++;
      const childFiles = db.prepare('SELECT * FROM files WHERE folder_id = ? AND deleted_at IS NULL').all(src.id) as FileRow[];
      for (const cf of childFiles) copyFile(cf, created);
      const childFolders = db.prepare('SELECT * FROM folders WHERE parent_id = ? AND deleted_at IS NULL').all(src.id) as FolderRow[];
      for (const cf of childFolders) copyFolder(cf, created);
    };
    for (const f of files) copyFile(f, target);
    for (const f of folders) copyFolder(f, target);
    return { copied };
  });
}

/* ---------- trash ---------- */

export function trashItems(ownerId: number, sel: Selection) {
  const { fileIds, folderIds } = normSelection(sel);
  return tx(() => {
    const t = now();
    let count = 0;
    for (const id of folderIds) {
      const f = getOwnedFolder(ownerId, id);
      const batch = newId();
      db.prepare('UPDATE folders SET deleted_at = ?, trash_batch = ?, trash_root = 0 WHERE path LIKE ? AND deleted_at IS NULL').run(t, batch, `${f.path}%`);
      db.prepare('UPDATE folders SET trash_root = 1 WHERE id = ?').run(f.id);
      db.prepare(
        'UPDATE files SET deleted_at = ?, trash_batch = ?, trash_root = 0 WHERE deleted_at IS NULL AND folder_id IN (SELECT id FROM folders WHERE path LIKE ?)',
      ).run(t, batch, `${f.path}%`);
      count++;
    }
    for (const id of fileIds) {
      const f = getOwnedFile(ownerId, id);
      db.prepare('UPDATE files SET deleted_at = ?, trash_batch = ?, trash_root = 1 WHERE id = ?').run(t, newId(), f.id);
      count++;
    }
    return { trashed: count };
  });
}

export function listTrash(ownerId: number, offset = 0, limit = 100) {
  const total =
    (db.prepare('SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND trash_root = 1 AND deleted_at IS NOT NULL').get(ownerId) as { c: number }).c +
    (db.prepare('SELECT COUNT(*) AS c FROM files WHERE owner_id = ? AND trash_root = 1 AND deleted_at IS NOT NULL').get(ownerId) as { c: number }).c;
  const rows = db
    .prepare(
      `SELECT 'folder' AS kind, id, deleted_at FROM folders WHERE owner_id = ? AND trash_root = 1 AND deleted_at IS NOT NULL
       UNION ALL SELECT 'file' AS kind, id, deleted_at FROM files WHERE owner_id = ? AND trash_root = 1 AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC LIMIT ? OFFSET ?`,
    )
    .all(ownerId, ownerId, Math.min(limit, 500), offset) as { kind: 'folder' | 'file'; id: string }[];
  const items = rows.map((r) => {
    if (r.kind === 'folder') {
      const f = getFolderRaw(r.id)!;
      const s = db
        .prepare('SELECT COALESCE(SUM(size),0) AS b FROM files WHERE trash_batch = ?')
        .get(f.trash_batch) as { b: number };
      return folderToItem(f, s.b);
    }
    return fileToItem(getFileRaw(r.id)!);
  });
  return { items, total, nextOffset: offset + items.length < total ? offset + items.length : null };
}

export function restoreItems(ownerId: number, sel: Selection) {
  const { fileIds, folderIds } = normSelection(sel);
  return tx(() => {
    let restored = 0;
    const ensureParent = (parentId: string | null): string | null => {
      if (!parentId) return null;
      const p = getFolderRaw(parentId);
      return p && !p.deleted_at ? p.id : null; // parent gone → restore to root
    };
    for (const id of folderIds) {
      const f = getOwnedFolder(ownerId, id, { allowDeleted: true });
      if (!f.deleted_at || !f.trash_root) continue;
      const parentId = ensureParent(f.parent_id);
      const name = uniqueName(ownerId, parentId, f.name, true);
      if (parentId !== f.parent_id) {
        const parent = parentId ? getFolderRaw(parentId)! : null;
        const newPath = `${parent?.path ?? '/'}${f.id}/`;
        db.prepare('UPDATE folders SET path = ? || substr(path, ?) WHERE path LIKE ?').run(newPath, f.path.length + 1, `${f.path}%`);
      }
      db.prepare('UPDATE folders SET deleted_at = NULL, trash_batch = NULL, trash_root = 0 WHERE trash_batch = ?').run(f.trash_batch);
      db.prepare('UPDATE files SET deleted_at = NULL, trash_batch = NULL, trash_root = 0 WHERE trash_batch = ?').run(f.trash_batch);
      db.prepare('UPDATE folders SET parent_id = ?, name = ? WHERE id = ?').run(parentId, name, f.id);
      restored++;
    }
    for (const id of fileIds) {
      const f = getOwnedFile(ownerId, id, { allowDeleted: true });
      if (!f.deleted_at || !f.trash_root) continue;
      const parentId = ensureParent(f.folder_id);
      const name = uniqueName(ownerId, parentId, f.name);
      db.prepare('UPDATE files SET deleted_at = NULL, trash_batch = NULL, trash_root = 0, folder_id = ?, name = ? WHERE id = ?').run(parentId, name, f.id);
      restored++;
    }
    return { restored };
  });
}

/** Permanently deletes file rows and releases blobs whose ref count drops to zero. */
function hardDeleteFiles(rows: FileRow[]): string[] {
  const orphanKeys: string[] = [];
  const del = db.prepare('DELETE FROM files WHERE id = ?');
  const dec = db.prepare('UPDATE blobs SET ref_count = ref_count - 1 WHERE id = ?');
  const usage = new Map<number, number>();
  for (const f of rows) {
    del.run(f.id);
    dec.run(f.blob_id);
    usage.set(f.owner_id, (usage.get(f.owner_id) ?? 0) + f.size);
    const b = getBlob(f.blob_id);
    if (b && b.ref_count <= 0) {
      db.prepare('DELETE FROM blobs WHERE id = ?').run(b.id);
      orphanKeys.push(b.storage_key);
    }
  }
  for (const [uid, bytes] of usage) adjustUsage(uid, -bytes);
  return orphanKeys;
}

export async function releaseKeys(keys: string[]) {
  for (const k of keys) {
    try {
      await storage.delete(k);
    } catch {
      /* best-effort; orphan sweeper will retry */
    }
  }
}

export function purgeItems(ownerId: number, sel: Selection): { deleted: number; keys: string[] } {
  const { fileIds, folderIds } = normSelection(sel);
  return tx(() => {
    const keys: string[] = [];
    let deleted = 0;
    for (const id of folderIds) {
      const f = getOwnedFolder(ownerId, id, { allowDeleted: true });
      const files = db
        .prepare('SELECT * FROM files WHERE folder_id IN (SELECT id FROM folders WHERE path LIKE ?)')
        .all(`${f.path}%`) as FileRow[];
      keys.push(...hardDeleteFiles(files));
      db.prepare('DELETE FROM shares WHERE target_type = ? AND target_id IN (SELECT id FROM folders WHERE path LIKE ?)').run('folder', `${f.path}%`);
      db.prepare('DELETE FROM folders WHERE path LIKE ?').run(`${f.path}%`);
      deleted++;
    }
    for (const id of fileIds) {
      const f = getOwnedFile(ownerId, id, { allowDeleted: true });
      keys.push(...hardDeleteFiles([f]));
      db.prepare("DELETE FROM shares WHERE target_type = 'file' AND target_id = ?").run(f.id);
      deleted++;
    }
    return { deleted, keys };
  });
}

export function emptyTrash(ownerId: number) {
  const folders = db.prepare('SELECT id FROM folders WHERE owner_id = ? AND trash_root = 1 AND deleted_at IS NOT NULL').all(ownerId) as { id: string }[];
  const files = db.prepare('SELECT id FROM files WHERE owner_id = ? AND trash_root = 1 AND deleted_at IS NOT NULL').all(ownerId) as { id: string }[];
  if (!folders.length && !files.length) return { deleted: 0, keys: [] };
  return purgeItems(ownerId, { folderIds: folders.map((f) => f.id), fileIds: files.map((f) => f.id) });
}

/** Removes trash older than `days`. */
export function purgeExpiredTrash(days: number) {
  if (days <= 0) return [];
  const cutoff = now() - days * 86400_000;
  const keys: string[] = [];
  const owners = db
    .prepare(
      'SELECT DISTINCT owner_id FROM (SELECT owner_id FROM folders WHERE trash_root = 1 AND deleted_at < ? UNION SELECT owner_id FROM files WHERE trash_root = 1 AND deleted_at < ?)',
    )
    .all(cutoff, cutoff) as { owner_id: number }[];
  for (const { owner_id } of owners) {
    const folders = db.prepare('SELECT id FROM folders WHERE owner_id = ? AND trash_root = 1 AND deleted_at < ?').all(owner_id, cutoff) as { id: string }[];
    const files = db.prepare('SELECT id FROM files WHERE owner_id = ? AND trash_root = 1 AND deleted_at < ?').all(owner_id, cutoff) as { id: string }[];
    keys.push(...purgeItems(owner_id, { folderIds: folders.map((f) => f.id), fileIds: files.map((f) => f.id) }).keys);
  }
  return keys;
}

/** Deletes all of a user's data (admin "delete user"). */
export function purgeUser(userId: number): string[] {
  return tx(() => {
    const files = db.prepare('SELECT * FROM files WHERE owner_id = ?').all(userId) as FileRow[];
    const keys = hardDeleteFiles(files);
    db.prepare('DELETE FROM folders WHERE owner_id = ?').run(userId);
    db.prepare('DELETE FROM shares WHERE owner_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    return keys;
  });
}

export function adminDeleteFiles(fileIds: string[]): string[] {
  return tx(() => {
    const rows = fileIds.map((id) => getFileRaw(id)).filter(Boolean) as FileRow[];
    for (const f of rows) db.prepare("DELETE FROM shares WHERE target_type = 'file' AND target_id = ?").run(f.id);
    return hardDeleteFiles(rows);
  });
}
