import { describe, it, expect } from 'vitest';
import type { Core } from '@strapi/types';

import { readPluginConfig } from '../../../../server/src/utils/plugin-config';
import { defaultConfig } from '../../../../server/src/config';

const strapiWithConfig = (values: Record<string, unknown>): Core.Strapi =>
  ({
    plugin: () => ({ config: (key: string) => values[key] }),
  }) as unknown as Core.Strapi;

describe('readPluginConfig', () => {
  it('falls back to the plugin defaults for keys the app does not set', () => {
    const config = readPluginConfig(strapiWithConfig({}));

    expect(config).toEqual(defaultConfig);
  });

  it('returns configured values verbatim', () => {
    const config = readPluginConfig(
      strapiWithConfig({ contentTypes: ['api::article.article'], components: 'all' }),
    );

    expect(config.contentTypes).toEqual(['api::article.article']);
    expect(config.components).toBe('all');
    expect(config.nameOverrides).toEqual({});
  });
});
