import { describe, it, expect, beforeEach, vi } from 'vitest';

import populateBuilder from '../../../../server/src/services/populate-builder';
import schemaReader from '../../../../server/src/services/schema-reader';
import { createMockStrapi } from '../../../helpers/mock-strapi';
import { createTestContentTypes, createTestComponents } from '../../../helpers/test-content-types';
import type { Core } from '@strapi/types';

const containsRef = (value: unknown): boolean => {
  if (typeof value !== 'object' || value === null) return false;
  if ('__ref' in value) return true;
  return Object.values(value).some(containsRef);
};

describe('populate-builder', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let builder: ReturnType<typeof populateBuilder>;
  let reader: ReturnType<typeof schemaReader>;

  beforeEach(() => {
    mock = createMockStrapi();
    mock.setContentTypes(createTestContentTypes());
    mock.setComponents(createTestComponents());
    reader = schemaReader({ strapi: mock.strapi as unknown as Core.Strapi });
    mock.registerService('content-schemas', 'schema-reader', reader);
    builder = populateBuilder({ strapi: mock.strapi as unknown as Core.Strapi });
  });

  describe('buildComponentPopulateTree', () => {
    it('builds a fully inlined populate tree for a component with media and nested components', () => {
      const tree = builder.buildComponentPopulateTree('hero-section.hero-section');

      expect(tree).toEqual({
        populate: {
          image: true,
          mobileImage: true,
          heroSectionButtons: true,
        },
      });
    });

    it('never emits __ref placeholders anywhere in the tree', () => {
      const tree = builder.buildComponentPopulateTree('hero-section.hero-section');

      expect(containsRef(tree)).toBe(false);
    });

    it('returns true for an unknown component uid', () => {
      expect(builder.buildComponentPopulateTree('unknown.component')).toBe(true);
    });

    it('terminates on recursive components via the visited guard', () => {
      mock.setComponents({
        ...createTestComponents(),
        'recursive.node': {
          uid: 'recursive.node',
          category: 'recursive',
          info: { displayName: 'Node' },
          attributes: {
            label: { type: 'string' },
            child: { type: 'component', component: 'recursive.node', repeatable: true },
          },
        },
      });

      const tree = builder.buildComponentPopulateTree('recursive.node');

      expect(tree).toEqual({ populate: { child: true } });
    });
  });

  describe('buildContentTypePopulateTree', () => {
    it('builds populate for media, components, and dynamic zones with on: fragments', () => {
      const tree = builder.buildContentTypePopulateTree('api::page.page');

      expect(tree).toEqual({
        image: true,
        gallery: true,
        seo: { populate: { metaImage: true } },
        modules: {
          on: {
            'hero-section.hero-section': {
              populate: { image: true, mobileImage: true, heroSectionButtons: true },
            },
            'faq.faq': { populate: { faqItems: true } },
          },
        },
      });
    });

    it('excludes relations from the generated populate', () => {
      const tree = builder.buildContentTypePopulateTree('api::page.page');

      expect(tree).not.toHaveProperty('author');
      expect(tree).not.toHaveProperty('tags');
      expect(tree).not.toHaveProperty('relatedArticles');
    });

    it('returns null for an unknown content type uid', () => {
      expect(builder.buildContentTypePopulateTree('api::missing.missing')).toBeNull();
    });
  });

  describe('getContentTypeIR', () => {
    it('returns the IR for a known uid', () => {
      const ir = builder.getContentTypeIR('api::article.article');

      expect(ir?.uid).toBe('api::article.article');
      expect(ir?.attributes.some((a) => a.type === 'dynamiczone')).toBe(false);
    });

    it('returns undefined for an unknown uid', () => {
      expect(builder.getContentTypeIR('api::missing.missing')).toBeUndefined();
    });
  });

  describe('memoization', () => {
    it('reads components from schema-reader only once across calls', () => {
      const readComponents = vi.fn(reader.readComponents);
      const readContentTypes = vi.fn(reader.readContentTypes);
      mock.registerService('content-schemas', 'schema-reader', {
        readComponents,
        readContentTypes,
      });
      const memoized = populateBuilder({ strapi: mock.strapi as unknown as Core.Strapi });

      memoized.buildComponentPopulateTree('faq.faq');
      memoized.buildComponentPopulateTree('shared.seo');
      memoized.buildContentTypePopulateTree('api::page.page');

      expect(readComponents).toHaveBeenCalledTimes(1);
    });

    it('reads each content type only once across calls', () => {
      const readComponents = vi.fn(reader.readComponents);
      const readContentTypes = vi.fn(reader.readContentTypes);
      mock.registerService('content-schemas', 'schema-reader', {
        readComponents,
        readContentTypes,
      });
      const memoized = populateBuilder({ strapi: mock.strapi as unknown as Core.Strapi });

      memoized.getContentTypeIR('api::page.page');
      memoized.getContentTypeIR('api::page.page');
      memoized.buildContentTypePopulateTree('api::page.page');

      expect(readContentTypes).toHaveBeenCalledTimes(1);
    });
  });
});
