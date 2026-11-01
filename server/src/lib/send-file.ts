import type { FastifyReply, FastifyRequest } from 'fastify';
import { storage } from '../storage/index.js';
import { inlineContentType } from './filetype.js';

let activeDownloads = 0;
export const activeDownloadCount = () => activeDownloads;

export function contentDisposition(type: 'inline' | 'attachment', filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())}`;
}

/** Parses a single "bytes=a-b" range. Returns undefined for no/ignored range, null for unsatisfiable. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (!header) return undefined;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return undefined; // multi-range or malformed → full response
  let start: number;
  let end: number;
  if (m[1] === '' && m[2] === '') return undefined;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (suffix === 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return null;
  return { start, end };
}

export interface SendableFile {
  name: string;
  mime: string;
  ext: string;
  size: number;
  updatedAt: number;
  storageKey: string;
  etag: string;
}

/**
 * Streams a stored file with Range / conditional request support.
 * `inline` is honoured only for MIME types that are safe to render in our origin.
 * Returns whether a "fresh" download started (range starting at 0), for download counters.
 */
export async function sendStoredFile(
  req: FastifyRequest,
  reply: FastifyReply,
  file: SendableFile,
  opts: { inline: boolean; cacheControl?: string },
): Promise<{ fresh: boolean }> {
  const inlineType = opts.inline ? inlineContentType(file.mime, file.ext) : null;
  const etag = `"${file.etag}"`;
  reply.header('Accept-Ranges', 'bytes');
  reply.header('ETag', etag);
  reply.header('Last-Modified', new Date(file.updatedAt).toUTCString());
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  reply.header('Cache-Control', opts.cacheControl ?? 'private, max-age=0, must-revalidate');
  reply.header('Content-Type', inlineType ?? 'application/octet-stream');
  reply.header('Content-Disposition', contentDisposition(inlineType ? 'inline' : 'attachment', file.name));

  if (req.headers['if-none-match'] === etag && !req.headers.range) {
    reply.code(304).send();
    return { fresh: false };
  }

  let range = parseRange(req.headers.range, file.size);
  const ifRange = req.headers['if-range'];
  if (range && ifRange && ifRange !== etag) range = undefined;
  if (range === null) {
    reply.code(416).header('Content-Range', `bytes */${file.size}`).send();
    return { fresh: false };
  }
  if (req.method === 'HEAD') {
    reply.header('Content-Length', String(file.size)).code(200).send();
    return { fresh: false };
  }
  if (file.size === 0) {
    reply.header('Content-Length', '0').code(200).send('');
    return { fresh: true };
  }
  const stream = await storage.createReadStream(file.storageKey, range ?? undefined);
  activeDownloads++;
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      activeDownloads--;
    }
  };
  stream.on('close', finish);
  stream.on('error', finish);
  reply.raw.on('close', () => {
    finish();
    stream.destroy();
  });
  if (range) {
    reply
      .code(206)
      .header('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`)
      .header('Content-Length', String(range.end - range.start + 1));
  } else {
    reply.code(200).header('Content-Length', String(file.size));
  }
  reply.send(stream);
  return { fresh: !range || range.start === 0 };
}
