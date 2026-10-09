import { describe, it, expect } from 'vitest';

import { mergeImports } from '../../../../server/src/services/code-writer';

describe('mergeImports', () => {
  it('merges value and type imports from the same module into one sorted line', () => {
    const merged = mergeImports([
      "import { BSchema } from './b';",
      "import type { B } from './b';",
      "import { ASchema, type A } from './b';",
    ]);

    expect(merged).toEqual(["import { ASchema, BSchema, type A, type B } from './b';"]);
  });

  it('deduplicates names and keeps distinct modules apart', () => {
    const merged = mergeImports([
      "import { XSchema } from './x';",
      "import { XSchema } from './x';",
      "import { YSchema } from './y';",
    ]);

    expect(merged).toEqual(["import { XSchema } from './x';", "import { YSchema } from './y';"]);
  });

  it('keeps lines it cannot parse verbatim and ahead of merged lines', () => {
    const merged = mergeImports([
      "import { ASchema } from './a';",
      "import * as v from 'valibot';",
      '',
      "import type { InferOutput } from 'valibot';",
    ]);

    expect(merged).toEqual([
      "import * as v from 'valibot';",
      "import { ASchema } from './a';",
      "import { type InferOutput } from 'valibot';",
    ]);
  });
});
