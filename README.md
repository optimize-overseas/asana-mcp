# asana-mcp

MCP server + typed TypeScript client for the [Asana API](https://developers.asana.com/docs).

Two ways to use it:

1. **MCP server** (`asana-mcp` bin) — gives MCP clients (Claude Desktop, Claude Code, MCP Inspector, any `mcporter`-style runner) a guarded Asana tool surface over stdio.
2. **Client library** (`asana-mcp/client`) — a small typed Asana REST client for direct in-process use in Node services, with retry/backoff and normalized errors.

> Unofficial. Not affiliated with or endorsed by Asana, Inc. If you want Asana's hosted, OAuth-based MCP integration for interactive AI assistants, see [Asana's official MCP server](https://developers.asana.com/docs/mcp-server) — this package exists for **headless / personal-access-token** use cases (service bots, automation, server-side integrations), which the official server does not support.

## Design choices

- **No delete tools, in any mode.** Destructive removal is excluded from the tool surface by design.
- **Write access is opt-in and tiered** (`read_only` → `restricted` → `full`), so an AI agent can be given exactly as much write capability as you intend — down to an allowlist of specific custom fields.
- **Zero baked-in account specifics.** Workspace, fields, and tokens all arrive via environment variables.

## MCP server

```bash
ASANA_ACCESS_TOKEN=0/123abc... npx asana-mcp
```

### Environment

| Variable | Required | Description |
|---|---|---|
| `ASANA_ACCESS_TOKEN` | yes | Asana [personal access token](https://developers.asana.com/docs/personal-access-token) |
| `ASANA_MCP_WRITE_MODE` | no | `read_only` (default), `restricted`, or `full` |
| `ASANA_MCP_WRITABLE_CUSTOM_FIELDS` | no | Comma-separated custom field GIDs writable in `restricted` mode |
| `ASANA_MCP_DEFAULT_WORKSPACE` | no | Default workspace GID for list/search tools |

### Write modes

| Mode | Registered write tools | Notes |
|---|---|---|
| `read_only` | none | Default. Read tools only. |
| `restricted` | `asana_add_comment`, `asana_update_task` | `asana_update_task` may modify **only** custom fields whose GIDs are in `ASANA_MCP_WRITABLE_CUSTOM_FIELDS`; every other task field is rejected. |
| `full` | + `asana_create_task`, unrestricted `asana_update_task` | Still no delete tools. |

### Tools

Read (always): `asana_get_task`, `asana_list_tasks`, `asana_list_task_comments`, `asana_list_task_attachments`, `asana_get_user`, `asana_list_project_sections`, `asana_list_tasks_in_section`, `asana_typeahead_search`.

Write (per mode, above): `asana_add_comment`, `asana_update_task`, `asana_create_task`.

### Example MCP client config

```json
{
  "mcpServers": {
    "asana": {
      "command": "npx",
      "args": ["asana-mcp"],
      "env": {
        "ASANA_ACCESS_TOKEN": "0/123abc...",
        "ASANA_MCP_WRITE_MODE": "restricted",
        "ASANA_MCP_WRITABLE_CUSTOM_FIELDS": "1200000000000001,1200000000000002",
        "ASANA_MCP_DEFAULT_WORKSPACE": "1100000000000001"
      }
    }
  }
}
```

## Client library

```ts
import { AsanaClient, AsanaApiError } from 'asana-mcp/client';

const asana = new AsanaClient({ accessToken: process.env.ASANA_ACCESS_TOKEN! });

const task = await asana.getTask('1300000000000001', {
  optFields: 'name,notes,assignee.name,custom_fields.display_value',
});

await asana.addComment(task.gid, {
  text: 'Done!',
  htmlText: '<body><strong>Done!</strong></body>', // tried first, falls back to text
});

await asana.setAssignee(task.gid, null); // unassign

for await (const t of asana.iterateTasks({
  project: '1400000000000001',
  optFields: 'name,completed',
  limit: 100,
})) {
  // auto-follows pagination
}
```

### Client behavior

- **Retries** 429 (honoring `Retry-After`), 500/502/503/504, and network errors with exponential backoff + jitter (default 3 retries, base 500 ms).
- **Per-attempt timeout** (default 30 s) via `AbortController`.
- **Errors** throw `AsanaApiError` with `.status`, `.body`, and `.request` — non-retryable 4xx throws immediately.
- **Injectable `fetchImpl`** for tests; everything is constructor-configurable (`baseUrl`, `maxRetries`, `timeoutMs`, `retryBaseDelayMs`).

Surface: `getTask`, `listTasks`, `iterateTasks`, `createTask`, `updateTask`, `setAssignee`, `getTaskStories`, `getStory`, `addComment`, `getTaskAttachments`, `getUser`, `getProjectSections`, `listTasksInSection`, `typeaheadSearch`. (No delete methods — see design choices.)

## Development

```bash
npm install
npm test        # vitest unit suite (mocked fetch — no network, no token needed)
npm run build   # tsc → build/
npm run inspector  # poke the server with MCP Inspector
```

## License

MIT
