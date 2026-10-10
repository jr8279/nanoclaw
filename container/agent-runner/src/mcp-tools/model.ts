/**
 * switch_model: change which Claude model this session runs on, live.
 *
 * Writes the per-session override file; the poll loop notices it within a
 * tick and calls the SDK's setModel() on the active query. No restart, no
 * approval.
 *
 * A switch is either the user's (`initiated_by: "user"`, sticky) or the
 * agent's own pick for the work in front of it (`initiated_by: "self"`).
 * Self picks are limited to opus, haiku and default, expire on their own,
 * and opus is capped per day, so self-routing has a hard spend ceiling that
 * does not depend on the agent following its instructions.
 */
import {
  AUTO_OPUS_DAILY_CAP,
  MODEL_ALIASES,
  autoOpusUsedToday,
  clearModelOverride,
  isAutoModelOverride,
  readModelOverride,
  recordAutoOpus,
  writeAutoModelOverride,
  writeModelOverride,
} from '../model-override.js';
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
      'Switch the Claude model this session runs on, live. Set initiated_by to "user" when the user explicitly asked for a model (sticky until they change it), ' +
      'or "self" when you are choosing a model for the work in front of you under your model-routing instructions. ' +
      `A "self" switch may only pick opus, haiku or default; it reverts to the default on its own after the work goes quiet or the task run ends, and opus is capped at ${AUTO_OPUS_DAILY_CAP} self-initiated switches per day. ` +
      `Models: ${names.join(', ')}; "default" restores the configured model. With no model, reports the current setting and today's self-initiated opus count.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', enum: [...names, 'default'], description: 'Model to switch to, or "default" to reset' },
        initiated_by: {
          type: 'string',
          enum: ['user', 'self'],
          description: '"user" = the user explicitly asked for this model. "self" = your own routing choice. Required with a model.',
        },
      },
    },
  },
  async handler(args) {
    const model = args.model as string | undefined;
    const initiatedBy = args.initiated_by as string | undefined;
    const used = autoOpusUsedToday();
    if (!model) {
      const current = readModelOverride();
      const kind = isAutoModelOverride() ? 'self-chosen, reverts on its own' : 'set by the user';
      return ok(
        (current ? `Session override: ${current} (${kind}).` : 'No override; using the configured default model.') +
          ` Self-initiated opus switches today: ${used} of ${AUTO_OPUS_DAILY_CAP}.`,
      );
    }
    if (initiatedBy !== 'user' && initiatedBy !== 'self') {
      return err('initiated_by is required: "user" if the user explicitly asked for this model, "self" if this is your own routing choice.');
    }
    if (model === 'default') {
      clearModelOverride();
      return ok('Switched back to the default model, effective from your next turn.');
    }
    const id = MODEL_ALIASES[model];
    if (!id) return err(`Unknown model "${model}". Choose one of: ${names.join(', ')}, default.`);
    if (initiatedBy === 'user') {
      writeModelOverride(id);
      return ok(`Switched to ${id}, effective from your next turn. It stays until the user changes it or the container restarts.`);
    }
    if (model !== 'opus' && model !== 'haiku') {
      return err(`A self-initiated switch may only pick opus, haiku or default. ${model} needs an explicit request from the user.`);
    }
    if (model === 'opus') {
      // Already on a self-chosen opus: keep it, don't charge the cap twice.
      if (isAutoModelOverride() && readModelOverride() === id) return ok(`Already on ${id}.`);
      if (used >= AUTO_OPUS_DAILY_CAP) {
        return err(
          `Daily limit reached: ${used} of ${AUTO_OPUS_DAILY_CAP} self-initiated opus switches used today. Stay on the current model. ` +
            'If this work really needs opus, tell the user in one line and let them decide.',
        );
      }
      recordAutoOpus();
    }
    writeAutoModelOverride(id);
    return ok(
      `Switched to ${id} for this piece of work. It reverts to the default on its own after 30 minutes without a turn, or when a task run ends.` +
        (model === 'opus' ? ` Self-initiated opus switches today: ${used + 1} of ${AUTO_OPUS_DAILY_CAP}.` : ''),
    );
  },
};

registerTools([switchModel]);
