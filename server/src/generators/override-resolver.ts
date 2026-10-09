import type { AttributeIR, ComponentIR, ContentTypeIR, TypeOverride } from '../types';

export interface ResolvedOverride {
  readonly typeOverride: TypeOverride;
  readonly source: 'type-override' | 'field-override';
}

export interface OverrideConfig {
  readonly typeOverrides: Readonly<Record<string, TypeOverride>>;
  readonly fieldOverrides: Readonly<Record<string, TypeOverride>>;
}

export const resolveOverride = (
  attrName: string,
  attrType: string,
  parentUid: string,
  overrides: OverrideConfig,
): ResolvedOverride | null => {
  // A field override targets one attribute and shadows the type-wide one
  const fieldOverride = overrides.fieldOverrides[`${parentUid}.${attrName}`];
  if (fieldOverride) return { typeOverride: fieldOverride, source: 'field-override' };

  const typeOverride = overrides.typeOverrides[attrType];
  if (typeOverride) return { typeOverride, source: 'type-override' };

  return null;
};

interface SchemaEntity {
  readonly uid: string;
  readonly attributes: readonly AttributeIR[];
}

// Convenience for callers that only need the override itself
export const resolveAttributeOverride = (
  attr: AttributeIR,
  parentUid: string,
  overrides: OverrideConfig,
): TypeOverride | undefined =>
  resolveOverride(attr.name, attr.type, parentUid, overrides)?.typeOverride;

export const collectUsedOverrides = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
  overrides: OverrideConfig,
): readonly TypeOverride[] => {
  const allEntities: readonly SchemaEntity[] = [...contentTypes, ...components];

  const collected = allEntities
    .flatMap((entity) =>
      entity.attributes
        .map((attr) => resolveAttributeOverride(attr, entity.uid, overrides))
        .filter((o): o is TypeOverride => o !== undefined),
    )
    .reduce((acc, override) => acc.set(override.name, override), new Map<string, TypeOverride>());

  return [...collected.values()];
};
