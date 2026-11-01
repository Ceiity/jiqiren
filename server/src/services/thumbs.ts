import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { config } from '../config.js';
import { storage } from '../storage/index.js';
import type { BlobRow, FileRow } from './fs.js';

sharp.cache(false);
sharp.concurrency(2);

const thumbDir = path.join(config.cacheDir, 'thumbs');
fs.mkdirSync(thumbDir, { recursive: true });

export const THUMB_SIZES = [128, 256, 512, 1024] as const;
const MAX_INPUT_PIXELS = 100_000_000;

// tiny semaphore so a grid of 200 images doesn't spawn 200 decoders
let running = 0;
const waiters: (() => void)[] = [];
async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 3) await new Promise<void>((r) => waiters.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.();
  }
}

const inflight = new Map<string, Promise<string | null>>();

function videoFrame(input: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-loglevel', 'error', '-ss', '1', '-i', input, '-frames:v', '1', '-vf', 'scale=640:-2', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1'];
    const p = spawn(config.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    p.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 32 * 1024 * 1024) p.kill('SIGKILL');
      else chunks.push(c);
    });
    const timer = setTimeout(() => p.kill('SIGKILL'), 20_000);
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error('ffmpeg failed'));
    });
  });
}

/** Returns path of a cached webp thumbnail, generating it on first use; null if not possible. */
export async function getThumbnail(file: FileRow, blob: BlobRow, size: number): Promise<string | null> {
  const s = THUMB_SIZES.find((x) => x >= size) ?? 1024;
  const out = path.join(thumbDir, `${blob.id}_${s}.webp`);
  try {
    await fsp.access(out);
    return out;
  } catch {
    /* generate */
  }
  const key = out;
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = withSlot(async () => {
    try {
      let input: Buffer | string;
      if (file.category === 'image') {
        const local = storage.localPath(blob.storage_key);
        if (local) input = local;
        else {
          if (blob.size > 50 * 1024 * 1024) return null;
          const chunks: Buffer[] = [];
          for await (const c of await storage.createReadStream(blob.storage_key)) chunks.push(c as Buffer);
          input = Buffer.concat(chunks);
        }
      } else if (file.category === 'video') {
        const local = storage.localPath(blob.storage_key);
        if (!local) return null;
        input = await videoFrame(local);
      } else return null;
      const tmp = `${out}.${process.pid}.tmp`;
      await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'none' })
        .rotate()
        .resize(s, s, { fit: 'cover', withoutEnlargement: false })
        .webp({ quality: 78 })
        .toFile(tmp);
      await fsp.rename(tmp, out);
      return out;
    } catch {
      return null;
    }
  }).finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

export async function dropThumbs(blobId: string) {
  for (const s of THUMB_SIZES) await fsp.rm(path.join(thumbDir, `${blobId}_${s}.webp`), { force: true });
}
