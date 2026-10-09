import * as path from 'node:path';

import { componentUidToCategory, componentUidToFileName } from '../utils';
import type { ExternalImport } from './schema-registry';

const relPath = (fromDir: string, toFile: string): string => {
  const rel = path.relative(fromDir, toFile).replace(/\\/g, '/');
  return rel.startsWith('.') ? rel : `./${rel}`;
};

const resolveRelativeImportPath = (fromRelDir: string, imp: ExternalImport): string => {
  switch (imp.source) {
    case 'upload-file':
      return relPath(fromRelDir, 'shared/upload-file');
    case 'component':
      return imp.uid
        ? relPath(
            fromRelDir,
            `components/${componentUidToCategory(imp.uid)}/${componentUidToFileName(imp.uid)}`,
          )
        : `./${imp.schemaVarName}`;
    case 'content-type':
      return imp.uid
        ? relPath(fromRelDir, `content-types/${imp.uid.split('.').pop() ?? imp.schemaVarName}`)
        : `./${imp.schemaVarName}`;
    case 'override':
      return relPath(fromRelDir, 'shared/overrides');
  }
};

export const buildExternalImportStatements = (
  imports: readonly ExternalImport[],
  fromRelDir: string,
): readonly string[] => {
  const grouped = imports.reduce((acc, imp) => {
    const importPath = resolveRelativeImportPath(fromRelDir, imp);
    return acc.set(importPath, [...(acc.get(importPath) ?? []), imp.schemaVarName]);
  }, new Map<string, readonly string[]>());

  return [...grouped.entries()].map(
    ([importPath, names]) => `import { ${names.join(', ')} } from '${importPath}';`,
  );
};
