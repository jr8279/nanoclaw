---
name: add-parallel-search-tool
description: Add Parallel's free Search MCP (web_search and web_fetch, no account or API key) to selected NanoClaw agent groups as a remote HTTP MCP server. Use when installing Parallel search, or when an agent needs a stronger free web search than its built-in tools.
---

# Add Parallel Search Tool

Register Parallel's hosted Search MCP for each selected agent group. It is free
and anonymous; no account, API key, image rebuild or new package is needed,
because NanoClaw connects to remote HTTP MCP servers natively.

The registered server exposes:

- `mcp__parallel__web_search`
- `mcp__parallel__web_fetch`

The server supplies its own tool descriptions and input schemas at runtime.

## Phase 1: Pre-flight

```bash
ncl groups list
```

Ask which agent groups should receive Parallel search. For each one, check
whether it is already registered:

```bash
ncl groups config get --id <group-id>
```

If a `parallel` MCP entry already points at `https://search.parallel.ai/mcp`,
skip that group. If it points at the retired address
`https://search-mcp.parallel.ai/mcp`, re-register it in Phase 2 (the command
overwrites the entry in place).

## Phase 2: Register Parallel

`config add-mcp-server` and `groups restart` are approval-gated. Run from inside
a container they return `approval-pending` immediately; that is not an error.
Wait for the admin's approval and the follow-up system message before moving on.

For each selected `<group-id>`:

```bash
ncl groups config add-mcp-server \
  --id <group-id> \
  --name parallel \
  --url https://search.parallel.ai/mcp
```

Do not add an `Authorization` header. The anonymous tier is the point of this
skill; see [Rate limits](#rate-limits) for the optional key.

Restart each selected group:

```bash
ncl groups restart \
  --id <group-id> \
  --message "Parallel Search is installed. Run one mcp__parallel__web_search for 'Florida State football schedule' and report whether it succeeds."
```

## Phase 3: Verify

```bash
ncl groups config get --id <group-id>
```

The output must contain one `parallel` server of type `http` with url
`https://search.parallel.ai/mcp`. Then check the agent's test reply: the call
must use `mcp__parallel__web_search` and return results.

## Rate limits

The anonymous tier is rate limited and shared by every group on this host's IP.
If calls start failing with HTTP `429`, the agent should fall back to its
built-in `WebSearch` / `WebFetch` and say so. Do not register an API key unless
the operator explicitly asks: a Parallel key moves the install onto Parallel's
paid usage. If they do, the key belongs in the credential gateway with host
pattern `search.parallel.ai` and an `Authorization: Bearer` header, never in
`--headers` or chat.

## Troubleshooting

- Parallel tools are absent: verify the group has a `parallel` MCP entry, then
  restart the group.
- Connection refused or blocked: the installed gateway may restrict egress.
  Allow `search.parallel.ai` in the gateway's policy, then restart the group.
- Calls fail after working before: check for `429` (rate limit, above) or a
  moved endpoint at <https://docs.parallel.ai/integrations/mcp/quickstart>.

## Removal

See [REMOVE.md](REMOVE.md).

## References

- [Parallel MCP quickstart](https://docs.parallel.ai/integrations/mcp/quickstart)
- [Parallel Search is free for agents via MCP](https://parallel.ai/blog/free-web-search-mcp)
