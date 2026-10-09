import type { Core } from '@strapi/types';

import type {
  AttributeIR,
  ComponentFilter,
  ComponentIR,
  ContentTypeIR,
  InternalFieldsConfig,
  StrapiAttributeType,
} from '../types';
import { matchesUidPattern } from '../utils';
import { collectReferencedComponents } from '../generators/dependency-graph';

const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt', 'publishedAt']);
const STRAPI_INTERNAL_FIELDS = new Set(['createdBy', 'updatedBy', 'locale', 'localizations']);
const SKIPPED_TYPES = new Set(['password']);

interface StrapiAttribute {
  readonly type: string;
  readonly required?: boolean;
  readonly private?: boolean;
  readonly enum?: readonly string[];
  readonly enumName?: string;
  readonly component?: string;
  readonly components?: readonly string[];
  readonly repeatable?: boolean;
  readonly relation?: string;
  readonly target?: string;
  readonly multiple?: boolean;
  readonly unique?: boolean;
  readonly default?: string | number | boolean;
  readonly allowedTypes?: readonly string[];
}

const ALWAYS_EXCLUDED_FIELDS = new Set(['id', 'documentId']);

// Strapi's registries are keyed in filesystem discovery order, which differs
// between machines; every downstream emission order derives from this list
const sortByUid = <T extends { readonly uid: string }>(entities: readonly T[]): readonly T[] =>
  [...entities].sort((a, b) => a.uid.localeCompare(b.uid));

const shouldIncludeField = (name: string, internalFields: InternalFieldsConfig): boolean => {
  if (STRAPI_INTERNAL_FIELDS.has(name)) return false;
  if (ALWAYS_EXCLUDED_FIELDS.has(name)) return false;
  if (TIMESTAMP_FIELDS.has(name)) return internalFields.timestamps;
  return true;
};

const KNOWN_ATTRIBUTE_TYPES: ReadonlySet<string> = new Set<StrapiAttributeType>([
  'string',
  'text',
  'richtext',
  'email',
  'password',
  'uid',
  'boolean',
  'integer',
  'biginteger',
  'float',
  'decimal',
  'date',
  'datetime',
  'time',
  'timestamp',
  'json',
  'blocks',
  'enumeration',
  'media',
  'relation',
  'component',
  'dynamiczone',
]);

const isKnownAttributeType = (type: string): type is StrapiAttributeType =>
  KNOWN_ATTRIBUTE_TYPES.has(type);

// Custom fields arrive with their underlying type already resolved by Strapi,
// so anything unknown here is a type this generator cannot describe
const DOCUMENT_ID_ATTRIBUTE: AttributeIR = { name: 'documentId', type: 'string', required: true };

const mapToAttributeIR = (
  name: string,
  attr: StrapiAttribute & { readonly type: StrapiAttributeType },
): AttributeIR => ({
  name,
  type: attr.type,
  required: attr.required ?? false,
  ...(attr.enum && { enumValues: attr.enum }),
  ...(attr.enumName && { enumName: attr.enumName }),
  ...(attr.component && { componentUID: attr.component }),
  ...(attr.components && { componentUIDs: attr.components }),
  ...(attr.repeatable !== undefined && { repeatable: attr.repeatable }),
  ...(attr.relation && { relationKind: attr.relation as AttributeIR['relationKind'] }),
  ...(attr.target && { relationTarget: attr.target }),
  ...(attr.multiple !== undefined && { mediaMultiple: attr.multiple }),
  ...(attr.unique && { unique: true }),
  ...(attr.default !== undefined && { defaultValue: attr.default }),
  ...(attr.allowedTypes && { mediaAllowedTypes: attr.allowedTypes }),
});

// Sanitization strips private attributes from every REST/Document response -
// a schema that promises them would fail against live data. Privacy comes from
// three places: attribute-level `private: true`, the model's
// `options.privateAttributes`, and the global `api.responses.privateAttributes`
// config.
const asPrivateNameList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((name): name is string => typeof name === 'string') : [];

const collectPrivateNames = (
  globalNames: readonly string[],
  modelOptions: unknown,
): ReadonlySet<string> => {
  const modelNames = asPrivateNameList(
    (modelOptions as { privateAttributes?: unknown } | undefined)?.privateAttributes,
  );
  return new Set([...globalNames, ...modelNames]);
};

const mapAttributes = (
  attributes: Record<string, StrapiAttribute>,
  internalFields: InternalFieldsConfig,
  isContentType: boolean,
  privateNames: ReadonlySet<string>,
  onUnknownType: (name: string, type: string) => void,
): readonly AttributeIR[] => {
  const mapped = Object.entries(attributes)
    .filter(([_name, attr]) => !SKIPPED_TYPES.has(attr.type))
    .filter(([name, attr]) => attr.private !== true && !privateNames.has(name))
    .filter(([name]) => shouldIncludeField(name, internalFields))
    .flatMap(([name, attr]) => {
      if (!isKnownAttributeType(attr.type)) {
        onUnknownType(name, attr.type);
        return [];
      }
      return [mapToAttributeIR(name, { ...attr, type: attr.type })];
    });

  return isContentType ? [DOCUMENT_ID_ATTRIBUTE, ...mapped] : mapped;
};

const schemaReader = ({ strapi }: { strapi: Core.Strapi }) => {
  const globalPrivateNames = (): readonly string[] =>
    asPrivateNameList(strapi.config.get('api.responses.privateAttributes', []));

  const warnUnknownType =
    (ownerUid: string) =>
    (name: string, type: string): void => {
      strapi.log.warn(
        `[content-schemas] Skipping "${ownerUid}.${name}": attribute type "${type}" is not supported.`,
      );
    };

  const readContentTypes = (
    patterns: readonly string[],
    internalFields: InternalFieldsConfig,
  ): readonly ContentTypeIR[] => {
    const contentTypes = strapi.contentTypes as unknown as Record<string, Record<string, unknown>>;

    const matched = Object.entries(contentTypes)
      .filter(([uid]) => matchesUidPattern(uid, patterns))
      .filter(([uid, ct]) => {
        // A broad pattern can match registry entries without the shape we
        // need; skipping with a warning beats a 500 on every request
        const valid =
          typeof ct.info === 'object' &&
          ct.info !== null &&
          typeof (ct.info as { singularName?: unknown }).singularName === 'string' &&
          typeof ct.attributes === 'object' &&
          ct.attributes !== null;
        if (!valid) {
          strapi.log.warn(
            `[content-schemas] Skipping "${uid}": missing info.singularName or attributes.`,
          );
        }
        return valid;
      })
      .map(([uid, ct]) => {
        const info = ct.info as { singularName: string; pluralName: string; displayName: string };
        const attributes = ct.attributes as Record<string, StrapiAttribute>;

        return {
          uid,
          singularName: info.singularName,
          pluralName: info.pluralName,
          displayName: info.displayName,
          kind: (ct.kind as ContentTypeIR['kind']) ?? 'collectionType',
          attributes: mapAttributes(
            attributes,
            internalFields,
            true,
            collectPrivateNames(globalPrivateNames(), ct.options),
            warnUnknownType(uid),
          ),
        };
      });

    return sortByUid(matched);
  };

  const readComponents = (
    filter: ComponentFilter,
    contentTypes: readonly ContentTypeIR[],
    internalFields: InternalFieldsConfig,
  ): readonly ComponentIR[] => {
    const allStrapiComponents = (strapi.components ?? {}) as unknown as Record<
      string,
      Record<string, unknown>
    >;

    const allComponentIRs: Record<string, ComponentIR> = {};
    for (const [uid, comp] of Object.entries(allStrapiComponents)) {
      const info = comp.info as { displayName: string };
      const attributes = comp.attributes as Record<string, StrapiAttribute>;
      const category = uid.split('.')[0] ?? uid;

      allComponentIRs[uid] = {
        uid,
        category,
        displayName: info.displayName,
        attributes: mapAttributes(
          attributes,
          internalFields,
          false,
          collectPrivateNames(globalPrivateNames(), comp.options),
          warnUnknownType(uid),
        ),
      };
    }

    const allComponents = sortByUid(Object.values(allComponentIRs));

    if (filter === 'all') {
      return allComponents;
    }

    if (Array.isArray(filter)) {
      return allComponents.filter((c) => matchesUidPattern(c.uid, filter as readonly string[]));
    }

    const referencedUIDs = collectReferencedComponents(contentTypes, allComponentIRs);
    return allComponents.filter((c) => referencedUIDs.has(c.uid));
  };

  return { readContentTypes, readComponents };
};

export default schemaReader;
