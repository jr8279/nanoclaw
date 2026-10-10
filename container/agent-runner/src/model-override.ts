/**
 * Per-session model override, set by the `switch_model` MCP tool at the
 * user's explicit request. The MCP server and the poll loop are separate
 * processes, so the override is a file in the session dir (`/workspace`).
 * It outlives the container, so a respawn keeps the chosen model; deleting
 * it returns the session to the agent group's configured default.
 */
import fs from 'fs';

const OVERRIDE_PATH = process.env.MODEL_OVERRIDE_PATH || '/workspace/.model-override';

/** Friendly names the tool accepts, mapped to concrete model IDs. */
export const MODEL_ALIASES: Record<string, string> = {
  fable: 'claude-fable-5-1',
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-5-5',
};

export function readModelOverride(): string | undefined {
  try {
    return fs.readFileSync(OVERRIDE_PATH, 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

export function writeModelOverride(model: string): void {
  fs.writeFileSync(OVERRIDE_PATH, `${model}\n`);
}

export function clearModelOverride(): void {
  fs.rmSync(OVERRIDE_PATH, { force: true });
}
