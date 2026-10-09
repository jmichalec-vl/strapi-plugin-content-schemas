import type { Core } from '@strapi/types';

import { GenerationError, InvalidRequestError, describeError } from '../errors';
import { getService } from '../utils/get-service';
import { readPluginConfig } from '../utils/plugin-config';
import type {
  ContentSchemasConfig,
  GenerationOptions,
  NullableStyle,
  SchemaTarget,
} from '../types';

export interface ApiContext {
  // Koa yields string[] for repeated query params (?populate=a&populate=b)
  readonly query: Record<string, string | string[] | undefined>;
  body: unknown;
  set: (key: string, value: string) => void;
  badRequest: (message: string) => unknown;
  internalServerError: (message: string) => unknown;
}

const GENERIC_FAILURE_MESSAGE = 'Schema generation failed - see the server log for details.';
const VALID_TARGETS: ReadonlySet<string> = new Set<SchemaTarget>(['valibot', 'zod']);
const VALID_NULLABLE_STYLES: ReadonlySet<string> = new Set<NullableStyle>([
  'nullish',
  'optional-union-null',
]);

const isSchemaTarget = (value: string): value is SchemaTarget => VALID_TARGETS.has(value);
const isNullableStyle = (value: string): value is NullableStyle => VALID_NULLABLE_STYLES.has(value);

type ServerOverrides = Pick<
  ContentSchemasConfig,
  | 'typeOverrides'
  | 'fieldOverrides'
  | 'viewTransformSchemas'
  | 'viewResponseSchemas'
  | 'nameOverrides'
>;

const getSingleParam = (
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined => {
  const value = query[key];
  if (Array.isArray(value)) {
    throw new InvalidRequestError(`Query parameter "${key}" must not be repeated.`);
  }
  return value;
};

// The skipped-overrides condition is static config, not per-request state -
// warn once per (context, target) instead of flooding the log
const warnedOverrideSkips = new Set<string>();

// Overrides are keyed by target first; a target without an entry gets none
const resolveOverridesForTarget = <T>(
  overrides: Readonly<Record<string, Readonly<Record<string, T>>>>,
  target: string,
  context: string,
  strapi: Core.Strapi,
): Readonly<Record<string, T>> => {
  const targetOverrides = overrides[target];
  if (targetOverrides) return targetOverrides;

  const otherTargets = Object.keys(overrides).filter((t) => {
    const entry = overrides[t];
    return entry && Object.keys(entry).length > 0;
  });
  const warnKey = `${context}:${target}`;
  if (otherTargets.length > 0 && !warnedOverrideSkips.has(warnKey)) {
    warnedOverrideSkips.add(warnKey);
    strapi.log.warn(
      `[content-schemas] ${context} has configurations for [${otherTargets.join(', ')}] but not for "${target}". Overrides will be skipped.`,
    );
  }

  return {};
};

const parseGenerationOptions = (
  query: Record<string, string | string[] | undefined>,
  serverConfig: ServerOverrides,
  strapi: Core.Strapi,
): GenerationOptions => {
  const target = getSingleParam(query, 'target') ?? 'valibot';
  if (!isSchemaTarget(target)) {
    throw new InvalidRequestError(
      `Invalid target: "${target}". Must be one of: ${[...VALID_TARGETS].join(', ')}`,
    );
  }

  const nullableStyle = getSingleParam(query, 'nullableStyle') ?? 'nullish';
  if (!isNullableStyle(nullableStyle)) {
    throw new InvalidRequestError(
      `Invalid nullableStyle: "${nullableStyle}". Must be one of: ${[...VALID_NULLABLE_STYLES].join(', ')}`,
    );
  }

  return {
    target,
    nullableStyle,
    generatePopulate: getSingleParam(query, 'populate') !== 'false',
    generateClient: getSingleParam(query, 'client') !== 'false',
    jsdoc: getSingleParam(query, 'jsdoc') === 'true',
    mocks: getSingleParam(query, 'mocks') === 'true',
    typeOverrides: resolveOverridesForTarget(
      serverConfig.typeOverrides,
      target,
      'typeOverrides',
      strapi,
    ),
    fieldOverrides: resolveOverridesForTarget(
      serverConfig.fieldOverrides,
      target,
      'fieldOverrides',
      strapi,
    ),
    viewTransformSchemas: resolveOverridesForTarget(
      serverConfig.viewTransformSchemas,
      target,
      'viewTransformSchemas',
      strapi,
    ),
    viewResponseSchemas: resolveOverridesForTarget(
      serverConfig.viewResponseSchemas,
      target,
      'viewResponseSchemas',
      strapi,
    ),
    // Not per-target: identifier names are shared across targets
    nameOverrides: serverConfig.nameOverrides,
  };
};

const contentSchemasController = ({ strapi }: { strapi: Core.Strapi }) => {
  const getGeneratorService = () => getService(strapi, 'generator');

  const getServerOverrides = (): ServerOverrides => readPluginConfig(strapi);

  const getSchemas = async (ctx: ApiContext) => {
    let options: GenerationOptions;
    try {
      options = parseGenerationOptions(ctx.query, getServerOverrides(), strapi);
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        ctx.badRequest(error.message);
        return;
      }
      strapi.log.error(`[content-schemas] Reading plugin config failed: ${describeError(error)}`);
      ctx.internalServerError(GENERIC_FAILURE_MESSAGE);
      return;
    }

    let tarball: Buffer;
    try {
      tarball = getGeneratorService().getTarball(options);
    } catch (error) {
      strapi.log.error(`[content-schemas] Generation failed: ${describeError(error)}`);
      // Only our own generation errors are consumer-actionable (name
      // collisions, path limits); anything else stays in the server log
      ctx.internalServerError(
        error instanceof GenerationError ? error.message : GENERIC_FAILURE_MESSAGE,
      );
      return;
    }

    ctx.set('Content-Type', 'application/gzip');
    ctx.set('Content-Disposition', 'attachment; filename="schemas.tar.gz"');
    ctx.body = tarball;
  };

  const getManifest = async (ctx: ApiContext) => {
    try {
      ctx.body = getGeneratorService().getManifest();
    } catch (error) {
      strapi.log.error(`[content-schemas] Manifest failed: ${describeError(error)}`);
      ctx.internalServerError(GENERIC_FAILURE_MESSAGE);
    }
  };

  const getStatus = async (ctx: ApiContext) => {
    ctx.body = getGeneratorService().getStatus() ?? { generated: false };
  };

  return {
    getSchemas,
    getManifest,
    getStatus,
  };
};

export default contentSchemasController;
