/**
 * Todo MCP server for NanoClaw
 * Exposes the self-hosted nanoclaw-todo app (github.com/jr8279/todo-list,
 * a standalone repo/deployment) as tools for the
 * container agent — list, create, complete, reopen, update and delete tasks,
 * plus category and household-member lookup. Talks to the todo app's REST
 * API over host.docker.internal (the todo app runs on the host/KVM, not
 * in-container).
 *
 * The todo app is multi-user (passkey-authenticated humans, each with their
 * own board). This tool authenticates as a separate *service* credential
 * (TODO_API_KEY) rather than as any one person, so every task it creates
 * must say which household member it belongs to (owner_id) — there's no
 * "me" to default to. Use todo_list_users to resolve a name to an id.
 *
 * TODO_API_URL defaults to the todo app's default port. TODO_API_KEY is
 * forwarded only if the host has one configured — without it this tool
 * can't authenticate at all (the todo app requires either a signed-in
 * session or this service key for every task/category/user endpoint).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const TODO_API_URL = process.env.TODO_API_URL || 'http://host.docker.internal:8787';
const TODO_API_KEY = process.env.TODO_API_KEY || '';

function log(msg: string): void {
  console.error(`[TODO] ${msg}`);
}

async function todoFetch(apiPath: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> | undefined),
  };
  if (TODO_API_KEY) headers['X-API-Key'] = TODO_API_KEY;
  const url = `${TODO_API_URL}${apiPath}`;
  try {
    return await fetch(url, { ...options, headers });
  } catch (err) {
    if (TODO_API_URL.includes('host.docker.internal')) {
      const fallbackUrl = url.replace('host.docker.internal', 'localhost');
      return await fetch(fallbackUrl, { ...options, headers });
    }
    throw err;
  }
}

function textResult(text: string, isError = false) {
  return { content: [{ type: 'text' as const, text }], isError };
}

async function todoJson(apiPath: string, options?: RequestInit): Promise<{ ok: boolean; body: unknown }> {
  const res = await todoFetch(apiPath, options);
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, body };
}

const server = new McpServer({ name: 'todo', version: '1.0.0' });

server.tool(
  'todo_list_users',
  'List the household members who have an account on the todo board, with their ids. ' +
    'Call this before creating or assigning a task so you know whose board it belongs on — ' +
    'match the name the person used in conversation to a display_name here.',
  {},
  async () => {
    const { ok, body } = await todoJson('/api/users');
    if (!ok) return textResult(`Failed to list users: ${JSON.stringify(body)}`, true);
    return textResult(JSON.stringify(body, null, 2));
  },
);

server.tool(
  'todo_list_categories',
  'List the todo categories (e.g. Home, Office, Kids School) with their ids. Use before creating a task with a category.',
  {},
  async () => {
    const { ok, body } = await todoJson('/api/categories');
    if (!ok) return textResult(`Failed to list categories: ${JSON.stringify(body)}`, true);
    return textResult(JSON.stringify(body, null, 2));
  },
);

server.tool(
  'todo_list_tasks',
  'List todo tasks. Defaults to pending tasks only. Filter by status, category, importance, ' +
    'a due-date range, or owner_id (whose board to look at — use todo_list_users to resolve a name). ' +
    'Omitting owner_id lists tasks across every household member.',
  {
    status: z.enum(['pending', 'completed', 'all']).optional().describe('Defaults to pending'),
    category_id: z.number().int().optional(),
    importance: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    due_before: z.string().optional().describe('ISO-8601 timestamp'),
    due_after: z.string().optional().describe('ISO-8601 timestamp'),
    q: z.string().optional().describe('Search title/notes'),
    owner_id: z.number().int().optional().describe('Limit to one household member\'s board'),
  },
  async (params) => {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) qs.set(key, String(value));
    }
    const { ok, body } = await todoJson(`/api/tasks?${qs}`);
    if (!ok) return textResult(`Failed to list tasks: ${JSON.stringify(body)}`, true);
    return textResult(JSON.stringify(body, null, 2));
  },
);

server.tool(
  'todo_create_task',
  'Create a new todo task. owner_id is required — use todo_list_users first to find whose board ' +
    'this belongs on (this tool has no "me", it always acts on behalf of the household, not one person). ' +
    'Use todo_list_categories first if you need a category_id. To tag other household members on it ' +
    '(so it shows on their board too), pass their ids in assignee_ids. ' +
    'For recurring tasks, set recurrence_freq (and optionally recurrence_interval) — ' +
    'this requires due_date to be set too, since recurrence is anchored on it. ' +
    'Link URLs must be http:// or https:// (or mailto:) — anything else is rejected.',
  {
    title: z.string(),
    owner_id: z.number().int().describe('Whose board this task belongs on — see todo_list_users'),
    notes: z.string().optional(),
    category_id: z.number().int().optional(),
    importance: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    due_date: z.string().optional().describe('ISO-8601 timestamp'),
    recurrence_freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
    recurrence_interval: z.number().int().min(1).optional(),
    links: z
      .array(z.object({ url: z.string(), label: z.string().optional() }))
      .optional()
      .describe('Reference links (http/https/mailto only), e.g. a portal URL or document'),
    assignee_ids: z
      .array(z.number().int())
      .optional()
      .describe('Other household members to tag on this task — see todo_list_users'),
  },
  async ({ recurrence_freq, recurrence_interval, ...rest }) => {
    const payload = {
      ...rest,
      recurrence: recurrence_freq ? { freq: recurrence_freq, interval: recurrence_interval || 1 } : null,
    };
    const { ok, body } = await todoJson('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
    if (!ok) return textResult(`Failed to create task: ${JSON.stringify(body)}`, true);
    log(`Created task: ${(body as { title?: string })?.title}`);
    return textResult(JSON.stringify(body, null, 2));
  },
);

server.tool(
  'todo_update_task',
  'Update fields on an existing task (partial update — only send fields to change). ' +
    'assignee_ids, if sent, replaces the full set of tagged household members.',
  {
    id: z.number().int(),
    title: z.string().optional(),
    notes: z.string().optional(),
    category_id: z.number().int().nullable().optional(),
    importance: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    due_date: z.string().nullable().optional(),
    status: z.enum(['pending', 'completed', 'archived']).optional(),
    recurrence_freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
    recurrence_interval: z.number().int().min(1).optional(),
    assignee_ids: z.array(z.number().int()).optional(),
  },
  async ({ id, recurrence_freq, recurrence_interval, ...rest }) => {
    const payload: Record<string, unknown> = { ...rest };
    if (recurrence_freq !== undefined) {
      payload.recurrence = recurrence_freq ? { freq: recurrence_freq, interval: recurrence_interval || 1 } : null;
    }
    const { ok, body } = await todoJson(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    if (!ok) return textResult(`Failed to update task ${id}: ${JSON.stringify(body)}`, true);
    return textResult(JSON.stringify(body, null, 2));
  },
);

server.tool(
  'todo_complete_task',
  'Mark a task complete. If it recurs, the next occurrence is created automatically and returned.',
  { id: z.number().int() },
  async ({ id }) => {
    const { ok, body } = await todoJson(`/api/tasks/${id}/complete`, { method: 'POST' });
    if (!ok) return textResult(`Failed to complete task ${id}: ${JSON.stringify(body)}`, true);
    return textResult(JSON.stringify(body, null, 2));
  },
);

server.tool(
  'todo_reopen_task',
  'Reopen a completed task (sets it back to pending).',
  { id: z.number().int() },
  async ({ id }) => {
    const { ok, body } = await todoJson(`/api/tasks/${id}/reopen`, { method: 'POST' });
    if (!ok) return textResult(`Failed to reopen task ${id}: ${JSON.stringify(body)}`, true);
    return textResult(JSON.stringify(body, null, 2));
  },
);

server.tool(
  'todo_delete_task',
  'Permanently delete a task. Prefer completing or archiving (todo_update_task with status: "archived") unless the user explicitly wants it removed.',
  { id: z.number().int() },
  async ({ id }) => {
    const res = await todoFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (!res.ok) return textResult(`Failed to delete task ${id}: ${res.status} ${res.statusText}`, true);
    return textResult(`Deleted task ${id}`);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`Ready (${TODO_API_URL})`);
}

main().catch((err) => {
  console.error('[TODO] Fatal error:', err);
  process.exit(1);
});
