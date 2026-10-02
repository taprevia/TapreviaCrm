/**
 * Storage abstraction for the media pipeline.
 *
 * Drivers:
 *  - local : filesystem under UPLOAD_DIR (dev / self-hosted)
 *  - s3    : any S3-compatible object store via @aws-sdk/client-s3
 *
 * The driver is chosen once from MEDIA_DRIVER and memoized as a singleton.
 * MEDIA_DRIVER=local is explicit opt-in; in production the default is s3
 * (Vercel's filesystem is non-persistent), and it is a hard error if the
 * bucket is not configured. Initialization is lazy: importing this module has
 * no side effects, and the S3 client is only constructed on the first
 * getStorage()/driver call after the s3 driver is selected.
 */

import { getLocalDriver } from './local';
import { getS3Driver } from './s3';

export interface StorageDriver {
  putObject(key: string, buffer: Buffer, contentType: string): Promise<void>;
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  /**
   * Verify an object exists and read its metadata without transferring the
   * body. Remote drivers (s3) issue a HEAD request; local stats the file.
   * Returns null when the object is absent. Used to independently confirm
   * direct (presigned-PUT) uploads before a Media row is marked 'ready'.
   */
  headObject(
    key: string
  ): Promise<{ size: number; contentType: string | null } | null>;
  /**
   * Serverless-safe direct-read URL. Remote drivers (s3) return a short-lived
   * presigned URL so large objects never need to be buffered through a
   * function; local returns null and callers proxy from disk.
   */
  presignGetUrl?(key: string, expiresInSeconds?: number): Promise<string | null>;
  /**
   * Direct-upload URL. Remote drivers (s3) return a short-lived presigned PUT
   * so clients bypass the serverless request-body cap; local returns undefined.
   */
  presignPutUrl?(
    key: string,
    contentType: string,
    expiresInSeconds?: number
  ): Promise<string | undefined>;
}

export type StorageDriverName = 'local' | 's3';

/** Resolves the configured driver name. */
export function driverName(): StorageDriverName {
  if (process.env.MEDIA_DRIVER === 'local') return 'local';
  if (process.env.MEDIA_DRIVER === 's3') return 's3';
  // Hosted environments have no writable disk — default to the object store
  // so an unset MEDIA_DRIVER never silently writes to ephemeral storage.
  return process.env.NODE_ENV === 'production' ? 's3' : 'local';
}

let instance: StorageDriver | null = null;

/** Driver singleton, initialized on first use. */
export function getStorage(): StorageDriver {
  if (!instance) {
    // Both factories are pure closures — nothing is constructed until here,
    // and only for the selected driver.
    instance = driverName() === 's3' ? getS3Driver() : getLocalDriver();
  }
  return instance;
}
