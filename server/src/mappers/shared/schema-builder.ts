import type { AttributeIR, ComponentIR, ContentTypeIR, NullableStyle } from '../../types';
import {
  toSchemaVarName,
  toTypeExportName,
  componentUidToSchemaVarName,
  componentUidToTypeName,
  componentUidToCategory,
  componentUidToFileName,
  contentTypeUidToSingularName,
} from '../../utils';
import { resolveAttributeOverride, type OverrideConfig } from '../../generators/override-resolver';
import type { SchemaRegistry } from '../../generators/schema-registry';
import {
  generateContentTypeInterface,
  generateComponentInterface,
} from '../../generators/type-generator';
import { collectEnumArtifacts, generateEnumArtifactCode } from '../../generators/enum-generator';
import type { MappedSchema } from '../target-adapter';
import type { TargetPrimitives } from './types';
import { buildAttributeLines } from './attribute-mapper';

// Relation targets that are part of this generation (and therefore have a
// generated type to import), each listed once
const collectKnownRelationTargets = (
  attributes: readonly AttributeIR[],
  registry: SchemaRegistry,
): readonly string[] => [
  ...new Set(
    attributes.flatMap((a) =>
      a.type === 'relation' && a.relationTarget && registry.contentTypes.has(a.relationTarget)
        ? [a.relationTarget]
        : [],
    ),
  ),
];

export interface ContentTypeSchemaOptions {
  readonly ct: ContentTypeIR;
  readonly nullableStyle: NullableStyle;
  readonly registry: SchemaRegistry;
  readonly primitives: TargetPrimitives;
  readonly overrides?: OverrideConfig;
  readonly jsdoc?: boolean;
}

export interface ComponentSchemaOptions {
  readonly component: ComponentIR;
  readonly nullableStyle: NullableStyle;
  readonly registry: SchemaRegistry;
  readonly primitives: TargetPrimitives;
  readonly overrides?: OverrideConfig;
  readonly componentUsage?: { readonly inDynamicZone: boolean; readonly inComponent: boolean };
  readonly jsdoc?: boolean;
}

export const buildContentTypeSchema = (options: ContentTypeSchemaOptions): MappedSchema => {
  const { ct, nullableStyle, registry, primitives, overrides, jsdoc } = options;
  const schemaVarName = toSchemaVarName(ct.singularName);
  const typeName = toTypeExportName(ct.singularName);

  const { lines, allExternalImports } = buildAttributeLines(
    ct.attributes,
    nullableStyle,
    registry,
    primitives,
    ct.uid,
    overrides,
  );

  const filteredImports = allExternalImports.filter(
    (imp) => !(imp.source === 'content-type' && imp.uid === ct.uid),
  );

  const hasRelationRefs = lines.some((line) => line.includes('ref('));
  const registryImport = hasRelationRefs
    ? `import { register, ref } from './registry';`
    : `import { register } from './registry';`;

  const enumArtifacts = collectEnumArtifacts(typeName, ct.attributes);
  const enumCode = generateEnumArtifactCode(enumArtifacts);

  const interfaceCode = generateContentTypeInterface(ct, registry, overrides, jsdoc, enumArtifacts);

  const relationTypeImports = collectKnownRelationTargets(ct.attributes, registry)
    .map((target) => {
      const targetSingular = contentTypeUidToSingularName(target);
      return { typeName: toTypeExportName(targetSingular), singularName: targetSingular };
    })
    .filter((r) => r.typeName !== typeName)
    .filter((r, i, arr) => arr.findIndex((x) => x.typeName === r.typeName) === i);

  const typeImportStatements = relationTypeImports.map(
    (r) => `import type { ${r.typeName} } from './${r.singularName}';`,
  );

  const code = [
    ...(enumCode ? [enumCode, ''] : []),
    primitives.objectWrap(schemaVarName, lines),
    '',
    `register('${typeName}', ${schemaVarName});`,
    '',
    interfaceCode,
  ].join('\n');

  return {
    code,
    importStatement: primitives.buildImportStatement(lines),
    externalImports: filteredImports,
    registryImport,
    typeImportStatements,
  };
};

export const buildComponentSchema = (options: ComponentSchemaOptions): MappedSchema => {
  const { component, nullableStyle, registry, primitives, overrides, componentUsage, jsdoc } =
    options;
  const schemaVarName = componentUidToSchemaVarName(component.uid);

  const { lines: attrLines, allExternalImports } = buildAttributeLines(
    component.attributes,
    nullableStyle,
    registry,
    primitives,
    component.uid,
    overrides,
  );

  const inDz = componentUsage?.inDynamicZone ?? false;
  const inComp = componentUsage?.inComponent ?? false;

  const componentFieldLine = inDz
    ? `  __component: ${primitives.componentDiscriminator(component.uid, !inComp)},`
    : undefined;

  const idLine = `  id: ${primitives.idExpression},`;

  const allLines = [...(componentFieldLine ? [componentFieldLine] : []), idLine, ...attrLines];

  const filteredImports = allExternalImports.filter(
    (imp) => !(imp.source === 'component' && imp.uid === component.uid),
  );

  const hasRelationRefs = allLines.some((line) => line.includes('ref('));
  const registryImport = hasRelationRefs
    ? `import { ref } from '../../content-types/registry';`
    : undefined;

  const componentTypeName = componentUidToTypeName(component.uid);
  const enumArtifacts = collectEnumArtifacts(componentTypeName, component.attributes);
  const enumCode = generateEnumArtifactCode(enumArtifacts);

  const interfaceCode = generateComponentInterface(
    component,
    registry,
    overrides,
    componentUsage,
    jsdoc,
    enumArtifacts,
  );

  const typeImports: string[] = [];

  // Members of a reference cycle reference themselves (via lazy()) and need an
  // explicit type, which in turn needs the interface declared in this file
  const isRecursive = registry.cycleUIDs?.has(component.uid) ?? false;
  if (isRecursive) typeImports.push(...primitives.recursiveTypeImports);

  const hasMedia = component.attributes.some((a) => a.type === 'media');
  if (hasMedia) {
    typeImports.push("import type { UploadFile } from '../../shared/upload-file';");
  }

  // Field overrides shadow type overrides - import only the one that is
  // actually resolved (and therefore exported from shared/overrides.ts)
  const overrideNames = new Set<string>(
    component.attributes.flatMap((attr) => {
      const resolved = overrides
        ? resolveAttributeOverride(attr, component.uid, overrides)
        : undefined;
      return resolved ? [resolved.typeName] : [];
    }),
  );
  if (overrideNames.size > 0) {
    typeImports.push(
      `import type { ${Array.from(overrideNames).sort().join(', ')} } from '../../shared/overrides';`,
    );
  }

  const relationTypeImports = collectKnownRelationTargets(component.attributes, registry)
    .map((target) => {
      const targetSingular = contentTypeUidToSingularName(target);
      return { typeName: toTypeExportName(targetSingular), singularName: targetSingular };
    })
    .filter((r, i, arr) => arr.findIndex((x) => x.typeName === r.typeName) === i);

  typeImports.push(
    ...relationTypeImports.map(
      (r) => `import type { ${r.typeName} } from '../../content-types/${r.singularName}';`,
    ),
  );

  const ownCategory = componentUidToCategory(component.uid);
  const nestedComponentImports = component.attributes
    .flatMap((a) =>
      a.type === 'component' &&
      a.componentUID &&
      registry.components.has(a.componentUID) &&
      a.componentUID !== component.uid
        ? [a.componentUID]
        : [],
    )
    .map((uid) => {
      const category = componentUidToCategory(uid);
      const importPath =
        category === ownCategory
          ? `./${componentUidToFileName(uid)}`
          : `../${category}/${componentUidToFileName(uid)}`;
      return { typeName: componentUidToTypeName(uid), importPath };
    })
    .filter((r, i, arr) => arr.findIndex((x) => x.typeName === r.typeName) === i);

  typeImports.push(
    ...nestedComponentImports.map((r) => `import type { ${r.typeName} } from '${r.importPath}';`),
  );

  const code = [
    ...(enumCode ? [enumCode, ''] : []),
    primitives.objectWrap(schemaVarName, allLines, isRecursive ? componentTypeName : undefined),
    '',
    interfaceCode,
  ].join('\n');

  return {
    code,
    importStatement: primitives.buildImportStatement(allLines),
    externalImports: filteredImports,
    registryImport,
    typeImportStatements: typeImports,
  };
};
