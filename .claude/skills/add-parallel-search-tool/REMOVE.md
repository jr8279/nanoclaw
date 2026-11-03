# Remove Parallel Search Tool

Every step is idempotent. Apply it only to groups where
`/add-parallel-search-tool` was installed.

```bash
ncl groups list
ncl groups config get --id <group-id>
```

For every group with a `parallel` MCP entry:

```bash
ncl groups config remove-mcp-server --id <group-id> --name parallel
ncl groups restart --id <group-id>
```

Confirm the entry is gone with `ncl groups config get --id <group-id>`.
