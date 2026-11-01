import fs from 'node:fs';
import fsp from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageDriver } from './driver.js';

export interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, etc.). */
export class S3Storage implements StorageDriver {
  readonly name = 's3';
  private client: S3Client;
  constructor(private opts: S3Options) {
    if (!opts.bucket) throw new Error('S3_BUCKET is required for STORAGE_DRIVER=s3');
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint || undefined,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.accessKeyId ? { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey } : undefined,
    });
  }

  localPath() {
    return null;
  }

  async putFromTempFile(tempPath: string, key: string): Promise<void> {
    const upload = new Upload({
      client: this.client,
      params: { Bucket: this.opts.bucket, Key: key, Body: fs.createReadStream(tempPath) },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
    });
    await upload.done();
    await fsp.rm(tempPath, { force: true });
  }

  async createReadStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Range: range ? `bytes=${range.start}-${range.end}` : undefined,
      }),
    );
    return res.Body as Readable;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }
}
