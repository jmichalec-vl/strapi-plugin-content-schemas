import { describe, it, expect } from 'vitest';

import { rewriteRelativeSpecifiers } from '../../../cli/src/pack-specifiers';

const classify = (specifier: string) =>
  specifier.endsWith('/views') ? 'directory' : specifier.includes('missing') ? null : 'file';

describe('rewriteRelativeSpecifiers', () => {
  it('adds .js to relative file imports and exports', () => {
    const code = [
      "import { ASchema } from './content-types/a';",
      "import type { A } from '../content-types/a';",
      "export { B } from './b';",
      "export * from './c';",
    ].join('\n');

    expect(rewriteRelativeSpecifiers(code, classify)).toBe(
      [
        "import { ASchema } from './content-types/a.js';",
        "import type { A } from '../content-types/a.js';",
        "export { B } from './b.js';",
        "export * from './c.js';",
      ].join('\n'),
    );
  });

  it('points directory re-exports at their index file', () => {
    expect(rewriteRelativeSpecifiers("export * from './views';", classify)).toBe(
      "export * from './views/index.js';",
    );
  });

  it('leaves bare specifiers, extensions and unknown targets alone', () => {
    const code = [
      "import { z } from 'zod';",
      "import { x } from './data.json';",
      "import { y } from './missing';",
      "import('./lazy')",
    ].join('\n');

    expect(rewriteRelativeSpecifiers(code, classify)).toBe(
      [
        "import { z } from 'zod';",
        "import { x } from './data.json';",
        "import { y } from './missing';",
        "import('./lazy.js')",
      ].join('\n'),
    );
  });
});
