import path from 'path';

/**
 * Is `name` safe to use as the last segment of a path inside an
 * attachment-staging directory? Filenames originate from untrusted sources —
 * channel messages from any chat participant, agent-to-agent forwards from
 * a possibly-compromised peer agent — and land in `path.join(dir, name)`
 * sinks on the host. Without this guard, a `..`-laden name escapes the
 * inbox and writes anywhere the host process has filesystem permission.
 *
 * Rejects:
 *   - non-string / empty
 *   - `.` / `..` (traversal sentinels that path.basename returns as-is)
 *   - anything containing a path separator (`/` or `\`) or NUL
 *   - any value where `path.basename(name) !== name`, catching OS-specific
 *     separators and covering drives/prefixes on Windows runtimes
 */
export function isSafeAttachmentName(name: string): boolean {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  if (/[\\/\0]/.test(name)) return false;
  return path.basename(name) === name;
}

/**
 * Is `id` safe to use as a (possibly multi-segment) directory path inside an
 * attachment-staging root? Unlike `isSafeAttachmentName`, `/` is allowed
 * between segments — some channel adapters hand back message ids that are
 * themselves slash-namespaced (e.g. Photon's `p:0/spc-msg-...`), and
 * blanket-rejecting any `/` silently drops every attachment on such a
 * message (#3xxx). Traversal is still fully blocked: each segment goes
 * through `isSafeAttachmentName`, so a `..` anywhere in the id is rejected
 * exactly as before; only a bare `/` between otherwise-safe segments is now
 * permitted. No leading/trailing/doubled slash — each produces an empty
 * segment, which `isSafeAttachmentName` already rejects.
 */
export function isSafeAttachmentPath(id: string): boolean {
  if (typeof id !== 'string' || id.length === 0) return false;
  if (id.startsWith('/') || id.endsWith('/')) return false;
  return id.split('/').every((segment) => isSafeAttachmentName(segment));
}
