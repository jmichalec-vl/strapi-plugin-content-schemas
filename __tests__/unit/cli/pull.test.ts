import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

import {
  resolveSafeOutputPath,
  parseTar,
  computeOutputHash,
  writeFileIfChanged,
  buildMetaFile,
  pruneStaleGeneratedFiles,
  gunzipTarball,
  assertDedicatedOutputDir,
} from '../../../cli/src/pull';
import { GENERATED_MARKER } from '../../../cli/src/constants';

const OUTPUT_DIR = path.resolve('/tmp/schemas-output');

describe('resolveSafeOutputPath', () => {
  it('resolves normal relative entries inside the output dir', () => {
    const result = resolveSafeOutputPath(OUTPUT_DIR, 'content-types/article.ts');
    expect(result).toBe(path.join(OUTPUT_DIR, 'content-types/article.ts'));
  });

  it('rejects entries that escape via ..', () => {
    expect(() => resolveSafeOutputPath(OUTPUT_DIR, '../../etc/passwd')).toThrow(
      /outside the output directory/,
    );
  });

  it('rejects entries that escape via nested ..', () => {
    expect(() => resolveSafeOutputPath(OUTPUT_DIR, 'a/../../../etc/passwd')).toThrow(
      /outside the output directory/,
    );
  });

  it('rejects absolute path entries', () => {
    expect(() => resolveSafeOutputPath(OUTPUT_DIR, '/etc/passwd')).toThrow(
      /outside the output directory/,
    );
  });

  it('rejects sibling directories with a shared prefix', () => {
    expect(() => resolveSafeOutputPath(OUTPUT_DIR, '../schemas-output-evil/x.ts')).toThrow(
      /outside the output directory/,
    );
  });
});

const BLOCK_SIZE = 512;
const SIZE_OFFSET = 124;
const CHECKSUM_OFFSET = 148;
const TYPEFLAG_OFFSET = 156;
const MAGIC_OFFSET = 257;

const headerChecksum = (header: Buffer): number => {
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    sum += i >= CHECKSUM_OFFSET && i < CHECKSUM_OFFSET + 8 ? 0x20 : (header[i] ?? 0);
  }
  return sum;
};

const withChecksum = (header: Buffer): Buffer => {
  header.write(
    `${headerChecksum(header).toString(8).padStart(6, '0')}\0 `,
    CHECKSUM_OFFSET,
    'utf-8',
  );
  return header;
};

const rawHeader = (name: string, sizeField: string, typeflag: string): Buffer => {
  const header = Buffer.alloc(BLOCK_SIZE);
  header.write(name, 0, 'utf-8');
  header.write(sizeField, SIZE_OFFSET, 'utf-8');
  header.write(typeflag, TYPEFLAG_OFFSET, 'utf-8');
  header.write('ustar\0' + '00', MAGIC_OFFSET, 'utf-8');
  return header;
};

const tarHeader = (name: string, size: number, typeflag: string): Buffer =>
  withChecksum(rawHeader(name, `${size.toString(8).padStart(11, '0')}\0`, typeflag));

const tarEntry = (name: string, content: string, typeflag = '0'): Buffer => {
  const body = Buffer.from(content, 'utf-8');
  const paddedSize = Math.ceil(body.length / BLOCK_SIZE) * BLOCK_SIZE;
  return Buffer.concat([
    tarHeader(name, body.length, typeflag),
    body,
    Buffer.alloc(paddedSize - body.length),
  ]);
};

const tarArchive = (...entries: Buffer[]): Buffer =>
  Buffer.concat([...entries, Buffer.alloc(BLOCK_SIZE * 2)]);

describe('parseTar', () => {
  it('parses regular files with typeflag "0"', () => {
    const entries = parseTar(tarArchive(tarEntry('article.ts', 'export {};')));

    expect([...entries.keys()]).toEqual(['article.ts']);
    expect(entries.get('article.ts')?.toString('utf-8')).toBe('export {};');
  });

  it('parses regular files with the pre-POSIX NUL typeflag', () => {
    const entries = parseTar(tarArchive(tarEntry('legacy.ts', 'legacy', '\0')));

    expect(entries.get('legacy.ts')?.toString('utf-8')).toBe('legacy');
  });

  it('parses 0-byte regular files', () => {
    const entries = parseTar(tarArchive(tarEntry('empty.ts', '')));

    expect([...entries.keys()]).toEqual(['empty.ts']);
    expect(entries.get('empty.ts')?.length).toBe(0);
  });

  it('skips PAX records including their data blocks', () => {
    const entries = parseTar(
      tarArchive(
        tarEntry('pax-header', '30 path=some/override/path.ts\n', 'x'),
        tarEntry('real.ts', 'export const x = 1;'),
      ),
    );

    expect([...entries.keys()]).toEqual(['real.ts']);
    expect(entries.get('real.ts')?.toString('utf-8')).toBe('export const x = 1;');
  });

  it('rejects a negative entry size instead of looping forever', () => {
    const hostile = withChecksum(rawHeader('x.ts', '-1000\0', '0'));

    expect(() => parseTar(tarArchive(hostile))).toThrow(/bad entry size/);
  });

  it('rejects a non-octal entry size', () => {
    const corrupt = withChecksum(rawHeader('x.ts', '0000000009\0', '0'));

    expect(() => parseTar(tarArchive(corrupt))).toThrow(/bad entry size/);
  });

  it('rejects headers without the ustar magic', () => {
    const header = tarHeader('x.ts', 0, '0');
    header.fill(0, MAGIC_OFFSET, MAGIC_OFFSET + 8);
    withChecksum(header);

    expect(() => parseTar(tarArchive(header))).toThrow(/ustar magic/);
  });

  it('rejects headers whose checksum does not match', () => {
    const header = tarHeader('x.ts', 0, '0');
    header.write('y', 0, 'utf-8');

    expect(() => parseTar(tarArchive(header))).toThrow(/checksum/);
  });

  it('rejects an entry whose declared size runs past the end of the archive', () => {
    const truncated = Buffer.concat([tarHeader('x.ts', 4096, '0'), Buffer.alloc(BLOCK_SIZE)]);

    expect(() => parseTar(truncated)).toThrow(/truncated/);
  });

  it('skips directory, symlink, and GNU long-name entries', () => {
    const entries = parseTar(
      tarArchive(
        tarEntry('subdir', '', '5'),
        tarEntry('link.ts', '', '2'),
        tarEntry('long-name-data', 'really/long/name.ts\0', 'L'),
        tarEntry('kept.ts', 'kept'),
      ),
    );

    expect([...entries.keys()]).toEqual(['kept.ts']);
  });
});

describe('gunzipTarball', () => {
  it('round-trips gzip data within the limit', () => {
    const tar = tarArchive(tarEntry('a.ts', 'x'));

    expect(gunzipTarball(zlib.gzipSync(tar)).equals(tar)).toBe(true);
  });

  it('refuses output larger than the configured limit', () => {
    const bomb = zlib.gzipSync(Buffer.alloc(64 * 1024));

    expect(() => gunzipTarball(bomb, 1024)).toThrow(/exceeds 1024 bytes/);
  });

  it('reports non-gzip input as such', () => {
    expect(() => gunzipTarball(Buffer.from('<html>error</html>'))).toThrow(/not gzip data/);
  });
});

describe('computeOutputHash', () => {
  const entriesOf = (pairs: readonly (readonly [string, string])[]): Map<string, Buffer> =>
    new Map(pairs.map(([name, content]) => [name, Buffer.from(content)]));

  it('is independent of insertion order', () => {
    const forward = entriesOf([
      ['a.ts', 'aaa'],
      ['b.ts', 'bbb'],
    ]);
    const backward = entriesOf([
      ['b.ts', 'bbb'],
      ['a.ts', 'aaa'],
    ]);

    expect(computeOutputHash(forward)).toBe(computeOutputHash(backward));
  });

  it('changes when any file content changes', () => {
    const base = entriesOf([['a.ts', 'aaa']]);
    const changed = entriesOf([['a.ts', 'aab']]);

    expect(computeOutputHash(base)).not.toBe(computeOutputHash(changed));
  });

  it('changes when a path changes, even with identical content', () => {
    const base = entriesOf([['a.ts', 'same']]);
    const renamed = entriesOf([['b.ts', 'same']]);

    expect(computeOutputHash(base)).not.toBe(computeOutputHash(renamed));
  });

  it('distinguishes content shifted across file boundaries', () => {
    const oneWay = entriesOf([
      ['a.ts', 'xy'],
      ['b.ts', 'z'],
    ]);
    const otherWay = entriesOf([
      ['a.ts', 'x'],
      ['b.ts', 'yz'],
    ]);

    expect(computeOutputHash(oneWay)).not.toBe(computeOutputHash(otherWay));
  });
});

describe('writeFileIfChanged', () => {
  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-if-changed-test-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('writes a missing file, creating parent directories', () => {
    const target = path.join(outputDir, 'nested', 'new.ts');

    expect(writeFileIfChanged(target, Buffer.from('fresh'))).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('fresh');
  });

  it('skips a byte-identical file and preserves its mtime', () => {
    const target = path.join(outputDir, 'same.ts');
    fs.writeFileSync(target, 'stable');
    const before = fs.statSync(target).mtimeMs;

    expect(writeFileIfChanged(target, Buffer.from('stable'))).toBe(false);
    expect(fs.statSync(target).mtimeMs).toBe(before);
  });

  it('rewrites a file whose content differs', () => {
    const target = path.join(outputDir, 'drifted.ts');
    fs.writeFileSync(target, 'old');

    expect(writeFileIfChanged(target, Buffer.from('new'))).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toBe('new');
  });
});

describe('buildMetaFile', () => {
  it('is byte-stable: sorted files, no timestamps', () => {
    const first = buildMetaFile('abc123', 'valibot', ['b.ts', 'a.ts']);
    const second = buildMetaFile('abc123', 'valibot', ['a.ts', 'b.ts']);

    expect(first.equals(second)).toBe(true);

    const parsed = JSON.parse(first.toString('utf-8'));
    expect(parsed.hash).toBe('abc123');
    expect(parsed.target).toBe('valibot');
    expect(parsed.files).toEqual(['a.ts', 'b.ts']);
    expect(Object.keys(parsed).sort()).toEqual(['cliVersion', 'files', 'hash', 'target']);
  });
});

describe('pruneStaleGeneratedFiles', () => {
  const generated = (body: string): string => `/* ${GENERATED_MARKER}. Do not edit. */\n${body}`;

  let outputDir: string;

  beforeEach(() => {
    outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prune-test-'));
  });

  afterEach(() => {
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  it('deletes marker files absent from the fresh archive and keeps everything else', () => {
    fs.writeFileSync(path.join(outputDir, 'kept.ts'), generated('kept'));
    fs.writeFileSync(path.join(outputDir, 'stale.ts'), generated('stale'));
    fs.writeFileSync(path.join(outputDir, 'hand-written.ts'), 'export const mine = true;');
    fs.writeFileSync(path.join(outputDir, 'README.md'), '# notes');

    const pruned = pruneStaleGeneratedFiles(outputDir, ['kept.ts']);

    expect(pruned).toEqual(['stale.ts']);
    expect(fs.existsSync(path.join(outputDir, 'kept.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'stale.ts'))).toBe(false);
    expect(fs.existsSync(path.join(outputDir, 'hand-written.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'README.md'))).toBe(true);
  });

  it('only treats files with the marker on their first line as generated', () => {
    fs.writeFileSync(
      path.join(outputDir, 'mentions.ts'),
      `export const note = 'mine';\n// see ${GENERATED_MARKER} output\n`,
    );
    fs.writeFileSync(
      path.join(outputDir, 'late-marker.ts'),
      `// mine\n// ${GENERATED_MARKER}\nexport const x = 1;\n`,
    );

    const pruned = pruneStaleGeneratedFiles(outputDir, []);

    expect(pruned).toEqual([]);
    expect(fs.existsSync(path.join(outputDir, 'mentions.ts'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'late-marker.ts'))).toBe(true);
  });

  it('keeps directories that were already empty before pruning', () => {
    const preexisting = path.join(outputDir, 'keep-me');
    fs.mkdirSync(preexisting);

    pruneStaleGeneratedFiles(outputDir, []);

    expect(fs.existsSync(preexisting)).toBe(true);
  });

  it('removes directories left empty after pruning', () => {
    const nestedDir = path.join(outputDir, 'content-types');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'gone.ts'), generated('gone'));

    const pruned = pruneStaleGeneratedFiles(outputDir, ['other.ts']);

    expect(pruned).toEqual([path.join('content-types', 'gone.ts')]);
    expect(fs.existsSync(nestedDir)).toBe(false);
  });

  it('keeps nested files listed in the fresh archive with tar-style separators', () => {
    const nestedDir = path.join(outputDir, 'content-types');
    fs.mkdirSync(nestedDir, { recursive: true });
    fs.writeFileSync(path.join(nestedDir, 'article.ts'), generated('article'));

    const pruned = pruneStaleGeneratedFiles(outputDir, ['content-types/article.ts']);

    expect(pruned).toEqual([]);
    expect(fs.existsSync(path.join(nestedDir, 'article.ts'))).toBe(true);
  });
});

describe('assertDedicatedOutputDir', () => {
  const cwd = path.resolve('/repo');

  it('accepts a directory inside the project', () => {
    expect(() => assertDedicatedOutputDir(path.resolve('/repo/src/generated'), cwd)).not.toThrow();
  });

  it('accepts a sibling directory outside the project', () => {
    expect(() => assertDedicatedOutputDir(path.resolve('/elsewhere/out'), cwd)).not.toThrow();
  });

  it('refuses the project root itself', () => {
    expect(() => assertDedicatedOutputDir(cwd, cwd)).toThrow(/dedicated directory/);
  });

  it('refuses an ancestor of the project root', () => {
    expect(() => assertDedicatedOutputDir(path.resolve('/'), cwd)).toThrow(/dedicated directory/);
  });
});
