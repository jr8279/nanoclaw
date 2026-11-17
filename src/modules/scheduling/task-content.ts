export interface TaskContent {
  prompt: string;
  script: string | null;
  /** Model this task's runs start on (an alias or model id); null uses the group's model. */
  model: string | null;
  /** Reasoning effort for this task's runs; null uses the group's effort. */
  effort: string | null;
  originSessionId: string | null;
}

/** Decode the storage-neutral task content envelope. */
export function parseTaskContent(raw: string): TaskContent {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      script: typeof parsed.script === 'string' ? parsed.script : null,
      model: typeof parsed.model === 'string' && parsed.model ? parsed.model : null,
      effort: typeof parsed.effort === 'string' && parsed.effort ? parsed.effort : null,
      originSessionId: typeof parsed.originSessionId === 'string' ? parsed.originSessionId : null,
    };
    // eslint-disable-next-line no-catch-all/no-catch-all -- LEGACY-COMPAT(v1-tasks): plain-string content predating the JSON envelope
  } catch {
    return { prompt: raw, script: null, model: null, effort: null, originSessionId: null };
  }
}
