// ESM under node16 resolution needs explicit file extensions on relative
// specifiers; the generator emits extensionless ones because bundlers and the
// CJS build accept them. The rewrite is textual on purpose: the generator only
// ever emits `from '<spec>'`, `import '<spec>'` and `import('<spec>')`.
export type SpecifierTarget = 'file' | 'directory' | null;

const RELATIVE_SPECIFIER =
  /((?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)['"])(\.{1,2}\/[^'"]+)(['"])/g;

const hasExtension = (specifier: string): boolean => /\.[A-Za-z0-9]+$/.test(specifier);

export const rewriteRelativeSpecifiers = (
  code: string,
  classify: (specifier: string) => SpecifierTarget,
): string =>
  code.replace(RELATIVE_SPECIFIER, (match, prefix: string, specifier: string, quote: string) => {
    if (hasExtension(specifier)) return match;
    const target = classify(specifier);
    if (target === 'file') return `${prefix}${specifier}.js${quote}`;
    if (target === 'directory') return `${prefix}${specifier}/index.js${quote}`;
    return match;
  });
