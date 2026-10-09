import type { Core } from '@strapi/types';

import { PLUGIN_ID } from '../constants';
import { defaultConfig } from '../config';
import type { ContentSchemasConfig } from '../types';

type ConfigKey = keyof ContentSchemasConfig;

// Strapi exposes plugin config as an untyped key accessor; this is the one
// place that reads it, so every consumer sees the same typed, defaulted shape
export const readPluginConfig = (strapi: Core.Strapi): ContentSchemasConfig => {
  const pluginConfig = strapi.plugin(PLUGIN_ID).config as unknown as (key: string) => unknown;
  const read = <K extends ConfigKey>(key: K): ContentSchemasConfig[K] =>
    (pluginConfig(key) as ContentSchemasConfig[K] | undefined) ?? defaultConfig[key];

  return {
    contentTypes: read('contentTypes'),
    components: read('components'),
    includeInternalFields: read('includeInternalFields'),
    typeOverrides: read('typeOverrides'),
    fieldOverrides: read('fieldOverrides'),
    viewTransformSchemas: read('viewTransformSchemas'),
    viewResponseSchemas: read('viewResponseSchemas'),
    nameOverrides: read('nameOverrides'),
  };
};
