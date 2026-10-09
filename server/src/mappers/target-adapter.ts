import type {
  ComponentIR,
  ContentTypeIR,
  NullableStyle,
  SchemaTarget,
  TypeOverride,
} from '../types';
import type { OverrideConfig } from '../generators/override-resolver';
import type { SchemaRegistry } from '../generators/schema-registry';
import type { TargetPrimitives } from './shared/types';

export interface MappedSchema {
  readonly code: string;
  readonly importStatement: string;
  readonly externalImports: readonly import('../generators/schema-registry').ExternalImport[];
  readonly registryImport?: string;
  readonly typeImportStatements?: readonly string[];
}

export interface TargetAdapter {
  readonly UPLOAD_FILE_IMPORT: string;
  readonly UPLOAD_FILE_SCHEMA_CODE: string;
  readonly REGISTRY_CODE: string;
  readonly arrayWrap: (schemaVar: string) => string;
  readonly validationImport: string;
  readonly validationCode: string;
  // Target syntax for callers that compose expressions themselves (views, slices)
  readonly primitives: TargetPrimitives;

  readonly mapContentTypeSchema: (
    ct: ContentTypeIR,
    nullableStyle: NullableStyle,
    registry: SchemaRegistry,
    overrides?: OverrideConfig,
    jsdoc?: boolean,
  ) => MappedSchema;

  readonly mapComponentSchema: (
    component: ComponentIR,
    nullableStyle: NullableStyle,
    registry: SchemaRegistry,
    overrides?: OverrideConfig,
    componentUsage?: { readonly inDynamicZone: boolean; readonly inComponent: boolean },
    jsdoc?: boolean,
  ) => MappedSchema;

  readonly buildOverridesFileContent: (overrides: readonly TypeOverride[]) => string;
}

const adapters = new Map<SchemaTarget, TargetAdapter>();

export const registerAdapter = (target: SchemaTarget, adapter: TargetAdapter): void => {
  adapters.set(target, adapter);
};

export const getAdapter = (target: SchemaTarget): TargetAdapter => {
  const adapter = adapters.get(target);
  if (!adapter)
    throw new Error(`Unknown target: "${target}". Available: ${[...adapters.keys()].join(', ')}`);
  return adapter;
};

export const getAvailableTargets = (): readonly SchemaTarget[] => [...adapters.keys()];
