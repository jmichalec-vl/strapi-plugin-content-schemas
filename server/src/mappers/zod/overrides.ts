import type { TypeOverride } from '../../types';
import { FILE_HEADER } from '../../constants';

export const buildOverridesFileContent = (overrides: readonly TypeOverride[]): string => {
  const allSchemaCode = overrides
    .map(
      (o) =>
        `export const ${o.name} = ${o.schema};\n\nexport type ${o.typeName} = z.infer<typeof ${o.name}>;`,
    )
    .join('\n\n');

  return [FILE_HEADER, `import { z } from 'zod';`, '', allSchemaCode, ''].join('\n');
};
