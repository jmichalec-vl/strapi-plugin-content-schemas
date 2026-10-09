import { describe, it, expect } from 'vitest';

import config from '../../../server/src/config';
import type { ContentSchemasConfig } from '../../../server/src/types';

const validConfig: ContentSchemasConfig = {
  contentTypes: ['api::*'],
  components: 'referenced',
  includeInternalFields: { timestamps: false },
  typeOverrides: {},
  fieldOverrides: {},
  viewTransformSchemas: {},
  viewResponseSchemas: {},
  nameOverrides: {},
};

describe('config', () => {
  describe('default', () => {
    it('has expected default values', () => {
      expect(config.default.contentTypes).toEqual(['api::*']);
      expect(config.default.components).toBe('referenced');
      expect(config.default.includeInternalFields).toEqual({ timestamps: false });
      expect(config.default.typeOverrides).toEqual({});
      expect(config.default.fieldOverrides).toEqual({});
    });
  });

  describe('validator', () => {
    describe('nameOverrides', () => {
      const withNameOverrides = (nameOverrides: Record<string, string>) => ({
        ...validConfig,
        nameOverrides,
      });

      it('accepts component uids mapped to PascalCase identifier bases', () => {
        expect(() =>
          config.validator(withNameOverrides({ 'catalog.form': 'CatalogFormComponent' })),
        ).not.toThrow();
      });

      it('rejects keys that are not component uids', () => {
        expect(() =>
          config.validator(withNameOverrides({ 'api::page.page': 'PageComponent' })),
        ).toThrow(/nameOverrides keys must be component uids/);
        expect(() => config.validator(withNameOverrides({ page: 'PageComponent' }))).toThrow(
          /nameOverrides keys must be component uids/,
        );
      });

      it('rejects values that are not PascalCase identifier bases', () => {
        expect(() =>
          config.validator(withNameOverrides({ 'catalog.form': 'catalogForm' })),
        ).toThrow(/PascalCase identifier base/);
        expect(() =>
          config.validator(withNameOverrides({ 'catalog.form': 'Catalog Form' })),
        ).toThrow(/PascalCase identifier base/);
      });
    });

    it('passes with valid config', () => {
      expect(() => config.validator(validConfig)).not.toThrow();
    });

    it('throws for empty contentTypes array', () => {
      expect(() => config.validator({ ...validConfig, contentTypes: [] })).toThrow(
        '[content-schemas] contentTypes must be a non-empty array',
      );
    });

    it('throws for invalid includeInternalFields', () => {
      expect(() =>
        config.validator({
          ...validConfig,
          includeInternalFields: null as unknown as ContentSchemasConfig['includeInternalFields'],
        }),
      ).toThrow('[content-schemas] includeInternalFields must be an object');
    });

    it('passes with components as "referenced"', () => {
      expect(() => config.validator({ ...validConfig, components: 'referenced' })).not.toThrow();
    });

    it('passes with components as "all"', () => {
      expect(() => config.validator({ ...validConfig, components: 'all' })).not.toThrow();
    });

    it('passes with components as array', () => {
      expect(() => config.validator({ ...validConfig, components: ['shared.seo'] })).not.toThrow();
    });

    it('throws for invalid components string', () => {
      expect(() =>
        config.validator({ ...validConfig, components: 'invalid' as 'referenced' }),
      ).toThrow('[content-schemas] components must be one of');
    });

    it('passes with target-keyed type overrides', () => {
      expect(() =>
        config.validator({
          ...validConfig,
          typeOverrides: {
            valibot: {
              richtext: {
                schema: 'object({ html: string() })',
                name: 'RenderedHtmlSchema',
                typeName: 'RenderedHtml',
              },
            },
          },
        }),
      ).not.toThrow();
    });

    it('passes with both valibot and zod overrides', () => {
      expect(() =>
        config.validator({
          ...validConfig,
          typeOverrides: {
            valibot: {
              richtext: {
                schema: 'object({ html: string() })',
                name: 'RenderedHtmlSchema',
                typeName: 'RenderedHtml',
              },
            },
            zod: {
              richtext: {
                schema: 'z.object({ html: z.string() })',
                name: 'RenderedHtmlSchema',
                typeName: 'RenderedHtml',
              },
            },
          },
        }),
      ).not.toThrow();
    });

    it('throws for override with empty schema', () => {
      expect(() =>
        config.validator({
          ...validConfig,
          typeOverrides: {
            valibot: {
              richtext: { schema: '', name: 'RenderedHtmlSchema', typeName: 'RenderedHtml' },
            },
          },
        }),
      ).toThrow('typeOverrides.valibot.richtext.schema must be a non-empty string');
    });

    it('throws for override with empty name', () => {
      expect(() =>
        config.validator({
          ...validConfig,
          typeOverrides: {
            valibot: { richtext: { schema: 'string()', name: '', typeName: 'RenderedHtml' } },
          },
        }),
      ).toThrow('typeOverrides.valibot.richtext.name must be a non-empty string');
    });

    it('throws for an override name that is not a TypeScript identifier', () => {
      const bad = {
        ...validConfig,
        typeOverrides: {
          valibot: { richtext: { schema: 'string()', name: 'Rendered-Html', typeName: 'Html' } },
        },
      };

      expect(() => config.validator(bad)).toThrow(/valid TypeScript identifier/);
    });

    it('throws for an override typeName that is not a TypeScript identifier', () => {
      const bad = {
        ...validConfig,
        fieldOverrides: {
          zod: { 'api::a.a.x': { schema: 'z.string()', name: 'Ok', typeName: '1Bad' } },
        },
      };

      expect(() => config.validator(bad)).toThrow(/typeName must be a valid TypeScript identifier/);
    });

    it('throws for duplicate override names within same target', () => {
      expect(() =>
        config.validator({
          ...validConfig,
          typeOverrides: {
            valibot: {
              richtext: { schema: 'string()', name: 'DuplicateSchema', typeName: 'Dup1' },
              blocks: { schema: 'string()', name: 'DuplicateSchema', typeName: 'Dup2' },
            },
          },
        }),
      ).toThrow('Duplicate override name "DuplicateSchema"');
    });
  });
});
