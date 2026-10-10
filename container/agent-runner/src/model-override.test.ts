import { beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'model-override-'));
process.env.MODEL_OVERRIDE_PATH = path.join(dir, '.model-override');

const override = await import('./model-override.js');
const { switchModel } = await import('./mcp-tools/model.js');

const text = (r: { content: { text: string }[] }) => r.content[0].text;

beforeEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
});

describe('model override', () => {
  test('user override is sticky', () => {
    override.writeModelOverride('claude-opus-5-5');
    expect(override.isAutoModelOverride()).toBe(false);
    expect(override.readModelOverride(Date.now() + 24 * 3600_000)).toBe('claude-opus-5-5');
  });

  test('auto override expires and is removed', () => {
    const now = 1_000_000;
    override.writeAutoModelOverride('claude-opus-5-5', now);
    expect(override.readModelOverride(now + override.AUTO_OVERRIDE_INITIAL_MS - 1)).toBe('claude-opus-5-5');
    expect(override.readModelOverride(now + override.AUTO_OVERRIDE_INITIAL_MS)).toBeUndefined();
    expect(override.isAutoModelOverride()).toBe(false);
  });

  test('touch restarts the idle clock', () => {
    const now = 1_000_000;
    override.writeAutoModelOverride('claude-haiku-5-5', now);
    override.touchAutoModelOverride(now + 10);
    expect(override.readModelOverride(now + 10 + override.AUTO_OVERRIDE_IDLE_MS - 1)).toBe('claude-haiku-5-5');
    expect(override.readModelOverride(now + 10 + override.AUTO_OVERRIDE_IDLE_MS)).toBeUndefined();
  });

  test('a user switch replaces an auto override and drops its expiry', () => {
    override.writeAutoModelOverride('claude-haiku-5-5', 0);
    override.writeModelOverride('claude-opus-5-5');
    expect(override.readModelOverride()).toBe('claude-opus-5-5');
  });
});

describe('switch_model tool', () => {
  test('requires initiated_by with a model', async () => {
    const r = await switchModel.handler({ model: 'opus' });
    expect(r.isError).toBe(true);
    expect(override.readModelOverride()).toBeUndefined();
  });

  test('self cannot pick fable or sonnet', async () => {
    expect((await switchModel.handler({ model: 'fable', initiated_by: 'self' })).isError).toBe(true);
    expect((await switchModel.handler({ model: 'sonnet', initiated_by: 'self' })).isError).toBe(true);
    expect((await switchModel.handler({ model: 'fable', initiated_by: 'user' })).isError).toBeUndefined();
  });

  test('self opus is capped per day and repeat calls are free', async () => {
    for (let i = 0; i < override.AUTO_OPUS_DAILY_CAP; i++) {
      expect((await switchModel.handler({ model: 'opus', initiated_by: 'self' })).isError).toBeUndefined();
      // Already on self-chosen opus: no extra charge.
      await switchModel.handler({ model: 'opus', initiated_by: 'self' });
      await switchModel.handler({ model: 'default', initiated_by: 'self' });
    }
    expect(override.autoOpusUsedToday()).toBe(override.AUTO_OPUS_DAILY_CAP);
    const refused = await switchModel.handler({ model: 'opus', initiated_by: 'self' });
    expect(refused.isError).toBe(true);
    expect(text(refused)).toContain('Daily limit reached');
    expect(override.readModelOverride()).toBeUndefined();
    // The user can still ask for it, and haiku is never capped.
    expect((await switchModel.handler({ model: 'haiku', initiated_by: 'self' })).isError).toBeUndefined();
    expect((await switchModel.handler({ model: 'opus', initiated_by: 'user' })).isError).toBeUndefined();
  });
});
