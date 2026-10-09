import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

export interface PackManifestInput {
  readonly name: string;
  readonly version: string;
  readonly target: string;
  readonly hash: string;
  readonly generatorVersion: string | null;
  readonly schemaLibrary: { readonly name: string; readonly version: string };
  readonly faker: { readonly version: string } | null;
}

const entryPoint = (file: string): Record<string, Record<string, string>> => ({
  import: { types: `./dist/esm/${file}.d.ts`, default: `./dist/esm/${file}.js` },
  require: { types: `./dist/cjs/${file}.d.ts`, default: `./dist/cjs/${file}.js` },
});

// Key order is fixed so identical input yields identical bytes
export const buildPackageManifest = (input: PackManifestInput): Record<string, unknown> => ({
  name: input.name,
  version: input.version,
  description: `Generated Strapi content contracts (${input.target})`,
  sideEffects: false,
  files: ['dist'],
  main: './dist/cjs/index.js',
  module: './dist/esm/index.js',
  types: './dist/cjs/index.d.ts',
  exports: {
    '.': entryPoint('index'),
    './types': entryPoint('types'),
    ...(input.faker ? { './mocks': entryPoint('mocks/index') } : {}),
    './package.json': './package.json',
  },
  peerDependencies: {
    [input.schemaLibrary.name]: `^${input.schemaLibrary.version}`,
    ...(input.faker ? { '@faker-js/faker': `^${input.faker.version}` } : {}),
  },
  ...(input.faker ? { peerDependenciesMeta: { '@faker-js/faker': { optional: true } } } : {}),
  contentSchemas: {
    hash: input.hash,
    target: input.target,
    generator: input.generatorVersion,
  },
});

// Resolves the package's entry (honouring its exports map) and walks up to
// the package.json, because many libraries do not export package.json itself
export const readInstalledVersion = (cwd: string, packageName: string): string | null => {
  const require = createRequire(path.join(cwd, 'package.json'));
  let entry: string;
  try {
    entry = require.resolve(packageName);
  } catch {
    return null;
  }
  let dir = path.dirname(entry);
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const pkg = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as {
        readonly name?: string;
        readonly version?: string;
      };
      if (pkg.name === packageName && pkg.version) return pkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};
