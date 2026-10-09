import type {
  BffViewManifest,
  ComponentIR,
  ContentTypeIR,
  GenerationOptions,
  TypeOverride,
} from '../types';
import { FILE_HEADER } from '../constants';
import {
  toSchemaVarName,
  toTypeExportName,
  toPopulateVarName,
  toPopulateTypeName,
  componentUidToCategory,
  componentUidToFileName,
  componentUidToSchemaVarName,
  componentUidToTypeName,
  componentUidToPopulateTypeName,
  componentUidToPopulateVarName,
  setComponentNameOverrides,
  contentTypeUidToSingularName,
} from '../utils';
import { getAdapter, type TargetAdapter } from '../mappers/target-adapter';
import '../mappers/valibot/index';
import '../mappers/zod/index';
import { buildSchemaRegistry, type SchemaRegistry } from '../generators/schema-registry';
import { buildExternalImportStatements } from '../generators/import-resolver';
import {
  topologicalSort,
  collectCycleUIDs,
  collectKnownComponentRefs,
} from '../generators/dependency-graph';
import {
  collectUsedOverrides,
  type OverrideConfig,
  resolveAttributeOverride,
} from '../generators/override-resolver';
import { collectEnumArtifacts } from '../generators/enum-generator';
import { buildComponentUsage, type ComponentUsageIndex } from '../generators/component-usage';
import { hasPopulatableAttributes, POPULATABLE_TYPES, POPULATE_REF_TYPES } from '../types/ir';
import { GenerationError } from '../errors';
import { generateViewFiles, type ViewGenerationOutput } from '../generators/view-schema-generator';
import { generateMockFiles } from '../generators/mock-generator';
import {
  generatePopulateCode,
  generateComponentPopulateCode,
  collectPopulateImportUIDs,
  type ComponentRegistry,
} from '../generators/populate-generator';
import {
  generateContentTypePopulateType,
  generateComponentPopulateType,
} from '../generators/populate-type-generator';
import {
  generateClientCode,
  generateErrorClassCode,
  generateQueryStringCode,
  generateRequestErrorCode,
  type ViewClientEntry,
} from '../generators/client-generator';
import { toPascalCase } from '../utils';

// File and registry names are derived from singularName / the component name
// segment only, so two entities can silently map to the same identifier -
// which corrupts the generated output. Fail loudly instead.
const validateUniqueOutputNames = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
): void => {
  const byVarName = new Map<string, string[]>();
  for (const ct of contentTypes) {
    const varName = toSchemaVarName(ct.singularName);
    byVarName.set(varName, [...(byVarName.get(varName) ?? []), ct.uid]);
  }
  for (const comp of components) {
    const varName = componentUidToSchemaVarName(comp.uid);
    byVarName.set(varName, [...(byVarName.get(varName) ?? []), comp.uid]);
  }

  const collisions = [...byVarName].filter(([, uids]) => uids.length > 1);
  if (collisions.length > 0) {
    const details = collisions
      .map(([varName, uids]) => `${varName} <- ${uids.join(', ')}`)
      .join('; ');
    throw new GenerationError(
      `[content-schemas] Name collision in generated output: ${details}. ` +
        `Resolve it with a nameOverrides entry for the component ` +
        `(e.g. nameOverrides: { '<component-uid>': 'SomeOtherName' }), rename the ` +
        `conflicting entities, or exclude some of them via the contentTypes/components ` +
        `config filters.`,
    );
  }

  const reserved = contentTypes.find((ct) => ct.singularName === 'registry');
  if (reserved) {
    throw new GenerationError(
      `[content-schemas] Content type "${reserved.uid}" uses the reserved singular name ` +
        `"registry" (collides with the generated content-types/registry.ts). Rename it or ` +
        `exclude it via the contentTypes config filter.`,
    );
  }
};

interface ParsedImport {
  readonly typeNames: readonly string[];
  readonly valueNames: readonly string[];
  readonly from: string;
}

const parseImport = (line: string): ParsedImport | null => {
  const typeMatch = line.match(/^import\s+type\s+\{\s*(.+?)\s*\}\s*from\s+'(.+?)';$/);
  if (typeMatch?.[1] && typeMatch[2]) {
    return {
      typeNames: typeMatch[1].split(',').map((s) => s.trim()),
      valueNames: [],
      from: typeMatch[2],
    };
  }

  const valueMatch = line.match(/^import\s+\{\s*(.+?)\s*\}\s*from\s+'(.+?)';$/);
  if (valueMatch?.[1] && valueMatch[2]) {
    const names = valueMatch[1].split(',').map((s) => s.trim());
    const types = names.filter((n) => n.startsWith('type ')).map((n) => n.replace('type ', ''));
    const values = names.filter((n) => !n.startsWith('type '));
    return { typeNames: types, valueNames: values, from: valueMatch[2] };
  }

  return null;
};

// Exported for direct unit coverage of the merge rules
export const mergeImports = (imports: readonly string[]): readonly string[] => {
  const grouped = new Map<string, { types: Set<string>; values: Set<string> }>();
  const unparsed: string[] = [];

  for (const line of imports) {
    if (!line) continue;
    const parsed = parseImport(line);
    if (!parsed) {
      unparsed.push(line);
      continue;
    }

    const existing = grouped.get(parsed.from) ?? { types: new Set(), values: new Set() };
    parsed.typeNames.forEach((n) => existing.types.add(n));
    parsed.valueNames.forEach((n) => existing.values.add(n));
    grouped.set(parsed.from, existing);
  }

  const merged = [...grouped.entries()].map(([from, { types, values }]) => {
    const parts = [
      ...Array.from(values).sort(),
      ...Array.from(types)
        .sort()
        .map((t) => `type ${t}`),
    ];
    return `import { ${parts.join(', ')} } from '${from}';`;
  });

  return [...unparsed, ...merged];
};

const buildFileContent = (
  valibotImport: string,
  externalImports: readonly string[],
  schemaCode: string,
  extraImports: readonly string[] = [],
): string => {
  const allImports = mergeImports([...extraImports, ...externalImports]);
  return [FILE_HEADER, valibotImport, ...allImports, '', schemaCode, ''].join('\n');
};

const buildBarrelContent = (
  contentTypes: readonly ContentTypeIR[],
  populateVarNames: readonly { singularName: string; varName: string }[],
  populateTypeNames: ReadonlySet<string>,
  hasClient: boolean,
  hasViews: boolean,
): string => {
  const parts: string[] = [FILE_HEADER];

  parts.push(
    ...contentTypes.map((ct) => {
      const schemaVar = toSchemaVarName(ct.singularName);
      const typeName = toTypeExportName(ct.singularName);
      const populateType = toPopulateTypeName(ct.singularName);
      const typeExports = populateTypeNames.has(ct.singularName)
        ? `type ${typeName}, type ${populateType}`
        : `type ${typeName}`;
      // A bare specifier exports both the const object and its merged type
      const enumExports = collectEnumArtifacts(typeName, ct.attributes)
        .map((artifact) => `, ${artifact.name}`)
        .join('');
      return `export { ${schemaVar}, ${typeExports}${enumExports} } from './content-types/${ct.singularName}';`;
    }),
  );

  if (populateVarNames.length > 0) {
    parts.push(
      ...populateVarNames.map(
        ({ singularName, varName }) =>
          `export { ${varName} } from './content-types/${singularName}';`,
      ),
    );
  }

  if (hasClient) {
    parts.push(
      "export { createStrapiClient, type StrapiClient, type StrapiListResponse, type StrapiPaginationMeta } from './client/strapi-client';",
    );
    parts.push("export { StrapiSchemaValidationError } from './client/schema-validation-error';");
    parts.push("export { StrapiRequestError } from './client/request-error';");
  }

  if (hasViews) {
    parts.push("export * from './views';");
  }

  parts.push('');
  return parts.join('\n');
};

const collectContentTypeTypeImports = (
  ct: ContentTypeIR,
  registry: SchemaRegistry,
  overrideConfig: OverrideConfig,
): readonly string[] => {
  const imports: string[] = [];

  const hasMedia = ct.attributes.some((a) => a.type === 'media');
  if (hasMedia) {
    imports.push("import type { UploadFile } from '../shared/upload-file';");
  }

  // Field overrides shadow type overrides - import only the one that is
  // actually resolved (and therefore exported from shared/overrides.ts)
  const overrideNames = new Set<string>(
    ct.attributes.flatMap((attr) => {
      const resolved = resolveAttributeOverride(attr, ct.uid, overrideConfig);
      return resolved ? [resolved.typeName] : [];
    }),
  );
  if (overrideNames.size > 0) {
    imports.push(
      `import type { ${Array.from(overrideNames).sort().join(', ')} } from '../shared/overrides';`,
    );
  }

  const componentUIDs = collectKnownComponentRefs(ct.attributes, (uid) =>
    registry.components.has(uid),
  );

  for (const uid of componentUIDs) {
    const category = componentUidToCategory(uid);
    const fileName = componentUidToFileName(uid);
    const typeName = componentUidToTypeName(uid);
    imports.push(`import type { ${typeName} } from '../components/${category}/${fileName}';`);
  }

  return imports;
};

const collectPopulateTypeImports = (
  ct: ContentTypeIR,
  registry: SchemaRegistry,
  componentRegistry: ComponentRegistry,
  populatableContentTypeUIDs: ReadonlySet<string>,
): readonly string[] => {
  const imports: string[] = [];

  const componentUIDs = collectKnownComponentRefs(ct.attributes, (uid) =>
    registry.components.has(uid),
  );

  for (const uid of componentUIDs) {
    const comp = componentRegistry[uid];
    if (!comp) continue;
    if (!hasPopulatableAttributes(comp.attributes)) continue;

    const category = componentUidToCategory(uid);
    const fileName = componentUidToFileName(uid);
    const populateTypeName = componentUidToPopulateTypeName(uid);
    imports.push(
      `import type { ${populateTypeName} } from '../components/${category}/${fileName}';`,
    );
  }

  const relationTargets = [
    ...new Set(
      ct.attributes.flatMap((a) =>
        a.type === 'relation' &&
        a.relationTarget &&
        registry.contentTypes.has(a.relationTarget) &&
        // Scalar-only targets have no PopulateInput to import
        populatableContentTypeUIDs.has(a.relationTarget)
          ? [a.relationTarget]
          : [],
      ),
    ),
  ];

  for (const target of relationTargets) {
    const targetSingularName = contentTypeUidToSingularName(target);
    if (targetSingularName === ct.singularName) continue;
    const populateTypeName = toPopulateTypeName(targetSingularName);
    imports.push(`import type { ${populateTypeName} } from './${targetSingularName}';`);
  }

  return imports;
};

const collectComponentPopulateTypeImports = (
  comp: ComponentIR,
  relDir: string,
  componentRegistry: ComponentRegistry,
): readonly string[] => {
  // Dynamic-zone members are referenced from the populate `on:` block exactly
  // like nested components, so they need the same imports
  const nestedUIDs = collectKnownComponentRefs(comp.attributes, (uid) => !!componentRegistry[uid]);

  const hasPopulatableType = (uid: string): boolean => {
    const nested = componentRegistry[uid];
    return !!nested && nested.attributes.some((a) => POPULATABLE_TYPES.has(a.type));
  };

  const hasPopulateConstant = (uid: string): boolean => {
    const nested = componentRegistry[uid];
    return !!nested && nested.attributes.some((a) => POPULATE_REF_TYPES.has(a.type));
  };

  const filteredUIDs = nestedUIDs.filter((uid) => uid !== comp.uid && hasPopulatableType(uid));

  return filteredUIDs.flatMap((uid) => {
    const category = componentUidToCategory(uid);
    const fileName = componentUidToFileName(uid);
    const targetDir = `components/${category}`;
    const relativePath = relDir === targetDir ? `./${fileName}` : `../${category}/${fileName}`;
    const imports: string[] = [];

    imports.push(`import type { ${componentUidToPopulateTypeName(uid)} } from '${relativePath}';`);
    if (hasPopulateConstant(uid)) {
      imports.push(`import { ${componentUidToPopulateVarName(uid)} } from '${relativePath}';`);
    }

    return imports;
  });
};

// Everything derived once per generation and shared by every emitter
interface GenerationContext {
  readonly config: GenerationOptions;
  readonly adapter: TargetAdapter;
  readonly registry: SchemaRegistry;
  readonly components: readonly ComponentIR[];
  readonly sortedContentTypes: readonly ContentTypeIR[];
  readonly componentUsage: ComponentUsageIndex;
  readonly componentRegistry: ComponentRegistry;
  readonly populatableContentTypeUIDs: ReadonlySet<string>;
  readonly overrideConfig: OverrideConfig;
  readonly hasClient: boolean;
}

const buildGenerationContext = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
  config: GenerationOptions,
): GenerationContext => {
  const componentUsage = buildComponentUsage(contentTypes, components);
  const registry = buildSchemaRegistry(
    contentTypes,
    components,
    componentUsage.dualUseUIDs,
    collectCycleUIDs(components),
  );

  return {
    config,
    adapter: getAdapter(config.target),
    registry,
    components,
    sortedContentTypes: [...contentTypes].sort((a, b) =>
      a.singularName.localeCompare(b.singularName),
    ),
    componentUsage,
    componentRegistry: config.generatePopulate
      ? Object.fromEntries(components.map((c) => [c.uid, c]))
      : {},
    populatableContentTypeUIDs: new Set(
      contentTypes.filter((ct) => hasPopulatableAttributes(ct.attributes)).map((ct) => ct.uid),
    ),
    overrideConfig: { typeOverrides: config.typeOverrides, fieldOverrides: config.fieldOverrides },
    hasClient: config.generateClient && config.generatePopulate,
  };
};

const joinCodeParts = (parts: readonly (string | null)[]): string =>
  parts.filter((part): part is string => part !== null).join('\n\n');

// View transform overrides are emitted into the same shared/overrides.ts as
// the base type/field overrides (deduped by name)
const emitSharedFiles = (
  files: Map<string, string>,
  ctx: GenerationContext,
  viewOutput: ViewGenerationOutput | null,
): void => {
  const { adapter } = ctx;
  files.set(
    'shared/upload-file.ts',
    buildFileContent(adapter.UPLOAD_FILE_IMPORT, [], adapter.UPLOAD_FILE_SCHEMA_CODE),
  );
  files.set('content-types/registry.ts', [FILE_HEADER, adapter.REGISTRY_CODE].join('\n'));

  const usedOverrides = [
    ...collectUsedOverrides(ctx.sortedContentTypes, ctx.components, ctx.overrideConfig),
    ...(viewOutput?.usedOverrides ?? []),
  ].reduce((acc, override) => acc.set(override.name, override), new Map<string, TypeOverride>());
  if (usedOverrides.size > 0) {
    files.set(
      'shared/overrides.ts',
      adapter.buildOverridesFileContent([...usedOverrides.values()]),
    );
  }
};

const emitComponentFile = (
  files: Map<string, string>,
  ctx: GenerationContext,
  comp: ComponentIR,
): void => {
  const { config, componentRegistry } = ctx;
  const relDir = `components/${componentUidToCategory(comp.uid)}`;
  const { code, importStatement, externalImports, registryImport, typeImportStatements } =
    ctx.adapter.mapComponentSchema(
      comp,
      config.nullableStyle,
      ctx.registry,
      ctx.overrideConfig,
      ctx.componentUsage.usageOf(comp.uid),
      config.jsdoc,
    );

  const populateCode = config.generatePopulate
    ? generateComponentPopulateCode(comp, componentRegistry)
    : null;
  const populateTypeCode = config.generatePopulate
    ? generateComponentPopulateType(comp, componentRegistry)
    : null;
  const extraImports = [
    ...(registryImport ? [registryImport] : []),
    ...(typeImportStatements ?? []),
    ...(populateTypeCode
      ? collectComponentPopulateTypeImports(comp, relDir, componentRegistry)
      : []),
  ];

  files.set(
    `${relDir}/${componentUidToFileName(comp.uid)}.ts`,
    buildFileContent(
      importStatement,
      buildExternalImportStatements(externalImports, relDir),
      joinCodeParts([code, populateCode, populateTypeCode]),
      extraImports,
    ),
  );
};

interface PopulateExports {
  readonly varNames: readonly { readonly singularName: string; readonly varName: string }[];
  readonly typeNames: ReadonlySet<string>;
}

const collectPopulateVarImports = (ctx: GenerationContext, ct: ContentTypeIR): readonly string[] =>
  collectPopulateImportUIDs(ct, ctx.componentRegistry).map((uid) => {
    const category = componentUidToCategory(uid);
    const fileName = componentUidToFileName(uid);
    return `import { ${componentUidToPopulateVarName(uid)} } from '../components/${category}/${fileName}';`;
  });

// Returns the populate exports the content type file declares, for the
// barrel and the client
const emitContentTypeFile = (
  files: Map<string, string>,
  ctx: GenerationContext,
  ct: ContentTypeIR,
): { readonly populateVarName: string | null; readonly hasPopulateType: boolean } => {
  const { config, componentRegistry, registry, populatableContentTypeUIDs } = ctx;
  const { code, importStatement, externalImports, registryImport, typeImportStatements } =
    ctx.adapter.mapContentTypeSchema(
      ct,
      config.nullableStyle,
      registry,
      ctx.overrideConfig,
      config.jsdoc,
    );

  // Scalar-only content types still get an (empty) populate export - the
  // generated client imports one for every content type unconditionally
  const populateCode = config.generatePopulate
    ? (generatePopulateCode(ct, componentRegistry) ??
      `export const ${toPopulateVarName(ct.singularName)} = {};`)
    : null;
  const populateTypeCode = config.generatePopulate
    ? generateContentTypePopulateType(ct, componentRegistry, registry, populatableContentTypeUIDs)
    : null;
  const extraImports = [
    ...(registryImport ? [registryImport] : []),
    ...(typeImportStatements ?? []),
    ...collectContentTypeTypeImports(ct, registry, ctx.overrideConfig),
    ...(config.generatePopulate
      ? collectPopulateTypeImports(ct, registry, componentRegistry, populatableContentTypeUIDs)
      : []),
    ...(config.generatePopulate ? collectPopulateVarImports(ctx, ct) : []),
  ];

  files.set(
    `content-types/${ct.singularName}.ts`,
    buildFileContent(
      importStatement,
      buildExternalImportStatements(externalImports, 'content-types'),
      joinCodeParts([code, populateCode, populateTypeCode]),
      extraImports,
    ),
  );

  return {
    populateVarName: populateCode ? toPopulateVarName(ct.singularName) : null,
    hasPopulateType: populateTypeCode !== null,
  };
};

const emitContentTypeFiles = (
  files: Map<string, string>,
  ctx: GenerationContext,
): PopulateExports => {
  const varNames: { singularName: string; varName: string }[] = [];
  const typeNames = new Set<string>();
  for (const ct of ctx.sortedContentTypes) {
    const exports = emitContentTypeFile(files, ctx, ct);
    if (exports.populateVarName) {
      varNames.push({ singularName: ct.singularName, varName: exports.populateVarName });
    }
    if (exports.hasPopulateType) typeNames.add(ct.singularName);
  }
  return { varNames, typeNames };
};

// Views the client can expose: only those actually generated, with the schema
// selection mirroring the view emission (exact ResponseSchema for hook-free
// views, declared SuccessSchema for assemble views)
const buildViewClientEntries = (
  config: GenerationOptions,
  viewManifest: BffViewManifest | null | undefined,
  viewOutput: ViewGenerationOutput | null,
): readonly ViewClientEntry[] =>
  (viewManifest?.views ?? [])
    .filter((view) => viewOutput?.files.has(`views/${view.id}.ts`))
    .map((view) => {
      const pascal = toPascalCase(view.id);
      const base = { id: view.id, path: view.path, keyParam: view.keyParam ?? null };
      if (!view.hasAssemble) {
        return {
          ...base,
          schemaExport: `${pascal}ResponseSchema`,
          typeExport: `${pascal}Response`,
        };
      }
      // A declaration the view generator skipped (name collision) has no
      // exports to import
      const declaration = viewOutput?.declaredViewIds.has(view.id)
        ? config.viewResponseSchemas[view.id]
        : undefined;
      return {
        ...base,
        schemaExport: declaration ? `${declaration.typeName}SuccessSchema` : null,
        typeExport: declaration ? `${declaration.typeName}Success` : null,
      };
    });

const emitClientFiles = (
  files: Map<string, string>,
  ctx: GenerationContext,
  populateTypeNames: ReadonlySet<string>,
  viewClientEntries: readonly ViewClientEntry[],
): void => {
  const { target } = ctx.config;
  files.set('client/query-string.ts', generateQueryStringCode());
  files.set('client/request-error.ts', generateRequestErrorCode());
  files.set('client/schema-validation-error.ts', generateErrorClassCode(target));
  files.set(
    'client/strapi-client.ts',
    generateClientCode(ctx.sortedContentTypes, populateTypeNames, target, viewClientEntries),
  );
};

const codeWriter = () => {
  const buildSchemaFiles = (
    contentTypes: readonly ContentTypeIR[],
    components: readonly ComponentIR[],
    config: GenerationOptions,
    viewManifest?: BffViewManifest | null,
  ): ReadonlyMap<string, string> => {
    // Must run before ANY naming call: every component identifier in this
    // generation (schemas, types, populates, mocks, views) honors the map.
    setComponentNameOverrides(config.nameOverrides ?? {});
    validateUniqueOutputNames(contentTypes, components);

    const ctx = buildGenerationContext(contentTypes, components, config);
    const files = new Map<string, string>();

    const viewOutput =
      viewManifest && viewManifest.views.length > 0
        ? generateViewFiles(viewManifest, contentTypes, components, ctx.registry, config)
        : null;

    emitSharedFiles(files, ctx, viewOutput);
    for (const comp of topologicalSort(components)) emitComponentFile(files, ctx, comp);
    const populateExports = emitContentTypeFiles(files, ctx);

    if (ctx.hasClient) {
      const viewClientEntries = buildViewClientEntries(config, viewManifest, viewOutput);
      emitClientFiles(files, ctx, populateExports.typeNames, viewClientEntries);
    }

    if (config.mocks) {
      for (const [path, content] of generateMockFiles(
        ctx.sortedContentTypes,
        components,
        ctx.overrideConfig,
      )) {
        files.set(path, content);
      }
    }

    for (const [path, content] of viewOutput?.files ?? []) files.set(path, content);

    files.set(
      'index.ts',
      buildBarrelContent(
        ctx.sortedContentTypes,
        populateExports.varNames,
        populateExports.typeNames,
        ctx.hasClient,
        viewOutput !== null,
      ),
    );
    return files;
  };

  return { buildSchemaFiles };
};

export default codeWriter;
