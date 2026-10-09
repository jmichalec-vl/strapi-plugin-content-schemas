import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import ts from 'typescript';

// The spec's gate for pack: the package installs into a scratch consumer, a
// types-only import pulls no runtime code, both resolution modes type-check,
// both formats load in Node, and the embedded hash equals the CMS-side hash.
const STRAPI_APP_DIR = path.resolve(__dirname, 'strapi-app');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.resolve(PLUGIN_ROOT, 'dist', 'cli', 'index.js');
const TOKEN_PATH = path.resolve(STRAPI_APP_DIR, '.tmp', 'api-token.txt');
const BASE_URL = process.env.STRAPI_URL ?? 'http://127.0.0.1:1337';

// Inside the fixture app so valibot and typescript resolve from its node_modules
const WORK_DIR = path.resolve(STRAPI_APP_DIR, '.tmp', 'pack');
const OUT_DIR = path.join(WORK_DIR, 'contracts');
const CONSUMER_DIR = path.join(WORK_DIR, 'consumer');
const PACKAGE_NAME = '@fixture/contracts';
// The fixture app has no faker, so the packed output excludes mocks
const GENERATION_FLAGS = ['--target', 'valibot', '--jsdoc'];

let token: string;
let manifest: { contentSchemas: { hash: string }; peerDependencies: Record<string, string> };

const runCli = (args: readonly string[], cwd = STRAPI_APP_DIR): string =>
  execFileSync('node', [CLI_PATH, ...args], { cwd, encoding: 'utf-8' });

const typeCheck = (file: string, options: ts.CompilerOptions): readonly string[] => {
  const program = ts.createProgram([file], {
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'],
    types: [],
    ...options,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
};

beforeAll(() => {
  token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  fs.mkdirSync(CONSUMER_DIR, { recursive: true });

  runCli([
    'pack',
    '--url',
    BASE_URL,
    '--token',
    token,
    '--name',
    PACKAGE_NAME,
    '--version',
    '0.0.1',
    '--out',
    OUT_DIR,
    ...GENERATION_FLAGS,
  ]);
  manifest = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'package.json'), 'utf-8'));

  // Install the tarball exactly as a consumer would (peers come from the app)
  fs.writeFileSync(
    path.join(CONSUMER_DIR, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, version: '0.0.0' }),
  );
  const tarball = execFileSync('npm', ['pack', OUT_DIR, '--json'], {
    cwd: CONSUMER_DIR,
    encoding: 'utf-8',
  });
  const [{ filename }] = JSON.parse(tarball) as [{ filename: string }];
  execFileSync(
    'npm',
    [
      'install',
      `./${filename}`,
      '--no-save',
      '--legacy-peer-deps',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ],
    { cwd: CONSUMER_DIR, stdio: 'ignore' },
  );
}, 180_000);

afterAll(() => {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
});

describe('pack', () => {
  it('embeds the same hash the hash verb reports for the same CMS state', () => {
    const reported = runCli(['hash', '--url', BASE_URL, '--token', token, ...GENERATION_FLAGS]);

    expect(manifest.contentSchemas.hash).toBe(reported.trim());
    expect(manifest.peerDependencies.valibot).toMatch(/^\^1\./);
  });

  it('exposes a types-only entry whose runtime module is empty', () => {
    const typesJs = fs.readFileSync(
      path.join(CONSUMER_DIR, 'node_modules', PACKAGE_NAME, 'dist/esm/types.js'),
      'utf-8',
    );
    expect(typesJs.trim()).toBe('export {};');
  });

  it('type-checks a types-only and a runtime import under bundler resolution', () => {
    const file = path.join(CONSUMER_DIR, 'bundler.ts');
    fs.writeFileSync(
      file,
      [
        `import type { Article } from '${PACKAGE_NAME}/types';`,
        `import { ArticleSchema } from '${PACKAGE_NAME}';`,
        'export const article: Article | null = null;',
        'export const schema = ArticleSchema;',
      ].join('\n'),
    );

    expect(
      typeCheck(file, {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      }),
    ).toEqual([]);
  });

  it('type-checks ESM and CJS consumers under node16 resolution', () => {
    const esm = path.join(CONSUMER_DIR, 'node16.mts');
    const cjs = path.join(CONSUMER_DIR, 'node16.cts');
    const body = [
      `import type { Article } from '${PACKAGE_NAME}/types';`,
      `import { ArticleSchema } from '${PACKAGE_NAME}';`,
      'export const article: Article | null = null;',
      'export const schema = ArticleSchema;',
    ].join('\n');
    fs.writeFileSync(esm, body);
    fs.writeFileSync(cjs, body);

    const options = {
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    };
    expect(typeCheck(esm, options)).toEqual([]);
    expect(typeCheck(cjs, options)).toEqual([]);
  });

  it('loads in Node as ESM and as CJS', () => {
    const esm = execFileSync(
      'node',
      [
        '--input-type=module',
        '-e',
        `import { ArticleSchema } from '${PACKAGE_NAME}'; import * as types from '${PACKAGE_NAME}/types'; console.log(typeof ArticleSchema, Object.keys(types).length);`,
      ],
      { cwd: CONSUMER_DIR, encoding: 'utf-8' },
    );
    expect(esm.trim()).toBe('object 0');

    const cjs = execFileSync(
      'node',
      ['-e', `const m = require('${PACKAGE_NAME}'); console.log(typeof m.ArticleSchema);`],
      { cwd: CONSUMER_DIR, encoding: 'utf-8' },
    );
    expect(cjs.trim()).toBe('object');
  });
});
