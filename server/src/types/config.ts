export type SchemaTarget = 'valibot' | 'zod';

export type NullableStyle = 'nullish' | 'optional-union-null';

export interface InternalFieldsConfig {
  readonly timestamps: boolean;
}

export type ComponentFilter = 'referenced' | 'all' | readonly string[];

export interface TypeOverride {
  readonly schema: string;
  readonly name: string;
  readonly typeName: string;
}

export type TargetOverrides = Readonly<Record<string, Readonly<Record<string, TypeOverride>>>>;

export interface ViewResponseDeclaration extends TypeOverride {
  /**
   * Escape hatch when identifier auto-resolution is ambiguous: verbatim import
   * lines prepended to the view file. Normally unnecessary - the generator
   * scans the schema string for known generated exports and imports them.
   */
  readonly imports?: readonly string[];
}

export type TargetViewResponseSchemas = Readonly<
  Record<string, Readonly<Record<string, ViewResponseDeclaration>>>
>;

export interface ContentSchemasConfig {
  readonly contentTypes: readonly string[];
  readonly components: ComponentFilter;
  readonly includeInternalFields: InternalFieldsConfig;
  readonly typeOverrides: TargetOverrides;
  readonly fieldOverrides: TargetOverrides;
  /**
   * Schemas for bff-views transformer output, keyed by transformer name
   * (then by target, like typeOverrides). Only needed for transformers whose
   * effect is not already reflected in base schemas via a typeOverride.
   */
  readonly viewTransformSchemas: TargetOverrides;
  /**
   * Declared response schemas for bff-views with an `assemble` hook, keyed by
   * view id (then by target). The assemble hook defines the final response
   * shape in arbitrary JS the generator cannot derive - this is the consumer's
   * declaration of that shape, co-located with the hook via config. The schema
   * string may reference any generated export (view slices, component/CT
   * schemas); the generator resolves those imports.
   */
  readonly viewResponseSchemas: TargetViewResponseSchemas;
  /**
   * Component uid → identifier base name (PascalCase), replacing the default
   * category-prefixed name in every generated identifier (schema, type,
   * populate, mock). The escape hatch for residual name collisions - e.g. a
   * content type `api::catalog-form.catalog-form` colliding with component
   * `catalog.form`: `{ 'catalog.form': 'CatalogFormComponent' }`. Not
   * per-target: identifiers are shared across targets. File paths are
   * unaffected.
   */
  readonly nameOverrides: Readonly<Record<string, string>>;
}

export interface GenerationOptions {
  readonly target: SchemaTarget;
  readonly nullableStyle: NullableStyle;
  readonly generatePopulate: boolean;
  readonly generateClient: boolean;
  readonly jsdoc: boolean;
  readonly mocks: boolean;
  readonly typeOverrides: Readonly<Record<string, TypeOverride>>;
  readonly fieldOverrides: Readonly<Record<string, TypeOverride>>;
  readonly viewTransformSchemas: Readonly<Record<string, TypeOverride>>;
  readonly viewResponseSchemas: Readonly<Record<string, ViewResponseDeclaration>>;
  readonly nameOverrides: Readonly<Record<string, string>>;
}
