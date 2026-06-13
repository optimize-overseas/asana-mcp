/**
 * Server configuration, sourced entirely from environment variables so the
 * package ships with zero instance-specific values.
 */

export type WriteMode = 'read_only' | 'restricted' | 'full';

export interface ServerConfig {
  /** Asana personal access token. Required. */
  accessToken: string;
  /**
   * Write posture:
   * - `read_only` (default): only read tools are registered.
   * - `restricted`: comments allowed; task updates may modify ONLY custom
   *   fields whose GIDs appear in `writableCustomFieldGids`; no task
   *   creation, no assignee/status/name changes.
   * - `full`: all write tools (create, update, comment).
   * There are no delete tools in any mode — by design.
   */
  writeMode: WriteMode;
  /** Custom field GIDs writable in `restricted` mode. */
  writableCustomFieldGids: Set<string>;
  /** Optional default workspace GID for list/search tools. */
  defaultWorkspaceGid?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const accessToken = env.ASANA_ACCESS_TOKEN ?? '';
  if (!accessToken) {
    throw new Error(
      'ASANA_ACCESS_TOKEN is required (an Asana personal access token; see https://developers.asana.com/docs/personal-access-token)',
    );
  }

  const rawMode = (env.ASANA_MCP_WRITE_MODE ?? 'read_only').trim().toLowerCase();
  if (rawMode !== 'read_only' && rawMode !== 'restricted' && rawMode !== 'full') {
    throw new Error(
      `ASANA_MCP_WRITE_MODE must be one of read_only|restricted|full (got "${rawMode}")`,
    );
  }

  const writableCustomFieldGids = new Set(
    (env.ASANA_MCP_WRITABLE_CUSTOM_FIELDS ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  );

  if (rawMode === 'restricted' && writableCustomFieldGids.size === 0) {
    // Allowed, but the operator should know update_task will reject everything.
    console.error(
      '[asana-mcp] WARNING: restricted mode with an empty ASANA_MCP_WRITABLE_CUSTOM_FIELDS — asana_update_task will reject all updates',
    );
  }

  return {
    accessToken,
    writeMode: rawMode,
    writableCustomFieldGids,
    defaultWorkspaceGid: env.ASANA_MCP_DEFAULT_WORKSPACE || undefined,
  };
}
