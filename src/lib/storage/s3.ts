import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageDriver } from './index';

// Module state holds only closures — the S3Client itself is constructed
// lazily on first driver call, never at import time.
let client: S3Client | null = null;
let driver: StorageDriver | null = null;

function requireBucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is required when MEDIA_DRIVER=s3');
  return bucket;
}

/**
 * Normalise the optional custom endpoint (MinIO / R2 / Wasabi …).
 *
 * Trailing slashes are stripped: the SDK appends "/<bucket>/<key>" itself, so
 * an endpoint ending in "/" yields a doubled separator in the path-style
 * request URL. The signature is computed over the canonical request, so the
 * doubled path makes the string sent differ from the one signed and R2
 * rejects it with SignatureDoesNotMatch — which surfaces as an opaque 403.
 */
function getEndpoint(): string | undefined {
  const raw = process.env.S3_ENDPOINT?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, '') || undefined;
}

function getClient(): S3Client {
  if (client) return client;

  // AWS_* names are canonical; fall back to the S3_* spellings that existed
  // in .env.example before this module landed.
  const region = process.env.AWS_REGION || process.env.S3_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_ACCESS_KEY;
  const endpoint = getEndpoint();

  client = new S3Client({
    region,
    // WHEN_REQUIRED keeps the SDK from appending strict checksum headers
    // (x-amz-checksum-crc32) to presigned PUT URLs, which would otherwise
    // cause browser preflight CORS failures during client-side uploads.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials:
      accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    // Single attempt: presigning is pure local signing (no network), and media
    // reads are latency-sensitive, so a retry storm on a slow R2 edge is worse
    // than surfacing the error. Callers retry at a higher level — /media
    // returns 503 + Retry-After and the browser refetches.
    maxAttempts: 1,
    // Path-style is required by R2 and every other S3-compatible store once a
    // custom endpoint is set; virtual-host style yields unresolvable subdomains.
    ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
  });
  return client;
}

/** Normalize SDK errors: any flavor of "key absent" becomes NOT_FOUND. */
function mapNotFound(err: unknown): never {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  const notFound =
    e?.name === 'NoSuchKey' ||
    e?.name === 'NotFound' ||
    e?.$metadata?.httpStatusCode === 404;
  throw notFound ? new Error('NOT_FOUND') : err;
}

function buildS3Driver(): StorageDriver {
  return {
    async putObject(key, buffer, contentType) {
      await getClient().send(
        new PutObjectCommand({
          Bucket: requireBucket(),
          Key: key,
          Body: buffer,
          ContentType: contentType,
        })
      );
    },

    async getObject(key) {
      try {
        const res = await getClient().send(
          new GetObjectCommand({ Bucket: requireBucket(), Key: key })
        );
        if (!res.Body) throw new Error('NOT_FOUND');
        const bytes = await res.Body.transformToByteArray();
        return Buffer.from(bytes);
      } catch (err) {
        mapNotFound(err);
      }
    },

    async deleteObject(key) {
      await getClient().send(
        new DeleteObjectCommand({ Bucket: requireBucket(), Key: key })
      );
    },

    async headObject(key) {
      try {
        const res = await getClient().send(
          new HeadObjectCommand({ Bucket: requireBucket(), Key: key })
        );
        return {
          size: res.ContentLength ?? 0,
          contentType: res.ContentType ?? null,
        };
      } catch (err) {
        const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
        if (
          e?.name === 'NotFound' ||
          e?.name === 'NoSuchKey' ||
          e?.$metadata?.httpStatusCode === 404
        ) {
          return null;
        }
        throw err;
      }
    },

    /** Short-lived presigned GET — serves large objects without buffering. */
    async presignGetUrl(key, expiresInSeconds = 3600) {
      return getSignedUrl(
        getClient(),
        new GetObjectCommand({ Bucket: requireBucket(), Key: key }),
        { expiresIn: expiresInSeconds }
      );
    },

    /** Short-lived presigned PUT — clients upload directly to the store. */
    async presignPutUrl(key, contentType, expiresInSeconds = 900) {
      return getSignedUrl(
        getClient(),
        new PutObjectCommand({
          Bucket: requireBucket(),
          Key: key,
          ContentType: contentType,
        }),
        { expiresIn: expiresInSeconds }
      );
    },
  };
}

export function getS3Driver(): StorageDriver {
  if (!driver) driver = buildS3Driver();
  return driver;
}
