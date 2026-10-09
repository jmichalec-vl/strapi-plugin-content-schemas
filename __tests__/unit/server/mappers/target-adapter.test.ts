import { describe, it, expect } from 'vitest';

import '../../../../server/src/mappers/valibot/index';
import '../../../../server/src/mappers/zod/index';
import { getAdapter, getAvailableTargets } from '../../../../server/src/mappers/target-adapter';

describe('getAdapter', () => {
  it('returns valibot adapter', () => {
    const adapter = getAdapter('valibot');

    expect(adapter.UPLOAD_FILE_IMPORT).toContain('valibot');
    expect(adapter.REGISTRY_CODE).toContain('lazy');
  });

  it('returns zod adapter', () => {
    const adapter = getAdapter('zod');

    expect(adapter.UPLOAD_FILE_IMPORT).toContain('zod');
    expect(adapter.REGISTRY_CODE).toContain('z.lazy');
  });

  it('throws for unknown target', () => {
    expect(() => getAdapter('unknown' as 'valibot')).toThrow('Unknown target: "unknown"');
  });
});

describe('getAvailableTargets', () => {
  it('returns both registered targets', () => {
    const targets = getAvailableTargets();

    expect(targets).toContain('valibot');
    expect(targets).toContain('zod');
  });
});

describe('adapter contract', () => {
  it.each(['valibot', 'zod'] as const)('%s adapter has all required fields', (target) => {
    const adapter = getAdapter(target);

    expect(adapter.UPLOAD_FILE_IMPORT).toBeTruthy();
    expect(adapter.UPLOAD_FILE_SCHEMA_CODE).toContain('UploadFileSchema');
    expect(adapter.REGISTRY_CODE).toContain('register');
    expect(adapter.REGISTRY_CODE).toContain('ref');
    expect(typeof adapter.arrayWrap).toBe('function');
    expect(adapter.validationImport).toBeTruthy();
    expect(adapter.validationCode).toBeTruthy();
    expect(typeof adapter.mapContentTypeSchema).toBe('function');
    expect(typeof adapter.mapComponentSchema).toBe('function');
    expect(typeof adapter.buildOverridesFileContent).toBe('function');
  });

  it.each(['valibot', 'zod'] as const)('%s arrayWrap wraps correctly', (target) => {
    const adapter = getAdapter(target);
    const result = adapter.arrayWrap('MySchema');

    expect(result).toContain('MySchema');
    expect(result).toContain('array');
  });
});
