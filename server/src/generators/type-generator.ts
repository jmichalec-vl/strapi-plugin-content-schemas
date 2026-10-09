import { isToMany } from '../types/ir';
import type { AttributeIR, ComponentIR, ContentTypeIR } from '../types';
import {
  toTypeExportName,
  componentUidToTypeName,
  escapeSingleQuoted,
  contentTypeUidToSingularName,
} from '../utils';
import { resolveOverride, type OverrideConfig } from './override-resolver';
import type { SchemaRegistry } from './schema-registry';
import { enumTypeNameFor, type EnumArtifact } from './enum-generator';

const PRIMITIVE_TS_TYPE_MAP: Readonly<Record<string, string>> = {
  string: 'string',
  text: 'string',
  richtext: 'string',
  uid: 'string',
  email: 'string',
  boolean: 'boolean',
  integer: 'number',
  // Strapi serializes biginteger as a JSON string to avoid precision loss
  biginteger: 'string',
  float: 'number',
  decimal: 'number',
  date: 'string',
  datetime: 'string',
  time: 'string',
  timestamp: 'string',
  json: 'unknown',
  blocks: 'unknown',
};

const mapAttributeToTsType = (
  attr: AttributeIR,
  registry: SchemaRegistry,
  parentUid: string,
  overrides?: OverrideConfig,
  enumContext?: { readonly parentTypeName: string; readonly artifacts: readonly EnumArtifact[] },
): string => {
  if (overrides) {
    const override = resolveOverride(attr.name, attr.type, parentUid, overrides);
    if (override) {
      return override.typeOverride.typeName;
    }
  }

  if (attr.type === 'enumeration') {
    const artifactName = enumContext
      ? enumTypeNameFor(enumContext.parentTypeName, attr, enumContext.artifacts)
      : null;
    if (artifactName) return artifactName;
    return (attr.enumValues ?? []).map((v) => `'${escapeSingleQuoted(v)}'`).join(' | ') || 'string';
  }

  if (attr.type === 'media') {
    return attr.mediaMultiple ? 'UploadFile[]' : 'UploadFile';
  }

  if (attr.type === 'component' && attr.componentUID) {
    const compTypeName = componentUidToTypeName(attr.componentUID);
    const base = registry.components.has(attr.componentUID) ? compTypeName : 'unknown';
    return attr.repeatable ? `${base}[]` : base;
  }

  if (attr.type === 'relation') {
    const target = attr.relationTarget;
    if (!target || !registry.contentTypes.has(target)) {
      return isToMany(attr.relationKind) ? 'unknown[]' : 'unknown';
    }
    const targetTypeName = toTypeExportName(contentTypeUidToSingularName(target));
    return isToMany(attr.relationKind) ? `${targetTypeName}[]` : targetTypeName;
  }

  if (attr.type === 'dynamiczone') {
    const typeNames = (attr.componentUIDs ?? [])
      .filter((uid) => registry.components.has(uid))
      .map((uid) => componentUidToTypeName(uid));
    return typeNames.length > 0 ? `(${typeNames.join(' | ')})[]` : 'unknown[]';
  }

  return PRIMITIVE_TS_TYPE_MAP[attr.type] ?? 'unknown';
};

const buildJsDoc = (attr: AttributeIR): string | null => {
  const parts: string[] = [];

  switch (attr.type) {
    case 'relation':
      parts.push(
        `Relation: ${attr.relationKind ?? 'unknown'} → ${attr.relationTarget ?? 'unknown'}`,
      );
      break;
    case 'media':
      parts.push(
        `Media${attr.mediaAllowedTypes ? ` (${attr.mediaAllowedTypes.join(', ')})` : ''}${attr.mediaMultiple ? ' (multiple)' : ''}`,
      );
      break;
    case 'component':
      parts.push(
        `Component: ${attr.componentUID ?? 'unknown'}${attr.repeatable ? ' (repeatable)' : ''}`,
      );
      break;
    case 'dynamiczone':
      parts.push(`Dynamic zone: ${(attr.componentUIDs ?? []).join(' | ')}`);
      break;
    default:
      break;
  }

  if (attr.unique) parts.push('@unique');
  if (attr.defaultValue !== undefined) parts.push(`@default ${JSON.stringify(attr.defaultValue)}`);

  return parts.length > 0 ? `  /** ${parts.join(' ')} */` : null;
};

const formatInterfaceField = (
  attr: AttributeIR,
  registry: SchemaRegistry,
  parentUid: string,
  overrides?: OverrideConfig,
  jsdoc?: boolean,
  enumContext?: { readonly parentTypeName: string; readonly artifacts: readonly EnumArtifact[] },
): string => {
  const tsType = mapAttributeToTsType(attr, registry, parentUid, overrides, enumContext);
  const lines: string[] = [];

  if (jsdoc) {
    const doc = buildJsDoc(attr);
    if (doc) lines.push(doc);
  }

  if (attr.type === 'relation') {
    // Relations are always optional/nullable: presence depends on populate,
    // and Strapi returns null for populated-but-empty relations
    lines.push(`  readonly ${attr.name}?: ${tsType} | null;`);
  } else {
    // Non-required fields are nullish in the schemas (key may be absent), so
    // the interface must mark the key optional too
    lines.push(
      attr.required
        ? `  readonly ${attr.name}: ${tsType};`
        : `  readonly ${attr.name}?: ${tsType} | null;`,
    );
  }

  return lines.join('\n');
};

export const generateContentTypeInterface = (
  ct: ContentTypeIR,
  registry: SchemaRegistry,
  overrides?: OverrideConfig,
  jsdoc?: boolean,
  enumArtifacts?: readonly EnumArtifact[],
): string => {
  const typeName = toTypeExportName(ct.singularName);
  const enumContext = enumArtifacts && { parentTypeName: typeName, artifacts: enumArtifacts };
  const fields = ct.attributes.map((attr) =>
    formatInterfaceField(attr, registry, ct.uid, overrides, jsdoc, enumContext),
  );
  return [`export interface ${typeName} {`, ...fields, `}`].join('\n');
};

export const generateComponentInterface = (
  component: ComponentIR,
  registry: SchemaRegistry,
  overrides?: OverrideConfig,
  componentUsage?: { readonly inDynamicZone: boolean; readonly inComponent: boolean },
  jsdoc?: boolean,
  enumArtifacts?: readonly EnumArtifact[],
): string => {
  const typeName = componentUidToTypeName(component.uid);
  const inDz = componentUsage?.inDynamicZone ?? false;
  const inComp = componentUsage?.inComponent ?? false;

  const componentField =
    inDz && !inComp
      ? `  readonly __component: '${component.uid}';`
      : inDz && inComp
        ? `  readonly __component?: '${component.uid}';`
        : undefined;

  const builtinFields = [...(componentField ? [componentField] : []), `  readonly id: number;`];
  const enumContext = enumArtifacts && { parentTypeName: typeName, artifacts: enumArtifacts };
  const fields = component.attributes.map((attr) =>
    formatInterfaceField(attr, registry, component.uid, overrides, jsdoc, enumContext),
  );
  return [`export interface ${typeName} {`, ...builtinFields, ...fields, `}`].join('\n');
};
