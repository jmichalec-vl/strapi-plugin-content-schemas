import type { AttributeIR, NullableStyle } from '../../types';
import { isToMany } from '../../types/ir';
import { contentTypeUidToSingularName, toTypeExportName } from '../../utils';
import { resolveOverride, type OverrideConfig } from '../../generators/override-resolver';
import {
  buildReverseMap,
  classifyExternalRef,
  type ExternalImport,
  type SchemaRegistry,
} from '../../generators/schema-registry';
import type { MappedAttribute, TargetPrimitives } from './types';

const mapComponent = (
  attr: AttributeIR,
  registry: SchemaRegistry,
  primitives: TargetPrimitives,
  parentUid?: string,
): MappedAttribute => {
  const uid = attr.componentUID;
  const schemaVarName = uid ? registry.components.get(uid) : undefined;
  if (!uid || !schemaVarName) return { expression: primitives.unknownExpression, externalRefs: [] };
  const selfRef = uid === parentUid;
  // Cycle members import each other; eager refs would hit the TDZ at module load
  const lazy = selfRef || (registry.cycleUIDs?.has(uid) ?? false);
  return primitives.wrapRef(schemaVarName, { lazy, selfRef }, !!attr.repeatable);
};

const mapRelation = (
  attr: AttributeIR,
  registry: SchemaRegistry,
  primitives: TargetPrimitives,
): MappedAttribute => {
  const target = attr.relationTarget;
  if (!target || !registry.contentTypes.has(target)) {
    const expr = isToMany(attr.relationKind)
      ? primitives.arrayWrap(primitives.unknownExpression)
      : primitives.unknownExpression;
    return { expression: expr, externalRefs: [] };
  }

  const targetName = toTypeExportName(contentTypeUidToSingularName(target));
  const refExpr = `ref('${targetName}')`;
  const expression = isToMany(attr.relationKind) ? primitives.arrayWrap(refExpr) : refExpr;
  return { expression, externalRefs: [] };
};

const buildAttributeMappers = (
  primitives: TargetPrimitives,
): Readonly<
  Record<
    string,
    (attr: AttributeIR, registry: SchemaRegistry, parentUid?: string) => MappedAttribute
  >
> => ({
  enumeration: (attr) => ({ expression: primitives.mapEnumeration(attr), externalRefs: [] }),
  media: (attr) => primitives.mapMedia(attr),
  component: (attr, registry, parentUid) => mapComponent(attr, registry, primitives, parentUid),
  relation: (attr, registry) => mapRelation(attr, registry, primitives),
  dynamiczone: (attr, registry) => primitives.mapDynamiczone(attr, registry),
});

export const mapAttribute = (
  attr: AttributeIR,
  nullableStyle: NullableStyle,
  registry: SchemaRegistry,
  primitives: TargetPrimitives,
  parentUid?: string,
  overrides?: OverrideConfig,
): MappedAttribute => {
  // Relations are always nullish regardless of `required`: their presence in a
  // response depends on the populate param, not on the content model
  const effectiveRequired = attr.type === 'relation' ? false : attr.required;

  if (parentUid && overrides) {
    const override = resolveOverride(attr.name, attr.type, parentUid, overrides);
    if (override) {
      // An override describes ONE value - multiple media stays an array of it
      const schemaVarName = override.typeOverride.name;
      const base =
        attr.type === 'media' && attr.mediaMultiple
          ? primitives.arrayWrap(schemaVarName)
          : schemaVarName;
      return {
        expression: primitives.wrapNullability(base, effectiveRequired, nullableStyle),
        externalRefs: [schemaVarName],
      };
    }
  }

  const mappers = buildAttributeMappers(primitives);
  const mapper = mappers[attr.type];
  const mapped = mapper
    ? mapper(attr, registry, parentUid)
    : {
        expression: primitives.primitiveMap[attr.type] ?? primitives.unknownExpression,
        externalRefs: [],
      };

  return {
    expression: primitives.wrapNullability(mapped.expression, effectiveRequired, nullableStyle),
    externalRefs: mapped.externalRefs,
  };
};

export const buildAttributeLines = (
  attributes: readonly AttributeIR[],
  nullableStyle: NullableStyle,
  registry: SchemaRegistry,
  primitives: TargetPrimitives,
  parentUid?: string,
  overrides?: OverrideConfig,
): {
  readonly lines: readonly string[];
  readonly allExternalImports: readonly ExternalImport[];
} => {
  const reverseMap = buildReverseMap(registry);
  const seen = new Set<string>();
  const allExternalImports: ExternalImport[] = [];

  const lines = attributes.map((attr) => {
    const mapped = mapAttribute(attr, nullableStyle, registry, primitives, parentUid, overrides);

    for (const ref of mapped.externalRefs) {
      if (!seen.has(ref)) {
        seen.add(ref);
        allExternalImports.push(classifyExternalRef(ref, reverseMap));
      }
    }

    return `  ${attr.name}: ${mapped.expression},`;
  });

  return { lines, allExternalImports };
};
