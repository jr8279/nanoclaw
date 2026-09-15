import fs from 'fs';
import path from 'path';

import type { MessageInRow } from './db/messages-in.js';
import type { PromptContent } from './providers/types.js';

function log(msg: string): void {
  console.error(`[image-attachments] ${msg}`);
}

type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

const IMAGE_MIME_ALLOWLIST: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

const EXT_TO_MIME: Record<string, ImageMediaType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// Anthropic rejects image blocks above ~5MB raw; leave headroom for the ~33%
// base64 expansion rather than let the API round-trip fail the whole turn.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function resolveImageMediaType(att: Record<string, unknown>): ImageMediaType | null {
  const mime = typeof att.mimeType === 'string' ? att.mimeType.split(';')[0].trim().toLowerCase() : '';
  if (IMAGE_MIME_ALLOWLIST.has(mime)) return mime as ImageMediaType;

  const name = typeof att.localPath === 'string' ? att.localPath : typeof att.name === 'string' ? att.name : '';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? null;
}

/**
 * Scan a batch of inbound chat messages for image attachments already
 * staged to disk (session-manager.ts on the host writes bytes to
 * `<sessionDir>/inbox/<messageId>/<filename>` and rewrites the attachment to
 * `{ localPath }`), and return them as native image content blocks.
 *
 * Only the four media types the Anthropic API accepts natively are
 * extracted (HEIC and anything else stays as the text file-path annotation
 * formatter.ts already emits — the agent can still open it with Read).
 */
export function extractImageBlocks(messages: MessageInRow[]): PromptContent[] {
  const blocks: PromptContent[] = [];

  for (const msg of messages) {
    if (msg.kind !== 'chat' && msg.kind !== 'chat-sdk') continue;

    let content: Record<string, unknown>;
    try {
      content = JSON.parse(msg.content);
    } catch {
      continue;
    }

    const attachments = content.attachments;
    if (!Array.isArray(attachments)) continue;

    for (const raw of attachments) {
      if (typeof raw !== 'object' || raw === null) continue;
      const att = raw as Record<string, unknown>;
      if (typeof att.localPath !== 'string') continue;

      const mediaType = resolveImageMediaType(att);
      if (!mediaType) continue;

      const absPath = path.join('/workspace', att.localPath);
      try {
        const stat = fs.statSync(absPath);
        if (stat.size > MAX_IMAGE_BYTES) {
          log(`Skipping oversized image attachment (${stat.size} bytes): ${absPath}`);
          continue;
        }
        const data = fs.readFileSync(absPath).toString('base64');
        blocks.push({ type: 'image', mediaType, data });
      } catch (e) {
        log(`Failed to read image attachment ${absPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return blocks;
}
