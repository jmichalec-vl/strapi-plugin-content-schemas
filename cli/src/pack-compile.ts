import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type TypeScript from 'typescript';

type TypeScriptApi = typeof TypeScript;

export type PackFormat = 'esm' | 'cjs';

// The consumer project's own TypeScript compiles the package, like prettier
// formats with the project's own prettier: the output then matches what the
// project itself would produce, and the CLI carries no compiler
export const resolveTypeScript = (cwd: string): TypeScriptApi | null => {
  try {
    const require = createRequire(path.join(cwd, 'package.json'));
    return require('typescript') as TypeScriptApi;
  } catch {
    return null;
  }
};

const listSourceFiles = (dir: string): string[] => {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(fullPath);
    }
  };
  walk(dir);
  return files;
};

const compilerOptions = (
  ts: TypeScriptApi,
  format: PackFormat,
  rootDir: string,
  outDir: string,
): TypeScript.CompilerOptions => ({
  target: ts.ScriptTarget.ES2020,
  module: format === 'esm' ? ts.ModuleKind.ESNext : ts.ModuleKind.CommonJS,
  moduleResolution:
    format === 'esm' ? ts.ModuleResolutionKind.Bundler : ts.ModuleResolutionKind.Node10,
  // The generated client uses fetch/Headers/Response; no @types are assumed
  lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  types: [],
  declaration: true,
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
  rootDir,
  outDir,
  newLine: ts.NewLineKind.LineFeed,
});

// Returns formatted diagnostics; an empty list means the emit succeeded
export const compileDirectory = (
  ts: TypeScriptApi,
  rootDir: string,
  outDir: string,
  format: PackFormat,
): readonly string[] => {
  const program = ts.createProgram(
    listSourceFiles(rootDir),
    compilerOptions(ts, format, rootDir, outDir),
  );
  const emitResult = program.emit();
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitResult.diagnostics];
  return diagnostics.map((diagnostic) => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (!diagnostic.file || diagnostic.start === undefined) return message;
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    const file = path.relative(rootDir, diagnostic.file.fileName);
    return `${file}:${line + 1}:${character + 1} ${message}`;
  });
};
