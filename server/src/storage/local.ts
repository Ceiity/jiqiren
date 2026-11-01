import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { StorageDriver } from './driver.js';

/** Stores blobs under <root>/<k0k1>/<k2k3>/<key>. Keys are generated server-side, never from user input. */
export class LocalStorage implements StorageDriver {
  readonly name = 'local';
  constructor(private root: string) {
    fs.mkdirSync(root, { recursive: true });
  }

  private resolve(key: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error('invalid storage key');
    return path.join(this.root, key.slice(0, 2), key.slice(2, 4), key);
  }

  localPath(key: string) {
    return this.resolve(key);
  }

  async putFromTempFile(tempPath: string, key: string): Promise<void> {
    const dest = this.resolve(key);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(tempPath, dest);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
      await fsp.copyFile(tempPath, dest);
      await fsp.unlink(tempPath);
    }
  }

  async createReadStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const p = this.resolve(key);
    await fsp.access(p);
    return fs.createReadStream(p, range ? { start: range.start, end: range.end, highWaterMark: 256 * 1024 } : { highWaterMark: 256 * 1024 });
  }

  async delete(key: string): Promise<void> {
    await fsp.rm(this.resolve(key), { force: true });
  }

  async stat() {
    const s = await fsp.statfs(this.root);
    return { total: s.blocks * s.bsize, free: s.bavail * s.bsize };
  }
}
