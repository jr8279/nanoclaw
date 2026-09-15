/**
 * Standalone stdio MCP server for the family chores app
 * (https://chores.therosenburgs.com). Spawned as a separate process via the
 * `chores` entry in a group's `mcpServers` container config — not part of
 * the always-on in-process tool set in ../mcp-tools/.
 *
 * Auth: outbound requests to the chores host go through the OneCLI gateway
 * (HTTPS_PROXY, set by container-runner.ts), which injects the real bearer
 * token at the proxy boundary. No Authorization header is set here and no
 * token is ever present in this container. See onecli-gateway skill.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

function log(msg: string): void {
  console.error(`[chores-mcp] ${msg}`);
}

const BASE_URL = process.env.CHORES_API_BASE_URL ?? 'https://chores.therosenburgs.com/api';

async function chores(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Chores API ${init?.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return body;
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
}

const zonePath = (period: string) => (period === 'biweekly' ? 'biweekly-zones' : 'zones');
const weekZonePath = (period: string) => (period === 'biweekly' ? 'biweekly' : 'zone');

const tools: { tool: Tool; handler: (args: Record<string, unknown>) => Promise<CallToolResult> }[] = [
  {
    tool: {
      name: 'get_current_week',
      description:
        'Get the current week\'s chore chart: zones, tasks, assignments, and completion status for both weekly and biweekly rotations.',
      inputSchema: { type: 'object', properties: {} },
    },
    handler: async () => {
      try {
        return ok(await chores('/week/current'));
      } catch (e) {
        return err(e);
      }
    },
  },
  {
    tool: {
      name: 'get_members',
      description: 'List family members who can be assigned chores.',
      inputSchema: { type: 'object', properties: {} },
    },
    handler: async () => {
      try {
        return ok(await chores('/members'));
      } catch (e) {
        return err(e);
      }
    },
  },
  {
    tool: {
      name: 'get_zones',
      description:
        'List chore zones (task groups with a dollar value) for the given rotation period. Includes zone ids needed for assigning/completing tasks.',
      inputSchema: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['weekly', 'biweekly'], description: 'Defaults to weekly.' },
        },
      },
    },
    handler: async (args) => {
      try {
        const period = (args.period as string) ?? 'weekly';
        return ok(await chores(`/${zonePath(period)}`));
      } catch (e) {
        return err(e);
      }
    },
  },
  {
    tool: {
      name: 'assign_chore',
      description:
        'Assign a zone (chore group) for a given week to a family member. Get week_id from get_current_week and zone_id from get_zones first.',
      inputSchema: {
        type: 'object',
        properties: {
          week_id: { type: 'string', description: 'Week id from get_current_week.' },
          zone_id: { type: 'string', description: 'Zone id from get_zones.' },
          period: { type: 'string', enum: ['weekly', 'biweekly'], description: 'Defaults to weekly.' },
          assignee_id: { type: 'string', description: 'Member id from get_members. Provide this or assignee_name.' },
          assignee_name: { type: 'string', description: 'Member name, if id is not known.' },
        },
        required: ['week_id', 'zone_id'],
      },
    },
    handler: async (args) => {
      try {
        const period = (args.period as string) ?? 'weekly';
        const { week_id, zone_id, assignee_id, assignee_name } = args as Record<string, string | undefined>;
        return ok(
          await chores(`/week/${week_id}/${weekZonePath(period)}/${zone_id}/assign`, {
            method: 'POST',
            body: JSON.stringify({ assignee_id, assignee_name }),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  },
  {
    tool: {
      name: 'set_task_status',
      description:
        'Mark a task within a zone complete or incomplete for a given week. Get week_id from get_current_week and zone_id/task_id from get_current_week or get_zones.',
      inputSchema: {
        type: 'object',
        properties: {
          week_id: { type: 'string', description: 'Week id from get_current_week.' },
          zone_id: { type: 'string', description: 'Zone id from get_zones.' },
          period: { type: 'string', enum: ['weekly', 'biweekly'], description: 'Defaults to weekly.' },
          task_id: { type: 'string', description: 'Task id, if known. Provide this or task_text.' },
          task_text: { type: 'string', description: 'Task text, if id is not known.' },
          completed: { type: 'boolean', description: 'True to mark complete, false to mark incomplete.' },
        },
        required: ['week_id', 'zone_id', 'completed'],
      },
    },
    handler: async (args) => {
      try {
        const period = (args.period as string) ?? 'weekly';
        const { week_id, zone_id, task_id, task_text, completed } = args as Record<string, unknown>;
        return ok(
          await chores(`/week/${week_id}/${weekZonePath(period)}/${zone_id}/task`, {
            method: 'POST',
            body: JSON.stringify({ task_id, task_text, completed }),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  },
  {
    tool: {
      name: 'get_earnings',
      description: 'Get earnings per family member for a date range (chore dollar values, summed by completed tasks).',
      inputSchema: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Start date, e.g. 2026-01-01.' },
          end: { type: 'string', description: 'End date, e.g. 2026-01-31.' },
        },
        required: ['start', 'end'],
      },
    },
    handler: async (args) => {
      try {
        const params = new URLSearchParams({ start: args.start as string, end: args.end as string });
        return ok(await chores(`/metrics/earnings?${params}`));
      } catch (e) {
        return err(e);
      }
    },
  },
];

async function main(): Promise<void> {
  const server = new Server({ name: 'chores', version: '1.0.0' }, { capabilities: { tools: {} } });
  const toolMap = new Map(tools.map((t) => [t.tool.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map((t) => t.tool) }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const t = toolMap.get(request.params.name);
    if (!t) return { content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }], isError: true };
    return t.handler(request.params.arguments ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`MCP server started with ${tools.length} tools`);
}

main().catch((e) => {
  log(`Fatal: ${e instanceof Error ? e.stack : e}`);
  process.exit(1);
});
