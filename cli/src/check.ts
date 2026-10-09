import * as fs from 'node:fs';
import * as path from 'node:path';

import { pull } from './pull';
import { GENERATED_MARKER, META_FILE_NAME } from './constants';
import { registerTempDir, removeTempDir } from './temp-dirs';

const readDirRecursive = (dir: string): Map<string, string> => {
  const files = new Map<string, string>();

  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = readDirRecursive(fullPath);
      for (const [relPath, content] of nested) {
        files.set(path.join(entry.name, relPath), content);
      }
    } else {
      files.set(entry.name, fs.readFileSync(fullPath, 'utf-8'));
    }
  }

  return files;
};

export const diffFiles = (
  committed: Map<string, string>,
  fresh: Map<string, string>,
): { added: string[]; removed: string[]; modified: string[]; ignored: string[] } => {
  const freshEntries = [...fresh.entries()];
  const added = freshEntries.filter(([p]) => !committed.has(p)).map(([p]) => p);
  const modified = freshEntries
    .filter(([p, c]) => committed.has(p) && committed.get(p) !== c)
    .map(([p]) => p);

  // Only previously-generated files count as stale when absent from a fresh pull;
  // hand-added files (README, .gitkeep, …) in the output dir are not staleness
  const committedOnly = [...committed.entries()].filter(([p]) => !fresh.has(p));
  const removed = committedOnly
    .filter(([, content]) => content.includes(GENERATED_MARKER))
    .map(([p]) => p);
  const ignored = committedOnly
    .filter(([, content]) => !content.includes(GENERATED_MARKER))
    .map(([p]) => p);

  return { added, removed, modified, ignored };
};

export type CheckResult = 'up-to-date' | 'stale';

// Returns a result instead of exiting so the temp dir cleanup in `finally`
// always runs; the caller decides the process exit code
export const check = async (
  url: string,
  token: string,
  outputDir: string,
  query: string,
  prettier: boolean,
  target: string,
): Promise<CheckResult> => {
  const resolvedOutput = path.resolve(process.cwd(), outputDir);
  // The candidate pull must be formatted under the SAME prettier context as
  // the committed output: prettier resolves its config, plugins, and ignore
  // files by walking up from each file's path, so a candidate in os.tmpdir()
  // would format with default config and report every file stale in any repo
  // with its own prettier setup. Pulling into a hidden sibling of the output
  // dir puts both sides in the same directory tree. (Removed in `finally`;
  // the dot-prefix keeps a crash leftover out of the way and easy to spot.)
  const parentDir = path.dirname(resolvedOutput);
  fs.mkdirSync(parentDir, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(parentDir, '.strapi-schemas-check-'));
  registerTempDir(tempDir);

  try {
    // Must mirror the pull settings (incl. prettier) or every formatted file diffs dirty
    await pull(url, token, tempDir, query, prettier, target);

    const committed = readDirRecursive(resolvedOutput);
    const fresh = readDirRecursive(tempDir);
    // The meta file records the CLI version, so it legitimately differs across
    // CLI upgrades while the generated set is identical; drift is judged on
    // the generated files alone
    committed.delete(META_FILE_NAME);
    fresh.delete(META_FILE_NAME);

    const { added, removed, modified, ignored } = diffFiles(committed, fresh);

    if (ignored.length > 0) {
      console.warn(`Ignoring non-generated files in output dir: ${ignored.join(', ')}`);
    }

    if (added.length === 0 && removed.length === 0 && modified.length === 0) {
      console.log('Schemas are up to date.');
      return 'up-to-date';
    }

    console.error('Schemas are stale:');
    if (added.length > 0) {
      console.error(`  Added (${added.length}): ${added.join(', ')}`);
    }
    if (removed.length > 0) {
      console.error(`  Removed (${removed.length}): ${removed.join(', ')}`);
    }
    if (modified.length > 0) {
      console.error(`  Modified (${modified.length}): ${modified.join(', ')}`);
    }
    console.error('\nRun "strapi-schemas pull" to update.');

    return 'stale';
  } finally {
    removeTempDir(tempDir);
  }
};
