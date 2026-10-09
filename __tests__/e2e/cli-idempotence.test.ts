import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { VALIBOT_DIR, ZOD_DIR } from './helpers/generated-dir';

// Publish-pipeline contract: pulls are idempotent (an unchanged CMS produces
// zero filesystem events for the consumer's file watcher), the output hash is
// printed and recorded in the meta file, and `hash` obtains it without writing.
const STRAPI_APP_DIR = path.resolve(__dirname, 'strapi-app');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.resolve(PLUGIN_ROOT, 'dist', 'cli', 'index.js');
const TOKEN_PATH = path.resolve(STRAPI_APP_DIR, '.tmp', 'api-token.txt');
const BASE_URL = process.env.STRAPI_URL ?? 'http://127.0.0.1:1337';
const META_FILE = '.strapi-schemas-meta.json';

// Must mirror the globalSetup valibot pull exactly - different generation
// flags produce a different artifact
const VALIBOT_PULL_FLAGS = ['--target', 'valibot', '--jsdoc', '--mocks'];

let token: string;

const runCli = (args: readonly string[]): string =>
  execFileSync('node', [CLI_PATH, ...args], { cwd: STRAPI_APP_DIR, encoding: 'utf-8' });

const pullValibot = (): string =>
  runCli([
    'pull',
    '--url',
    BASE_URL,
    '--token',
    token,
    '--output',
    VALIBOT_DIR,
    ...VALIBOT_PULL_FLAGS,
    '--prettier',
  ]);

const snapshotMtimes = (dir: string): Map<string, number> => {
  const mtimes = new Map<string, number>();
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else mtimes.set(path.relative(dir, fullPath), fs.statSync(fullPath).mtimeMs);
    }
  };
  walk(dir);
  return mtimes;
};

const readMeta = (dir: string): { hash: string; target: string; files: string[] } =>
  JSON.parse(fs.readFileSync(path.join(dir, META_FILE), 'utf-8'));

beforeAll(() => {
  token = fs.readFileSync(TOKEN_PATH, 'utf-8').trim();
});

describe('pull idempotence + output hash', () => {
  it('writes a self-describing meta file on pull', () => {
    const meta = readMeta(VALIBOT_DIR);

    expect(meta.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.target).toBe('valibot');
    expect(meta.files).toContain('index.ts');
    expect(meta.files).toEqual([...meta.files].sort());
    // meta describes the generated set, not itself
    expect(meta.files).not.toContain(META_FILE);
  });

  it('re-pull against an unchanged CMS performs zero writes and preserves every mtime', () => {
    const before = snapshotMtimes(VALIBOT_DIR);

    const stdout = pullValibot();

    expect(stdout).toMatch(/Output hash: [0-9a-f]{64}/);
    expect(stdout).toContain('(0 written,');
    expect(snapshotMtimes(VALIBOT_DIR)).toEqual(before);
  }, 60_000);

  it('printed hash equals the recorded meta hash across runs', () => {
    const stdout = pullValibot();

    const printed = stdout.match(/Output hash: ([0-9a-f]{64})/)?.[1];
    expect(printed).toBe(readMeta(VALIBOT_DIR).hash);
  }, 60_000);

  it('a single drifted file is the only rewrite on the next pull', () => {
    const drifted = path.join(VALIBOT_DIR, 'content-types', 'product.ts');
    const original = fs.readFileSync(drifted, 'utf-8');
    fs.writeFileSync(drifted, `${original}\n// drift\n`);
    const before = snapshotMtimes(VALIBOT_DIR);

    const stdout = pullValibot();

    expect(stdout).toContain('(1 written,');
    expect(fs.readFileSync(drifted, 'utf-8')).toBe(original);
    const after = snapshotMtimes(VALIBOT_DIR);
    for (const [relPath, mtime] of before) {
      if (relPath === path.join('content-types', 'product.ts')) continue;
      expect(after.get(relPath), relPath).toBe(mtime);
    }
  }, 60_000);

  it('different targets record different hashes', () => {
    expect(readMeta(ZOD_DIR).target).toBe('zod');
    expect(readMeta(ZOD_DIR).hash).not.toBe(readMeta(VALIBOT_DIR).hash);
  });
});

describe('hash verb', () => {
  it('prints the artifact hash without writing, matching the pulled meta', () => {
    const before = snapshotMtimes(VALIBOT_DIR);

    const stdout = runCli(['hash', '--url', BASE_URL, '--token', token, ...VALIBOT_PULL_FLAGS]);

    // bare hash on stdout - script-consumable as-is
    expect(stdout.trim()).toBe(readMeta(VALIBOT_DIR).hash);
    expect(snapshotMtimes(VALIBOT_DIR)).toEqual(before);
  }, 60_000);

  it('keeps stdout to the bare hash when a config file is present', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'strapi-schemas-hash-'));
    fs.writeFileSync(
      path.join(cwd, 'content-schemas.config.js'),
      `module.exports = { url: ${JSON.stringify(BASE_URL)} };`,
    );

    try {
      const stdout = execFileSync(
        'node',
        [CLI_PATH, 'hash', '--token', token, ...VALIBOT_PULL_FLAGS],
        { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] },
      );

      expect(stdout.trim().split('\n')).toEqual([readMeta(VALIBOT_DIR).hash]);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }, 60_000);
});
