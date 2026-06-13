#!/usr/bin/env node
/**
 * asana-mcp — MCP server for the Asana API (stdio transport).
 *
 * Environment:
 *   ASANA_ACCESS_TOKEN              required — Asana personal access token
 *   ASANA_MCP_WRITE_MODE            read_only (default) | restricted | full
 *   ASANA_MCP_WRITABLE_CUSTOM_FIELDS  comma-separated custom field GIDs
 *                                     writable in restricted mode
 *   ASANA_MCP_DEFAULT_WORKSPACE     optional default workspace GID
 *
 * There are no delete tools in any mode — by design.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server/index';

async function main(): Promise<void> {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[asana-mcp] server running on stdio');
}

main().catch(err => {
  console.error('[asana-mcp] fatal:', err);
  process.exit(1);
});
