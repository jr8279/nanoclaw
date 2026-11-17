import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { getContinuation, setContinuation } from './db/session-state.js';
import { closeSessionDb, getInboundDb, initTestSessionDb } from './mailbox/sqlite/connection.js';
import { runPollLoop } from './poll-loop.js';
import type { AgentProvider, AgentQuery, ProviderEvent, QueryInput } from './providers/types.js';

// A task run must not resume the transcript of earlier runs: the series fires
// hours apart, so resuming re-sends all of it against a cold prompt cache.
// Chat turns keep resuming.

class RecordingProvider implements AgentProvider {
  continuations: (string | undefined)[] = [];

  registerMemorySessionHook(): void {}

  isSessionInvalid(): boolean {
    return false;
  }

  query(input: QueryInput): AgentQuery {
    this.continuations.push(input.continuation);
    let end: (() => void) | undefined;
    const ended = new Promise<void>((resolve) => {
      end = resolve;
    });
    const events: AsyncIterable<ProviderEvent> = {
      async *[Symbol.asyncIterator]() {
        yield { type: 'init', continuation: 'new-session' };
        yield { type: 'result', text: 'done' };
        await ended;
      },
    };
    return { push() {}, end: () => end?.(), events, abort: () => end?.() };
  }
}

function insertMessage(kind: 'task' | 'chat'): void {
  getInboundDb()
    .prepare(
      `INSERT INTO messages_in (id, kind, timestamp, status, platform_id, channel_type, content)
       VALUES (?, ?, datetime('now'), 'pending', ?, ?, ?)`,
    )
    .run(
      `m-${kind}`,
      kind,
      kind === 'chat' ? 'chan-1' : null,
      kind === 'chat' ? 'discord' : null,
      JSON.stringify(kind === 'chat' ? { sender: 'Alice', text: 'hello' } : { prompt: 'Run the nightly check' }),
    );
}

async function runUntilQueried(provider: RecordingProvider): Promise<void> {
  const controller = new AbortController();
  const loop = runPollLoop({ provider, providerName: 'rec', cwd: '/tmp', signal: controller.signal }).catch(() => {});
  const start = Date.now();
  while (getContinuation('rec') !== 'new-session' && Date.now() - start < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  controller.abort();
  await loop;
}

beforeEach(() => {
  initTestSessionDb();
  setContinuation('rec', 'old-session');
});

afterEach(() => {
  closeSessionDb();
});

describe('task runs start fresh', () => {
  it('does not resume the stored continuation for a task run', async () => {
    insertMessage('task');
    const provider = new RecordingProvider();
    await runUntilQueried(provider);
    expect(provider.continuations).toEqual([undefined]);
    expect(getContinuation('rec')).toBe('new-session');
  });

  it('still resumes the stored continuation for a chat turn', async () => {
    insertMessage('chat');
    const provider = new RecordingProvider();
    await runUntilQueried(provider);
    expect(provider.continuations).toEqual(['old-session']);
  });
});
