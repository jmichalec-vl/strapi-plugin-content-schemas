import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { defineConfig, loadConfig } from '../../../cli/src/config';

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const config = defineConfig({
      url: 'http://localhost:1337',
      output: './generated',
      target: 'valibot',
    });

    expect(config.url).toBe('http://localhost:1337');
    expect(config.output).toBe('./generated');
    expect(config.target).toBe('valibot');
  });

  it('accepts all config options', () => {
    const config = defineConfig({
      url: 'http://localhost:1337',
      output: './generated',
      target: 'valibot',
      nullableStyle: 'nullish',
      populate: true,
      client: true,
      jsdoc: true,
      prettier: true,
    });

    expect(config.jsdoc).toBe(true);
    expect(config.prettier).toBe(true);
  });

  it('accepts partial config', () => {
    const config = defineConfig({ output: './out' });
    expect(config.output).toBe('./out');
    expect(config.url).toBeUndefined();
  });
});

describe('loadConfig', () => {
  const TMP_DIR = path.join(__dirname, '.tmp-config-test');

  beforeEach(() => {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('returns null when no config file exists', async () => {
    const config = await loadConfig(TMP_DIR);
    expect(config).toBeNull();
  });

  it('loads content-schemas.config.js', async () => {
    fs.writeFileSync(
      path.join(TMP_DIR, 'content-schemas.config.js'),
      `module.exports = { url: 'http://test:1337', output: './schemas' };`,
    );

    const config = await loadConfig(TMP_DIR);
    expect(config).not.toBeNull();
    expect(config!.url).toBe('http://test:1337');
    expect(config!.output).toBe('./schemas');
  });

  it('loads content-schemas.config.mjs (ESM) via jiti', async () => {
    fs.writeFileSync(
      path.join(TMP_DIR, 'content-schemas.config.mjs'),
      `export default { url: 'http://from-mjs:1337', output: './schemas' };`,
    );

    const config = await loadConfig(TMP_DIR);
    expect(config).not.toBeNull();
    expect(config!.url).toBe('http://from-mjs:1337');
    expect(config!.output).toBe('./schemas');
  });

  it('reports the loaded file on stderr so stdout stays script-consumable', async () => {
    fs.writeFileSync(
      path.join(TMP_DIR, 'content-schemas.config.js'),
      `module.exports = { url: 'http://test:1337' };`,
    );
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});

    await loadConfig(TMP_DIR);

    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledWith('Loaded config from content-schemas.config.js');
  });

  it('prefers .ts over .js', async () => {
    fs.writeFileSync(
      path.join(TMP_DIR, 'content-schemas.config.ts'),
      `export default { url: 'http://from-ts:1337' };`,
    );
    fs.writeFileSync(
      path.join(TMP_DIR, 'content-schemas.config.js'),
      `module.exports = { url: 'http://from-js:1337' };`,
    );

    const config = await loadConfig(TMP_DIR);
    expect(config).not.toBeNull();
    expect(config!.url).toBe('http://from-ts:1337');
  });
});
