import { describe, expect, it, vi } from 'vitest';
import { AsanaClient } from '../src/client/client';
import { AsanaApiError } from '../src/client/errors';

/** Build a client whose fetch is a vi.fn returning the queued responses. */
function mockClient(responses: Array<() => Response | Promise<Response>>, opts: Partial<ConstructorParameters<typeof AsanaClient>[0]> = {}) {
  const fetchImpl = vi.fn();
  for (const r of responses) fetchImpl.mockImplementationOnce(r);
  const client = new AsanaClient({
    accessToken: 'test-token',
    fetchImpl: fetchImpl as unknown as typeof fetch,
    retryBaseDelayMs: 1,
    timeoutMs: 5_000,
    ...opts,
  });
  return { client, fetchImpl };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('constructor', () => {
  it('requires an access token', () => {
    expect(() => new AsanaClient({ accessToken: '' })).toThrow(/accessToken/);
  });

  it('strips trailing slashes from baseUrl', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: '1' } })], {
      baseUrl: 'https://example.test/api/1.0///',
    });
    await client.getTask('1');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.test/api/1.0/tasks/1');
  });
});

describe('request shapes', () => {
  it('getTask sends GET with bearer auth and opt_fields', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: '42', name: 'T' } })]);
    const task = await client.getTask('42', { optFields: 'name,notes' });
    expect(task).toEqual({ gid: '42', name: 'T' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://app.asana.com/api/1.0/tasks/42?opt_fields=name%2Cnotes');
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer test-token');
    expect(init.body).toBeUndefined();
  });

  it('URL-encodes path segments', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: 'a/b' } })]);
    await client.getTask('a/b');
    expect(fetchImpl.mock.calls[0][0]).toContain('/tasks/a%2Fb');
  });

  it('listTasks maps camelCase params to Asana query params and omits empties', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: [] })]);
    await client.listTasks({
      workspace: 'w1',
      assignee: 'u1',
      completedSince: 'now',
      limit: 50,
    });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/1.0/tasks');
    expect(url.searchParams.get('workspace')).toBe('w1');
    expect(url.searchParams.get('assignee')).toBe('u1');
    expect(url.searchParams.get('completed_since')).toBe('now');
    expect(url.searchParams.get('limit')).toBe('50');
    expect(url.searchParams.has('project')).toBe(false);
    expect(url.searchParams.has('opt_fields')).toBe(false);
  });

  it('updateTask sends PUT with a {data} envelope', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: '7' } })]);
    await client.updateTask('7', { assignee: 'u9', custom_fields: { f1: 'v' } });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://app.asana.com/api/1.0/tasks/7');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ data: { assignee: 'u9', custom_fields: { f1: 'v' } } });
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('setAssignee(null) sends assignee null (unassign)', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: '7' } })]);
    await client.setAssignee('7', null);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ data: { assignee: null } });
  });

  it('createTask sends POST /tasks', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: 'n1' } })]);
    await client.createTask({ name: 'New', workspace: 'w1' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://app.asana.com/api/1.0/tasks');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).data.name).toBe('New');
  });

  it('getTaskStories / getStory / getTaskAttachments / getUser / sections hit the right paths', async () => {
    const { client, fetchImpl } = mockClient([
      () => json({ data: [] }),
      () => json({ data: { gid: 's1' } }),
      () => json({ data: [] }),
      () => json({ data: { gid: 'u1' } }),
      () => json({ data: [] }),
      () => json({ data: [] }),
    ]);
    await client.getTaskStories('t1');
    await client.getStory('s1');
    await client.getTaskAttachments('t1');
    await client.getUser('u1');
    await client.getProjectSections('p1');
    await client.listTasksInSection('sec1');
    const paths = fetchImpl.mock.calls.map(c => new URL(c[0]).pathname);
    expect(paths).toEqual([
      '/api/1.0/tasks/t1/stories',
      '/api/1.0/stories/s1',
      '/api/1.0/tasks/t1/attachments',
      '/api/1.0/users/u1',
      '/api/1.0/projects/p1/sections',
      '/api/1.0/sections/sec1/tasks',
    ]);
  });

  it('typeaheadSearch hits the workspace typeahead endpoint', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: [] })]);
    await client.typeaheadSearch('w1', { resourceType: 'task', query: 'hello', count: 5 });
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/1.0/workspaces/w1/typeahead');
    expect(url.searchParams.get('resource_type')).toBe('task');
    expect(url.searchParams.get('query')).toBe('hello');
    expect(url.searchParams.get('count')).toBe('5');
  });
});

describe('addComment html fallback', () => {
  it('tries html_text first and returns on success', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: 's1' } })]);
    await client.addComment('t1', { text: 'plain', htmlText: '<body>rich</body>' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      data: { html_text: '<body>rich</body>' },
    });
  });

  it('falls back to plain text when html_text is rejected with 4xx', async () => {
    const { client, fetchImpl } = mockClient([
      () => json({ errors: [{ message: 'bad html' }] }, 400),
      () => json({ data: { gid: 's2' } }),
    ]);
    const story = await client.addComment('t1', { text: 'plain', htmlText: '<bad>' });
    expect(story.gid).toBe('s2');
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({ data: { text: 'plain' } });
  });

  it('does not fall back on 5xx (throws after retries)', async () => {
    const { client } = mockClient([
      () => json({}, 500),
      () => json({}, 500),
      () => json({}, 500),
      () => json({}, 500),
    ]);
    await expect(client.addComment('t1', { text: 'p', htmlText: '<h>' })).rejects.toThrow(
      AsanaApiError,
    );
  });

  it('sends plain text directly when no htmlText given', async () => {
    const { client, fetchImpl } = mockClient([() => json({ data: { gid: 's3' } })]);
    await client.addComment('t1', { text: 'only plain' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ data: { text: 'only plain' } });
  });
});

describe('retry behavior', () => {
  it('retries 429 honoring Retry-After and succeeds', async () => {
    const { client, fetchImpl } = mockClient([
      () => json({}, 429, { 'Retry-After': '0' }),
      () => json({ data: { gid: '1' } }),
    ]);
    const task = await client.getTask('1');
    expect(task.gid).toBe('1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('retries 503 and network errors, then succeeds', async () => {
    const { client, fetchImpl } = mockClient([
      () => json({}, 503),
      () => {
        throw new TypeError('fetch failed');
      },
      () => json({ data: { gid: '1' } }),
    ]);
    const task = await client.getTask('1');
    expect(task.gid).toBe('1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    const { client, fetchImpl } = mockClient(
      [() => json({}, 502), () => json({}, 502)],
      { maxRetries: 1 },
    );
    await expect(client.getTask('1')).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry non-retryable 4xx', async () => {
    const { client, fetchImpl } = mockClient([() => json({ errors: [] }, 404)]);
    await expect(client.getTask('missing')).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('exposes status/body/request on AsanaApiError', async () => {
    const { client } = mockClient([() => json({ errors: [{ message: 'no' }] }, 403)]);
    try {
      await client.getTask('1');
      expect.unreachable();
    } catch (err) {
      const e = err as AsanaApiError;
      expect(e).toBeInstanceOf(AsanaApiError);
      expect(e.status).toBe(403);
      expect(e.body).toContain('no');
      expect(e.request).toBe('GET /tasks/1');
    }
  });
});

describe('pagination', () => {
  it('iterateTasks follows next_page offsets', async () => {
    const { client, fetchImpl } = mockClient([
      () =>
        json({
          data: [{ gid: '1' }, { gid: '2' }],
          next_page: { offset: 'off2', path: '/x', uri: 'u' },
        }),
      () => json({ data: [{ gid: '3' }], next_page: null }),
    ]);
    const gids: string[] = [];
    for await (const t of client.iterateTasks({ project: 'p1', limit: 2 })) gids.push(t.gid);
    expect(gids).toEqual(['1', '2', '3']);
    const second = new URL(fetchImpl.mock.calls[1][0]);
    expect(second.searchParams.get('offset')).toBe('off2');
  });
});
