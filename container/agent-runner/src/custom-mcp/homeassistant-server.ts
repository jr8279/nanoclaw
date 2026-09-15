/**
 * Standalone stdio MCP server for Home Assistant
 * (https://hass.therosenburgs.com). Spawned as a separate process via the
 * `homeassistant` entry in a group's `mcpServers` container config — not
 * part of the always-on in-process tool set in ../mcp-tools/.
 *
 * Auth: outbound requests to the HA host go through the OneCLI gateway
 * (HTTPS_PROXY, set by container-runner.ts), which injects the real
 * long-lived access token at the proxy boundary. No Authorization header is
 * set here and no token is ever present in this container. See
 * onecli-gateway skill.
 *
 * Safety: lock/cover/alarm_control_panel are entity domains that can
 * physically unlock doors, open garage doors, or disarm an alarm. call_service
 * refuses those domains unless `confirm: true` is passed — the tool
 * description instructs the agent to only set that after the user has
 * explicitly confirmed in conversation. This is an instruction-level rail,
 * not a hard approval gate.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

function log(msg: string): void {
  console.error(`[homeassistant-mcp] ${msg}`);
}

const BASE_URL = process.env.HASS_API_BASE_URL ?? 'https://hass.therosenburgs.com/api';

const CONFIRM_REQUIRED_DOMAINS = new Set(['lock', 'cover', 'alarm_control_panel']);

async function hass(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(`Home Assistant ${init?.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  }
  return body;
}

function ok(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(e: unknown): CallToolResult {
  return { content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
}

interface HassState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

const tools: { tool: Tool; handler: (args: Record<string, unknown>) => Promise<CallToolResult> }[] = [
  {
    tool: {
      name: 'get_states',
      description:
        'Get the current state of one entity, or all entities. Use list_entities first to find entity ids by domain (light, lock, cover, climate, sensor, etc.).',
      inputSchema: {
        type: 'object',
        properties: {
          entity_id: { type: 'string', description: 'e.g. light.kitchen. Omit to get every entity.' },
        },
      },
    },
    handler: async (args) => {
      try {
        const entityId = args.entity_id as string | undefined;
        return ok(await hass(entityId ? `/states/${entityId}` : '/states'));
      } catch (e) {
        return err(e);
      }
    },
  },
  {
    tool: {
      name: 'list_entities',
      description:
        'List entity ids, current state, and friendly names, optionally filtered to one domain (e.g. "light", "lock", "cover", "climate", "sensor", "alarm_control_panel").',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'Entity domain prefix, e.g. "light". Omit to list everything.' },
        },
      },
    },
    handler: async (args) => {
      try {
        const domain = args.domain as string | undefined;
        const all = (await hass('/states')) as HassState[];
        const filtered = domain ? all.filter((s) => s.entity_id.startsWith(`${domain}.`)) : all;
        return ok(
          filtered.map((s) => ({
            entity_id: s.entity_id,
            state: s.state,
            friendly_name: s.attributes.friendly_name,
          })),
        );
      } catch (e) {
        return err(e);
      }
    },
  },
  {
    tool: {
      name: 'call_service',
      description:
        'Call a Home Assistant service to control a device or run an automation/scene (e.g. domain "light" service "turn_on", domain "lock" service "unlock", domain "cover" service "open_cover"). ' +
        'For the lock, cover, and alarm_control_panel domains — anything that can unlock a door, open a garage, or disarm an alarm — you MUST ask the user to explicitly confirm in the conversation before calling this, then pass confirm: true. Calls to those domains without confirm: true are rejected.',
      inputSchema: {
        type: 'object',
        properties: {
          domain: { type: 'string', description: 'e.g. light, lock, cover, climate, scene, automation.' },
          service: { type: 'string', description: 'e.g. turn_on, turn_off, unlock, lock, open_cover, close_cover, set_temperature.' },
          entity_id: { type: 'string', description: 'Target entity, e.g. light.kitchen. Omit for services that target no entity.' },
          service_data: {
            type: 'object',
            description: 'Extra service parameters, e.g. { "temperature": 70 } for climate.set_temperature.',
          },
          confirm: {
            type: 'boolean',
            description: 'Required (true) for lock/cover/alarm_control_panel domains, after the user has explicitly confirmed in chat.',
          },
        },
        required: ['domain', 'service'],
      },
    },
    handler: async (args) => {
      try {
        const domain = args.domain as string;
        const service = args.service as string;
        const entityId = args.entity_id as string | undefined;
        const serviceData = (args.service_data as Record<string, unknown> | undefined) ?? {};
        const confirm = args.confirm === true;

        if (CONFIRM_REQUIRED_DOMAINS.has(domain) && !confirm) {
          return err(
            `Refusing to call ${domain}.${service} without confirm: true. Ask the user to explicitly confirm this action in the conversation first, then retry with confirm: true.`,
          );
        }

        return ok(
          await hass(`/services/${domain}/${service}`, {
            method: 'POST',
            body: JSON.stringify(entityId ? { entity_id: entityId, ...serviceData } : serviceData),
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  },
];

async function main(): Promise<void> {
  const server = new Server({ name: 'homeassistant', version: '1.0.0' }, { capabilities: { tools: {} } });
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
