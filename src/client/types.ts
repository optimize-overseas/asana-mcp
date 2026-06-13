/**
 * Asana API resource types (subset relevant to this package's surface).
 * Field presence depends on the `opt_fields` requested — all fields beyond
 * `gid` are optional.
 */

export interface AsanaUser {
  gid: string;
  name?: string;
  email?: string;
  resource_type?: string;
}

export interface AsanaEnumOption {
  gid: string;
  name?: string;
  enabled?: boolean;
  color?: string;
}

export interface AsanaCustomField {
  gid: string;
  name?: string;
  type?: string;
  resource_subtype?: string;
  text_value?: string | null;
  number_value?: number | null;
  display_value?: string | null;
  enum_value?: AsanaEnumOption | null;
  multi_enum_values?: AsanaEnumOption[] | null;
  enum_options?: AsanaEnumOption[];
}

export interface AsanaProjectMembership {
  project: { gid: string; name?: string };
  section?: { gid: string; name?: string };
}

export interface AsanaTask {
  gid: string;
  name?: string;
  notes?: string;
  html_notes?: string;
  completed?: boolean;
  permalink_url?: string;
  assignee?: AsanaUser | null;
  followers?: AsanaUser[];
  memberships?: AsanaProjectMembership[];
  created_by?: AsanaUser;
  created_at?: string;
  modified_at?: string;
  due_on?: string | null;
  due_at?: string | null;
  custom_fields?: AsanaCustomField[];
  parent?: { gid: string; resource_type?: string } | null;
  num_subtasks?: number;
  resource_type?: string;
}

export interface AsanaStory {
  gid: string;
  text?: string;
  html_text?: string;
  type?: string;
  resource_subtype?: string;
  created_by?: AsanaUser;
  created_at?: string;
  target?: { gid: string; resource_type?: string };
}

export interface AsanaAttachment {
  gid: string;
  name?: string;
  download_url?: string;
  permanent_url?: string;
  host?: string;
  resource_type?: string;
  size?: number;
}

export interface AsanaSection {
  gid: string;
  name?: string;
  resource_type?: string;
}

export interface AsanaTypeaheadResult {
  gid: string;
  name?: string;
  resource_type?: string;
}

/** Fields accepted when updating a task (PUT /tasks/{gid}). */
export interface AsanaTaskUpdateData {
  name?: string;
  notes?: string;
  html_notes?: string;
  completed?: boolean;
  /** User GID, or null to unassign. */
  assignee?: string | null;
  due_on?: string | null;
  due_at?: string | null;
  /** Map of custom field GID -> new value (text, number, or enum option GID). */
  custom_fields?: Record<string, string | number | null>;
  [key: string]: unknown;
}

/** Fields accepted when creating a task (POST /tasks). */
export interface AsanaTaskCreateData {
  name: string;
  notes?: string;
  html_notes?: string;
  /** Workspace GID — required unless `projects` or `parent` is given. */
  workspace?: string;
  projects?: string[];
  parent?: string;
  assignee?: string;
  due_on?: string;
  due_at?: string;
  followers?: string[];
  custom_fields?: Record<string, string | number | null>;
  [key: string]: unknown;
}

/** Pagination envelope returned by Asana list endpoints. */
export interface AsanaPage<T> {
  data: T[];
  next_page?: { offset: string; path: string; uri: string } | null;
}

export interface ListTasksParams {
  /** Workspace GID (combine with `assignee`). */
  workspace?: string;
  /** Assignee user GID, or "me". */
  assignee?: string;
  /** Project GID. */
  project?: string;
  /** Section GID. */
  section?: string;
  /** ISO-8601 time or "now" — only tasks incomplete or completed since then. */
  completedSince?: string;
  /** ISO-8601 time — only tasks modified since then. */
  modifiedSince?: string;
  optFields?: string;
  limit?: number;
  offset?: string;
}

export interface ClientRequestOptions {
  optFields?: string;
  limit?: number;
  offset?: string;
}

export interface TypeaheadParams {
  resourceType: 'task' | 'project' | 'user' | 'portfolio' | 'tag';
  query: string;
  count?: number;
  optFields?: string;
}
