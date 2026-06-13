import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AsanaClient } from '../client/client';
import { loadConfig, ServerConfig } from './config';
import { registerTools } from './tools';

export { loadConfig } from './config';
export type { ServerConfig, WriteMode } from './config';
export { registerTools } from './tools';

const VERSION = '1.0.0';

/**
 * Build (but do not connect) the MCP server instance. Exposed for embedding
 * and tests; the published bin wires this to a stdio transport.
 */
export function buildServer(config?: ServerConfig, client?: AsanaClient): McpServer {
  const resolvedConfig = config ?? loadConfig();
  const resolvedClient =
    client ?? new AsanaClient({ accessToken: resolvedConfig.accessToken });
  const server = new McpServer({ name: 'asana-mcp', version: VERSION });
  registerTools(server, resolvedClient, resolvedConfig);
  return server;
}
