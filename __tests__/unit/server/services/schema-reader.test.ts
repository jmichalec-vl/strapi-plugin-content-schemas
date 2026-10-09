import { describe, it, expect, beforeEach } from 'vitest';

import schemaReader from '../../../../server/src/services/schema-reader';
import { createMockStrapi } from '../../../helpers/mock-strapi';
import { createTestContentTypes, createTestComponents } from '../../../helpers/test-content-types';
import type { Core } from '@strapi/types';
import type { InternalFieldsConfig } from '../../../../server/src/types';

const DEFAULT_INTERNAL_FIELDS: InternalFieldsConfig = {
  timestamps: false,
};

describe('schema-reader', () => {
  let mock: ReturnType<typeof createMockStrapi>;
  let reader: ReturnType<typeof schemaReader>;

  beforeEach(() => {
    mock = createMockStrapi();
    mock.setContentTypes(createTestContentTypes());
    mock.setComponents(createTestComponents());
    reader = schemaReader({ strapi: mock.strapi as unknown as Core.Strapi });
  });

  describe('UID filtering', () => {
    it('filters only api:: content types with api::* pattern', () => {
      const result = reader.readContentTypes(['api::*'], DEFAULT_INTERNAL_FIELDS);

      const uids = result.map((ct) => ct.uid);
      expect(uids).toContain('api::article.article');
      expect(uids).toContain('api::page.page');
      expect(uids).not.toContain('admin::user');
      expect(uids).not.toContain('plugin::upload.file');
    });

    it('filters specific UIDs', () => {
      const result = reader.readContentTypes(['api::article.article'], DEFAULT_INTERNAL_FIELDS);

      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe('api::article.article');
    });

    it('supports multiple patterns', () => {
      const result = reader.readContentTypes(
        ['api::article.*', 'plugin::upload.*'],
        DEFAULT_INTERNAL_FIELDS,
      );

      const uids = result.map((ct) => ct.uid);
      expect(uids).toContain('api::article.article');
      expect(uids).toContain('plugin::upload.file');
      expect(uids).not.toContain('admin::user');
    });
  });

  describe('content type info', () => {
    it('reads singularName, pluralName, displayName', () => {
      const result = reader.readContentTypes(['api::article.article'], DEFAULT_INTERNAL_FIELDS);

      expect(result[0].singularName).toBe('article');
      expect(result[0].pluralName).toBe('articles');
      expect(result[0].displayName).toBe('Article');
    });

    it('reads kind', () => {
      const result = reader.readContentTypes(['api::*'], DEFAULT_INTERNAL_FIELDS);

      const article = result.find((ct) => ct.uid === 'api::article.article');
      const page = result.find((ct) => ct.uid === 'api::page.page');

      expect(article?.kind).toBe('collectionType');
      expect(page?.kind).toBe('singleType');
    });
  });

  describe('attribute mapping', () => {
    it('maps primitive attribute types', () => {
      const result = reader.readContentTypes(['api::article.article'], DEFAULT_INTERNAL_FIELDS);
      const attrs = result[0].attributes;

      const title = attrs.find((a) => a.name === 'title');
      expect(title).toEqual({ name: 'title', type: 'string', required: true });

      const body = attrs.find((a) => a.name === 'body');
      expect(body).toEqual({ name: 'body', type: 'richtext', required: false });

      const published = attrs.find((a) => a.name === 'published');
      expect(published).toEqual({ name: 'published', type: 'boolean', required: true });
    });

    it('captures enumValues for enumeration attributes', () => {
      const result = reader.readContentTypes(['api::article.article'], DEFAULT_INTERNAL_FIELDS);
      const status = result[0].attributes.find((a) => a.name === 'status');

      expect(status?.type).toBe('enumeration');
      expect(status?.enumValues).toEqual(['draft', 'published', 'archived']);
      expect(status?.required).toBe(true);
    });

    it('captures component metadata', () => {
      const result = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const seo = result[0].attributes.find((a) => a.name === 'seo');

      expect(seo?.type).toBe('component');
      expect(seo?.componentUID).toBe('shared.seo');
      expect(seo?.repeatable).toBe(false);
    });

    it('captures dynamiczone metadata', () => {
      const result = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const modules = result[0].attributes.find((a) => a.name === 'modules');

      expect(modules?.type).toBe('dynamiczone');
      expect(modules?.componentUIDs).toEqual(['hero-section.hero-section', 'faq.faq']);
    });

    it('captures relation metadata', () => {
      const result = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const author = result[0].attributes.find((a) => a.name === 'author');

      expect(author?.type).toBe('relation');
      expect(author?.relationKind).toBe('manyToOne');
      expect(author?.relationTarget).toBe('api::author.author');
    });

    it('captures media metadata', () => {
      const result = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);

      const image = result[0].attributes.find((a) => a.name === 'image');
      expect(image?.type).toBe('media');
      expect(image?.mediaMultiple).toBe(false);

      const gallery = result[0].attributes.find((a) => a.name === 'gallery');
      expect(gallery?.type).toBe('media');
      expect(gallery?.mediaMultiple).toBe(true);
    });
  });

  describe('attribute filtering', () => {
    it('skips password attributes', () => {
      const result = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const names = result[0].attributes.map((a) => a.name);

      expect(names).not.toContain('password');
    });

    it('always injects documentId as first field for content types', () => {
      const result = reader.readContentTypes(['api::article.article'], DEFAULT_INTERNAL_FIELDS);

      const names = result[0].attributes.map((a) => a.name);
      expect(names[0]).toBe('documentId');
    });

    it('documentId is required', () => {
      const result = reader.readContentTypes(['api::article.article'], DEFAULT_INTERNAL_FIELDS);

      const docId = result[0].attributes.find((a) => a.name === 'documentId');
      expect(docId?.required).toBe(true);
      expect(docId?.type).toBe('string');
    });

    it('excludes id from content types', () => {
      const result = reader.readContentTypes(['api::article.article'], DEFAULT_INTERNAL_FIELDS);

      const names = result[0].attributes.map((a) => a.name);
      expect(names).not.toContain('id');
    });

    it('excludes timestamp fields when includeInternalFields.timestamps is false', () => {
      const result = reader.readContentTypes(['api::article.article'], {
        timestamps: false,
      });

      const names = result[0].attributes.map((a) => a.name);
      expect(names).not.toContain('createdAt');
      expect(names).not.toContain('updatedAt');
      expect(names).not.toContain('publishedAt');
    });

    it('includes timestamp fields when includeInternalFields.timestamps is true', () => {
      const result = reader.readContentTypes(['api::article.article'], {
        timestamps: true,
      });

      const names = result[0].attributes.map((a) => a.name);
      expect(names).toContain('createdAt');
      expect(names).toContain('updatedAt');
    });
  });

  describe('private attributes', () => {
    const privateFixture = {
      'api::secretive.secretive': {
        kind: 'collectionType',
        info: { singularName: 'secretive', pluralName: 'secretives', displayName: 'Secretive' },
        options: { privateAttributes: ['internalRank'] },
        attributes: {
          title: { type: 'string', required: true },
          apiSecret: { type: 'string', private: true },
          internalRank: { type: 'integer' },
        },
      },
    };

    it('excludes attribute-level private: true fields', () => {
      mock.setContentTypes(privateFixture);
      const result = reader.readContentTypes(['api::*'], DEFAULT_INTERNAL_FIELDS);

      const names = result[0].attributes.map((a) => a.name);
      expect(names).toContain('title');
      expect(names).not.toContain('apiSecret');
    });

    it('excludes fields listed in the model options.privateAttributes', () => {
      mock.setContentTypes(privateFixture);
      const result = reader.readContentTypes(['api::*'], DEFAULT_INTERNAL_FIELDS);

      const names = result[0].attributes.map((a) => a.name);
      expect(names).not.toContain('internalRank');
    });

    it('excludes fields listed in the global api.responses.privateAttributes config', () => {
      mock.setContentTypes(privateFixture);
      mock.strapi.config.get.mockImplementation((key: string, fallback?: unknown) =>
        key === 'api.responses.privateAttributes' ? ['title'] : fallback,
      );
      const result = reader.readContentTypes(['api::*'], DEFAULT_INTERNAL_FIELDS);

      const names = result[0].attributes.map((a) => a.name);
      expect(names).not.toContain('title');
    });

    it('excludes private component attributes', () => {
      mock.setComponents({
        'shared.tracking': {
          info: { displayName: 'Tracking' },
          attributes: {
            campaign: { type: 'string' },
            vendorToken: { type: 'string', private: true },
          },
        },
      });
      const components = reader.readComponents('all', [], DEFAULT_INTERNAL_FIELDS);

      const tracking = components.find((c) => c.uid === 'shared.tracking');
      const names = tracking?.attributes.map((a) => a.name);
      expect(names).toContain('campaign');
      expect(names).not.toContain('vendorToken');
    });
  });

  describe('unknown attribute types', () => {
    it('skips attributes of a type the generator cannot describe and warns once per field', () => {
      mock.setContentTypes({
        ...createTestContentTypes(),
        'api::widget.widget': {
          uid: 'api::widget.widget',
          kind: 'collectionType',
          info: { singularName: 'widget', pluralName: 'widgets', displayName: 'Widget' },
          attributes: {
            title: { type: 'string' },
            weird: { type: 'hologram' },
          },
        },
      });
      const reader = schemaReader({ strapi: mock.strapi as unknown as Core.Strapi });

      const widget = reader
        .readContentTypes(['api::widget.widget'], DEFAULT_INTERNAL_FIELDS)
        .find((ct) => ct.uid === 'api::widget.widget');

      expect(widget?.attributes.map((a) => a.name)).toEqual(['documentId', 'title']);
      expect(mock.strapi.log.warn).toHaveBeenCalledWith(
        expect.stringContaining('"api::widget.widget.weird": attribute type "hologram"'),
      );
    });
  });

  describe('ordering', () => {
    it('returns content types sorted by uid regardless of registry order', () => {
      const result = reader.readContentTypes(['api::*'], DEFAULT_INTERNAL_FIELDS);

      const uids = result.map((ct) => ct.uid);
      expect(uids).toEqual([...uids].sort((a, b) => a.localeCompare(b)));
      expect(uids.length).toBeGreaterThan(1);
    });

    it('returns components sorted by uid regardless of registry order', () => {
      const components = reader.readComponents('all', [], DEFAULT_INTERNAL_FIELDS);

      const uids = components.map((c) => c.uid);
      expect(uids).toEqual([...uids].sort((a, b) => a.localeCompare(b)));
      expect(uids.length).toBeGreaterThan(1);
    });
  });

  describe('readComponents', () => {
    it('reads referenced components when filter is "referenced"', () => {
      const contentTypes = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const components = reader.readComponents('referenced', contentTypes, DEFAULT_INTERNAL_FIELDS);

      const uids = components.map((c) => c.uid);
      expect(uids).toContain('shared.seo');
      expect(uids).toContain('hero-section.hero-section');
      expect(uids).toContain('faq.faq');
    });

    it('includes transitively referenced components', () => {
      const contentTypes = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const components = reader.readComponents('referenced', contentTypes, DEFAULT_INTERNAL_FIELDS);

      const uids = components.map((c) => c.uid);
      expect(uids).toContain('hero-section.hero-section-buttons');
      expect(uids).toContain('faq.faq-item');
    });

    it('reads all components when filter is "all"', () => {
      const contentTypes = reader.readContentTypes(
        ['api::article.article'],
        DEFAULT_INTERNAL_FIELDS,
      );
      const components = reader.readComponents('all', contentTypes, DEFAULT_INTERNAL_FIELDS);

      expect(components.length).toBe(Object.keys(createTestComponents()).length);
    });

    it('filters by specific UIDs when filter is an array', () => {
      const contentTypes = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const components = reader.readComponents(
        ['shared.seo'],
        contentTypes,
        DEFAULT_INTERNAL_FIELDS,
      );

      expect(components).toHaveLength(1);
      expect(components[0].uid).toBe('shared.seo');
    });

    it('maps component attributes correctly', () => {
      const contentTypes = reader.readContentTypes(['api::page.page'], DEFAULT_INTERNAL_FIELDS);
      const components = reader.readComponents('referenced', contentTypes, DEFAULT_INTERNAL_FIELDS);

      const seo = components.find((c) => c.uid === 'shared.seo');
      expect(seo?.category).toBe('shared');
      expect(seo?.displayName).toBe('SEO');

      const metaTitle = seo?.attributes.find((a) => a.name === 'metaTitle');
      expect(metaTitle?.type).toBe('string');
      expect(metaTitle?.required).toBe(true);

      const metaImage = seo?.attributes.find((a) => a.name === 'metaImage');
      expect(metaImage?.type).toBe('media');
      expect(metaImage?.mediaMultiple).toBe(false);
    });
  });
});
