import fs from 'fs';
import path from 'path';

/**
 * uid/gid of the `node` user baked into the agent image (container/Dockerfile).
 * Referenced here and by the `--user` remap check in container-runner.ts so
 * both stay in sync with the Dockerfile.
 */
export const CONTAINER_UID = 1000;
export const CONTAINER_GID = 1000;

/**
 * Recursively re-owns a host path to match the container's `node` user.
 *
 * Directories NanoClaw creates for RW bind mounts (session dir, group dir,
 * .claude-shared) are owned by whatever user the host process runs as. When
 * that's root, the container's non-root `node` user (uid 1000) can't write
 * into them — `mkdir`/`open` inside the container fails with EACCES and the
 * agent-runner crashes before producing a reply.
 *
 * No-op when the host process isn't root: the common case is a host uid that
 * already equals 1000, and container-runner.ts remaps `--user` to the host
 * uid for any other non-root uid — only root needs this fixup, since we
 * deliberately don't remap the container to run as root (see the comment at
 * that call site).
 */
export function ensureContainerWritable(rootPath: string): void {
  if (process.getuid?.() !== 0) return;
  chownRecursive(rootPath);
}

function chownRecursive(target: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(target);
  } catch {
    return;
  }

  if (stat.uid !== CONTAINER_UID || stat.gid !== CONTAINER_GID) {
    try {
      fs.lchownSync(target, CONTAINER_UID, CONTAINER_GID);
    } catch {
      return;
    }
  }

  if (!stat.isDirectory()) return;

  let entries: string[];
  try {
    entries = fs.readdirSync(target);
  } catch {
    return;
  }
  for (const entry of entries) {
    chownRecursive(path.join(target, entry));
  }
}
