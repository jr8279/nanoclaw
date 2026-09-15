/**
 * scripts/backup-snapshot.ts — safe point-in-time copy of the central DB.
 *
 * Usage:
 *   pnpm exec tsx scripts/backup-snapshot.ts <source-db> <dest-db>
 *
 * Uses better-sqlite3's native .backup(), which is WAL-safe and does not
 * require stopping the host process or holding a write lock — a plain
 * `cp` of data/v2.db can copy a torn/inconsistent file while WAL pages
 * haven't been checkpointed back into the main file yet.
 */
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error("usage: backup-snapshot.ts <source-db> <dest-db>");
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });

const db = new Database(src, { readonly: true });
try {
  await db.backup(dest);
  console.log(`backed up ${src} -> ${dest}`);
} finally {
  db.close();
}
