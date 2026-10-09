import * as fs from 'node:fs';
import * as path from 'node:path';

import { assertDedicatedOutputDir, pull } from './pull';
import { compileDirectory, resolveTypeScript, type PackFormat } from './pack-compile';
import { buildPackageManifest, readInstalledVersion } from './pack-manifest';
import { rewriteRelativeSpecifiers, type SpecifierTarget } from './pack-specifiers';
import { registerTempDir, removeTempDir } from './temp-dirs';
import { CLI_VERSION } from './version';
import { FILE_HEADER_LINE, META_FILE_NAME, PACK_STAGING_PREFIX } from './constants';

export interface PackOptions {
  readonly url: string;
  readonly token: string;
  readonly query: string;
  readonly target: string;
  readonly name: string;
  readonly version: string;
  readonly out: string;
  readonly from: string | undefined;
}

interface MetaFile {
  readonly hash: string;
  readonly target: string;
  readonly files: readonly string[];
}

const SCHEMA_LIBRARY_BY_TARGET: Readonly<Record<string, string>> = {
  valibot: 'valibot',
  zod: 'zod',
};
const MOCKS_BARREL = 'mocks/index.ts';

const readMeta = (dir: string): MetaFile => {
  const metaPath = path.join(dir, META_FILE_NAME);
  if (!fs.existsSync(metaPath)) {
    throw new Error(
      `${dir} has no ${META_FILE_NAME} - point --from at a directory written by pull.`,
    );
  }
  return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as MetaFile;
};

// The types-only entry: `export type *` leaves an empty runtime module behind,
// so `import type { X } from '<pkg>/types'` pulls in no schema code
const writeTypesEntry = (sourceDir: string): void => {
  fs.writeFileSync(
    path.join(sourceDir, 'types.ts'),
    `${FILE_HEADER_LINE}\nexport type * from './index';\n`,
  );
};

const listFiles = (dir: string, suffix: string): string[] => {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith(suffix)) files.push(fullPath);
    }
  };
  walk(dir);
  return files.sort();
};

const classifySpecifier =
  (fromFile: string): ((specifier: string) => SpecifierTarget) =>
  (specifier) => {
    const base = path.resolve(path.dirname(fromFile), specifier);
    if (fs.existsSync(`${base}.js`)) return 'file';
    if (fs.existsSync(path.join(base, 'index.js'))) return 'directory';
    return null;
  };

const addEsmExtensions = (esmDir: string): void => {
  for (const file of [...listFiles(esmDir, '.js'), ...listFiles(esmDir, '.d.ts')]) {
    const code = fs.readFileSync(file, 'utf-8');
    const rewritten = rewriteRelativeSpecifiers(code, classifySpecifier(file));
    if (rewritten !== code) fs.writeFileSync(file, rewritten);
  }
};

const compileFormat = (
  ts: NonNullable<ReturnType<typeof resolveTypeScript>>,
  sourceDir: string,
  distDir: string,
  format: PackFormat,
): void => {
  const outDir = path.join(distDir, format);
  const diagnostics = compileDirectory(ts, sourceDir, outDir, format);
  if (diagnostics.length > 0) {
    throw new Error(
      `Compiling the generated output (${format}) failed - this usually means the schema library is not installed in this project or the generator emitted invalid code:\n${diagnostics.join('\n')}`,
    );
  }
  // Each format directory declares its own module type so Node needs no
  // per-file extensions beyond .js
  fs.writeFileSync(
    path.join(outDir, 'package.json'),
    `${JSON.stringify({ type: format === 'esm' ? 'module' : 'commonjs' }, null, 2)}\n`,
  );
};

const requireInstalled = (cwd: string, packageName: string, why: string): string => {
  const version = readInstalledVersion(cwd, packageName);
  if (!version) {
    throw new Error(
      `${packageName} is not installed in this project (${why}). Run pack where it is installed, e.g. the frontend or contracts repo.`,
    );
  }
  return version;
};

const prepareSourceDir = async (options: PackOptions, stagingDir: string): Promise<MetaFile> => {
  if (options.from) {
    const fromDir = path.resolve(process.cwd(), options.from);
    const meta = readMeta(fromDir);
    // Compile from a copy: the user's pulled directory must stay untouched
    fs.cpSync(fromDir, stagingDir, { recursive: true });
    return meta;
  }
  await pull(options.url, options.token, stagingDir, options.query, false, options.target);
  return readMeta(stagingDir);
};

export const pack = async (options: PackOptions): Promise<string> => {
  const cwd = process.cwd();
  const resolvedOut = path.resolve(cwd, options.out);
  assertDedicatedOutputDir(resolvedOut, cwd);

  const ts = resolveTypeScript(cwd);
  if (!ts) {
    throw new Error(
      "typescript is not installed in this project; pack compiles the generated output with the project's own TypeScript. Install with: npm install -D typescript",
    );
  }

  const parentDir = path.dirname(resolvedOut);
  fs.mkdirSync(parentDir, { recursive: true });
  const stagingDir = fs.mkdtempSync(path.join(parentDir, PACK_STAGING_PREFIX));
  registerTempDir(stagingDir);
  try {
    const meta = await prepareSourceDir(options, stagingDir);
    writeTypesEntry(stagingDir);

    const schemaLibrary = SCHEMA_LIBRARY_BY_TARGET[meta.target] ?? meta.target;
    const schemaLibraryVersion = requireInstalled(
      cwd,
      schemaLibrary,
      'the generated schemas import it',
    );
    const hasMocks = meta.files.includes(MOCKS_BARREL);
    const fakerVersion = hasMocks
      ? requireInstalled(cwd, '@faker-js/faker', 'the generated mocks import it')
      : null;

    fs.rmSync(resolvedOut, { recursive: true, force: true });
    const distDir = path.join(resolvedOut, 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    compileFormat(ts, stagingDir, distDir, 'esm');
    compileFormat(ts, stagingDir, distDir, 'cjs');
    addEsmExtensions(path.join(distDir, 'esm'));

    const manifest = buildPackageManifest({
      name: options.name,
      version: options.version,
      target: meta.target,
      hash: meta.hash,
      generatorVersion: CLI_VERSION,
      schemaLibrary: { name: schemaLibrary, version: schemaLibraryVersion },
      faker: fakerVersion ? { version: fakerVersion } : null,
    });
    fs.writeFileSync(
      path.join(resolvedOut, 'package.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    console.log(`Packed ${options.name}@${options.version} -> ${resolvedOut} (hash ${meta.hash})`);
    return meta.hash;
  } finally {
    removeTempDir(stagingDir);
  }
};
