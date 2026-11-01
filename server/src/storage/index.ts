import { config } from '../config.js';
import type { StorageDriver } from './driver.js';
import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';

export const storage: StorageDriver =
  config.storageDriver === 's3' ? new S3Storage(config.s3) : new LocalStorage(config.storageDir);
