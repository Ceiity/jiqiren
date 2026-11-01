import { ZipArchive } from 'archiver';
import type { FastifyReply } from 'fastify';
import { PassThrough } from 'node:stream';
import { storage } from '../storage/index.js';
import { contentDisposition } from '../lib/send-file.js';
import type { FileRow } from './fs.js';
import { getBlob } from './fs.js';

export interface ZipEntry {
  file: FileRow;
  relPath: string;
}

/** Streams a zip (store mode — no recompression, constant memory) to the client. */
export function sendZip(reply: FastifyReply, zipName: string, entries: ZipEntry[], emptyDirs: string[] = []) {
  const archive = new ZipArchive({ zlib: { level: 0 }, store: true } as never);
  const out = new PassThrough();
  reply.header('Content-Type', 'application/zip');
  reply.header('Content-Disposition', contentDisposition('attachment', zipName.endsWith('.zip') ? zipName : `${zipName}.zip`));
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Cache-Control', 'no-store');
  archive.on('error', (err) => out.destroy(err));
  archive.pipe(out);
  reply.raw.on('close', () => archive.abort());
  reply.send(out);

  // de-duplicate names inside the archive
  const used = new Set<string>();
  const uniq = (p: string) => {
    let candidate = p;
    let i = 1;
    while (used.has(candidate.toLowerCase())) {
      const dot = p.lastIndexOf('.');
      candidate = dot > p.lastIndexOf('/') ? `${p.slice(0, dot)} (${i})${p.slice(dot)}` : `${p} (${i})`;
      i++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  };

  (async () => {
    for (const dir of emptyDirs) archive.append('', { name: `${dir}/` });
    for (const e of entries) {
      const blob = getBlob(e.file.blob_id);
      if (!blob) continue;
      // lazy open: archiver consumes entries sequentially
      const stream = await storage.createReadStream(blob.storage_key);
      archive.append(stream, { name: uniq(e.relPath), date: new Date(e.file.updated_at) });
      await new Promise<void>((resolve, reject) => {
        const onEntry = () => {
          archive.off('error', onErr);
          resolve();
        };
        const onErr = (err: Error) => reject(err);
        archive.once('entry', onEntry);
        archive.once('error', onErr);
      });
    }
    await archive.finalize();
  })().catch((err) => {
    archive.abort();
    out.destroy(err);
  });
}
