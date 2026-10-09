// For interpolating arbitrary strings (enum values, UIDs) into generated
// single-quoted literals. Line terminators (incl. U+2028/U+2029, which JS
// treats as such) would otherwise end the literal early.
export const escapeSingleQuoted = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

// For interpolating arbitrary strings into generated template literals: a
// backtick or `${` in the value would otherwise break out of the literal
export const escapeTemplateLiteral = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

export const toPascalCase = (input: string): string =>
  input
    .split(/[-_\s]+/)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');

export const toSchemaVarName = (singularName: string): string =>
  `${toPascalCase(singularName)}Schema`;

export const toTypeExportName = (singularName: string): string => toPascalCase(singularName);

// 'api::article.article' -> 'article'; generated content-type file and type
// names derive from this segment
export const contentTypeUidToSingularName = (uid: string): string => uid.split('.').pop() ?? uid;

export const componentUidToCategory = (uid: string): string => uid.split('.')[0] ?? uid;

export const componentUidToName = (uid: string): string => uid.split('.')[1] ?? uid;

// Component identifiers are unconditionally category-prefixed
// ('catalog.consultation' → CatalogConsultation…): component names are only
// unique per category, so a bare name can collide with a content type or with
// a same-named component in another category. Prefixing always (rather than
// only on collision) keeps generated names stable when the content model grows.
//
// Residual collisions (a content type named like a prefixed component, e.g.
// api::catalog-form.catalog-form vs catalog.form) are resolved surgically via
// the `nameOverrides` config option. The override map is module state set once
// at the top of every (synchronous) generation run rather than threaded
// through every naming call site.
let componentNameOverrides: Readonly<Record<string, string>> = {};

export const setComponentNameOverrides = (overrides: Readonly<Record<string, string>>): void => {
  componentNameOverrides = overrides;
};

const componentUidToPascalName = (uid: string): string =>
  componentNameOverrides[uid] ??
  `${toPascalCase(componentUidToCategory(uid))}${toPascalCase(componentUidToName(uid))}`;

export const componentUidToSchemaVarName = (uid: string): string =>
  `${componentUidToPascalName(uid)}Schema`;

export const componentUidToTypeName = (uid: string): string => componentUidToPascalName(uid);

// File names stay category-free - the components/<category>/ directory already
// disambiguates them.
export const componentUidToFileName = (uid: string): string => componentUidToName(uid);

export const toCamelCase = (input: string): string => {
  const pascal = toPascalCase(input);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
};

export const toPopulateVarName = (singularName: string): string =>
  `${toCamelCase(singularName)}Populate`;

export const toPopulateTypeName = (singularName: string): string =>
  `${toPascalCase(singularName)}PopulateInput`;

export const componentUidToPopulateTypeName = (uid: string): string =>
  `${componentUidToPascalName(uid)}PopulateInput`;

export const componentUidToPopulateVarName = (uid: string): string => {
  const pascal = componentUidToPascalName(uid);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}Populate`;
};
