import { pull } from './pull';
import { fetchManifest } from './manifest';
import { HttpError } from './http';
import { errorMessage } from './errors';

const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;

const blockForever = (): Promise<never> => new Promise<never>(() => {});

const fetchManifestHash = async (url: string, token: string): Promise<string | undefined> => {
  const manifest = await fetchManifest(url, token);
  return typeof manifest.hash === 'string' ? manifest.hash : undefined;
};

// The manifest is a separate content-api action: a token scoped to getSchemas
// alone is the common misconfiguration, and it looks nothing like an old plugin
const explainManifestFailure = (error: unknown): string => {
  if (error instanceof HttpError) {
    if (error.status === HTTP_UNAUTHORIZED || error.status === HTTP_FORBIDDEN) {
      return `the API token lacks permission for the manifest endpoint (grant content-schemas.getManifest). Change detection is unavailable, but polling continues. (${error.message})`;
    }
    if (error.status === HTTP_NOT_FOUND) {
      return `the server plugin may predate the manifest endpoint. Polling continues. (${error.message})`;
    }
  }
  return `could not fetch the manifest. Polling continues. (${errorMessage(error)})`;
};

export const watch = async (
  url: string,
  token: string,
  outputDir: string,
  query: string,
  prettier: boolean,
  intervalMs: number,
  target: string,
): Promise<void> => {
  let lastHash: string | undefined;
  let warnedMissingHash = false;
  let lastPollError: string | undefined;

  const warnMissingHashOnce = (): void => {
    if (warnedMissingHash) return;
    warnedMissingHash = true;
    console.warn(
      'Manifest response has no hash - change detection is unavailable, but polling continues.',
    );
  };

  // The baseline hash is taken BEFORE the initial pull: a model change landing
  // between the two would otherwise be invisible until the next change
  try {
    lastHash = await fetchManifestHash(url, token);
    if (lastHash === undefined) warnMissingHashOnce();
  } catch (error) {
    console.warn(`Warning: ${explainManifestFailure(error)}`);
  }

  await pull(url, token, outputDir, query, prettier, target);

  console.log(
    `Watching for schema changes (polling every ${intervalMs / 1000}s)... Press Ctrl+C to stop.`,
  );

  let timer: NodeJS.Timeout;

  // Self-scheduling instead of setInterval so polls (including their pull)
  // never overlap when a cycle outlasts the interval
  const poll = async (): Promise<void> => {
    try {
      const currentHash = await fetchManifestHash(url, token);
      lastPollError = undefined;
      if (currentHash === undefined) {
        warnMissingHashOnce();
      } else if (currentHash !== lastHash) {
        console.log(`\nSchema change detected (${lastHash} -> ${currentHash}), re-pulling...`);
        await pull(url, token, outputDir, query, prettier, target);
        lastHash = currentHash;
        console.log(`Watching for schema changes...`);
      }
    } catch (error) {
      // A server that is down logs once, not once per interval
      const message = errorMessage(error);
      if (message !== lastPollError) console.error(`Poll error: ${message}`);
      lastPollError = message;
    }
    timer = setTimeout(poll, intervalMs);
  };

  timer = setTimeout(poll, intervalMs);

  process.on('SIGINT', () => {
    clearTimeout(timer);
    console.log('\nStopped watching.');
    process.exit(0);
  });

  await blockForever();
};
