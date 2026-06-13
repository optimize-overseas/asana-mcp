import { AsanaApiError } from './errors';
import type {
  AsanaAttachment,
  AsanaPage,
  AsanaSection,
  AsanaStory,
  AsanaTask,
  AsanaTaskCreateData,
  AsanaTaskUpdateData,
  AsanaTypeaheadResult,
  AsanaUser,
  ClientRequestOptions,
  ListTasksParams,
  TypeaheadParams,
} from './types';

export interface AsanaClientOptions {
  /** Asana personal access token (or any bearer token). */
  accessToken: string;
  /** Override the API base URL (default https://app.asana.com/api/1.0). */
  baseUrl?: string;
  /** Injectable fetch implementation (default: global fetch). */
  fetchImpl?: typeof fetch;
  /** Max retry attempts for retryable failures (429/5xx/network). Default 3. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 30000. */
  timeoutMs?: number;
  /** Base backoff delay in milliseconds (doubled per attempt + jitter). Default 500. */
  retryBaseDelayMs?: number;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Upper bound for a single backoff sleep, including vendor Retry-After. */
const MAX_BACKOFF_MS = 60_000;

/**
 * Minimal typed client for the Asana REST API (v1.0).
 *
 * - Bearer-token auth (personal access token).
 * - Automatic retry with exponential backoff + jitter on 429 (honoring
 *   Retry-After), 5xx, and network errors.
 * - Per-attempt timeout via AbortController.
 * - Throws {@link AsanaApiError} on non-2xx after retries are exhausted.
 *
 * The surface is deliberately small: tasks, stories, attachments, users,
 * sections, and typeahead search. There are NO delete methods by design.
 */
export class AsanaClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly retryBaseDelayMs: number;

  constructor(options: AsanaClientOptions) {
    if (!options.accessToken) {
      throw new Error('AsanaClient requires an accessToken');
    }
    this.accessToken = options.accessToken;
    this.baseUrl = (options.baseUrl ?? 'https://app.asana.com/api/1.0').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  async getTask(taskGid: string, opts: ClientRequestOptions = {}): Promise<AsanaTask> {
    const res = await this.request<{ data: AsanaTask }>('GET', `/tasks/${enc(taskGid)}`, {
      query: { opt_fields: opts.optFields },
    });
    return res.data;
  }

  async listTasks(params: ListTasksParams = {}): Promise<AsanaPage<AsanaTask>> {
    return this.request<AsanaPage<AsanaTask>>('GET', '/tasks', {
      query: {
        workspace: params.workspace,
        assignee: params.assignee,
        project: params.project,
        section: params.section,
        completed_since: params.completedSince,
        modified_since: params.modifiedSince,
        opt_fields: params.optFields,
        limit: params.limit,
        offset: params.offset,
      },
    });
  }

  /** Iterate tasks across pages (requires `limit` to enable Asana pagination). */
  async *iterateTasks(params: ListTasksParams): AsyncGenerator<AsanaTask> {
    let offset = params.offset;
    do {
      const page = await this.listTasks({ ...params, offset });
      for (const task of page.data) yield task;
      offset = page.next_page?.offset ?? undefined;
    } while (offset);
  }

  async createTask(data: AsanaTaskCreateData, opts: ClientRequestOptions = {}): Promise<AsanaTask> {
    const res = await this.request<{ data: AsanaTask }>('POST', '/tasks', {
      query: { opt_fields: opts.optFields },
      body: { data },
    });
    return res.data;
  }

  async updateTask(
    taskGid: string,
    data: AsanaTaskUpdateData,
    opts: ClientRequestOptions = {},
  ): Promise<AsanaTask> {
    const res = await this.request<{ data: AsanaTask }>('PUT', `/tasks/${enc(taskGid)}`, {
      query: { opt_fields: opts.optFields },
      body: { data },
    });
    return res.data;
  }

  /** Convenience: set or clear (null) the task assignee. */
  async setAssignee(taskGid: string, assigneeGid: string | null): Promise<AsanaTask> {
    return this.updateTask(taskGid, { assignee: assigneeGid });
  }

  // ── Stories (comments) ───────────────────────────────────────────────────

  async getTaskStories(taskGid: string, opts: ClientRequestOptions = {}): Promise<AsanaStory[]> {
    const res = await this.request<{ data: AsanaStory[] }>(
      'GET',
      `/tasks/${enc(taskGid)}/stories`,
      { query: { opt_fields: opts.optFields, limit: opts.limit, offset: opts.offset } },
    );
    return res.data;
  }

  async getStory(storyGid: string, opts: ClientRequestOptions = {}): Promise<AsanaStory> {
    const res = await this.request<{ data: AsanaStory }>('GET', `/stories/${enc(storyGid)}`, {
      query: { opt_fields: opts.optFields },
    });
    return res.data;
  }

  /**
   * Post a comment. When `htmlText` is provided it is tried first
   * (`html_text` rich formatting); if Asana rejects it with a 4xx the
   * comment falls back to plain `text` automatically.
   */
  async addComment(
    taskGid: string,
    comment: { text: string; htmlText?: string },
  ): Promise<AsanaStory> {
    if (comment.htmlText) {
      try {
        const res = await this.request<{ data: AsanaStory }>(
          'POST',
          `/tasks/${enc(taskGid)}/stories`,
          { body: { data: { html_text: comment.htmlText } } },
        );
        return res.data;
      } catch (err) {
        const rejectedHtml =
          err instanceof AsanaApiError && err.status >= 400 && err.status < 500;
        if (!rejectedHtml) throw err;
      }
    }
    const res = await this.request<{ data: AsanaStory }>(
      'POST',
      `/tasks/${enc(taskGid)}/stories`,
      { body: { data: { text: comment.text } } },
    );
    return res.data;
  }

  // ── Attachments ──────────────────────────────────────────────────────────

  async getTaskAttachments(
    taskGid: string,
    opts: ClientRequestOptions = {},
  ): Promise<AsanaAttachment[]> {
    const res = await this.request<{ data: AsanaAttachment[] }>(
      'GET',
      `/tasks/${enc(taskGid)}/attachments`,
      { query: { opt_fields: opts.optFields, limit: opts.limit, offset: opts.offset } },
    );
    return res.data;
  }

  // ── Users ────────────────────────────────────────────────────────────────

  async getUser(userGid: string, opts: ClientRequestOptions = {}): Promise<AsanaUser> {
    const res = await this.request<{ data: AsanaUser }>('GET', `/users/${enc(userGid)}`, {
      query: { opt_fields: opts.optFields },
    });
    return res.data;
  }

  // ── Sections ─────────────────────────────────────────────────────────────

  async getProjectSections(
    projectGid: string,
    opts: ClientRequestOptions = {},
  ): Promise<AsanaSection[]> {
    const res = await this.request<{ data: AsanaSection[] }>(
      'GET',
      `/projects/${enc(projectGid)}/sections`,
      { query: { opt_fields: opts.optFields, limit: opts.limit, offset: opts.offset } },
    );
    return res.data;
  }

  async listTasksInSection(
    sectionGid: string,
    opts: ClientRequestOptions & { completedSince?: string } = {},
  ): Promise<AsanaPage<AsanaTask>> {
    return this.request<AsanaPage<AsanaTask>>('GET', `/sections/${enc(sectionGid)}/tasks`, {
      query: {
        opt_fields: opts.optFields,
        limit: opts.limit,
        offset: opts.offset,
        completed_since: opts.completedSince,
      },
    });
  }

  // ── Search ───────────────────────────────────────────────────────────────

  async typeaheadSearch(
    workspaceGid: string,
    params: TypeaheadParams,
  ): Promise<AsanaTypeaheadResult[]> {
    const res = await this.request<{ data: AsanaTypeaheadResult[] }>(
      'GET',
      `/workspaces/${enc(workspaceGid)}/typeahead`,
      {
        query: {
          resource_type: params.resourceType,
          query: params.query,
          count: params.count,
          opt_fields: params.optFields,
        },
      },
    );
    return res.data;
  }

  // ── Transport ────────────────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    init: { query?: Record<string, string | number | undefined>; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
    const requestLabel = `${method} ${path}`;

    let lastError: AsanaApiError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(this.backoffDelay(attempt, lastError));
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            Accept: 'application/json',
            ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        // Network failure / timeout — retryable.
        lastError = new AsanaApiError(0, String(err), requestLabel);
        continue;
      }
      clearTimeout(timer);

      if (response.ok) {
        return (await response.json()) as T;
      }

      const bodyText = await safeText(response);
      lastError = new AsanaApiError(response.status, bodyText, requestLabel);
      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw lastError;
      }
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter) {
        lastError.retryAfterMs = Math.min(Number(retryAfter) * 1000 || 0, MAX_BACKOFF_MS);
      }
    }
    throw lastError ?? new AsanaApiError(0, 'unknown failure', requestLabel);
  }

  private backoffDelay(attempt: number, lastError?: AsanaApiError): number {
    if (lastError?.retryAfterMs) return lastError.retryAfterMs;
    const exponential = this.retryBaseDelayMs * 2 ** (attempt - 1);
    const jitter = Math.random() * this.retryBaseDelayMs;
    return Math.min(exponential + jitter, MAX_BACKOFF_MS);
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
