import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AsanaClient } from '../client/client';
import { AsanaApiError } from '../client/errors';
import type { ServerConfig } from './config';

/**
 * Registers the tool surface appropriate to the configured write mode.
 *
 * Read tools (always):
 *   asana_get_task, asana_list_tasks, asana_list_task_comments,
 *   asana_list_task_attachments, asana_get_user, asana_list_project_sections,
 *   asana_list_tasks_in_section, asana_typeahead_search
 * Write tools (restricted): asana_add_comment, asana_update_task (custom
 *   fields on the allowlist only)
 * Write tools (full): + asana_create_task, unrestricted asana_update_task
 * Delete tools: none, in any mode (by design).
 */
export function registerTools(server: McpServer, client: AsanaClient, config: ServerConfig): void {
  registerReadTools(server, client, config);
  if (config.writeMode !== 'read_only') {
    registerWriteTools(server, client, config);
  }
}

const optFieldsParam = z
  .string()
  .optional()
  .describe(
    'Comma-separated Asana opt_fields to include in the response (e.g. "name,notes,assignee.name")',
  );

function registerReadTools(server: McpServer, client: AsanaClient, config: ServerConfig): void {
  server.tool(
    'asana_get_task',
    'Get an Asana task by GID, including any requested opt_fields (name, notes, assignee, custom_fields, memberships, etc).',
    { task_gid: z.string().describe('Task GID'), opt_fields: optFieldsParam },
    async ({ task_gid, opt_fields }) =>
      run(() => client.getTask(task_gid, { optFields: opt_fields })),
  );

  server.tool(
    'asana_list_tasks',
    'List tasks filtered by workspace+assignee, project, or section. Use completed_since="now" for incomplete tasks only.',
    {
      workspace: z.string().optional().describe('Workspace GID (combine with assignee)'),
      assignee: z.string().optional().describe('Assignee user GID or "me"'),
      project: z.string().optional().describe('Project GID'),
      section: z.string().optional().describe('Section GID'),
      completed_since: z.string().optional().describe('ISO-8601 time or "now"'),
      modified_since: z.string().optional().describe('ISO-8601 time'),
      opt_fields: optFieldsParam,
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.string().optional().describe('Pagination offset token from a previous page'),
    },
    async args =>
      run(() =>
        client.listTasks({
          workspace: args.workspace ?? config.defaultWorkspaceGid,
          assignee: args.assignee,
          project: args.project,
          section: args.section,
          completedSince: args.completed_since,
          modifiedSince: args.modified_since,
          optFields: args.opt_fields,
          limit: args.limit,
          offset: args.offset,
        }),
      ),
  );

  server.tool(
    'asana_list_task_comments',
    'List the stories (comments and system events) on a task. Filter client-side on type="comment" for human comments.',
    { task_gid: z.string(), opt_fields: optFieldsParam },
    async ({ task_gid, opt_fields }) =>
      run(() => client.getTaskStories(task_gid, { optFields: opt_fields })),
  );

  server.tool(
    'asana_list_task_attachments',
    'List attachments on a task (name, host, download_url).',
    { task_gid: z.string(), opt_fields: optFieldsParam },
    async ({ task_gid, opt_fields }) =>
      run(() =>
        client.getTaskAttachments(task_gid, {
          optFields: opt_fields ?? 'name,download_url,host,size',
        }),
      ),
  );

  server.tool(
    'asana_get_user',
    'Get an Asana user by GID (or "me") — name, email, etc.',
    { user_gid: z.string(), opt_fields: optFieldsParam },
    async ({ user_gid, opt_fields }) =>
      run(() => client.getUser(user_gid, { optFields: opt_fields ?? 'name,email' })),
  );

  server.tool(
    'asana_list_project_sections',
    'List the sections of a project.',
    { project_gid: z.string(), opt_fields: optFieldsParam },
    async ({ project_gid, opt_fields }) =>
      run(() => client.getProjectSections(project_gid, { optFields: opt_fields })),
  );

  server.tool(
    'asana_list_tasks_in_section',
    'List the tasks in a section.',
    {
      section_gid: z.string(),
      opt_fields: optFieldsParam,
      completed_since: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.string().optional(),
    },
    async args =>
      run(() =>
        client.listTasksInSection(args.section_gid, {
          optFields: args.opt_fields,
          completedSince: args.completed_since,
          limit: args.limit,
          offset: args.offset,
        }),
      ),
  );

  server.tool(
    'asana_typeahead_search',
    'Fast typeahead search in a workspace for tasks, projects, users, portfolios, or tags.',
    {
      workspace: z.string().optional().describe('Workspace GID (falls back to the configured default)'),
      resource_type: z.enum(['task', 'project', 'user', 'portfolio', 'tag']),
      query: z.string().min(1),
      count: z.number().int().min(1).max(100).optional(),
      opt_fields: optFieldsParam,
    },
    async args => {
      const workspace = args.workspace ?? config.defaultWorkspaceGid;
      if (!workspace) {
        return errorResult(
          'No workspace provided and ASANA_MCP_DEFAULT_WORKSPACE is not configured',
        );
      }
      return run(() =>
        client.typeaheadSearch(workspace, {
          resourceType: args.resource_type,
          query: args.query,
          count: args.count,
          optFields: args.opt_fields,
        }),
      );
    },
  );
}

const customFieldsParam = z
  .record(z.union([z.string(), z.number(), z.null()]))
  .optional()
  .describe('Map of custom field GID -> new value (text, number, or enum option GID)');

function registerWriteTools(server: McpServer, client: AsanaClient, config: ServerConfig): void {
  server.tool(
    'asana_add_comment',
    'Add a comment to a task. If html_text is given it is tried first, falling back to plain text on rejection.',
    {
      task_gid: z.string(),
      text: z.string().min(1).describe('Plain-text comment body'),
      html_text: z.string().optional().describe('Optional rich-text body (<body>…</body>)'),
    },
    async ({ task_gid, text, html_text }) =>
      run(() => client.addComment(task_gid, { text, htmlText: html_text })),
  );

  server.tool(
    'asana_update_task',
    config.writeMode === 'restricted'
      ? 'Update custom fields on a task. RESTRICTED MODE: only custom field GIDs on the configured allowlist may be written; all other task fields are rejected.'
      : 'Update a task: name, notes, completed, assignee (null to unassign), due dates, and/or custom fields.',
    {
      task_gid: z.string(),
      name: z.string().optional(),
      notes: z.string().optional(),
      completed: z.boolean().optional(),
      assignee: z
        .union([z.string(), z.null()])
        .optional()
        .describe('User GID, or null to unassign'),
      due_on: z.union([z.string(), z.null()]).optional(),
      custom_fields: customFieldsParam,
    },
    async args => {
      const { task_gid, custom_fields, ...rest } = args;
      const restKeys = Object.keys(rest).filter(k => rest[k as keyof typeof rest] !== undefined);

      if (config.writeMode === 'restricted') {
        if (restKeys.length > 0) {
          return errorResult(
            `Restricted mode: only custom_fields updates are allowed (rejected: ${restKeys.join(', ')})`,
          );
        }
        const requested = Object.keys(custom_fields ?? {});
        if (requested.length === 0) {
          return errorResult('Restricted mode: provide custom_fields to update');
        }
        const blocked = requested.filter(gid => !config.writableCustomFieldGids.has(gid));
        if (blocked.length > 0) {
          return errorResult(
            `Restricted mode: custom field GID(s) not on the writable allowlist: ${blocked.join(', ')}`,
          );
        }
      }

      return run(() =>
        client.updateTask(task_gid, {
          ...(rest as Record<string, unknown>),
          ...(custom_fields ? { custom_fields } : {}),
        }),
      );
    },
  );

  if (config.writeMode === 'full') {
    server.tool(
      'asana_create_task',
      'Create a task in a workspace or project(s).',
      {
        name: z.string().min(1),
        notes: z.string().optional(),
        workspace: z.string().optional().describe('Workspace GID (or rely on projects/parent)'),
        projects: z.array(z.string()).optional(),
        parent: z.string().optional(),
        assignee: z.string().optional(),
        due_on: z.string().optional(),
        custom_fields: customFieldsParam,
      },
      async args => {
        // Asana requires a location: explicit workspace, projects, or parent.
        // Fall back to the configured default workspace when none is given.
        const workspace =
          args.workspace ??
          (!args.projects && !args.parent ? config.defaultWorkspaceGid : undefined);
        if (!workspace && !args.projects && !args.parent) {
          return errorResult(
            'Provide workspace, projects, or parent (or configure ASANA_MCP_DEFAULT_WORKSPACE)',
          );
        }
        return run(() =>
          client.createTask({
            name: args.name,
            notes: args.notes,
            workspace,
            projects: args.projects,
            parent: args.parent,
            assignee: args.assignee,
            due_on: args.due_on,
            custom_fields: args.custom_fields,
          }),
        );
      },
    );
  }
}

type ToolResult = {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await fn();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    if (err instanceof AsanaApiError) {
      return errorResult(`${err.message}`);
    }
    return errorResult(String(err));
  }
}

function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}
