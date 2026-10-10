/**
 * Tests for the voice channel adapter: the HTTP surface (POST /api/turn,
 * GET /api/wait), auth, reply collection, and speech cleanup.
 */
import http from 'http';
import type { AddressInfo } from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVoiceAdapter, toSpeech } from './voice.js';
import type { ChannelAdapter, ChannelSetup } from './adapter.js';

vi.mock('../log.js', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const TOKEN = 'test-token-test-token-test-token';
const AUTH = { Authorization: `Bearer ${TOKEN}` };

function makeSetup(overrides: Partial<ChannelSetup> = {}): ChannelSetup {
  return { onInbound: vi.fn(), onInboundEvent: vi.fn(), onMetadata: vi.fn(), onAction: vi.fn(), ...overrides };
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

async function req(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => (raw += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(raw) }));
      },
    );
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

describe('voice adapter', () => {
  let adapter: ChannelAdapter;
  let setup: ChannelSetup;
  let port: number;

  beforeEach(async () => {
    port = await getFreePort();
    adapter = createVoiceAdapter({
      port,
      bind: ['127.0.0.1'],
      authToken: TOKEN,
      platformId: 'default',
      senderName: 'Ryan (voice)',
      senderId: 'voice:ryan',
      turnWaitMs: 150,
      pollWaitMs: 150,
      settleMs: 30,
    });
    setup = makeSetup();
    await adapter.setup(setup);
  });

  afterEach(async () => {
    await adapter.teardown();
  });

  it('rejects a missing or wrong token but leaves health open', async () => {
    expect((await req(port, 'POST', '/api/turn', '{"text":"hi"}')).status).toBe(401);
    expect((await req(port, 'GET', '/api/wait', undefined, { Authorization: 'Bearer nope' })).status).toBe(401);
    expect((await req(port, 'GET', '/api/health')).status).toBe(200);
    expect(setup.onInbound).not.toHaveBeenCalled();
  });

  it('rejects empty text and bad JSON', async () => {
    expect((await req(port, 'POST', '/api/turn', '{"text":"  "}', AUTH)).status).toBe(400);
    expect((await req(port, 'POST', '/api/turn', 'not json', AUTH)).status).toBe(400);
  });

  it('forwards the turn and returns the reply once it arrives', async () => {
    const pending = req(port, 'POST', '/api/turn', '{"text":"what is on my calendar"}', AUTH);
    await vi.waitFor(() => expect(setup.onInbound).toHaveBeenCalled());
    const [platformId, threadId, message] = vi.mocked(setup.onInbound).mock.calls[0];
    expect(platformId).toBe('default');
    expect(threadId).toBeNull();
    expect(message.content).toEqual({ text: 'what is on my calendar', sender: 'Ryan (voice)', senderId: 'voice:ryan' });

    await adapter.deliver('default', null, { kind: 'chat', content: { text: 'You have **two** things today.' } });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ reply: 'You have two things today.', more: false });
  });

  it('joins messages that arrive close together', async () => {
    const pending = req(port, 'POST', '/api/turn', '{"text":"hi"}', AUTH);
    await vi.waitFor(() => expect(setup.onInbound).toHaveBeenCalled());
    await adapter.deliver('default', null, { kind: 'chat', content: 'First.' });
    await adapter.deliver('default', null, { kind: 'chat', content: 'Second.' });
    expect((await pending).data).toEqual({ reply: 'First. Second.', more: false });
  });

  it('answers with a filler when the agent is slow, then /api/wait gets the reply', async () => {
    const turn = await req(port, 'POST', '/api/turn', '{"text":"check my email"}', AUTH);
    expect(turn.data).toEqual({ reply: 'One moment.', more: true });

    const waiting = req(port, 'GET', '/api/wait', undefined, AUTH);
    await adapter.deliver('default', null, { kind: 'chat', content: 'Nothing urgent.' });
    expect((await waiting).data).toEqual({ reply: 'Nothing urgent.', more: false });

    expect((await req(port, 'GET', '/api/wait', undefined, AUTH)).data).toEqual({
      reply: 'Still working on it.',
      more: true,
    });
  });

  it('drops an unspoken reply when a new turn starts', async () => {
    await adapter.deliver('default', null, { kind: 'chat', content: 'Stale answer.' });
    const turn = await req(port, 'POST', '/api/turn', '{"text":"new question"}', AUTH);
    expect(turn.data).toEqual({ reply: 'One moment.', more: true });
  });

  it('ignores deliveries for another platform id and empty text', async () => {
    expect(await adapter.deliver('other', null, { kind: 'chat', content: 'x' })).toBeUndefined();
    expect(await adapter.deliver('default', null, { kind: 'chat', content: { card: {} } })).toBeUndefined();
  });
});

describe('toSpeech', () => {
  it('strips markdown, links and list markers', () => {
    expect(toSpeech('## Today\n- **Dentist** at 3\n- See [the form](https://x.co/a) or https://y.co/b')).toBe(
      'Today. Dentist at 3. See the form or a link',
    );
  });

  it('does not double up sentence punctuation across lines', () => {
    expect(toSpeech('All clear.\n\nAnything else?\nNo:')).toBe('All clear. Anything else? No:');
  });
});
