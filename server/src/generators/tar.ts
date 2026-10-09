import * as zlib from 'node:zlib';

import { GenerationError } from '../errors';

const BLOCK_SIZE = 512;

// ustar header layout (POSIX.1-1988): byte offsets inside the 512-byte block
const NAME_FIELD = { offset: 0, length: 100 } as const;
const MODE_FIELD = { offset: 100, length: 8 } as const;
const UID_FIELD = { offset: 108, length: 8 } as const;
const GID_FIELD = { offset: 116, length: 8 } as const;
const SIZE_FIELD = { offset: 124, length: 12 } as const;
const MTIME_FIELD = { offset: 136, length: 12 } as const;
const CHECKSUM_FIELD = { offset: 148, length: 8 } as const;
const TYPEFLAG_OFFSET = 156;
const MAGIC_FIELD = { offset: 257, length: 6 } as const;
const VERSION_FIELD = { offset: 263, length: 2 } as const;
const PREFIX_FIELD = { offset: 345, length: 155 } as const;

const USTAR_MAGIC = 'ustar';
const USTAR_VERSION = '00';
const REGULAR_FILE_TYPEFLAG = 0x30; // '0'
const CHECKSUM_PLACEHOLDER_BYTE = 0x20; // space, per spec while summing
const CHECKSUM_TERMINATOR_BYTE = 0x20;
const FILE_MODE = 0o644;

// The archive is content-addressed (cached and hashed by the consumer), so
// every header field must be a pure function of the file set. A real
// timestamp would make byte-identical output differ between generations.
const FIXED_MTIME = 0;

const encodeString = (str: string, length: number): Buffer => {
  const buf = Buffer.alloc(length);
  buf.write(str, 0, length, 'utf-8');
  return buf;
};

const encodeOctal = (num: number, length: number): Buffer => {
  const str = num.toString(8).padStart(length - 1, '0');
  return encodeString(str + '\0', length);
};

const computeChecksum = (header: Buffer): number => {
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const inChecksumField =
      i >= CHECKSUM_FIELD.offset && i < CHECKSUM_FIELD.offset + CHECKSUM_FIELD.length;
    sum += inChecksumField ? CHECKSUM_PLACEHOLDER_BYTE : (header[i] ?? 0);
  }
  return sum;
};

// ustar splits long paths into name (<=100 bytes) + prefix (<=155 bytes) at a '/'
const splitTarPath = (filePath: string): { readonly name: string; readonly prefix: string } => {
  if (Buffer.byteLength(filePath, 'utf-8') <= NAME_FIELD.length) {
    return { name: filePath, prefix: '' };
  }

  const parts = filePath.split('/');
  for (let i = 1; i < parts.length; i++) {
    const prefix = parts.slice(0, i).join('/');
    const name = parts.slice(i).join('/');
    if (
      Buffer.byteLength(prefix, 'utf-8') <= PREFIX_FIELD.length &&
      Buffer.byteLength(name, 'utf-8') <= NAME_FIELD.length
    ) {
      return { name, prefix };
    }
  }

  throw new GenerationError(
    `[content-schemas] Tar entry path too long to encode in a ustar header: "${filePath}"`,
  );
};

const createFileHeader = (fileName: string, prefix: string, fileSize: number): Buffer => {
  const header = Buffer.alloc(BLOCK_SIZE);

  encodeString(fileName, NAME_FIELD.length).copy(header, NAME_FIELD.offset);
  encodeOctal(FILE_MODE, MODE_FIELD.length).copy(header, MODE_FIELD.offset);
  encodeOctal(0, UID_FIELD.length).copy(header, UID_FIELD.offset);
  encodeOctal(0, GID_FIELD.length).copy(header, GID_FIELD.offset);
  encodeOctal(fileSize, SIZE_FIELD.length).copy(header, SIZE_FIELD.offset);
  encodeOctal(FIXED_MTIME, MTIME_FIELD.length).copy(header, MTIME_FIELD.offset);

  header[TYPEFLAG_OFFSET] = REGULAR_FILE_TYPEFLAG;

  encodeString(USTAR_MAGIC, MAGIC_FIELD.length).copy(header, MAGIC_FIELD.offset);
  encodeString(USTAR_VERSION, VERSION_FIELD.length).copy(header, VERSION_FIELD.offset);
  encodeString(prefix, PREFIX_FIELD.length).copy(header, PREFIX_FIELD.offset);

  const checksum = computeChecksum(header);
  encodeOctal(checksum, CHECKSUM_FIELD.length - 1).copy(header, CHECKSUM_FIELD.offset);
  header[CHECKSUM_FIELD.offset + CHECKSUM_FIELD.length - 1] = CHECKSUM_TERMINATOR_BYTE;

  return header;
};

// Entries are written in sorted path order so the archive bytes never depend
// on the caller's map insertion order
export const createTarGz = (files: ReadonlyMap<string, string>): Buffer => {
  const blocks: Buffer[] = [];

  for (const filePath of [...files.keys()].sort()) {
    const contentBuffer = Buffer.from(files.get(filePath) ?? '', 'utf-8');
    const { name, prefix } = splitTarPath(filePath);
    blocks.push(createFileHeader(name, prefix, contentBuffer.length));

    blocks.push(contentBuffer);
    const padding = BLOCK_SIZE - (contentBuffer.length % BLOCK_SIZE);
    if (padding < BLOCK_SIZE) {
      blocks.push(Buffer.alloc(padding));
    }
  }

  blocks.push(Buffer.alloc(BLOCK_SIZE * 2));

  return zlib.gzipSync(Buffer.concat(blocks));
};
