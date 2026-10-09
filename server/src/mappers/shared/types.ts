import type { AttributeIR, NullableStyle } from '../../types';
import type { SchemaRegistry } from '../../generators/schema-registry';

export interface MappedAttribute {
  readonly expression: string;
  readonly externalRefs: readonly string[];
}

export interface RefWrapOptions {
  // Defer evaluation with lazy() - required for self-references and for refs
  // between components that participate in a dependency cycle (their modules
  // import each other; eager refs hit the TDZ at module evaluation)
  readonly lazy: boolean;
  // Self-references stay in the same file and need no import
  readonly selfRef: boolean;
}

// Everything target-specific lives here so generators compose expressions
// without knowing which library they emit for
export interface TargetPrimitives {
  readonly primitiveMap: Readonly<Record<string, string>>;
  readonly unknownExpression: string;
  readonly nullExpression: string;
  // Numeric row id the runtime always returns alongside documentId
  readonly idExpression: string;
  readonly literal: (value: string) => string;
  // `__component` field of a dynamic-zone member; optional when the component
  // is also used outside a zone (Strapi omits the field there)
  readonly componentDiscriminator: (uid: string, required: boolean) => string;
  readonly inferType: (schemaVarName: string) => string;
  // `loose` objects keep unknown keys (enrich hooks, open meta)
  readonly objectOpen: (loose: boolean) => string;
  readonly objectClose: (loose: boolean) => string;
  readonly union: (members: readonly string[]) => string;
  readonly discriminatedUnion: (members: readonly string[]) => string;
  // Import lines the inferred-type syntax needs (none for zod)
  readonly typeImportStatements: readonly string[];
  readonly wrapNullability: (expr: string, required: boolean, style: NullableStyle) => string;
  readonly wrapRef: (
    schemaRef: string,
    options: RefWrapOptions,
    isMany: boolean,
  ) => MappedAttribute;
  readonly mapEnumeration: (attr: AttributeIR) => string;
  readonly mapMedia: (attr: AttributeIR) => MappedAttribute;
  readonly mapDynamiczone: (attr: AttributeIR, registry: SchemaRegistry) => MappedAttribute;
  // `recursiveType` annotates the const with its interface: a schema that
  // references itself (directly or through a cycle) cannot be inferred by
  // TypeScript under strict mode (TS7022) without an explicit type
  readonly objectWrap: (
    varName: string,
    lines: readonly string[],
    recursiveType?: string,
  ) => string;
  // Import lines the recursive annotation needs (none for zod)
  readonly recursiveTypeImports: readonly string[];
  readonly buildImportStatement: (lines: readonly string[]) => string;
  readonly arrayWrap: (schemaVar: string) => string;
}
