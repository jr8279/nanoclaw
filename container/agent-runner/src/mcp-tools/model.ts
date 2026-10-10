/**
 * switch_model: change which Claude model this session runs on, live.
 *
 * Writes the per-session override file; the poll loop notices it within a
 * tick and calls the SDK's setModel() on the active query. No restart, no
 * approval. The tool description and instructions restrict use to explicit
 * user requests so the agent never escalates model cost on its own.
 */
import { MODEL_ALIASES, clearModelOverride, readModelOverride, writeModelOverride } from '../model-override.js';
import { registerTools } from './server.js';
import type { McpToolDefinition } from './types.js';

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(text: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${text}` }], isError: true };
}

const names = Object.keys(MODEL_ALIASES);

export const switchModel: McpToolDefinition = {
  tool: {
    name: 'switch_model',
    description:
      'Switch the Claude model this session runs on, live. ONLY call this when the user explicitly asks you to switch models (or to go back to the default). ' +
      'NEVER call it on your own initiative, even if a task looks hard or easy: model choice controls the user\'s token spend and is theirs to make. ' +
      `Models: ${names.join(', ')}; "default" restores the configured model. Takes effect from your next turn. With no model, reports the current setting.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', enum: [...names, 'default'], description: 'Model to switch to, or "default" to reset' },
      },
    },
  },
  async handler(args) {
    const model = args.model as string | undefined;
    if (!model) {
      const current = readModelOverride();
      return ok(current ? `Session override: ${current}` : 'No override; using the configured default model.');
    }
    if (model === 'default') {
      clearModelOverride();
      return ok('Switched back to the default model, effective from your next turn.');
    }
    const id = MODEL_ALIASES[model];
    if (!id) return err(`Unknown model "${model}". Choose one of: ${names.join(', ')}, default.`);
    writeModelOverride(id);
    return ok(`Switched to ${id}, effective from your next turn.`);
  },
};

registerTools([switchModel]);
