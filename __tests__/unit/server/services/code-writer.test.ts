import { describe, it, expect, beforeEach } from 'vitest';

import codeWriter from '../../../../server/src/services/code-writer';
import type {
  BffViewManifest,
  ComponentIR,
  ContentTypeIR,
  GenerationOptions,
} from '../../../../server/src/types';

const DEFAULT_OPTIONS: GenerationOptions = {
  target: 'valibot',
  nullableStyle: 'nullish',
  generatePopulate: true,
  generateClient: true,
  jsdoc: false,
  mocks: false,
  typeOverrides: {},
  fieldOverrides: {},
  viewTransformSchemas: {},
  viewResponseSchemas: {},
  nameOverrides: {},
};

const ARTICLE_CT: ContentTypeIR = {
  uid: 'api::article.article',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  kind: 'collectionType',
  attributes: [
    { name: 'id', type: 'integer', required: false },
    { name: 'title', type: 'string', required: true },
    { name: 'body', type: 'richtext', required: false },
    { name: 'coverImage', type: 'media', required: false, mediaMultiple: false },
    {
      name: 'seo',
      type: 'component',
      required: false,
      componentUID: 'shared.seo',
      repeatable: false,
    },
  ],
};

const SEO_COMPONENT: ComponentIR = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: [
    { name: 'metaTitle', type: 'string', required: true },
    { name: 'metaDescription', type: 'text', required: false },
    { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
  ],
};

const ASSEMBLE_VIEW_MANIFEST: BffViewManifest = {
  manifestVersion: 1,
  views: [
    {
      id: 'article-view',
      path: '/article-view/:slug',
      keyParam: 'slug',
      contentType: 'api::article.article',
      lookup: { field: 'title' },
      fields: ['documentId', 'title'],
      componentFields: {},
      dynamicZones: {},
      relations: {},
      componentOverrides: {},
      transforms: [],
      hasEnrich: false,
      hasAssemble: true,
    },
  ],
};

describe('code-writer', () => {
  let writer: ReturnType<typeof codeWriter>;

  beforeEach(() => {
    writer = codeWriter();
  });

  describe('populate imports for dynamic zones inside components', () => {
    it('imports member populate exports referenced from the on: block', () => {
      const hero: ComponentIR = {
        uid: 'blocks.hero',
        category: 'blocks',
        displayName: 'Hero',
        attributes: [{ name: 'image', type: 'media', required: false, mediaMultiple: false }],
      };
      const layout: ComponentIR = {
        uid: 'layout.section',
        category: 'layout',
        displayName: 'Section',
        attributes: [
          { name: 'blocks', type: 'dynamiczone', required: false, componentUIDs: ['blocks.hero'] },
        ],
      };
      const page: ContentTypeIR = {
        ...ARTICLE_CT,
        attributes: [
          { name: 'section', type: 'component', required: false, componentUID: 'layout.section' },
        ],
      };

      const files = writer.buildSchemaFiles([page], [hero, layout], DEFAULT_OPTIONS);
      const section = files.get('components/layout/section.ts') ?? '';

      expect(section).toMatch(
        /import \{[^}]*\bblocksHeroPopulate\b[^}]*\} from '\.\.\/blocks\/hero';/,
      );
      expect(section).toMatch(
        /import \{[^}]*type BlocksHeroPopulateInput\b[^}]*\} from '\.\.\/blocks\/hero';/,
      );
      expect(section).toContain("'blocks.hero': blocksHeroPopulate,");
    });
  });

  describe('view client entries', () => {
    const declared = (name: string, typeName: string): GenerationOptions => ({
      ...DEFAULT_OPTIONS,
      viewResponseSchemas: {
        'article-view': { schema: 'object({})', name, typeName },
      },
    });

    it('imports the declared success schema when the declaration was emitted', () => {
      const files = writer.buildSchemaFiles(
        [ARTICLE_CT],
        [],
        declared('ArticleViewAssembledSchema', 'ArticleViewAssembled'),
        ASSEMBLE_VIEW_MANIFEST,
      );
      const client = files.get('client/strapi-client.ts') ?? '';

      expect(files.get('views/article-view.ts')).toContain(
        'export const ArticleViewAssembledSuccessSchema',
      );
      expect(client).toContain(
        "import { ArticleViewAssembledSuccessSchema, type ArticleViewAssembledSuccess } from '../views/article-view';",
      );
    });

    it('does not import a declaration the view generator skipped for a name collision', () => {
      const files = writer.buildSchemaFiles(
        [ARTICLE_CT],
        [],
        declared('ArticleViewMergedSchema', 'ArticleViewMerged'),
        ASSEMBLE_VIEW_MANIFEST,
      );
      const client = files.get('client/strapi-client.ts') ?? '';

      expect(files.get('views/article-view.ts')).not.toContain('SuccessSchema');
      expect(client).not.toContain("from '../views/article-view'");
      expect(client).toContain(
        'readonly articleView: (slug: string, options?: ViewRequestOptions) => Promise<unknown | null>;',
      );
    });
  });

  describe('buildSchemaFiles', () => {
    it('emits an empty populate export for scalar-only content types', () => {
      const scalarOnly: ContentTypeIR = {
        uid: 'api::announcement.announcement',
        singularName: 'announcement',
        pluralName: 'announcements',
        displayName: 'Announcement',
        kind: 'singleType',
        attributes: [
          { name: 'title', type: 'string', required: true },
          { name: 'text', type: 'text', required: false },
        ],
      };

      const files = writer.buildSchemaFiles([scalarOnly], [], DEFAULT_OPTIONS);

      const content = files.get('content-types/announcement.ts');
      expect(content).toContain('export const announcementPopulate = {};');
      // the generated client imports this populate for every content type
      const client = files.get('client/strapi-client.ts');
      expect(client).toContain('announcementPopulate');
    });

    it('resolves cross-category same-name components via category prefixes', () => {
      const sharedCta: ComponentIR = {
        uid: 'shared.cta',
        category: 'shared',
        displayName: 'CTA',
        attributes: [{ name: 'label', type: 'string', required: true }],
      };
      const blocksCta: ComponentIR = {
        uid: 'blocks.cta',
        category: 'blocks',
        displayName: 'CTA',
        attributes: [{ name: 'text', type: 'string', required: true }],
      };

      const files = writer.buildSchemaFiles([ARTICLE_CT], [sharedCta, blocksCta], DEFAULT_OPTIONS);

      expect(files.get('components/shared/cta.ts')).toContain(
        'export const SharedCtaSchema = object({',
      );
      expect(files.get('components/blocks/cta.ts')).toContain(
        'export const BlocksCtaSchema = object({',
      );
    });

    it('throws a descriptive error when a content type collides with a prefixed component', () => {
      const consultationComponent: ComponentIR = {
        uid: 'catalog.consultation',
        category: 'catalog',
        displayName: 'Consultation',
        attributes: [{ name: 'label', type: 'string', required: true }],
      };
      const consultationCt: ContentTypeIR = {
        uid: 'api::catalog-consultation.catalog-consultation',
        singularName: 'catalog-consultation',
        pluralName: 'catalog-consultations',
        displayName: 'Catalog Consultation',
        kind: 'collectionType',
        attributes: [{ name: 'title', type: 'string', required: true }],
      };

      expect(() =>
        writer.buildSchemaFiles([consultationCt], [consultationComponent], DEFAULT_OPTIONS),
      ).toThrow(/Name collision.*CatalogConsultationSchema.*catalog\.consultation/s);
    });

    it('resolves a content-type collision via a nameOverrides entry', () => {
      const consultationComponent: ComponentIR = {
        uid: 'catalog.consultation',
        category: 'catalog',
        displayName: 'Consultation',
        attributes: [
          { name: 'label', type: 'string', required: true },
          { name: 'icon', type: 'media', required: false, mediaMultiple: false },
        ],
      };
      const consultationCt: ContentTypeIR = {
        uid: 'api::catalog-consultation.catalog-consultation',
        singularName: 'catalog-consultation',
        pluralName: 'catalog-consultations',
        displayName: 'Catalog Consultation',
        kind: 'collectionType',
        attributes: [
          { name: 'title', type: 'string', required: true },
          {
            name: 'details',
            type: 'component',
            required: false,
            componentUID: 'catalog.consultation',
          },
        ],
      };

      const files = writer.buildSchemaFiles([consultationCt], [consultationComponent], {
        ...DEFAULT_OPTIONS,
        nameOverrides: { 'catalog.consultation': 'CatalogConsultationComponent' },
      });

      const componentFile = files.get('components/catalog/consultation.ts') ?? '';
      expect(componentFile).toContain('export const CatalogConsultationComponentSchema = object({');
      expect(componentFile).toContain('export interface CatalogConsultationComponent {');
      expect(componentFile).toContain('export const catalogConsultationComponentPopulate = {');

      const ctFile = files.get('content-types/catalog-consultation.ts') ?? '';
      expect(ctFile).toContain('export const CatalogConsultationSchema = object({');
      expect(ctFile).toContain("from '../components/catalog/consultation'");
      expect(ctFile).toContain('CatalogConsultationComponentSchema');
    });

    it('throws on duplicate content type singular names', () => {
      const other: ContentTypeIR = {
        ...ARTICLE_CT,
        uid: 'plugin::store.article',
      };

      expect(() => writer.buildSchemaFiles([ARTICLE_CT, other], [], DEFAULT_OPTIONS)).toThrow(
        /Name collision.*ArticleSchema/s,
      );
    });

    it('emits category-aware type imports for cross-category nested components', () => {
      const tag: ComponentIR = {
        uid: 'shared.tag',
        category: 'shared',
        displayName: 'Tag',
        attributes: [{ name: 'name', type: 'string', required: true }],
      };
      const promoTile: ComponentIR = {
        uid: 'modules.promo-tile',
        category: 'modules',
        displayName: 'Promo Tile',
        attributes: [
          { name: 'title', type: 'string', required: true },
          { name: 'badge', type: 'component', required: false, componentUID: 'shared.tag' },
        ],
      };
      const ct: ContentTypeIR = {
        ...ARTICLE_CT,
        attributes: [
          { name: 'title', type: 'string', required: true },
          {
            name: 'tile',
            type: 'component',
            required: false,
            componentUID: 'modules.promo-tile',
            repeatable: false,
          },
        ],
      };

      const files = writer.buildSchemaFiles([ct], [tag, promoTile], DEFAULT_OPTIONS);
      const content = files.get('components/modules/promo-tile.ts');

      // value + type import merged onto the category-aware path
      expect(content).toContain("import { SharedTagSchema, type SharedTag } from '../shared/tag';");
      expect(content).not.toContain("from './tag'");
    });

    it('detects dual-use components and falls back to a plain union', () => {
      const tag: ComponentIR = {
        uid: 'shared.tag',
        category: 'shared',
        displayName: 'Tag',
        attributes: [{ name: 'name', type: 'string', required: true }],
      };
      const hero: ComponentIR = {
        uid: 'modules.hero',
        category: 'modules',
        displayName: 'Hero',
        attributes: [{ name: 'heading', type: 'string', required: true }],
      };
      const ct: ContentTypeIR = {
        ...ARTICLE_CT,
        attributes: [
          { name: 'title', type: 'string', required: true },
          // tag is BOTH a DZ member and a plain nested component
          {
            name: 'blocks',
            type: 'dynamiczone',
            required: false,
            componentUIDs: ['modules.hero', 'shared.tag'],
          },
          {
            name: 'label',
            type: 'component',
            required: false,
            componentUID: 'shared.tag',
            repeatable: false,
          },
        ],
      };

      const files = writer.buildSchemaFiles([ct], [tag, hero], DEFAULT_OPTIONS);
      const content = files.get('content-types/article.ts');

      expect(content).toContain('array(union([ModulesHeroSchema, SharedTagSchema]))');
      expect(content).not.toContain("variant('__component'");
    });

    it('imports optional/union/null_ for the optional-union-null style', () => {
      const ct: ContentTypeIR = {
        ...ARTICLE_CT,
        attributes: [
          { name: 'title', type: 'string', required: true },
          { name: 'subtitle', type: 'string', required: false },
        ],
      };
      const files = writer.buildSchemaFiles([ct], [], {
        ...DEFAULT_OPTIONS,
        nullableStyle: 'optional-union-null',
      });
      const content = files.get('content-types/article.ts')!;

      expect(content).toContain('optional(union([string(), null_()]))');
      const importLine = content.split('\n').find((l) => l.includes("from 'valibot'"))!;
      for (const fn of ['optional', 'union', 'null_']) {
        expect(importLine).toContain(fn);
      }
    });

    it('emits enum const objects, references them in interfaces, and re-exports them', () => {
      const ct: ContentTypeIR = {
        ...ARTICLE_CT,
        attributes: [
          { name: 'title', type: 'string', required: true },
          {
            name: 'status',
            type: 'enumeration',
            required: true,
            enumValues: ['draft', 'in_review', 'published'],
          },
        ],
      };
      const comp: ComponentIR = {
        ...SEO_COMPONENT,
        attributes: [
          {
            name: 'socialNetwork',
            type: 'enumeration',
            required: true,
            enumValues: ['Facebook', 'Twitter'],
            enumName: 'SOCIAL_NETWORK',
          },
        ],
      };
      const withSeo: ContentTypeIR = {
        ...ct,
        attributes: [
          ...ct.attributes,
          { name: 'seo', type: 'component', required: false, componentUID: 'shared.seo' },
        ],
      };

      const files = writer.buildSchemaFiles([withSeo], [comp], DEFAULT_OPTIONS);
      const article = files.get('content-types/article.ts')!;
      const seo = files.get('components/shared/seo.ts')!;

      expect(article).toContain('export const ArticleStatus = {');
      expect(article).toContain("  InReview: 'in_review',");
      expect(article).toContain(
        'export type ArticleStatus = (typeof ArticleStatus)[keyof typeof ArticleStatus];',
      );
      // interface references the named type; schema keeps raw literal validation
      expect(article).toContain('readonly status: ArticleStatus;');
      expect(article).toContain("status: picklist(['draft', 'in_review', 'published'])");
      // enumName hint wins for the component artifact
      expect(seo).toContain('export const SocialNetwork = {');
      expect(seo).toContain('readonly socialNetwork: SocialNetwork;');
      // barrel re-exports content-type enums (value + merged type)
      expect(files.get('index.ts')).toContain('ArticleStatus');
    });

    it('generates shared/upload-file.ts', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const content = files.get('shared/upload-file.ts');
      expect(content).toBeDefined();
      expect(content).toContain('export const UploadFileSchema = object({');
      expect(content).toContain('url: string()');
      expect(content).toContain("from 'valibot'");
    });

    it('generates component files in components/{category}/', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const content = files.get('components/shared/seo.ts');
      expect(content).toBeDefined();
      expect(content).toContain('export const SharedSeoSchema = object({');
      expect(content).not.toContain('__component');
      expect(content).toContain('id: number()');
      expect(content).toContain('metaTitle: string()');
    });

    it('generates content type files with external imports', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const content = files.get('content-types/article.ts');
      expect(content).toBeDefined();
      expect(content).toContain('export const ArticleSchema = object({');
      expect(content).toContain('UploadFileSchema');
      expect(content).toContain('SharedSeoSchema');
      expect(content).toContain("from '../shared/upload-file'");
      expect(content).toContain("from '../components/shared/seo'");
    });

    it('generates barrel index.ts', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const content = files.get('index.ts');
      expect(content).toBeDefined();
      expect(content).toContain(
        "export { ArticleSchema, type Article, type ArticlePopulateInput } from './content-types/article';",
      );
    });

    it('does not re-export components from barrel', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const content = files.get('index.ts');
      expect(content).not.toContain('SeoSchema');
    });

    it('includes file header in all generated files', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      for (const [, content] of files) {
        expect(content).toContain('Auto-generated');
      }
    });

    it('returns map of all generated files', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      expect(files.has('shared/upload-file.ts')).toBe(true);
      expect(files.has('components/shared/seo.ts')).toBe(true);
      expect(files.has('content-types/article.ts')).toBe(true);
      expect(files.has('index.ts')).toBe(true);
    });

    it('handles content types with no complex fields', () => {
      const simpleCt: ContentTypeIR = {
        uid: 'api::tag.tag',
        singularName: 'tag',
        pluralName: 'tags',
        displayName: 'Tag',
        kind: 'collectionType',
        attributes: [{ name: 'name', type: 'string', required: true }],
      };

      const files = writer.buildSchemaFiles([simpleCt], [], DEFAULT_OPTIONS);

      const content = files.get('content-types/tag.ts');
      expect(content).toBeDefined();
      expect(content).toContain('export const TagSchema = object({');
      expect(content).not.toContain('UploadFileSchema');
    });

    it('handles dynamiczone with component imports', () => {
      const pageWithDz: ContentTypeIR = {
        uid: 'api::page.page',
        singularName: 'page',
        pluralName: 'pages',
        displayName: 'Page',
        kind: 'singleType',
        attributes: [
          {
            name: 'modules',
            type: 'dynamiczone',
            required: true,
            componentUIDs: ['shared.seo'],
          },
        ],
      };

      const files = writer.buildSchemaFiles([pageWithDz], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const content = files.get('content-types/page.ts');
      expect(content).toBeDefined();
      expect(content).toContain("array(variant('__component', [SharedSeoSchema]))");
      expect(content).toContain('SharedSeoSchema');
    });

    it('generates shared/overrides.ts when type overrides are used', () => {
      const ctWithRichtext: ContentTypeIR = {
        uid: 'api::article.article',
        singularName: 'article',
        pluralName: 'articles',
        displayName: 'Article',
        kind: 'collectionType',
        attributes: [{ name: 'body', type: 'richtext', required: false }],
      };

      const options: GenerationOptions = {
        ...DEFAULT_OPTIONS,
        typeOverrides: {
          richtext: {
            schema: `object({
  html: string(),
  meta: optional(record(string(), any())),
})`,
            name: 'RenderedHtmlSchema',
            typeName: 'RenderedHtml',
          },
        },
      };

      const files = writer.buildSchemaFiles([ctWithRichtext], [], options);

      const overridesContent = files.get('shared/overrides.ts');
      expect(overridesContent).toBeDefined();
      expect(overridesContent).toContain('export const RenderedHtmlSchema');
      expect(overridesContent).toContain('html: string()');
      expect(overridesContent).toContain(
        'export type RenderedHtml = InferInput<typeof RenderedHtmlSchema>',
      );
      expect(overridesContent).toContain("from 'valibot'");

      const articleContent = files.get('content-types/article.ts');
      expect(articleContent).toContain('RenderedHtmlSchema');
      expect(articleContent).toContain("from '../shared/overrides'");
    });

    it('does not generate overrides.ts when no overrides are used', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [], DEFAULT_OPTIONS);

      expect(files.has('shared/overrides.ts')).toBe(false);
    });

    it('generates overrides.ts with field overrides', () => {
      const ctWithBody: ContentTypeIR = {
        uid: 'api::article.article',
        singularName: 'article',
        pluralName: 'articles',
        displayName: 'Article',
        kind: 'collectionType',
        attributes: [
          { name: 'body', type: 'richtext', required: true },
          { name: 'excerpt', type: 'richtext', required: false },
        ],
      };

      const options: GenerationOptions = {
        ...DEFAULT_OPTIONS,
        fieldOverrides: {
          'api::article.article.body': {
            schema: 'string()',
            name: 'CustomBodySchema',
            typeName: 'CustomBody',
          },
        },
      };

      const files = writer.buildSchemaFiles([ctWithBody], [], options);

      const overridesContent = files.get('shared/overrides.ts');
      expect(overridesContent).toBeDefined();
      expect(overridesContent).toContain('export const CustomBodySchema');

      const articleContent = files.get('content-types/article.ts');
      expect(articleContent).toContain('body: CustomBodySchema');
      expect(articleContent).toContain('excerpt: nullish(string())');
    });

    it('includes populate in content type file when generatePopulate is true', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const articleContent = files.get('content-types/article.ts');
      expect(articleContent).toContain('export const articlePopulate');
      expect(articleContent).toContain('coverImage: true');
      expect(articleContent).toContain('seo:');
    });

    it('excludes populate from content type file when generatePopulate is false', () => {
      const options = { ...DEFAULT_OPTIONS, generatePopulate: false };
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], options);

      const articleContent = files.get('content-types/article.ts');
      expect(articleContent).not.toContain('articlePopulate');
    });

    it('includes populate exports in barrel from content-types', () => {
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], DEFAULT_OPTIONS);

      const barrelContent = files.get('index.ts');
      expect(barrelContent).toContain("export { articlePopulate } from './content-types/article'");
    });

    it('does not include populate in barrel when generatePopulate is false', () => {
      const options = { ...DEFAULT_OPTIONS, generatePopulate: false };
      const files = writer.buildSchemaFiles([ARTICLE_CT], [SEO_COMPONENT], options);

      const barrelContent = files.get('index.ts');
      expect(barrelContent).not.toContain('Populate');
    });
  });
});
