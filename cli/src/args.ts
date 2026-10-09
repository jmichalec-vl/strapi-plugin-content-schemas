import type { CliConfig } from './config';
import {
  DEFAULT_WATCH_INTERVAL_MS,
  EXIT_CODE_ERROR,
  EXIT_CODE_STALE,
  TOKEN_ENV_VAR,
} from './constants';

export type CliCommand = 'pull' | 'check' | 'hash' | 'pack';

export interface PackArgs {
  readonly name: string;
  readonly version: string;
  readonly out: string;
  readonly from: string | undefined;
}

export interface CliArgs {
  readonly command: CliCommand;
  // Present for the pack command only
  readonly pack?: PackArgs;
  readonly url: string;
  readonly token: string;
  readonly output: string;
  readonly target: string;
  readonly nullableStyle: string;
  readonly populate: boolean;
  readonly client: boolean;
  readonly jsdoc: boolean;
  readonly mocks: boolean;
  readonly prettier: boolean;
  readonly watch: boolean;
  readonly watchInterval: number;
}

export const USAGE = `
Usage: strapi-schemas <command> [options]

Commands:
  pull    Pull schemas from a Strapi instance
  check   Check if committed schemas are up to date
  hash    Print the output hash for the current CMS state (writes nothing)
  pack    Build an installable package directory from the generated output

Required (or set in content-schemas.config.ts):
  --url <url>              Strapi instance URL (e.g., http://localhost:1337)
  --token <token>          API token (or set ${TOKEN_ENV_VAR})
  --output <dir>           Output directory for generated schemas (pull, check)

pack options:
  --name <pkg>             Package name, e.g. @scope/cms-contracts
  --version <semver>       Package version (decided by your CI, never derived)
  --out <dir>              Package directory to write (emptied first)
  --from <dir>             Reuse a directory written by pull instead of pulling

Generation options:
  --target <target>        Schema target: valibot | zod (default: valibot)
  --nullable-style <style> nullish | optional-union-null (default: nullish)
  --no-populate            Disable populate generation
  --no-client              Disable client generation
  --jsdoc / --no-jsdoc     JSDoc comments on generated interfaces
  --mocks / --no-mocks     Faker.js mock factory functions
  --prettier / --no-prettier
                           Format output with the project's prettier
  --watch                  Watch for schema changes and re-pull
  --watch-interval <ms>    Polling interval in ms (default: ${DEFAULT_WATCH_INTERVAL_MS})

Flags may also be written as --flag=value. Flags win over config-file values.

Exit codes:
  0  success / schemas up to date
  ${EXIT_CODE_STALE}  check: committed schemas are stale
  ${EXIT_CODE_ERROR}  the command itself failed

Examples:
  strapi-schemas pull --url http://localhost:1337 --token $STRAPI_TOKEN --output ./lib/strapi/generated
  strapi-schemas pull --token $STRAPI_TOKEN
  strapi-schemas check --token $STRAPI_TOKEN
  strapi-schemas pack --token $STRAPI_TOKEN --name @scope/cms-contracts --version 1.4.0 --out ./dist-contracts
`.trim();

export type ArgErrorKind = 'help' | 'usage';

export class ArgError extends Error {
  readonly kind: ArgErrorKind;

  constructor(message: string, kind: ArgErrorKind = 'usage') {
    super(message);
    this.name = 'ArgError';
    this.kind = kind;
  }
}

interface RawArgs {
  readonly command: CliCommand;
  readonly url?: string;
  readonly token?: string;
  readonly output?: string;
  readonly target?: string;
  readonly nullableStyle?: string;
  readonly noPopulate: boolean;
  readonly noClient: boolean;
  readonly jsdoc: boolean;
  readonly noJsdoc: boolean;
  readonly mocks: boolean;
  readonly noMocks: boolean;
  readonly prettier: boolean;
  readonly noPrettier: boolean;
  readonly watch: boolean;
  readonly watchInterval?: string;
  readonly name?: string;
  readonly version?: string;
  readonly out?: string;
  readonly from?: string;
}

const COMMANDS: ReadonlySet<string> = new Set(['pull', 'check', 'hash', 'pack']);
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  'url',
  'token',
  'output',
  'target',
  'nullable-style',
  'watch-interval',
  'name',
  'version',
  'out',
  'from',
]);
const BOOLEAN_FLAGS: ReadonlySet<string> = new Set([
  'no-populate',
  'no-client',
  'jsdoc',
  'no-jsdoc',
  'mocks',
  'no-mocks',
  'prettier',
  'no-prettier',
  'watch',
]);
const HELP_TOKENS: ReadonlySet<string> = new Set(['--help', '-h']);
// A boolean flag and its negation on the same command line have no sane winner
const CONFLICTING_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['jsdoc', 'no-jsdoc'],
  ['mocks', 'no-mocks'],
  ['prettier', 'no-prettier'],
];

const isCommand = (token: string): token is CliCommand => COMMANDS.has(token);

// `--flag=value` is split into two tokens so the rest of the parser only ever
// sees the `--flag value` form
const splitInlineValues = (tokens: readonly string[]): readonly string[] =>
  tokens.flatMap((token) => {
    if (!token.startsWith('--')) return [token];
    const separator = token.indexOf('=');
    return separator === -1 ? [token] : [token.slice(0, separator), token.slice(separator + 1)];
  });

interface ParsedFlags {
  readonly values: ReadonlyMap<string, string>;
  readonly booleans: ReadonlySet<string>;
}

// One strict pass: every token is a known flag, a value owned by the flag
// before it, or an error. Duplicates and stray positionals are rejected
// because silently picking one reading would hide a mistake in a script.
const parseFlags = (tokens: readonly string[]): ParsedFlags => {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (HELP_TOKENS.has(token)) throw new ArgError('Help requested', 'help');
    if (!token.startsWith('--')) throw new ArgError(`Unexpected argument: ${token}`);

    const name = token.slice(2);
    if (VALUE_FLAGS.has(name)) {
      if (values.has(name)) throw new ArgError(`Flag --${name} given more than once`);
      const value = tokens[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new ArgError(`Missing value for --${name}`);
      }
      values.set(name, value);
      index += 2;
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) {
      if (booleans.has(name)) throw new ArgError(`Flag --${name} given more than once`);
      booleans.add(name);
      index += 1;
      continue;
    }
    throw new ArgError(`Unknown flag: ${token}`);
  }

  for (const [flag, negation] of CONFLICTING_PAIRS) {
    if (booleans.has(flag) && booleans.has(negation)) {
      throw new ArgError(`--${flag} and --${negation} cannot be combined`);
    }
  }

  return { values, booleans };
};

export const parseRawArgs = (args: readonly string[]): RawArgs => {
  const command = args[0];

  if (!command || HELP_TOKENS.has(command)) throw new ArgError('Help requested', 'help');
  if (!isCommand(command)) throw new ArgError(`Unknown command: ${command}`);

  const { values, booleans } = parseFlags(splitInlineValues(args.slice(1)));

  return {
    command,
    url: values.get('url'),
    token: values.get('token'),
    output: values.get('output'),
    target: values.get('target'),
    nullableStyle: values.get('nullable-style'),
    noPopulate: booleans.has('no-populate'),
    noClient: booleans.has('no-client'),
    jsdoc: booleans.has('jsdoc'),
    noJsdoc: booleans.has('no-jsdoc'),
    mocks: booleans.has('mocks'),
    noMocks: booleans.has('no-mocks'),
    prettier: booleans.has('prettier'),
    noPrettier: booleans.has('no-prettier'),
    watch: booleans.has('watch'),
    watchInterval: values.get('watch-interval'),
    name: values.get('name'),
    version: values.get('version'),
    out: values.get('out'),
    from: values.get('from'),
  };
};

// Commands that only read from the server never need an output directory
const COMMANDS_WITHOUT_OUTPUT: ReadonlySet<CliCommand> = new Set(['hash', 'pack']);

const resolvePackArgs = (raw: RawArgs): PackArgs => {
  if (!raw.name) throw new ArgError('Missing required for pack: --name');
  if (!raw.version) throw new ArgError('Missing required for pack: --version');
  if (!raw.out) throw new ArgError('Missing required for pack: --out');
  return { name: raw.name, version: raw.version, out: raw.out, from: raw.from };
};

// Flag > negated flag > config > default, so a config `prettier: true` can
// still be switched off for one run
const resolveToggle = (
  enabled: boolean,
  disabled: boolean,
  configValue: boolean | undefined,
  fallback: boolean,
): boolean => {
  if (disabled) return false;
  if (enabled) return true;
  return configValue ?? fallback;
};

export const mergeWithConfig = (
  raw: RawArgs,
  config: CliConfig | null,
  env: NodeJS.ProcessEnv = process.env,
): CliArgs => {
  const url = raw.url ?? config?.url;
  const token = raw.token ?? env[TOKEN_ENV_VAR];
  const output = raw.output ?? config?.output;

  if (!url) throw new ArgError('Missing required: --url (or set url in config file)');
  if (!token) throw new ArgError(`Missing required: --token (or set ${TOKEN_ENV_VAR})`);
  if (!output && !COMMANDS_WITHOUT_OUTPUT.has(raw.command)) {
    throw new ArgError('Missing required: --output (or set output in config file)');
  }

  const watchInterval = raw.watchInterval
    ? parseInt(raw.watchInterval, 10)
    : (config?.watchInterval ?? DEFAULT_WATCH_INTERVAL_MS);
  if (Number.isNaN(watchInterval) || watchInterval <= 0) {
    throw new ArgError('Invalid --watch-interval: must be a positive number of milliseconds');
  }

  return {
    command: raw.command,
    ...(raw.command === 'pack' ? { pack: resolvePackArgs(raw) } : {}),
    url,
    token,
    output: output ?? '',
    target: raw.target ?? config?.target ?? 'valibot',
    nullableStyle: raw.nullableStyle ?? config?.nullableStyle ?? 'nullish',
    populate: resolveToggle(false, raw.noPopulate, config?.populate, true),
    client: resolveToggle(false, raw.noClient, config?.client, true),
    jsdoc: resolveToggle(raw.jsdoc, raw.noJsdoc, config?.jsdoc, false),
    mocks: resolveToggle(raw.mocks, raw.noMocks, config?.mocks, false),
    prettier: resolveToggle(raw.prettier, raw.noPrettier, config?.prettier, false),
    watch: raw.watch,
    watchInterval,
  };
};

export const buildQueryString = (args: CliArgs): string => {
  const params = new URLSearchParams();
  params.set('target', args.target);
  params.set('nullableStyle', args.nullableStyle);
  if (!args.populate) params.set('populate', 'false');
  if (!args.client) params.set('client', 'false');
  if (args.jsdoc) params.set('jsdoc', 'true');
  if (args.mocks) params.set('mocks', 'true');
  return params.toString();
};

const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// A bearer token over plain http to a remote host travels in cleartext
export const isInsecureRemoteUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && !LOCAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};
