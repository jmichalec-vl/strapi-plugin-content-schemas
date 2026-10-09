import { describe, it, expect } from 'vitest';

import { buildPackageManifest, readInstalledVersion } from '../../../cli/src/pack-manifest';

const BASE = {
  name: '@acme/contracts',
  version: '1.2.3',
  target: 'valibot',
  hash: 'abc',
  generatorVersion: '1.0.0',
  schemaLibrary: { name: 'valibot', version: '1.4.0' },
  faker: null,
};

describe('buildPackageManifest', () => {
  it('emits dual entry points, a types-only entry, the peer range and the hash field', () => {
    const manifest = buildPackageManifest(BASE);

    expect(Object.keys(manifest)).toEqual([
      'name',
      'version',
      'description',
      'sideEffects',
      'files',
      'main',
      'module',
      'types',
      'exports',
      'peerDependencies',
      'contentSchemas',
    ]);
    expect(manifest.exports).toEqual({
      '.': {
        import: { types: './dist/esm/index.d.ts', default: './dist/esm/index.js' },
        require: { types: './dist/cjs/index.d.ts', default: './dist/cjs/index.js' },
      },
      './types': {
        import: { types: './dist/esm/types.d.ts', default: './dist/esm/types.js' },
        require: { types: './dist/cjs/types.d.ts', default: './dist/cjs/types.js' },
      },
      './package.json': './package.json',
    });
    expect(manifest.peerDependencies).toEqual({ valibot: '^1.4.0' });
    expect(manifest.contentSchemas).toEqual({ hash: 'abc', target: 'valibot', generator: '1.0.0' });
    expect(manifest.sideEffects).toBe(false);
  });

  it('adds the mocks entry and an optional faker peer when mocks were generated', () => {
    const manifest = buildPackageManifest({ ...BASE, faker: { version: '9.0.0' } });

    expect((manifest.exports as Record<string, unknown>)['./mocks']).toEqual({
      import: { types: './dist/esm/mocks/index.d.ts', default: './dist/esm/mocks/index.js' },
      require: { types: './dist/cjs/mocks/index.d.ts', default: './dist/cjs/mocks/index.js' },
    });
    expect(manifest.peerDependencies).toEqual({ valibot: '^1.4.0', '@faker-js/faker': '^9.0.0' });
    expect(manifest.peerDependenciesMeta).toEqual({ '@faker-js/faker': { optional: true } });
  });
});

describe('readInstalledVersion', () => {
  it('reads the version of a package resolvable from the directory', () => {
    expect(readInstalledVersion(process.cwd(), 'typescript')).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('returns null for a package that is not installed', () => {
    expect(readInstalledVersion(process.cwd(), 'definitely-not-installed-xyz')).toBeNull();
  });
});
