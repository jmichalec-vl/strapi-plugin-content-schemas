import { describe, it, expect, vi, afterEach } from 'vitest';
import * as zlib from 'node:zlib';

import { createTarGz } from '../../../../server/src/generators/tar';

const BLOCK_SIZE = 512;

const readHeaderString = (header: Buffer, start: number, length: number): string =>
  header
    .subarray(start, start + length)
    .toString('utf-8')
    .replace(/\0/g, '');

const extractTar = (tarBuffer: Buffer): Map<string, string> => {
  const files = new Map<string, string>();
  let offset = 0;

  while (offset < tarBuffer.length - BLOCK_SIZE) {
    const header = tarBuffer.subarray(offset, offset + BLOCK_SIZE);
    if (header.every((b) => b === 0)) break;

    const name = readHeaderString(header, 0, 100);
    const prefix = readHeaderString(header, 345, 155);
    const fileName = prefix ? `${prefix}/${name}` : name;
    const fileSizeStr = readHeaderString(header, 124, 12).trim();
    const fileSize = parseInt(fileSizeStr, 8);
    offset += BLOCK_SIZE;

    if (fileName && fileSize > 0) {
      files.set(fileName, tarBuffer.subarray(offset, offset + fileSize).toString('utf-8'));
    }

    offset += Math.ceil(fileSize / BLOCK_SIZE) * BLOCK_SIZE;
  }

  return files;
};

describe('createTarGz', () => {
  it('creates a valid gzip-compressed archive', () => {
    const files = new Map([['test.ts', 'export const x = 1;']]);
    const gzBuffer = createTarGz(files);

    expect(() => zlib.gunzipSync(gzBuffer)).not.toThrow();
  });

  it('contains all input files', () => {
    const files = new Map([
      ['index.ts', 'export {};'],
      ['types/config.ts', 'export type Config = {};'],
    ]);

    const gzBuffer = createTarGz(files);
    const tarBuffer = zlib.gunzipSync(gzBuffer);
    const extracted = extractTar(tarBuffer);

    expect(extracted.size).toBe(2);
    expect(extracted.get('index.ts')).toBe('export {};');
    expect(extracted.get('types/config.ts')).toBe('export type Config = {};');
  });

  it('handles empty file map', () => {
    const gzBuffer = createTarGz(new Map());
    const tarBuffer = zlib.gunzipSync(gzBuffer);

    expect(tarBuffer.length).toBe(BLOCK_SIZE * 2);
  });

  it('preserves file content with special characters', () => {
    const content = "const x = `hello\\nworld`;\nconst y = '日本語';";
    const files = new Map([['special.ts', content]]);

    const gzBuffer = createTarGz(files);
    const tarBuffer = zlib.gunzipSync(gzBuffer);
    const extracted = extractTar(tarBuffer);

    expect(extracted.get('special.ts')).toBe(content);
  });

  it('handles files with content larger than one block', () => {
    const content = 'x'.repeat(1024);
    const files = new Map([['large.ts', content]]);

    const gzBuffer = createTarGz(files);
    const tarBuffer = zlib.gunzipSync(gzBuffer);
    const extracted = extractTar(tarBuffer);

    expect(extracted.get('large.ts')).toBe(content);
  });

  it('writes ustar magic bytes', () => {
    const gzBuffer = createTarGz(new Map([['test.ts', 'x']]));
    const tarBuffer = zlib.gunzipSync(gzBuffer);

    expect(tarBuffer.subarray(257, 262).toString('utf-8')).toBe('ustar');
  });

  it('round-trips paths longer than 100 bytes via the ustar prefix field', () => {
    const longPath = `mocks/components/${'a'.repeat(60)}/${'b'.repeat(60)}.mock.ts`;
    expect(Buffer.byteLength(longPath)).toBeGreaterThan(100);

    const gzBuffer = createTarGz(new Map([[longPath, 'content']]));
    const tarBuffer = zlib.gunzipSync(gzBuffer);
    const extracted = extractTar(tarBuffer);

    expect(extracted.get(longPath)).toBe('content');
  });

  it('throws a clear error for paths that cannot be split into prefix + name', () => {
    const unsplittable = 'x'.repeat(150);

    expect(() => createTarGz(new Map([[unsplittable, 'content']]))).toThrow(/path too long/i);
  });

  describe('determinism', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('produces byte-identical archives for identical input regardless of wall-clock time', () => {
      const files = new Map([['index.ts', 'export {};']]);

      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
      const first = createTarGz(files);
      vi.setSystemTime(new Date('2027-06-15T12:34:56Z'));
      const second = createTarGz(files);

      expect(first.equals(second)).toBe(true);
    });

    it('produces byte-identical archives regardless of map insertion order', () => {
      const ordered = new Map([
        ['a.ts', 'a'],
        ['b.ts', 'b'],
      ]);
      const reversed = new Map([
        ['b.ts', 'b'],
        ['a.ts', 'a'],
      ]);

      expect(createTarGz(ordered).equals(createTarGz(reversed))).toBe(true);
    });

    it('writes a zero mtime so headers carry no timestamp', () => {
      const tarBuffer = zlib.gunzipSync(createTarGz(new Map([['test.ts', 'x']])));

      expect(readHeaderString(tarBuffer, 136, 12)).toBe('00000000000');
    });
  });
});
