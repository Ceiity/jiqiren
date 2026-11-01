import type { Readable } from 'node:stream';

export interface StorageDriver {
  readonly name: string;
  /** Moves a finished temp file (on local disk) into the store under `key`. */
  putFromTempFile(tempPath: string, key: string, size: number): Promise<void>;
  /** Opens a read stream; `end` is inclusive. */
  createReadStream(key: string, range?: { start: number; end: number }): Promise<Readable>;
  delete(key: string): Promise<void>;
  /** Local filesystem path when available (used for ffmpeg thumbnails). */
  localPath(key: string): string | null;
  stat?(): Promise<{ total: number; free: number } | null>;
}
