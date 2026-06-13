import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AsanaClient } from '../src/client/client';
import type { ServerConfig } from '../src/server/config';
import { registerTools } from '../src/server/tools';

const READ_TOOLS = [
  'asana_get_task',
  'asana_list_tasks',
  'asana_list_task_comments',
  'asana_list_task_attachments',
  'asana_get_user',
  'asana_list_project_sections',
  'asana_list_tasks_in_section',
  'asana_typeahead_search',
];

function makeConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    accessToken: 'tok',
    writeMode: 'read_only',
    writableCustomFieldGids: new Set(),
    defaultWorkspaceGid: undefined,
    ...overrides,
  };
}

/**
 * Register tools into a real McpServer and capture the registry. The SDK's
 * McpServer keeps registered tools privately; we intercept via `server.tool`
 * by wrapping the instance with a spy-friendly subclass substitute.
 */
function captureTools(config: ServerConfig, client?: AsanaClient) {
  const tools = new Map<string, { description: string; handler: (args: any) => Promise<any> }>();
  const fake = {
    tool: (name: string, description: string, _schema: unknown, handler: (args: any) => Promise<any>) => {
      tools.set(name, { description, handler });
    },
  } as unknown as McpServer;
  registerTools(
    fake,
    client ??
      new AsanaClient({ accessToken: 'tok', fetchImpl: vi.fn() as unknown as typeof fetch }),
    config,
  );
  return tools;
}

function clientReturning(body: unknown, capture?: { calls: any[] }) {
  const fetchImpl = vi.fn(async (url: string, init: any) => {
    capture?.calls.push([url, init]);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return new AsanaClient({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
}

describe('tool registration per write mode', () => {
  it('read_only registers exactly the read tools', () => {
    const tools = captureTools(makeConfig());
    expect([...tools.keys()].sort()).toEqual([...READ_TOOLS].sort());
  });

  it('restricted adds add_comment + update_task only', () => {
    const tools = captureTools(makeConfig({ writeMode: 'restricted' }));
    expect([...tools.keys()].sort()).toEqual(
      [...READ_TOOLS, 'asana_add_comment', 'asana_update_task'].sort(),
    );
  });

  it('full adds create_task as well', () => {
    const tools = captureTools(makeConfig({ writeMode: 'full' }));
    expect([...tools.keys()].sort()).toEqual(
      [...READ_TOOLS, 'asana_add_comment', 'asana_update_task', 'asana_create_task'].sort(),
    );
  });

  it('no delete tool exists in any mode', () => {
    for (const mode of ['read_only', 'restricted', 'full'] as const) {
      const tools = captureTools(makeConfig({ writeMode: mode }));
      for (const name of tools.keys()) expect(name).not.toMatch(/delete/i);
    }
  });
});

describe('restricted-mode update guard', () => {
  const allow = new Set(['1200000000000001']);

  it('rejects non-custom-field updates', async () => {
    const tools = captureTools(
      makeConfig({ writeMode: 'restricted', writableCustomFieldGids: allow }),
    );
    const result = await tools.get('asana_update_task')!.handler({
      task_gid: 't1',
      name: 'renamed',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/only custom_fields/);
  });

  it('rejects custom field GIDs off the allowlist', async () => {
    const tools = captureTools(
      makeConfig({ writeMode: 'restricted', writableCustomFieldGids: allow }),
    );
    const result = await tools.get('asana_update_task')!.handler({
      task_gid: 't1',
      custom_fields: { '1200000000000001': 'ok', '9999999999999999': 'nope' },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('9999999999999999');
  });

  it('rejects an empty update', async () => {
    const tools = captureTools(
      makeConfig({ writeMode: 'restricted', writableCustomFieldGids: allow }),
    );
    const result = await tools.get('asana_update_task')!.handler({ task_gid: 't1' });
    expect(result.isError).toBe(true);
  });

  it('allows allowlisted custom-field updates and calls the API', async () => {
    const capture = { calls: [] as any[] };
    const tools = captureTools(
      makeConfig({ writeMode: 'restricted', writableCustomFieldGids: allow }),
      clientReturning({ data: { gid: 't1' } }, capture),
    );
    const result = await tools.get('asana_update_task')!.handler({
      task_gid: 't1',
      custom_fields: { '1200000000000001': 'value' },
    });
    expect(result.isError).toBeUndefined();
    expect(capture.calls).toHaveLength(1);
    expect(JSON.parse(capture.calls[0][1].body)).toEqual({
      data: { custom_fields: { '1200000000000001': 'value' } },
    });
  });

  it('full mode passes arbitrary fields through', async () => {
    const capture = { calls: [] as any[] };
    const tools = captureTools(
      makeConfig({ writeMode: 'full' }),
      clientReturning({ data: { gid: 't1' } }, capture),
    );
    const result = await tools.get('asana_update_task')!.handler({
      task_gid: 't1',
      name: 'renamed',
      assignee: null,
    });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(capture.calls[0][1].body)).toEqual({
      data: { name: 'renamed', assignee: null },
    });
  });
});

describe('tool handlers', () => {
  it('handlers return JSON text content on success', async () => {
    const tools = captureTools(makeConfig(), clientReturning({ data: { gid: 't9', name: 'X' } }));
    const result = await tools.get('asana_get_task')!.handler({ task_gid: 't9' });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ gid: 't9', name: 'X' });
  });

  it('handlers surface AsanaApiError as isError text (no throw)', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"errors":[{"message":"nope"}]}', { status: 403 }));
    const tools = captureTools(
      makeConfig(),
      new AsanaClient({ accessToken: 'tok', fetchImpl: fetchImpl as unknown as typeof fetch }),
    );
    const result = await tools.get('asana_get_task')!.handler({ task_gid: 't9' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/403/);
  });

  it('typeahead errors cleanly without a workspace', async () => {
    const tools = captureTools(makeConfig());
    const result = await tools.get('asana_typeahead_search')!.handler({
      resource_type: 'task',
      query: 'q',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/workspace/i);
  });

  it('typeahead falls back to the configured default workspace', async () => {
    const capture = { calls: [] as any[] };
    const tools = captureTools(
      makeConfig({ defaultWorkspaceGid: '1100000000000001' }),
      clientReturning({ data: [] }, capture),
    );
    const result = await tools.get('asana_typeahead_search')!.handler({
      resource_type: 'task',
      query: 'q',
    });
    expect(result.isError).toBeUndefined();
    expect(capture.calls[0][0]).toContain('/workspaces/1100000000000001/typeahead');
  });

  it('list_tasks falls back to the configured default workspace', async () => {
    const capture = { calls: [] as any[] };
    const tools = captureTools(
      makeConfig({ defaultWorkspaceGid: '1100000000000001' }),
      clientReturning({ data: [] }, capture),
    );
    await tools.get('asana_list_tasks')!.handler({ assignee: 'me' });
    const url = new URL(capture.calls[0][0]);
    expect(url.searchParams.get('workspace')).toBe('1100000000000001');
  });

  it('create_task errors cleanly without any location', async () => {
    const tools = captureTools(makeConfig({ writeMode: 'full' }));
    const result = await tools.get('asana_create_task')!.handler({ name: 'T' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/workspace, projects, or parent/);
  });
});
