import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

import { fetchManifest } from './manifest';
import { fetchOk } from './http';
import { registerTempDir, removeTempDir } from './temp-dirs';
import { CLI_VERSION, isVersionMismatch } from './version';
import { GENERATED_MARKER, MAX_TARBALL_BYTES, META_FILE_NAME } from './constants';

const BLOCK_SIZE = 512;
// ustar header layout (POSIX.1-1988): byte offsets inside the 512-byte block
const NAME_FIELD = { offset: 0, length: 100 } as const;
const SIZE_FIELD = { offset: 124, length: 12 } as const;
const CHECKSUM_FIELD = { offset: 148, length: 8 } as const;
const TYPEFLAG_OFFSET = 156;
const MAGIC_FIELD = { offset: 257, length: 6 } as const;
const PREFIX_FIELD = { offset: 345, length: 155 } as const;
const USTAR_MAGIC = 'ustar';
const CHECKSUM_PLACEHOLDER_BYTE = 0x20;
const OCTAL_DIGITS = /^[0-7]*$/;
// '0' (POSIX) and NUL (pre-POSIX) both mark a regular file
const REGULAR_TYPEFLAGS: ReadonlySet<number> = new Set([0x30, 0x00]);

const readHeaderString = (header: Buffer, start: number, length: number): string =>
  header
    .subarray(start, start + length)
    .toString('utf-8')
    .replace(/\0/g, '');

// The server can never emit entries pointing outside the output dir, but the tar
// comes over the network - never trust its paths
export const resolveSafeOutputPath = (outputDir: string, fileName: string): string => {
  const target = path.resolve(outputDir, fileName);
  if (target !== outputDir && !target.startsWith(outputDir + path.sep)) {
    throw new Error(`Refusing to extract tar entry outside the output directory: "${fileName}"`);
  }
  return target;
};

const invalidArchive = (reason: string): Error =>
  new Error(`Response was not a valid ustar archive (${reason}) - check the URL and token.`);

const computeHeaderChecksum = (header: Buffer): number => {
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const inChecksumField =
      i >= CHECKSUM_FIELD.offset && i < CHECKSUM_FIELD.offset + CHECKSUM_FIELD.length;
    sum += inChecksumField ? CHECKSUM_PLACEHOLDER_BYTE : (header[i] ?? 0);
  }
  return sum;
};

// The archive comes over the network: a corrupt or hostile header must fail
// fast instead of being parsed into garbage entries or an endless loop
const assertValidHeader = (header: Buffer): void => {
  const magic = readHeaderString(header, MAGIC_FIELD.offset, MAGIC_FIELD.length);
  if (!magic.startsWith(USTAR_MAGIC)) throw invalidArchive('missing ustar magic');

  const recorded = readHeaderString(header, CHECKSUM_FIELD.offset, CHECKSUM_FIELD.length).trim();
  if (Number.parseInt(recorded, 8) !== computeHeaderChecksum(header)) {
    throw invalidArchive('header checksum mismatch');
  }
};

// A signed or non-octal size would let the reader rewind onto the same header
// forever; only non-negative octal digits are a valid ustar size
const readEntrySize = (header: Buffer): number => {
  const raw = readHeaderString(header, SIZE_FIELD.offset, SIZE_FIELD.length).trim();
  if (!OCTAL_DIGITS.test(raw)) throw invalidArchive(`bad entry size "${raw}"`);
  const size = raw === '' ? 0 : Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(size)) throw invalidArchive(`bad entry size "${raw}"`);
  return size;
};

export const parseTar = (tarBuffer: Buffer): Map<string, Buffer> => {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + BLOCK_SIZE <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + BLOCK_SIZE);

    if (header.every((b) => b === 0)) break;
    assertValidHeader(header);

    const name = readHeaderString(header, NAME_FIELD.offset, NAME_FIELD.length);
    const prefix = readHeaderString(header, PREFIX_FIELD.offset, PREFIX_FIELD.length);
    const fileName = prefix ? `${prefix}/${name}` : name;
    const fileSize = readEntrySize(header);
    const typeflag = header[TYPEFLAG_OFFSET];

    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + fileSize;
    if (dataEnd > tarBuffer.length) throw invalidArchive(`truncated entry "${fileName}"`);

    // PAX records, GNU long names, symlinks and directories are skipped along
    // with their data blocks - only regular file entries (even empty) are kept
    if (fileName && typeflag !== undefined && REGULAR_TYPEFLAGS.has(typeflag)) {
      entries.set(fileName, Buffer.from(tarBuffer.subarray(dataStart, dataEnd)));
    }

    offset = dataStart + Math.ceil(fileSize / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return entries;
};

const errorCode = (err: unknown): string | undefined =>
  typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { readonly code: unknown }).code)
    : undefined;

// Bounded decompression: a small gzip bomb must not exhaust memory
export const gunzipTarball = (gzBuffer: Buffer, maxBytes: number = MAX_TARBALL_BYTES): Buffer => {
  try {
    return zlib.gunzipSync(gzBuffer, { maxOutputLength: maxBytes });
  } catch (err) {
    if (errorCode(err) === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`Decompressed tarball exceeds ${maxBytes} bytes - refusing to extract.`);
    }
    throw new Error(
      'Response was not gzip data - check the URL and token (the server may have returned an error page instead of a tarball).',
    );
  }
};

// Identity of the artifact: sha256 over the canonical (pre-formatting) server
// output, sorted by path. Prettier-independent on purpose - CI and dev laptops
// must compute the same value regardless of their prettier version/config.
export const computeOutputHash = (entries: ReadonlyMap<string, Buffer>): string => {
  const digest = crypto.createHash('sha256');
  const sortedEntries = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [name, content] of sortedEntries) {
    digest.update(name);
    digest.update('\0');
    digest.update(content);
    digest.update('\0');
  }
  return digest.digest('hex');
};

// Idempotence primitive: a byte-identical file is never rewritten, so its
// mtime survives and consumer file watchers see no event
export const writeFileIfChanged = (filePath: string, content: Buffer): boolean => {
  if (fs.existsSync(filePath) && content.equals(fs.readFileSync(filePath))) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
};

export const fetchEntries = async (
  baseUrl: string,
  token: string,
  query: string,
): Promise<Map<string, Buffer>> => {
  const schemasUrl = `${baseUrl}/api/content-schemas/schemas${query ? `?${query}` : ''}`;
  const gzBuffer = await fetchOk('schemas', schemasUrl, token, 'application/gzip');
  return parseTar(gunzipTarball(gzBuffer));
};

// The marker is the first line of every generated file; requiring it there
// (not anywhere in the body) keeps a hand-written file that merely mentions
// the plugin out of reach
const isGeneratedFile = (filePath: string): boolean => {
  const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n', 1)[0] ?? '';
  return firstLine.includes(GENERATED_MARKER);
};

export const pruneStaleGeneratedFiles = (
  outputDir: string,
  extractedFiles: readonly string[],
): string[] => {
  const freshPaths = new Set(extractedFiles.map((entry) => entry.split('/').join(path.sep)));
  const pruned: string[] = [];

  // Returns how many files were pruned under `dir`; only a directory this
  // prune emptied is removed, never one that was already empty
  const walk = (dir: string): number => {
    let prunedHere = 0;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const prunedBelow = walk(fullPath);
        prunedHere += prunedBelow;
        if (prunedBelow > 0 && fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
        continue;
      }

      const relPath = path.relative(outputDir, fullPath);
      if (!entry.name.endsWith('.ts') || freshPaths.has(relPath)) continue;

      if (isGeneratedFile(fullPath)) {
        fs.rmSync(fullPath);
        pruned.push(relPath);
        prunedHere += 1;
      }
    }
    return prunedHere;
  };

  walk(outputDir);
  return pruned;
};

// Pruning walks the whole output tree and deletes generated files in it; the
// project root (or an ancestor) is never an acceptable target for that
export const assertDedicatedOutputDir = (resolvedOutput: string, cwd: string): void => {
  const relative = path.relative(resolvedOutput, cwd);
  const containsCwd = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  if (containsCwd) {
    throw new Error(
      `--output must be a dedicated directory for generated files, not the project root or one of its parents: ${resolvedOutput}`,
    );
  }
};

// The consumer repo's own prettier is resolved from the working directory and
// run through the current Node binary: `npx` would silently download a
// different version when none is installed, and cannot be spawned portably
// on Windows
const resolvePrettierBin = (cwd: string): string | null => {
  try {
    const packageJsonPath = require.resolve('prettier/package.json', { paths: [cwd] });
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      readonly bin?: string | Readonly<Record<string, string>>;
    };
    const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.prettier;
    return bin ? path.join(path.dirname(packageJsonPath), bin) : null;
  } catch {
    return null;
  }
};

const runPrettier = (stagingDir: string): void => {
  const prettierBin = resolvePrettierBin(process.cwd());
  if (!prettierBin) {
    console.warn(
      'prettier is not installed in this project. Skipping formatting. Install with: npm install -D prettier',
    );
    return;
  }

  console.log('Formatting output with prettier...');
  // stderr is inherited so a prettier config or syntax error is visible
  execFileSync(process.execPath, [prettierBin, '--write', stagingDir], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
};

const warnOnVersionMismatch = async (baseUrl: string, token: string): Promise<void> => {
  try {
    const manifest = await fetchManifest(baseUrl, token);
    if (!manifest.pluginVersion || !CLI_VERSION) return;

    if (isVersionMismatch(CLI_VERSION, manifest.pluginVersion)) {
      console.warn(
        `Warning: server plugin version ${manifest.pluginVersion} and CLI version ${CLI_VERSION} differ in a breaking version (major, or minor on the 0.x line). Generated output may be incompatible - align both to the same version.`,
      );
    }
  } catch {
    // manifest unavailable (e.g. older plugin version) - not fatal
  }
};

// Formatting must not touch the output dir (prettier --write would storm the
// consumer's file watcher with rewrites of unchanged files), and it must run
// under the consumer repo's own prettier config - which prettier resolves by
// walking up from each file's path. A hidden sibling of the output dir
// satisfies both, same trick `check` uses for its candidate pull.
const formatViaStaging = (
  entries: ReadonlyMap<string, Buffer>,
  resolvedOutput: string,
): Map<string, Buffer> => {
  const stagingDir = fs.mkdtempSync(
    path.join(path.dirname(resolvedOutput), '.strapi-schemas-stage-'),
  );
  registerTempDir(stagingDir);

  try {
    for (const [name, content] of entries) {
      const filePath = resolveSafeOutputPath(stagingDir, name);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
    runPrettier(stagingDir);
    return new Map(
      [...entries.keys()].map((name) => [
        name,
        fs.readFileSync(resolveSafeOutputPath(stagingDir, name)),
      ]),
    );
  } finally {
    removeTempDir(stagingDir);
  }
};

export const buildMetaFile = (
  outputHash: string,
  target: string,
  entryNames: readonly string[],
): Buffer =>
  // No timestamps - the file must be byte-identical for identical output, or
  // it would defeat the zero-writes guarantee and pack determinism
  Buffer.from(
    `${JSON.stringify(
      { hash: outputHash, target, files: [...entryNames].sort(), cliVersion: CLI_VERSION },
      null,
      2,
    )}\n`,
  );

export const pull = async (
  url: string,
  token: string,
  outputDir: string,
  query: string,
  prettier: boolean,
  target: string,
): Promise<string> => {
  const baseUrl = url.replace(/\/$/, '');

  console.log(`Pulling schemas from ${baseUrl}...`);

  const entries = await fetchEntries(baseUrl, token, query);
  const outputHash = computeOutputHash(entries);

  const resolvedOutput = path.resolve(process.cwd(), outputDir);
  assertDedicatedOutputDir(resolvedOutput, process.cwd());
  fs.mkdirSync(resolvedOutput, { recursive: true });

  const finalEntries = prettier ? formatViaStaging(entries, resolvedOutput) : entries;

  let written = 0;
  for (const [name, content] of finalEntries) {
    if (writeFileIfChanged(resolveSafeOutputPath(resolvedOutput, name), content)) written += 1;
  }
  if (
    writeFileIfChanged(
      path.join(resolvedOutput, META_FILE_NAME),
      buildMetaFile(outputHash, target, [...entries.keys()]),
    )
  ) {
    written += 1;
  }

  const pruned = pruneStaleGeneratedFiles(resolvedOutput, [...finalEntries.keys()]);
  const total = finalEntries.size + 1;

  console.log(`Output hash: ${outputHash}`);
  console.log(
    `Synced ${total} files to ${resolvedOutput} (${written} written, ${total - written} unchanged)`,
  );
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} stale generated file(s): ${pruned.join(', ')}`);
  }

  await warnOnVersionMismatch(baseUrl, token);
  return outputHash;
};
