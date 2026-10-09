import type { NullableStyle } from '../../types';
import type { OverrideConfig } from '../../generators/override-resolver';
import type { SchemaRegistry } from '../../generators/schema-registry';
import type { ComponentIR, ContentTypeIR } from '../../types';
import { registerAdapter } from '../target-adapter';
import { buildContentTypeSchema, buildComponentSchema } from '../shared/schema-builder';
import { zodPrimitives } from './primitives';
import { buildOverridesFileContent } from './overrides';

export const UPLOAD_FILE_IMPORT = `import { z } from 'zod';`;

export const UPLOAD_FILE_SCHEMA_CODE = `export const UploadFileFormatSchema = z.object({
  url: z.string(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  mime: z.string().nullish(),
  size: z.number().nullish(),
  ext: z.string().nullish(),
  hash: z.string().nullish(),
  name: z.string().nullish(),
  path: z.string().nullish(),
  sizeInBytes: z.number().nullish(),
});

export type UploadFileFormat = z.infer<typeof UploadFileFormatSchema>;

export const UploadFileSchema = z.object({
  id: z.number(),
  documentId: z.string(),
  name: z.string(),
  alternativeText: z.string().nullish(),
  caption: z.string().nullish(),
  width: z.number().nullish(),
  height: z.number().nullish(),
  url: z.string(),
  formats: z.record(z.string(), UploadFileFormatSchema).nullish(),
  hash: z.string(),
  mime: z.string(),
  size: z.number(),
  ext: z.string().nullish(),
  previewUrl: z.string().nullish(),
  provider: z.string(),
  provider_metadata: z.unknown(),
});

export type UploadFile = z.infer<typeof UploadFileSchema>;`;

export const REGISTRY_CODE = `import { z } from 'zod';

const schemas = new Map<string, z.ZodTypeAny>();

export const register = (name: string, schema: z.ZodTypeAny): void => {
  schemas.set(name, schema);
};

export const ref = (name: string) =>
  z.lazy(() => {
    const s = schemas.get(name);
    if (!s) throw new Error(\`Schema "\${name}" not registered\`);
    return s;
  });
`;

export const VALIDATION_IMPORT = `import { z } from 'zod';`;

export const VALIDATION_CODE = `
    const result = (schema as { safeParse: (data: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown[] } } }).safeParse(data);

    if (!result.success) {
      throw new StrapiSchemaValidationError({
        endpoint,
        method: 'GET',
        status,
        issues: result.error!.issues,
      });
    }

    return result.data as T;`;

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
    primitives: zodPrimitives,
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
    primitives: zodPrimitives,
    overrides,
    componentUsage,
    jsdoc,
  });

registerAdapter('zod', {
  UPLOAD_FILE_IMPORT,
  UPLOAD_FILE_SCHEMA_CODE,
  REGISTRY_CODE,
  arrayWrap: zodPrimitives.arrayWrap,
  validationImport: VALIDATION_IMPORT,
  validationCode: VALIDATION_CODE,
  primitives: zodPrimitives,
  mapContentTypeSchema,
  mapComponentSchema,
  buildOverridesFileContent,
});
