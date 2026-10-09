import type { TypeOverride } from '../../types';
import { FILE_HEADER } from '../../constants';
import { detectUsedFunctions } from './functions';

export const buildOverridesFileContent = (overrides: readonly TypeOverride[]): string => {
  const allSchemaCode = overrides
    .map(
      (o) =>
        `export const ${o.name} = ${o.schema};\n\nexport type ${o.typeName} = InferInput<typeof ${o.name}>;`,
    )
    .join('\n\n');

  const usedFunctions = new Set<string>(['InferInput', ...detectUsedFunctions(allSchemaCode)]);

  const sorted = Array.from(usedFunctions).sort();
  const typeImports = sorted.filter((f) => f === 'InferInput').map((t) => `type ${t}`);
  const valueImports = sorted.filter((f) => f !== 'InferInput');
  const importStatement = `import { ${[...typeImports, ...valueImports].join(', ')} } from 'valibot';`;

  return [FILE_HEADER, importStatement, '', allSchemaCode, ''].join('\n');
};
