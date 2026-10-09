import { createHash } from 'node:crypto';

import type { Core } from '@strapi/types';

import { PLUGIN_VERSION, SCHEMA_FORMAT_VERSION } from '../constants';
import { getService } from '../utils/get-service';
import { readPluginConfig } from '../utils/plugin-config';
import { createTarGz } from '../generators/tar';
import type {
  BffViewManifest,
  ContentSchemasConfig,
  ContentTypeIR,
  ComponentIR,
  GenerationOptions,
} from '../types';
import { SUPPORTED_VIEW_MANIFEST_VERSION } from '../types';

export interface GenerationManifest {
  readonly hash: string;
  readonly timestamp: string;
  readonly pluginVersion: string;
  readonly schemaFormatVersion: number;
  // null when the manifest was computed without running generation
  readonly fileCount: number | null;
  readonly contentTypes: readonly string[];
  readonly components: readonly string[];
}

const MAX_CACHED_TARBALLS = 8;

// The hash must cover everything that can change the generated output: the
// content model IR, the plugin config (overrides, filters), the bff-views
// view manifest when present, AND the generator itself (a plugin upgrade can
// change emitted code for an unchanged model) - otherwise an edit or upgrade
// serves stale hash-keyed caches (watch mode, tarball cache)
const computeSchemaHash = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
  config: ContentSchemasConfig,
  viewManifest: BffViewManifest | null,
): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        pluginVersion: PLUGIN_VERSION,
        schemaFormatVersion: SCHEMA_FORMAT_VERSION,
        contentTypes,
        components,
        config,
        viewManifest,
      }),
    )
    .digest('hex')
    .slice(0, 16);

const buildManifest = (
  fileCount: number | null,
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
  config: ContentSchemasConfig,
  viewManifest: BffViewManifest | null,
): GenerationManifest => ({
  hash: computeSchemaHash(contentTypes, components, config, viewManifest),
  timestamp: new Date().toISOString(),
  pluginVersion: PLUGIN_VERSION,
  schemaFormatVersion: SCHEMA_FORMAT_VERSION,
  fileCount,
  contentTypes: contentTypes.map((ct) => ct.uid),
  components: components.map((c) => c.uid),
});

const generator = ({ strapi }: { strapi: Core.Strapi }) => {
  let lastGeneration: GenerationManifest | null = null;

  // Tarballs cached per generation-options key; the whole cache is dropped as
  // soon as the content model (schema hash) changes
  let tarballCache = new Map<string, Buffer>();
  let cachedSchemaHash: string | null = null;

  const getConfigAndServices = () => ({
    config: readPluginConfig(strapi),
    reader: getService(strapi, 'schema-reader'),
    writer: getService(strapi, 'code-writer'),
  });

  // Feature detection, not a dependency: when bff-views is enabled in the same
  // app, its view manifest drives per-view schema generation. Absent plugin,
  // unknown manifest version, or a throwing service all degrade to "no views".
  const readViewManifest = (): BffViewManifest | null => {
    try {
      const bffPlugin = strapi.plugin('bff-views');
      if (!bffPlugin) return null;
      const viewRegistry = bffPlugin.service('view-registry') as
        { describeViews?: () => BffViewManifest } | undefined;
      if (typeof viewRegistry?.describeViews !== 'function') return null;

      const manifest = viewRegistry.describeViews();
      if (manifest?.manifestVersion !== SUPPORTED_VIEW_MANIFEST_VERSION) {
        strapi.log.warn(
          `[content-schemas] bff-views manifest version ${manifest?.manifestVersion} is not supported ` +
            `(expected ${SUPPORTED_VIEW_MANIFEST_VERSION}) - view schemas skipped`,
        );
        return null;
      }
      return manifest;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      strapi.log.warn(`[content-schemas] reading the bff-views manifest failed: ${message}`);
      return null;
    }
  };

  const readSchemas = () => {
    const { config, reader, writer } = getConfigAndServices();
    const contentTypes = reader.readContentTypes(config.contentTypes, config.includeInternalFields);
    const components = reader.readComponents(
      config.components,
      contentTypes,
      config.includeInternalFields,
    );
    const viewManifest = readViewManifest();
    return { config, contentTypes, components, writer, viewManifest };
  };

  const generate = (options: GenerationOptions): ReadonlyMap<string, string> => {
    const { config, contentTypes, components, writer, viewManifest } = readSchemas();
    const files = writer.buildSchemaFiles(contentTypes, components, options, viewManifest);

    lastGeneration = buildManifest(files.size, contentTypes, components, config, viewManifest);
    return files;
  };

  const getTarball = (options: GenerationOptions): Buffer => {
    const { config, contentTypes, components, writer, viewManifest } = readSchemas();
    const schemaHash = computeSchemaHash(contentTypes, components, config, viewManifest);

    if (schemaHash !== cachedSchemaHash) {
      tarballCache = new Map();
      cachedSchemaHash = schemaHash;
    }

    const cacheKey = JSON.stringify(options);
    const cached = tarballCache.get(cacheKey);
    if (cached) return cached;

    const files = writer.buildSchemaFiles(contentTypes, components, options, viewManifest);
    lastGeneration = buildManifest(files.size, contentTypes, components, config, viewManifest);
    const tarball = createTarGz(files);

    if (tarballCache.size >= MAX_CACHED_TARBALLS) {
      const oldestKey = tarballCache.keys().next().value;
      if (oldestKey !== undefined) tarballCache.delete(oldestKey);
    }
    tarballCache.set(cacheKey, tarball);

    return tarball;
  };

  const getManifest = (): GenerationManifest => {
    const { config, contentTypes, components, viewManifest } = readSchemas();
    return buildManifest(null, contentTypes, components, config, viewManifest);
  };

  const getStatus = (): GenerationManifest | null => lastGeneration;

  return { generate, getTarball, getManifest, getStatus };
};

export default generator;
