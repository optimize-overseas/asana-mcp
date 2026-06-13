import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/server/config';

const BASE_ENV = { ASANA_ACCESS_TOKEN: 'tok' } as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('requires ASANA_ACCESS_TOKEN', () => {
    expect(() => loadConfig({} as NodeJS.ProcessEnv)).toThrow(/ASANA_ACCESS_TOKEN/);
  });

  it('defaults to read_only', () => {
    const cfg = loadConfig({ ...BASE_ENV });
    expect(cfg.writeMode).toBe('read_only');
    expect(cfg.writableCustomFieldGids.size).toBe(0);
    expect(cfg.defaultWorkspaceGid).toBeUndefined();
  });

  it('parses each write mode (case/whitespace tolerant)', () => {
    expect(loadConfig({ ...BASE_ENV, ASANA_MCP_WRITE_MODE: 'read_only' }).writeMode).toBe('read_only');
    expect(loadConfig({ ...BASE_ENV, ASANA_MCP_WRITE_MODE: ' RESTRICTED ' }).writeMode).toBe('restricted');
    expect(loadConfig({ ...BASE_ENV, ASANA_MCP_WRITE_MODE: 'Full' }).writeMode).toBe('full');
  });

  it('rejects unknown write modes', () => {
    expect(() => loadConfig({ ...BASE_ENV, ASANA_MCP_WRITE_MODE: 'yolo' })).toThrow(/read_only\|restricted\|full/);
  });

  it('parses the writable custom field allowlist', () => {
    const cfg = loadConfig({
      ...BASE_ENV,
      ASANA_MCP_WRITE_MODE: 'restricted',
      ASANA_MCP_WRITABLE_CUSTOM_FIELDS: ' 1200000000000001, 1200000000000002 ,,',
    });
    expect([...cfg.writableCustomFieldGids].sort()).toEqual([
      '1200000000000001',
      '1200000000000002',
    ]);
  });

  it('reads the default workspace', () => {
    const cfg = loadConfig({ ...BASE_ENV, ASANA_MCP_DEFAULT_WORKSPACE: '1100000000000001' });
    expect(cfg.defaultWorkspaceGid).toBe('1100000000000001');
  });
});
