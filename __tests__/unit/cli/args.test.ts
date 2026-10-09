import { describe, it, expect } from 'vitest';

import {
  parseRawArgs,
  mergeWithConfig,
  buildQueryString,
  isInsecureRemoteUrl,
  ArgError,
} from '../../../cli/src/args';

const COMMON_FLAGS = ['--url', 'http://localhost:1337', '--token', 'abc', '--output', './out'];

describe('parseRawArgs', () => {
  const REQUIRED_FLAGS = ['--url', 'http://localhost:1337', '--token', 'abc', '--output', './out'];

  it('parses pull command', () => {
    const result = parseRawArgs(['pull', ...REQUIRED_FLAGS]);
    expect(result.command).toBe('pull');
    expect(result.url).toBe('http://localhost:1337');
    expect(result.token).toBe('abc');
    expect(result.output).toBe('./out');
  });

  it('parses check command', () => {
    const result = parseRawArgs(['check', ...REQUIRED_FLAGS]);
    expect(result.command).toBe('check');
  });

  it('parses hash command', () => {
    const result = parseRawArgs(['hash', '--url', 'http://localhost:1337', '--token', 'abc']);
    expect(result.command).toBe('hash');
  });

  it('returns undefined for missing optional flags', () => {
    const result = parseRawArgs(['pull', '--token', 'abc']);
    expect(result.url).toBeUndefined();
    expect(result.output).toBeUndefined();
    expect(result.target).toBeUndefined();
    expect(result.nullableStyle).toBeUndefined();
  });

  it.each([
    { flag: '--target', value: 'valibot', key: 'target' },
    { flag: '--nullable-style', value: 'optional-union-null', key: 'nullableStyle' },
    { flag: '--watch-interval', value: '5000', key: 'watchInterval' },
  ])('parses $flag with value', ({ flag, value, key }) => {
    const result = parseRawArgs(['pull', ...REQUIRED_FLAGS, flag, value]);
    expect(result[key as keyof typeof result]).toBe(value);
  });

  it.each([
    { flag: '--no-populate', key: 'noPopulate' },
    { flag: '--no-client', key: 'noClient' },
    { flag: '--jsdoc', key: 'jsdoc' },
    { flag: '--prettier', key: 'prettier' },
    { flag: '--watch', key: 'watch' },
  ])('parses $flag boolean flag', ({ flag, key }) => {
    const result = parseRawArgs(['pull', ...REQUIRED_FLAGS, flag]);
    expect(result[key as keyof typeof result]).toBe(true);
  });

  it.each(['prettier', 'watch', 'jsdoc'] as const)('defaults %s to false', (key) => {
    const result = parseRawArgs(['pull', ...REQUIRED_FLAGS]);
    expect(result[key]).toBe(false);
  });

  it('accepts --flag=value for value flags', () => {
    const result = parseRawArgs(['pull', '--url=http://x:1337', '--token=abc', '--output=./o']);

    expect(result.url).toBe('http://x:1337');
    expect(result.token).toBe('abc');
    expect(result.output).toBe('./o');
  });

  it('keeps = characters inside the value', () => {
    const result = parseRawArgs(['hash', '--url', 'http://x', '--token=a=b=c']);

    expect(result.token).toBe('a=b=c');
  });

  it('rejects a flag given twice instead of silently picking one', () => {
    expect(() => parseRawArgs(['pull', ...REQUIRED_FLAGS, '--url', 'http://other'])).toThrow(
      /--url given more than once/,
    );
  });

  it('rejects stray positional arguments', () => {
    expect(() => parseRawArgs(['pull', ...REQUIRED_FLAGS, 'extra'])).toThrow(
      /Unexpected argument: extra/,
    );
  });

  it('parses negated toggles', () => {
    const result = parseRawArgs([
      'pull',
      ...REQUIRED_FLAGS,
      '--no-jsdoc',
      '--no-mocks',
      '--no-prettier',
    ]);

    expect(result.noJsdoc).toBe(true);
    expect(result.noMocks).toBe(true);
    expect(result.noPrettier).toBe(true);
  });

  it('rejects a toggle combined with its negation', () => {
    expect(() => parseRawArgs(['pull', ...REQUIRED_FLAGS, '--jsdoc', '--no-jsdoc'])).toThrow(
      /--jsdoc and --no-jsdoc cannot be combined/,
    );
  });

  it('marks help errors by kind', () => {
    expect(() => parseRawArgs(['pull', '-h'])).toThrow(expect.objectContaining({ kind: 'help' }));
  });

  it('parses the pack command with its own value flags', () => {
    const result = parseRawArgs([
      'pack',
      '--url',
      'http://x',
      '--token',
      't',
      '--name',
      '@acme/contracts',
      '--version',
      '1.2.3',
      '--out',
      './dist-contracts',
      '--from',
      './generated',
    ]);

    expect(result.command).toBe('pack');
    expect(result.name).toBe('@acme/contracts');
    expect(result.version).toBe('1.2.3');
    expect(result.out).toBe('./dist-contracts');
    expect(result.from).toBe('./generated');
  });

  it('throws ArgError for unknown command', () => {
    expect(() => parseRawArgs(['unknown'])).toThrow(ArgError);
    expect(() => parseRawArgs(['unknown'])).toThrow('Unknown command: unknown');
  });

  it('throws ArgError for empty args (help)', () => {
    expect(() => parseRawArgs([])).toThrow(expect.objectContaining({ kind: 'help' }));
  });

  it('throws ArgError for --help flag', () => {
    expect(() => parseRawArgs(['--help'])).toThrow(expect.objectContaining({ kind: 'help' }));
  });

  it('throws ArgError naming an unknown flag', () => {
    expect(() => parseRawArgs(['pull', ...REQUIRED_FLAGS, '--prettire'])).toThrow(ArgError);
    expect(() => parseRawArgs(['pull', ...REQUIRED_FLAGS, '--prettire'])).toThrow(
      'Unknown flag: --prettire',
    );
  });

  it('throws ArgError for an unknown value-style flag', () => {
    expect(() => parseRawArgs(['check', '--tokn', 'abc'])).toThrow('Unknown flag: --tokn');
  });

  it('treats --help after the command as help', () => {
    expect(() => parseRawArgs(['pull', '--help'])).toThrow(
      expect.objectContaining({ kind: 'help' }),
    );
  });
});

describe('mergeWithConfig', () => {
  const BASE_RAW = {
    command: 'pull' as const,
    url: 'http://localhost:1337',
    token: 'abc',
    output: './out',
    noPopulate: false,
    noClient: false,
    jsdoc: false,
    mocks: false,
    prettier: false,
    noJsdoc: false,
    noMocks: false,
    noPrettier: false,
    watch: false,
    watchInterval: undefined,
  };

  it('uses CLI values when no config', () => {
    const result = mergeWithConfig(BASE_RAW, null);

    expect(result.url).toBe('http://localhost:1337');
    expect(result.token).toBe('abc');
    expect(result.output).toBe('./out');
    expect(result.target).toBe('valibot');
    expect(result.nullableStyle).toBe('nullish');
    expect(result.populate).toBe(true);
    expect(result.client).toBe(true);
    expect(result.jsdoc).toBe(false);
  });

  it('falls back to config for url and output', () => {
    const raw = { ...BASE_RAW, url: undefined, output: undefined };
    const config = { url: 'http://strapi:1337', output: './generated' };

    const result = mergeWithConfig(raw, config);
    expect(result.url).toBe('http://strapi:1337');
    expect(result.output).toBe('./generated');
  });

  it('CLI flags override config values', () => {
    const raw = { ...BASE_RAW, target: 'valibot', nullableStyle: 'optional-union-null' };
    const config = { url: 'http://other', target: 'zod', nullableStyle: 'nullish' };

    const result = mergeWithConfig(raw, config);
    expect(result.target).toBe('valibot');
    expect(result.nullableStyle).toBe('optional-union-null');
  });

  it('--no-populate overrides config populate=true', () => {
    const raw = { ...BASE_RAW, noPopulate: true };
    const config = { populate: true };

    const result = mergeWithConfig(raw, config);
    expect(result.populate).toBe(false);
  });

  it('config populate=false used when no CLI flag', () => {
    const config = { populate: false };
    const result = mergeWithConfig(BASE_RAW, config);
    expect(result.populate).toBe(false);
  });

  it('--jsdoc CLI flag overrides config jsdoc=false', () => {
    const raw = { ...BASE_RAW, jsdoc: true };
    const config = { jsdoc: false };

    const result = mergeWithConfig(raw, config);
    expect(result.jsdoc).toBe(true);
  });

  it('config jsdoc=true used when no CLI flag', () => {
    const config = { jsdoc: true };
    const result = mergeWithConfig(BASE_RAW, config);
    expect(result.jsdoc).toBe(true);
  });

  it('--prettier CLI flag enables prettier', () => {
    const raw = { ...BASE_RAW, prettier: true };
    const result = mergeWithConfig(raw, null);
    expect(result.prettier).toBe(true);
  });

  it('config prettier=true used when no CLI flag', () => {
    const config = { prettier: true };
    const result = mergeWithConfig(BASE_RAW, config);
    expect(result.prettier).toBe(true);
  });

  it('--no-jsdoc overrides config jsdoc=true', () => {
    const raw = parseRawArgs(['pull', ...COMMON_FLAGS, '--no-jsdoc']);
    const result = mergeWithConfig(raw, { jsdoc: true, prettier: true, mocks: true });

    expect(result.jsdoc).toBe(false);
    expect(result.prettier).toBe(true);
  });

  it('--no-prettier and --no-mocks override config', () => {
    const raw = parseRawArgs(['pull', ...COMMON_FLAGS, '--no-prettier', '--no-mocks']);
    const result = mergeWithConfig(raw, { prettier: true, mocks: true });

    expect(result.prettier).toBe(false);
    expect(result.mocks).toBe(false);
  });

  it('falls back to the STRAPI_SCHEMAS_TOKEN environment variable', () => {
    const raw = parseRawArgs(['pull', '--url', 'http://x', '--output', './o']);
    const result = mergeWithConfig(raw, null, { STRAPI_SCHEMAS_TOKEN: 'from-env' });

    expect(result.token).toBe('from-env');
  });

  it('prefers --token over the environment variable', () => {
    const raw = parseRawArgs(['pull', ...COMMON_FLAGS]);
    const result = mergeWithConfig(raw, null, { STRAPI_SCHEMAS_TOKEN: 'from-env' });

    expect(result.token).toBe('abc');
  });

  it('requires name, version and out for pack but not output', () => {
    const base = ['pack', '--url', 'http://x', '--token', 't'];
    expect(() => mergeWithConfig(parseRawArgs(base), null)).toThrow(/--name/);
    expect(() =>
      mergeWithConfig(parseRawArgs([...base, '--name', 'a', '--version', '1.0.0']), null),
    ).toThrow(/--out/);

    const args = mergeWithConfig(
      parseRawArgs([...base, '--name', 'a', '--version', '1.0.0', '--out', './o']),
      null,
    );
    expect(args.pack).toEqual({ name: 'a', version: '1.0.0', out: './o', from: undefined });
    expect(args.output).toBe('');
  });

  it('throws when url is missing from both CLI and config', () => {
    const raw = { ...BASE_RAW, url: undefined };
    expect(() => mergeWithConfig(raw, null)).toThrow('Missing required: --url');
  });

  it('throws when token is missing', () => {
    const raw = { ...BASE_RAW, token: undefined };
    expect(() => mergeWithConfig(raw, null)).toThrow('Missing required: --token');
  });

  it('throws when output is missing from both CLI and config', () => {
    const raw = { ...BASE_RAW, output: undefined };
    expect(() => mergeWithConfig(raw, null)).toThrow('Missing required: --output');
  });

  it('does not require output for the hash command', () => {
    const raw = { ...BASE_RAW, command: 'hash' as const, output: undefined };
    const result = mergeWithConfig(raw, null);
    expect(result.command).toBe('hash');
    expect(result.output).toBe('');
  });

  it('throws for a non-numeric watch interval', () => {
    const raw = { ...BASE_RAW, watchInterval: 'abc' };
    expect(() => mergeWithConfig(raw, null)).toThrow('Invalid --watch-interval');
  });

  it('throws for a non-positive watch interval', () => {
    const raw = { ...BASE_RAW, watchInterval: '0' };
    expect(() => mergeWithConfig(raw, null)).toThrow('Invalid --watch-interval');
  });
});

describe('parseRawArgs flag values', () => {
  it('throws when a value flag is followed by another flag', () => {
    expect(() => parseRawArgs(['pull', '--url', '--token', 'abc'])).toThrow(
      'Missing value for --url',
    );
  });

  it('throws when a value flag is the last token', () => {
    expect(() => parseRawArgs(['pull', '--token', 'abc', '--url'])).toThrow(
      'Missing value for --url',
    );
  });
});

describe('buildQueryString', () => {
  const BASE_ARGS = {
    command: 'pull' as const,
    url: 'http://localhost:1337',
    token: 'abc',
    output: './out',
    target: 'valibot',
    nullableStyle: 'nullish',
    populate: true,
    client: true,
    jsdoc: false,
    mocks: false,
    prettier: false,
    watch: false,
    watchInterval: 3000,
  };

  it('includes target and nullableStyle', () => {
    const query = buildQueryString(BASE_ARGS);
    expect(query).toContain('target=valibot');
    expect(query).toContain('nullableStyle=nullish');
  });

  it('does not include populate=false when populate is true', () => {
    const query = buildQueryString(BASE_ARGS);
    expect(query).not.toContain('populate=false');
  });

  it('includes populate=false when disabled', () => {
    const query = buildQueryString({ ...BASE_ARGS, populate: false });
    expect(query).toContain('populate=false');
  });

  it('includes client=false when disabled', () => {
    const query = buildQueryString({ ...BASE_ARGS, client: false });
    expect(query).toContain('client=false');
  });

  it('includes jsdoc=true when enabled', () => {
    const query = buildQueryString({ ...BASE_ARGS, jsdoc: true });
    expect(query).toContain('jsdoc=true');
  });

  it('does not include jsdoc when disabled', () => {
    const query = buildQueryString(BASE_ARGS);
    expect(query).not.toContain('jsdoc');
  });
});

describe('isInsecureRemoteUrl', () => {
  it.each([
    ['http://cms.example.com', true],
    ['http://localhost:1337', false],
    ['http://127.0.0.1:1337', false],
    ['https://cms.example.com', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isInsecureRemoteUrl(url)).toBe(expected);
  });
});
