import type { ComponentIR, ContentTypeIR } from '../types';

export interface ComponentUsage {
  readonly inDynamicZone: boolean;
  readonly inComponent: boolean;
}

export interface ComponentUsageIndex {
  // Members of at least one dynamic zone: their schema carries a required
  // __component discriminator
  readonly dynamicZoneUIDs: ReadonlySet<string>;
  // Used as a plain (single or repeatable) component field somewhere
  readonly singleOrRepeatableUIDs: ReadonlySet<string>;
  // Both at once: __component becomes nullish and zones containing them lose
  // their discriminated union
  readonly dualUseUIDs: ReadonlySet<string>;
  readonly usageOf: (uid: string) => ComponentUsage;
}

interface AttributeOwner {
  readonly attributes: ContentTypeIR['attributes'];
}

// Computed once per generation and shared by the schema, type and mock
// emitters so they cannot disagree about a component's role
export const buildComponentUsage = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
): ComponentUsageIndex => {
  const owners: readonly AttributeOwner[] = [...contentTypes, ...components];

  const dynamicZoneUIDs = new Set(
    owners.flatMap((owner) =>
      owner.attributes.flatMap((a) => (a.type === 'dynamiczone' ? (a.componentUIDs ?? []) : [])),
    ),
  );
  const singleOrRepeatableUIDs = new Set(
    owners.flatMap((owner) =>
      owner.attributes.flatMap((a) =>
        a.type === 'component' && a.componentUID ? [a.componentUID] : [],
      ),
    ),
  );
  const dualUseUIDs = new Set(
    [...dynamicZoneUIDs].filter((uid) => singleOrRepeatableUIDs.has(uid)),
  );

  return {
    dynamicZoneUIDs,
    singleOrRepeatableUIDs,
    dualUseUIDs,
    usageOf: (uid) => ({
      inDynamicZone: dynamicZoneUIDs.has(uid),
      inComponent: singleOrRepeatableUIDs.has(uid),
    }),
  };
};
