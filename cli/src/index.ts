#!/usr/bin/env node

import { pull } from './pull';
import { check } from './check';
import { hash } from './hash';
import { watch } from './watch';
import { pack } from './pack';
import {
  parseRawArgs,
  mergeWithConfig,
  buildQueryString,
  isInsecureRemoteUrl,
  ArgError,
  USAGE,
} from './args';
import { loadConfig } from './config';
import { EXIT_CODE_ERROR, EXIT_CODE_STALE } from './constants';
import { errorMessage } from './errors';

const main = async (): Promise<void> => {
  const raw = parseRawArgs(process.argv.slice(2));
  const config = await loadConfig();
  const args = mergeWithConfig(raw, config);
  const query = buildQueryString(args);

  // A pack run that reuses a pulled directory never contacts the server
  const contactsServer = !(args.command === 'pack' && args.pack?.from);
  if (contactsServer && isInsecureRemoteUrl(args.url)) {
    console.warn(
      `Warning: ${args.url} is plain http to a remote host - the API token is sent in cleartext.`,
    );
  }

  if (args.command === 'pull' && args.watch) {
    await watch(
      args.url,
      args.token,
      args.output,
      query,
      args.prettier,
      args.watchInterval,
      args.target,
    );
  } else if (args.command === 'pull') {
    await pull(args.url, args.token, args.output, query, args.prettier, args.target);
  } else if (args.command === 'hash') {
    await hash(args.url, args.token, query);
  } else if (args.command === 'pack' && args.pack) {
    await pack({
      url: args.url,
      token: args.token,
      query,
      target: args.target,
      name: args.pack.name,
      version: args.pack.version,
      out: args.pack.out,
      from: args.pack.from,
    });
  } else {
    const result = await check(
      args.url,
      args.token,
      args.output,
      query,
      args.prettier,
      args.target,
    );
    if (result === 'stale') process.exit(EXIT_CODE_STALE);
  }
};

main().catch((error: unknown) => {
  if (error instanceof ArgError) {
    if (error.kind === 'help') {
      console.log(USAGE);
      process.exit(0);
    }
    console.error(`${error.message}\n`);
    console.error(USAGE);
    process.exit(EXIT_CODE_ERROR);
  }
  console.error(`Error: ${errorMessage(error)}`);
  process.exit(EXIT_CODE_ERROR);
});
