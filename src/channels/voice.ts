/**
 * Voice channel adapter — native HTTP bridge for a speak/listen client.
 *
 * Built for an iOS Shortcut ("Dictate Text" → HTTP → "Speak Text" in a loop),
 * but any client that can POST text and read JSON works:
 *  - POST /api/turn  {"text": "..."} — the user said something; fire onInbound
 *    and hold the request open for the agent's reply
 *  - GET  /api/wait — hold open for a reply to a turn that is still running
 *
 * Both return {"reply": string, "more": boolean}. `more: true` means the agent
 * has not answered yet: `reply` is a short spoken filler and the client should
 * call /api/wait. A reply is every message the agent sent for the turn, joined
 * and cleaned up for a speech synthesizer.
 *
 * The holds are short on purpose: phone HTTP clients and tunnels give up on a
 * request long before a tool-heavy agent turn finishes.
 *
 * Single-user, single-chat: one adapter instance = one messaging group with
 * `platform_id = "default"` (override with VOICE_PLATFORM_ID). No threads, no
 * cold DM. Refuses to start without VOICE_AUTH_TOKEN — this endpoint is meant
 * to be reachable from outside the host. Self-registers on import.
 */
import crypto from 'crypto';
import http from 'http';

import { readEnvFile } from '../env.js';
import { log } from '../log.js';
import { registerChannelAdapter } from './channel-registry.js';
import type { ChannelAdapter, ChannelDefaults, ChannelSetup, InboundMessage, OutboundMessage } from './adapter.js';

const MAX_BODY_BYTES = 8 * 1024;
const REPLY_QUEUE_MAX = 50;

/**
 * Single-operator transport, wired manually: every line is for the agent,
 * the only sender is the token holder ('strict' keeps auto-create off), no
 * thread or mention concept.
 */
const VOICE_DEFAULTS: ChannelDefaults = {
  dm: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'strict' },
  group: { engageMode: 'pattern', engagePattern: '.', threads: false, unknownSenderPolicy: 'strict' },
  mentions: 'never',
};

export interface VoiceAdapterOptions {
  port: number;
  /** Addresses to listen on. One server per address. */
  bind: string[];
  authToken: string;
  platformId: string;
  senderName: string;
  senderId: string;
  /** How long POST /api/turn holds before answering with a filler. */
  turnWaitMs: number;
  /** How long GET /api/wait holds before answering with a filler. */
  pollWaitMs: number;
  /** Quiet gap after a reply before the turn's messages are returned together. */
  settleMs: number;
}

interface TurnResult {
  reply: string;
  more: boolean;
}

/** Make agent text safe to hand to a speech synthesizer. */
export function toSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/\.(\s*\.)+/g, '.')
    .replace(/([!?:;,])\s*\./g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function createVoiceAdapter(opts: VoiceAdapterOptions): ChannelAdapter {
  let servers: http.Server[] = [];
  let setupConfig: ChannelSetup | null = null;
  const replies: string[] = [];
  let wake: (() => void) | null = null;

  const expectedAuth = Buffer.from(`Bearer ${opts.authToken}`);

  function checkAuth(req: http.IncomingMessage): boolean {
    const got = Buffer.from(String(req.headers['authorization'] ?? ''));
    return got.length === expectedAuth.length && crypto.timingSafeEqual(got, expectedAuth);
  }

  function send(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(body));
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Resolves when a reply arrives or `ms` elapses, whichever is first. */
  function nextReply(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        if (wake === done) wake = null;
        resolve();
      }
      wake = done;
    });
  }

  async function collect(waitMs: number, filler: string): Promise<TurnResult> {
    const deadline = Date.now() + waitMs;
    while (replies.length === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return { reply: filler, more: true };
      await nextReply(remaining);
    }
    // Let a multi-message answer finish arriving so it is spoken in one go.
    let seen = 0;
    while (seen !== replies.length) {
      seen = replies.length;
      await sleep(opts.settleMs);
    }
    return { reply: replies.splice(0).join(' '), more: false };
  }

  function handleTurn(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY_BYTES) tooBig = true;
    });
    req.on('end', () => {
      if (tooBig) return send(res, 413, { error: 'Too long' });
      let text: string;
      try {
        text = String((JSON.parse(body) as { text?: unknown }).text ?? '');
      } catch {
        return send(res, 400, { error: 'Invalid JSON' });
      }
      if (!text.trim()) return send(res, 400, { error: 'text required' });

      // A new turn supersedes anything left unspoken from the last one.
      replies.length = 0;

      const inbound: InboundMessage = {
        id: `voice-${Date.now()}`,
        kind: 'chat',
        content: { text, sender: opts.senderName, senderId: opts.senderId },
        timestamp: new Date().toISOString(),
      };
      try {
        void setupConfig?.onInbound(opts.platformId, null, inbound);
      } catch (err) {
        log.error('Voice onInbound failed', { err });
        return send(res, 500, { error: 'Could not reach the agent' });
      }

      void collect(opts.turnWaitMs, 'One moment.').then((result) => send(res, 200, result));
    });
  }

  function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://voice.local');
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true });
    if (!checkAuth(req)) return send(res, 401, { error: 'Unauthorized' });
    if (req.method === 'POST' && url.pathname === '/api/turn') return handleTurn(req, res);
    if (req.method === 'GET' && url.pathname === '/api/wait') {
      void collect(opts.pollWaitMs, 'Still working on it.').then((result) => send(res, 200, result));
      return;
    }
    send(res, 404, { error: 'Not found' });
  }

  return {
    name: 'voice',
    channelType: 'voice',
    supportsThreads: false,
    defaults: VOICE_DEFAULTS,

    async setup(config: ChannelSetup): Promise<void> {
      setupConfig = config;
      for (const host of opts.bind) {
        const server = http.createServer(handle);
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(opts.port, host, () => resolve());
        });
        servers.push(server);
      }
      log.info('Voice channel listening', { port: opts.port, bind: opts.bind, platformId: opts.platformId });

      // Stamp a human-readable name on the messaging_groups row on first boot.
      config.onMetadata(opts.platformId, 'Voice', false);
    },

    async teardown(): Promise<void> {
      const closing = servers;
      servers = [];
      wake?.();
      await Promise.all(
        closing.map(
          (server) =>
            new Promise<void>((resolve) => {
              server.close(() => resolve());
              server.closeAllConnections();
            }),
        ),
      );
      log.info('Voice channel stopped');
    },

    isConnected(): boolean {
      return servers.length > 0 && servers.every((server) => server.listening);
    },

    async deliver(platformId: string, _threadId: string | null, message: OutboundMessage): Promise<string | undefined> {
      if (platformId !== opts.platformId) {
        log.warn('Voice deliver called with unknown platformId', { platformId });
        return undefined;
      }
      const text = toSpeech(extractText(message.content));
      if (!text) return undefined;

      replies.push(text);
      while (replies.length > REPLY_QUEUE_MAX) replies.shift();
      wake?.();
      return `voice-out-${Date.now()}`;
    },
  };
}

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content && typeof content === 'object') {
    const c = content as { text?: unknown };
    if (typeof c.text === 'string') return c.text;
  }
  return '';
}

registerChannelAdapter('voice', {
  factory: () => {
    const env = readEnvFile([
      'VOICE_ENABLED',
      'VOICE_CHANNEL_PORT',
      'VOICE_BIND',
      'VOICE_AUTH_TOKEN',
      'VOICE_PLATFORM_ID',
      'VOICE_SENDER_NAME',
      'VOICE_SENDER_HANDLE',
    ]);
    const get = (key: keyof typeof env & string): string | undefined => process.env[key] || env[key];

    const enabled = get('VOICE_ENABLED');
    if (!enabled || enabled === 'false') return null;

    const authToken = get('VOICE_AUTH_TOKEN');
    if (!authToken || authToken.length < 24) {
      log.error('Voice channel not started: VOICE_AUTH_TOKEN must be set to at least 24 characters');
      return null;
    }

    return createVoiceAdapter({
      port: parseInt(get('VOICE_CHANNEL_PORT') || '8791', 10),
      bind: (get('VOICE_BIND') || '127.0.0.1')
        .split(',')
        .map((host) => host.trim())
        .filter(Boolean),
      authToken,
      platformId: get('VOICE_PLATFORM_ID') || 'default',
      senderName: get('VOICE_SENDER_NAME') || 'Voice',
      senderId: `voice:${get('VOICE_SENDER_HANDLE') || 'owner'}`,
      turnWaitMs: 12_000,
      pollWaitMs: 45_000,
      settleMs: 1_500,
    });
  },
  defaults: VOICE_DEFAULTS,
});

export { createVoiceAdapter };
