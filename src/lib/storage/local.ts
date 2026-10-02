import fsp from 'fs/promises';
import path from 'path';
import type { StorageDriver } from './index';

/** Root directory for stored media: UPLOAD_DIR relative to project cwd. */
function resolveRoot(): string {
  const dir = process.env.UPLOAD_DIR ?? '.data/uploads';
  return path.resolve(process.cwd(), dir);
}

/**
 * Resolve `key` beneath `root`, rejecting any traversal that escapes it
 * (`..`, absolute keys, symlink-free best effort). Throws INVALID_KEY.
 */
function safeJoin(root: string, key: string): string {
  const full = path.resolve(root, key);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('INVALID_KEY');
  }
  return full;
}

function isMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/**
 * Filesystem-backed driver. Content type is intentionally ignored (local
 * files carry no mime metadata; serving uses the Media doc).
 */
export function getLocalDriver(): StorageDriver {
  const root = resolveRoot();

  return {
    async putObject(key, buffer) {
      const full = safeJoin(root, key);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      await fsp.writeFile(full, buffer);
    },

    async getObject(key) {
      const full = safeJoin(root, key);
      try {
        return await fsp.readFile(full);
      } catch (err) {
        if (isMissing(err)) throw new Error('NOT_FOUND');
        throw err;
      }
    },

    async deleteObject(key) {
      const full = safeJoin(root, key);
      try {
        await fsp.unlink(full);
      } catch (err) {
        // Deleting an already-absent object is a no-op, not an error.
        if (!isMissing(err)) throw err;
      }
    },

    async headObject(key) {
      const full = safeJoin(root, key);
      try {
        const stat = await fsp.stat(full);
        // Local files carry no mime metadata — content-type is unknown.
        return { size: stat.size, contentType: null };
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
    },
  };
}
