import type { NullableStyle } from '../../types';
import type { OverrideConfig } from '../../generators/override-resolver';
import type { SchemaRegistry } from '../../generators/schema-registry';
import type { ComponentIR, ContentTypeIR } from '../../types';
import { registerAdapter } from '../target-adapter';
import { buildContentTypeSchema, buildComponentSchema } from '../shared/schema-builder';
import { valibotPrimitives } from './primitives';
import { buildOverridesFileContent } from './overrides';

export const UPLOAD_FILE_IMPORT =
  "import { type InferInput, nullish, number, object, record, string, unknown } from 'valibot';";

export const UPLOAD_FILE_SCHEMA_CODE = `export const UploadFileFormatSchema = object({
  url: string(),
  width: nullish(number()),
  height: nullish(number()),
  mime: nullish(string()),
  size: nullish(number()),
  ext: nullish(string()),
  hash: nullish(string()),
  name: nullish(string()),
  path: nullish(string()),
  sizeInBytes: nullish(number()),
});

export type UploadFileFormat = InferInput<typeof UploadFileFormatSchema>;

export const UploadFileSchema = object({
  id: number(),
  documentId: string(),
  name: string(),
  alternativeText: nullish(string()),
  caption: nullish(string()),
  width: nullish(number()),
  height: nullish(number()),
  url: string(),
  formats: nullish(record(string(), UploadFileFormatSchema)),
  hash: string(),
  mime: string(),
  size: number(),
  ext: nullish(string()),
  previewUrl: nullish(string()),
  provider: string(),
  provider_metadata: unknown(),
});

export type UploadFile = InferInput<typeof UploadFileSchema>;`;

export const REGISTRY_CODE = `import { lazy } from 'valibot';

const schemas = new Map<string, unknown>();

export const register = (name: string, schema: unknown): void => {
  schemas.set(name, schema);
};

export const ref = (name: string) =>
  lazy(() => {
    const s = schemas.get(name);
    if (!s) throw new Error(\`Schema "\${name}" not registered\`);
    return s as Parameters<typeof lazy>[0] extends () => infer R ? R : never;
  });
`;

export const VALIDATION_IMPORT = `import { array, safeParse } from 'valibot';`;

export const VALIDATION_CODE = `
    const result = safeParse(schema as Parameters<typeof safeParse>[0], data);

    if (!result.success) {
      throw new StrapiSchemaValidationError({
        endpoint,
        method: 'GET',
        status,
        issues: result.issues,
      });
    }

    return result.output as T;`;

const mapContentTypeSchema = (
  ct: ContentTypeIR,
  nullableStyle: NullableStyle,
  registry: SchemaRegistry,
  overrides?: OverrideConfig,
  jsdoc?: boolean,
) =>
  buildContentTypeSchema({
    ct,
    nullableStyle,
    registry,
    primitives: valibotPrimitives,
    overrides,
    jsdoc,
  });

const mapComponentSchema = (
  component: ComponentIR,
  nullableStyle: NullableStyle,
  registry: SchemaRegistry,
  overrides?: OverrideConfig,
  componentUsage?: { readonly inDynamicZone: boolean; readonly inComponent: boolean },
  jsdoc?: boolean,
) =>
  buildComponentSchema({
    component,
    nullableStyle,
    registry,
    primitives: valibotPrimitives,
    overrides,
    componentUsage,
    jsdoc,
  });

registerAdapter('valibot', {
  UPLOAD_FILE_IMPORT,
  UPLOAD_FILE_SCHEMA_CODE,
  REGISTRY_CODE,
  arrayWrap: valibotPrimitives.arrayWrap,
  validationImport: VALIDATION_IMPORT,
  validationCode: VALIDATION_CODE,
  primitives: valibotPrimitives,
  mapContentTypeSchema,
  mapComponentSchema,
  buildOverridesFileContent,
});
