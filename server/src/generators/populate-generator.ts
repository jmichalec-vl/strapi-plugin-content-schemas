import type { AttributeIR, ComponentIR, ContentTypeIR } from '../types';
import { toPopulateVarName, componentUidToPopulateVarName } from '../utils';
import { POPULATABLE_TYPES, POPULATE_REF_TYPES } from '../types/ir';

export interface ComponentRegistry {
  readonly [uid: string]: ComponentIR;
}

type PopulateValue =
  | true
  | { readonly populate: Readonly<Record<string, PopulateValue>> }
  | { readonly on: Readonly<Record<string, PopulateValue>> }
  | { readonly __ref: string };

export type RuntimePopulateValue =
  | true
  | { readonly populate: Readonly<Record<string, RuntimePopulateValue>> }
  | { readonly on: Readonly<Record<string, RuntimePopulateValue>> };

const hasPopulatableFields = (uid: string, componentRegistry: ComponentRegistry): boolean => {
  const component = componentRegistry[uid];
  if (!component) return false;
  return component.attributes.some((a) => POPULATE_REF_TYPES.has(a.type));
};

const buildAttributePopulate = (
  attr: AttributeIR,
  componentRegistry: ComponentRegistry,
  visited: Set<string>,
  useRefs: boolean,
): PopulateValue | null => {
  if (attr.type === 'media') return true;
  if (attr.type === 'relation') return null;

  if (attr.type === 'component' && attr.componentUID) {
    return buildComponentPopulate(attr.componentUID, componentRegistry, visited, useRefs);
  }

  if (attr.type === 'dynamiczone' && attr.componentUIDs) {
    // Strapi rejects `on` keys for components it does not know about, so
    // excluded components must not appear in the generated populate
    const knownUIDs = attr.componentUIDs.filter((uid) => componentRegistry[uid]);
    if (knownUIDs.length === 0) return true;
    const on = Object.fromEntries(
      knownUIDs.map((uid) => [
        uid,
        buildComponentPopulate(uid, componentRegistry, visited, useRefs),
      ]),
    );
    return { on };
  }

  return null;
};

const buildComponentPopulate = (
  uid: string,
  componentRegistry: ComponentRegistry,
  visited: Set<string>,
  useRefs: boolean,
): PopulateValue => {
  if (visited.has(uid)) return true;

  const component = componentRegistry[uid];
  if (!component) return true;

  if (useRefs && hasPopulatableFields(uid, componentRegistry)) {
    return { __ref: componentUidToPopulateVarName(uid) };
  }

  visited.add(uid);
  const nestedPopulate = buildPopulateFromAttributes(
    component.attributes,
    componentRegistry,
    visited,
    useRefs,
  );
  visited.delete(uid);

  return nestedPopulate ? { populate: nestedPopulate } : true;
};

const buildPopulateFromAttributes = (
  attributes: readonly AttributeIR[],
  componentRegistry: ComponentRegistry,
  visited: Set<string>,
  useRefs: boolean,
): Readonly<Record<string, PopulateValue>> | null => {
  const entries = attributes
    .filter((attr) => POPULATABLE_TYPES.has(attr.type))
    .map(
      (attr) =>
        [attr.name, buildAttributePopulate(attr, componentRegistry, visited, useRefs)] as const,
    )
    .filter((entry): entry is [string, PopulateValue] => entry[1] !== null);

  return entries.length > 0 ? Object.fromEntries(entries) : null;
};

/**
 * Runtime variants of the populate builders, consumed by other plugins through the
 * `populate-builder` service (notably strapi-plugin-bff-views). With `useRefs`
 * disabled the `__ref` branch of PopulateValue is unreachable, so the returned
 * trees are fully inlined and usable directly as Document Service populate params.
 * Semver-minor stable: signatures only change with a minor version bump.
 */
export const buildRuntimeComponentPopulate = (
  uid: string,
  componentRegistry: ComponentRegistry,
): RuntimePopulateValue =>
  buildComponentPopulate(uid, componentRegistry, new Set(), false) as RuntimePopulateValue;

export const buildRuntimePopulateFromAttributes = (
  attributes: readonly AttributeIR[],
  componentRegistry: ComponentRegistry,
): Readonly<Record<string, RuntimePopulateValue>> | null =>
  buildPopulateFromAttributes(attributes, componentRegistry, new Set(), false) as Readonly<
    Record<string, RuntimePopulateValue>
  > | null;

const isRef = (obj: unknown): obj is { __ref: string } =>
  typeof obj === 'object' && obj !== null && '__ref' in obj;

const serializePopulate = (obj: unknown, indent: number): string => {
  if (obj === true) return 'true';
  if (isRef(obj)) return obj.__ref;
  if (typeof obj !== 'object' || obj === null) return String(obj);

  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length === 0) return '{}';

  const spaces = '  '.repeat(indent);
  const innerSpaces = '  '.repeat(indent + 1);

  const lines = entries.map(([key, value]) => {
    const keyStr = /[-.:]/g.test(key) ? `'${key}'` : key;
    return `${innerSpaces}${keyStr}: ${serializePopulate(value, indent + 1)},`;
  });

  return `{\n${lines.join('\n')}\n${spaces}}`;
};

export const generatePopulateCode = (
  ct: ContentTypeIR,
  componentRegistry: ComponentRegistry,
): string | null => {
  const populate = buildPopulateFromAttributes(ct.attributes, componentRegistry, new Set(), true);
  if (!populate) return null;

  const varName = toPopulateVarName(ct.singularName);
  return `export const ${varName} = ${serializePopulate(populate, 0)};`;
};

export const generateComponentPopulateCode = (
  component: ComponentIR,
  componentRegistry: ComponentRegistry,
): string | null => {
  const visited = new Set([component.uid]);
  const populate = buildPopulateFromAttributes(
    component.attributes,
    componentRegistry,
    visited,
    true,
  );
  if (!populate) return null;

  const varName = componentUidToPopulateVarName(component.uid);
  const wrapped = { populate };
  return `export const ${varName} = ${serializePopulate(wrapped, 0)};`;
};

export const collectPopulateImportUIDs = (
  ct: ContentTypeIR,
  componentRegistry: ComponentRegistry,
): readonly string[] => {
  const refs = new Set<string>();

  const collectRefs = (attributes: readonly AttributeIR[]): void => {
    for (const attr of attributes) {
      if (
        attr.type === 'component' &&
        attr.componentUID &&
        hasPopulatableFields(attr.componentUID, componentRegistry)
      ) {
        refs.add(attr.componentUID);
      }
      if (attr.type === 'dynamiczone' && attr.componentUIDs) {
        for (const uid of attr.componentUIDs) {
          if (hasPopulatableFields(uid, componentRegistry)) {
            refs.add(uid);
          }
        }
      }
    }
  };

  collectRefs(ct.attributes);
  return [...refs];
};
