import type { ContentTypeIR, SchemaTarget } from '../types';
import { getAdapter } from '../mappers/target-adapter';
import {
  CLIENT_CONFIG_INTERFACE,
  LIST_RESPONSE_INTERFACE,
  PAGINATION_META_INTERFACE,
  REQUEST_OPTIONS_INTERFACE,
  RETRY_DEFAULTS,
  VIEW_REQUEST_OPTIONS_INTERFACE,
  VIEW_REQUEST_RUNTIME,
  buildRuntimeCore,
} from './client-runtime-template';
import { FILE_HEADER } from '../constants';
import {
  toCamelCase,
  toSchemaVarName,
  toTypeExportName,
  toPopulateVarName,
  toPopulateTypeName,
  escapeTemplateLiteral,
} from '../utils';

// A bff-views view the client should expose under `strapi.views.*`. Built by
// the code-writer from the view manifest + viewResponseSchemas declarations.
export interface ViewClientEntry {
  readonly id: string;
  // Route template relative to /api/bff-views, e.g. '/page-view/:slug'
  readonly path: string;
  // null for keyless views (singleton/composite, bff-views 0.2.0) - their
  // client methods take no key argument
  readonly keyParam: string | null;
  // Full-envelope schema + inferred type exported from ../views/<id>, or null
  // for assemble views without a viewResponseSchemas declaration
  readonly schemaExport: string | null;
  readonly typeExport: string | null;
}

const generateSchemaImports = (
  contentTypes: readonly ContentTypeIR[],
  populateTypeNames: ReadonlySet<string>,
): string =>
  contentTypes
    .map((ct) => {
      const schemaVar = toSchemaVarName(ct.singularName);
      const typeName = toTypeExportName(ct.singularName);
      const populateType = toPopulateTypeName(ct.singularName);
      const typeImports = populateTypeNames.has(ct.singularName)
        ? `type ${typeName}, type ${populateType}`
        : `type ${typeName}`;
      return `import { ${schemaVar}, ${typeImports} } from '../content-types/${ct.singularName}';`;
    })
    .join('\n');

const generatePopulateImports = (contentTypes: readonly ContentTypeIR[]): string =>
  contentTypes
    .map((ct) => {
      const populateVar = toPopulateVarName(ct.singularName);
      return `import { ${populateVar} } from '../content-types/${ct.singularName}';`;
    })
    .join('\n');

// Single types are singular everywhere: endpoint, return type, and cardinality
// - so the accessor is too (client.header.find(), not client.headers.find())
const clientPropertyBaseName = (ct: ContentTypeIR): string =>
  ct.kind === 'singleType' ? ct.singularName : ct.pluralName;

const generateInterfaceMethod = (
  ct: ContentTypeIR,
  populateTypeNames: ReadonlySet<string>,
): string => {
  const typeName = toTypeExportName(ct.singularName);
  const hasPopulateType = populateTypeNames.has(ct.singularName);
  const optionsType = hasPopulateType
    ? `RequestOptions<${toPopulateTypeName(ct.singularName)}>`
    : 'RequestOptions';

  if (ct.kind === 'singleType') {
    return `    find: (options?: ${optionsType}) => Promise<${typeName} | null>;`;
  }

  return [
    `    findMany: (options?: ${optionsType}) => Promise<StrapiListResponse<${typeName}>>;`,
    `    findOne: (documentId: string, options?: ${optionsType}) => Promise<${typeName} | null>;`,
  ].join('\n');
};

const generateImplementationMethod = (ct: ContentTypeIR, target: SchemaTarget): string => {
  const schemaVar = toSchemaVarName(ct.singularName);
  const populateVar = toPopulateVarName(ct.singularName);
  const endpoint = ct.kind === 'singleType' ? ct.singularName : ct.pluralName;
  const adapter = getAdapter(target);
  const arrayWrap = adapter.arrayWrap(schemaVar);

  if (ct.kind === 'singleType') {
    return `    find: (options?) => request('${endpoint}', ${schemaVar}, ${populateVar}, options),`;
  }

  return [
    `    findMany: (options?) => requestList('${endpoint}', ${arrayWrap}, ${populateVar}, options),`,
    `    findOne: (documentId, options?) => request(\`${endpoint}/\${documentId}\`, ${schemaVar}, ${populateVar}, options),`,
  ].join('\n');
};

// Strapi-specific replacement for `qs` (bracket syntax, values-only encoding) so the
// generated client has zero runtime dependencies
const QUERY_STRING_CODE = `const appendPair = (pairs: string[], key: string, value: unknown): void => {
  if (value === undefined) return;
  if (value === null) {
    pairs.push(\`\${key}=\`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendPair(pairs, \`\${key}[\${index}]\`, item));
    return;
  }
  if (value instanceof Date) {
    pairs.push(\`\${key}=\${encodeURIComponent(value.toISOString())}\`);
    return;
  }
  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      appendPair(pairs, \`\${key}[\${childKey}]\`, childValue);
    }
    return;
  }
  pairs.push(\`\${key}=\${encodeURIComponent(String(value))}\`);
};

export const serializeQuery = (params: Record<string, unknown>): string => {
  const pairs: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    appendPair(pairs, key, value);
  }
  return pairs.join('&');
};`;

export const generateQueryStringCode = (): string =>
  [FILE_HEADER, QUERY_STRING_CODE, ''].join('\n');

// Structured request failure - carries status/url/body so consumers branch on
// fields instead of regex-parsing error messages
const REQUEST_ERROR_CODE = `export class StrapiRequestError extends Error {
  public readonly status: number;
  public readonly url: string;
  // Parsed response body when it was JSON (e.g. Strapi's error envelope)
  public readonly body: unknown;

  constructor(context: { readonly status: number; readonly url: string; readonly body: unknown }) {
    super(\`Strapi request failed: \${context.status} (\${context.url})\`);
    this.name = 'StrapiRequestError';
    this.status = context.status;
    this.url = context.url;
    this.body = context.body;
  }
}`;

export const generateRequestErrorCode = (): string =>
  [FILE_HEADER, REQUEST_ERROR_CODE, ''].join('\n');

const generateViewImports = (viewEntries: readonly ViewClientEntry[]): readonly string[] =>
  viewEntries.flatMap((view) =>
    view.schemaExport
      ? [`import { ${view.schemaExport}, type ${view.typeExport} } from '../views/${view.id}';`]
      : [],
  );

const generateClientInterface = (
  contentTypes: readonly ContentTypeIR[],
  populateTypeNames: ReadonlySet<string>,
  viewEntries: readonly ViewClientEntry[],
): string => {
  const interfaceMembers = contentTypes
    .map((ct) => {
      const propName = toCamelCase(clientPropertyBaseName(ct));
      const methods = generateInterfaceMethod(ct, populateTypeNames);
      return `  readonly ${propName}: {\n${methods}\n  };`;
    })
    .join('\n');

  const viewInterfaceMembers = viewEntries
    .map((view) => {
      const methodName = toCamelCase(view.id);
      const args = view.keyParam
        ? `${view.keyParam}: string, options?: ViewRequestOptions`
        : `options?: ViewRequestOptions`;
      if (!view.typeExport) {
        // No viewResponseSchemas declaration - envelope handling only
        return `    /** Declare viewResponseSchemas['${view.id}'] for typed validation */\n    readonly ${methodName}: (${args}) => Promise<unknown | null>;`;
      }
      return `    readonly ${methodName}: (${args}) => Promise<${view.typeExport} | null>;`;
    })
    .join('\n');
  const viewsGroup =
    viewEntries.length > 0 ? `\n  readonly views: {\n${viewInterfaceMembers}\n  };` : '';

  return `export interface StrapiClient {\n${interfaceMembers}${viewsGroup}\n}`;
};

const generateViewImplementation = (view: ViewClientEntry): string => {
  const methodName = toCamelCase(view.id);
  const schemaArg = view.schemaExport ?? 'null';
  const typeArg = view.typeExport ?? 'unknown';
  // The manifest path lands inside a template literal; escape it before
  // splicing in our own `${encodeURIComponent(...)}` interpolation
  const safePath = escapeTemplateLiteral(view.path);
  if (!view.keyParam) {
    return `      ${methodName}: (options?) => viewRequest<${typeArg}>(\`${safePath}\`, ${schemaArg}, options),`;
  }
  // '/page-view/:slug' -> `/page-view/${encodeURIComponent(slug)}`
  const pathExpr = safePath.replace(
    `:${view.keyParam}`,
    `\${encodeURIComponent(${view.keyParam})}`,
  );
  return `      ${methodName}: (${view.keyParam}, options?) => viewRequest<${typeArg}>(\`${pathExpr}\`, ${schemaArg}, options),`;
};

const generateClientObject = (
  contentTypes: readonly ContentTypeIR[],
  target: SchemaTarget,
  viewEntries: readonly ViewClientEntry[],
): string => {
  const implementations = contentTypes
    .map((ct) => {
      const propName = toCamelCase(clientPropertyBaseName(ct));
      const methods = generateImplementationMethod(ct, target);
      return `    ${propName}: {\n  ${methods}\n    },`;
    })
    .join('\n');
  const views =
    viewEntries.length > 0
      ? [`    views: {\n${viewEntries.map(generateViewImplementation).join('\n')}\n    },`]
      : [];

  return ['  return {', implementations, ...views, '  };', '};'].join('\n');
};

export const generateClientCode = (
  contentTypes: readonly ContentTypeIR[],
  populateTypeNames: ReadonlySet<string>,
  target: SchemaTarget = 'valibot',
  viewEntries: readonly ViewClientEntry[] = [],
): string => {
  const adapter = getAdapter(target);
  const hasViews = viewEntries.length > 0;

  return [
    FILE_HEADER,
    `import { serializeQuery } from './query-string';`,
    adapter.validationImport,
    `import { StrapiSchemaValidationError } from './schema-validation-error';`,
    `import { StrapiRequestError } from './request-error';`,
    generateSchemaImports(contentTypes, populateTypeNames),
    generatePopulateImports(contentTypes),
    ...generateViewImports(viewEntries),
    '',
    CLIENT_CONFIG_INTERFACE,
    '',
    PAGINATION_META_INTERFACE,
    '',
    LIST_RESPONSE_INTERFACE,
    '',
    REQUEST_OPTIONS_INTERFACE,
    ...(hasViews ? ['', VIEW_REQUEST_OPTIONS_INTERFACE] : []),
    '',
    generateClientInterface(contentTypes, populateTypeNames, viewEntries),
    '',
    RETRY_DEFAULTS,
    '',
    buildRuntimeCore(adapter.validationCode),
    ...(hasViews ? [VIEW_REQUEST_RUNTIME] : []),
    '',
    generateClientObject(contentTypes, target, viewEntries),
    '',
  ].join('\n');
};

const SHARED_ERROR_CODE = `
const IDENTIFIER_FIELDS = [
  '__component',
  'slug',
  'name',
  'title',
  'documentId',
  'sku',
] as const;

const extractIdentifiers = (value: Record<string, unknown>): string => {
  const identifiers: string[] = [];
  for (const field of IDENTIFIER_FIELDS) {
    if (field in value && typeof value[field] === 'string') {
      identifiers.push(\`\${field}: "\${value[field]}"\`);
    }
  }
  return identifiers.join(', ');
};
`;

const VALIBOT_ERROR_CODE = `import { type BaseIssue, getDotPath } from 'valibot';
${SHARED_ERROR_CODE}
interface ErrorContext {
  readonly endpoint: string;
  readonly method: string;
  readonly status: number;
  readonly issues: ReadonlyArray<BaseIssue<unknown>>;
}

export class StrapiSchemaValidationError extends Error {
  public readonly endpoint: string;
  public readonly method: string;
  public readonly status: number;
  public readonly issues: ReadonlyArray<BaseIssue<unknown>>;
  public readonly issueCount: number;

  constructor(context: ErrorContext) {
    const formatted = formatValidationError(context);
    super(formatted);
    this.name = 'StrapiSchemaValidationError';
    this.endpoint = context.endpoint;
    this.method = context.method;
    this.status = context.status;
    this.issues = context.issues;
    this.issueCount = context.issues.length;
  }
}

const formatContext = (path: BaseIssue<unknown>['path']): string => {
  if (!path || path.length === 0) return '';
  const lines: string[] = [];

  path.forEach((item, index) => {
    if (item.value === null || typeof item.value !== 'object') return;
    const identifiers = extractIdentifiers(item.value as Record<string, unknown>);
    if (!identifiers) return;

    const parentItem = index > 0 ? path[index - 1] : null;
    const displayKey =
      parentItem && typeof item.key === 'number'
        ? \`\${String(parentItem.key)}[\${item.key}]\`
        : String(item.key);

    lines.push(\`    \${displayKey.padEnd(20)}→ \${identifiers}\`);
  });

  if (lines.length === 0) return '';
  return \`\\n  Context:\\n\${lines.join('\\n')}\`;
};

const formatSingleIssue = (issue: BaseIssue<unknown>): string => {
  const dotPath = getDotPath(issue) ?? 'root';
  const expectedReceived =
    issue.expected === null
      ? \`  Message: \${issue.message}\`
      : \`  Expected: \${issue.expected} | Received: \${issue.received}\`;
  const context = formatContext(issue.path);
  return \`  Path: \${dotPath}\\n\${expectedReceived}\${context}\`;
};

const formatValidationError = (ctx: ErrorContext): string => {
  const count = ctx.issues.length;
  const header = [
    \`Strapi schema validation failed (\${count} \${count === 1 ? 'issue' : 'issues'}):\`,
    \`  Endpoint: \${ctx.method} /api/\${ctx.endpoint}\`,
    \`  Status: \${ctx.status}\`,
  ].join('\\n');

  const body = ctx.issues.map(formatSingleIssue).join('\\n\\n');
  return \`\${header}\\n\\n\${body}\`;
};`;

const ZOD_ERROR_CODE = `import { type ZodIssue } from 'zod';
${SHARED_ERROR_CODE}
interface ErrorContext {
  readonly endpoint: string;
  readonly method: string;
  readonly status: number;
  readonly issues: readonly unknown[];
}

export class StrapiSchemaValidationError extends Error {
  public readonly endpoint: string;
  public readonly method: string;
  public readonly status: number;
  public readonly issues: readonly unknown[];
  public readonly issueCount: number;

  constructor(context: ErrorContext) {
    const formatted = formatValidationError(context);
    super(formatted);
    this.name = 'StrapiSchemaValidationError';
    this.endpoint = context.endpoint;
    this.method = context.method;
    this.status = context.status;
    this.issues = context.issues;
    this.issueCount = context.issues.length;
  }
}

const formatSingleIssue = (issue: unknown): string => {
  const zodIssue = issue as ZodIssue;
  const dotPath = zodIssue.path?.join('.') || 'root';
  return \`  Path: \${dotPath}\\n  Message: \${zodIssue.message}\`;
};

const formatValidationError = (ctx: ErrorContext): string => {
  const count = ctx.issues.length;
  const header = [
    \`Strapi schema validation failed (\${count} \${count === 1 ? 'issue' : 'issues'}):\`,
    \`  Endpoint: \${ctx.method} /api/\${ctx.endpoint}\`,
    \`  Status: \${ctx.status}\`,
  ].join('\\n');

  const body = ctx.issues.map(formatSingleIssue).join('\\n\\n');
  return \`\${header}\\n\\n\${body}\`;
};`;

const ERROR_CODE_MAP: Readonly<Record<string, string>> = {
  valibot: VALIBOT_ERROR_CODE,
  zod: ZOD_ERROR_CODE,
};

export const generateErrorClassCode = (target: SchemaTarget = 'valibot'): string =>
  [FILE_HEADER, ERROR_CODE_MAP[target] ?? VALIBOT_ERROR_CODE, ''].join('\n');
