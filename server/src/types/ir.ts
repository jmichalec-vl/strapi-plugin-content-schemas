export type StrapiAttributeType =
  | 'string'
  | 'text'
  | 'richtext'
  | 'email'
  | 'password'
  | 'uid'
  | 'boolean'
  | 'integer'
  | 'biginteger'
  | 'float'
  | 'decimal'
  | 'date'
  | 'datetime'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'blocks'
  | 'enumeration'
  | 'media'
  | 'relation'
  | 'component'
  | 'dynamiczone';

export type RelationKind =
  | 'oneToOne'
  | 'oneToMany'
  | 'manyToOne'
  | 'manyToMany'
  | 'morphOne'
  | 'morphMany'
  | 'morphToOne'
  | 'morphToMany';

const TO_MANY_RELATION_KINDS: ReadonlySet<string> = new Set([
  'oneToMany',
  'manyToMany',
  'morphMany',
  'morphToMany',
]);

// Attribute types whose values come from other tables and only appear in a
// response when populated; everything else is a scalar column
export const POPULATABLE_TYPES: ReadonlySet<string> = new Set([
  'media',
  'relation',
  'component',
  'dynamiczone',
]);

// Populatable types that get a generated populate constant of their own
// (relations are referenced by name via the registry instead)
export const POPULATE_REF_TYPES: ReadonlySet<string> = new Set([
  'media',
  'component',
  'dynamiczone',
]);

export const hasPopulatableAttributes = (attributes: readonly AttributeIR[]): boolean =>
  attributes.some((attribute) => POPULATABLE_TYPES.has(attribute.type));

// Single source of truth for cardinality: schemas, interfaces, populate and
// view slices must all agree on which relation kinds yield arrays
export const isToMany = (relationKind?: string): boolean =>
  relationKind !== undefined && TO_MANY_RELATION_KINDS.has(relationKind);

export interface AttributeIR {
  readonly name: string;
  readonly type: StrapiAttributeType;
  readonly required: boolean;
  readonly enumValues?: readonly string[];
  // Strapi's optional naming hint on enumeration attributes (used by its
  // GraphQL plugin); we honor it for enum const-object naming
  readonly enumName?: string;
  readonly componentUID?: string;
  readonly componentUIDs?: readonly string[];
  readonly repeatable?: boolean;
  readonly relationKind?: RelationKind;
  readonly relationTarget?: string;
  readonly mediaMultiple?: boolean;
  readonly unique?: boolean;
  readonly defaultValue?: string | number | boolean;
  readonly mediaAllowedTypes?: readonly string[];
}

export interface ContentTypeIR {
  readonly uid: string;
  readonly singularName: string;
  readonly pluralName: string;
  readonly displayName: string;
  readonly kind: 'collectionType' | 'singleType';
  readonly attributes: readonly AttributeIR[];
}

export interface ComponentIR {
  readonly uid: string;
  readonly category: string;
  readonly displayName: string;
  readonly attributes: readonly AttributeIR[];
}
