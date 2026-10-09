export type { StrapiAttributeType, AttributeIR, ContentTypeIR, ComponentIR } from './ir';

export type {
  SchemaTarget,
  NullableStyle,
  ComponentFilter,
  TypeOverride,
  InternalFieldsConfig,
  ContentSchemasConfig,
  GenerationOptions,
  TargetOverrides,
  ViewResponseDeclaration,
  TargetViewResponseSchemas,
} from './config';

export type { GenerationManifest } from '../services/generator';

export type {
  BffViewTransform,
  BffRelationOverlay,
  BffViewManifestEntry,
  BffViewManifest,
} from './view-manifest';
export { SUPPORTED_VIEW_MANIFEST_VERSION } from './view-manifest';
