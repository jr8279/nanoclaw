/**
 * Per-session model override, set by the `switch_model` MCP tool. The MCP
 * server and the poll loop are separate processes, so the override is a file
 * in the session dir (`/workspace`). It outlives the container, so a respawn
 * keeps the chosen model; deleting it returns the session to the agent
 * group's configured default.
 *
 * Two kinds of override:
 *  - user: the user asked for a model. Sticky until they change it.
 *  - auto: the agent picked a model for the work in front of it. Carries an
 *    expiry (a sidecar marker file) so it falls back to the default after
 *    the work goes quiet, and opus picks count against a daily cap. Both
 *    exist so self-routing cannot quietly run up the user's token spend.
 */
import fs from 'fs';

const OVERRIDE_PATH = process.env.MODEL_OVERRIDE_PATH || '/workspace/.model-override';
const AUTO_MARKER_PATH = `${OVERRIDE_PATH}-auto`;
const AUTO_LEDGER_PATH = `${OVERRIDE_PATH}-auto-ledger.json`;

/** Friendly names the tool accepts, mapped to concrete model IDs. */
export const MODEL_ALIASES: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

/** How long an auto override survives after the last finished turn. */
export const AUTO_OVERRIDE_IDLE_MS = 30 * 60 * 1000;
/** First window, sized so one long turn is not cut back mid-work. */
export const AUTO_OVERRIDE_INITIAL_MS = 45 * 60 * 1000;
/** Self-initiated opus switches allowed per local day, per session. */
export const AUTO_OPUS_DAILY_CAP = Number(process.env.MODEL_AUTO_OPUS_DAILY_CAP) || 3;

function readAutoMarker(): { expiresAt: number } | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(AUTO_MARKER_PATH, 'utf8')) as { expiresAt?: unknown };
    return typeof parsed.expiresAt === 'number' ? { expiresAt: parsed.expiresAt } : undefined;
  } catch {
    return undefined;
  }
}

/** Current override, or undefined. An expired auto override is dropped here. */
export function readModelOverride(now = Date.now()): string | undefined {
  let model: string | undefined;
  try {
    model = fs.readFileSync(OVERRIDE_PATH, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
  const marker = readAutoMarker();
  if (model && marker && now >= marker.expiresAt) {
    clearModelOverride();
    return undefined;
  }
  return model;
}

/** User-requested override: sticky, no expiry. */
export function writeModelOverride(model: string): void {
  fs.rmSync(AUTO_MARKER_PATH, { force: true });
  fs.writeFileSync(OVERRIDE_PATH, `${model}\n`);
}

/** Agent-chosen override: expires once the work goes quiet. */
export function writeAutoModelOverride(model: string, now = Date.now()): void {
  fs.writeFileSync(OVERRIDE_PATH, `${model}\n`);
  fs.writeFileSync(AUTO_MARKER_PATH, JSON.stringify({ expiresAt: now + AUTO_OVERRIDE_INITIAL_MS }));
}

export function isAutoModelOverride(): boolean {
  return readAutoMarker() !== undefined && fs.existsSync(OVERRIDE_PATH);
}

/** Turn finished on an auto override: restart its idle clock. */
export function touchAutoModelOverride(now = Date.now()): void {
  if (!isAutoModelOverride()) return;
  fs.writeFileSync(AUTO_MARKER_PATH, JSON.stringify({ expiresAt: now + AUTO_OVERRIDE_IDLE_MS }));
}

export function clearModelOverride(): void {
  fs.rmSync(OVERRIDE_PATH, { force: true });
  fs.rmSync(AUTO_MARKER_PATH, { force: true });
}

function localDay(now: number): string {
  return new Date(now).toLocaleDateString('en-CA');
}

/** Self-initiated opus switches already made today. */
export function autoOpusUsedToday(now = Date.now()): number {
  try {
    const ledger = JSON.parse(fs.readFileSync(AUTO_LEDGER_PATH, 'utf8')) as { day?: string; count?: number };
    return ledger.day === localDay(now) && typeof ledger.count === 'number' ? ledger.count : 0;
  } catch {
    return 0;
  }
}

export function recordAutoOpus(now = Date.now()): void {
  fs.writeFileSync(AUTO_LEDGER_PATH, JSON.stringify({ day: localDay(now), count: autoOpusUsedToday(now) + 1 }));
}
