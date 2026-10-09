import { describe, it, expect } from 'vitest';

import { generateViewFiles } from '../../../../server/src/generators/view-schema-generator';
import { buildSchemaRegistry } from '../../../../server/src/generators/schema-registry';
import type {
  BffViewManifest,
  BffViewManifestEntry,
  ComponentIR,
  ContentTypeIR,
  GenerationOptions,
} from '../../../../server/src/types';

const contentTypes: readonly ContentTypeIR[] = [
  {
    uid: 'api::page.page',
    singularName: 'page',
    pluralName: 'pages',
    displayName: 'Page',
    kind: 'collectionType',
    attributes: [
      { name: 'documentId', type: 'string', required: true },
      { name: 'title', type: 'string', required: true },
      { name: 'slug', type: 'uid', required: true },
      { name: 'summary', type: 'text', required: false },
      { name: 'body', type: 'richtext', required: false },
      { name: 'seo', type: 'component', required: false, componentUID: 'shared.seo' },
      {
        name: 'modules',
        type: 'dynamiczone',
        required: true,
        componentUIDs: ['content.hero', 'content.faq'],
      },
      {
        name: 'author',
        type: 'relation',
        required: false,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      },
      {
        name: 'related',
        type: 'relation',
        required: false,
        relationKind: 'oneToMany',
        relationTarget: 'api::page.page',
      },
    ],
  },
  {
    uid: 'api::author.author',
    singularName: 'author',
    pluralName: 'authors',
    displayName: 'Author',
    kind: 'collectionType',
    attributes: [
      { name: 'documentId', type: 'string', required: true },
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'email', required: false },
      { name: 'avatar', type: 'media', required: false, mediaMultiple: false },
      { name: 'level', type: 'enumeration', required: true, enumValues: ['junior', 'senior'] },
    ],
  },
];

const components: readonly ComponentIR[] = [
  {
    uid: 'shared.seo',
    category: 'shared',
    displayName: 'SEO',
    attributes: [
      { name: 'metaTitle', type: 'string', required: true },
      { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
    ],
  },
  {
    uid: 'content.hero',
    category: 'content',
    displayName: 'Hero',
    attributes: [
      { name: 'heading', type: 'richtext', required: true },
      { name: 'image', type: 'media', required: false, mediaMultiple: false },
    ],
  },
  {
    uid: 'content.faq',
    category: 'content',
    displayName: 'FAQ',
    attributes: [
      { name: 'title', type: 'string', required: false },
      { name: 'items', type: 'component', required: false, componentUID: 'content.faq-item' },
    ],
  },
  {
    uid: 'content.faq-item',
    category: 'content',
    displayName: 'FAQ Item',
    attributes: [
      { name: 'question', type: 'string', required: true },
      { name: 'answer', type: 'richtext', required: true },
    ],
  },
];

const registry = buildSchemaRegistry(contentTypes, components);

const baseOptions: GenerationOptions = {
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

const baseView: BffViewManifestEntry = {
  id: 'content-page',
  path: '/content-page/:slug',
  keyParam: 'slug',
  contentType: 'api::page.page',
  lookup: { field: 'slug' },
  fields: ['documentId', 'title', 'slug', 'summary'],
  componentFields: { seo: 'shared.seo' },
  dynamicZones: { modules: ['content.hero', 'content.faq'] },
  relations: { author: { fields: ['name'], populate: { avatar: true } } },
  componentOverrides: {},
  transforms: [],
  hasEnrich: false,
  hasAssemble: false,
};

const manifestWith = (...views: readonly BffViewManifestEntry[]): BffViewManifest => ({
  manifestVersion: 1,
  views,
});

const generate = (
  view: BffViewManifestEntry,
  options: GenerationOptions = baseOptions,
): { readonly content: string; readonly output: ReturnType<typeof generateViewFiles> } => {
  const output = generateViewFiles(manifestWith(view), contentTypes, components, registry, options);
  return { content: output.files.get(`views/${view.id}.ts`) ?? '', output };
};

describe('view-schema-generator (valibot)', () => {
  it('skips views whose id is not safe as a file name or identifier', () => {
    const { output } = generate({ ...baseView, id: '../escape' });

    expect(output.files.size).toBe(0);
    expect(output.warnings.join('\n')).toContain("view '../escape': id must contain only");
  });

  it('emits data + response schemas, envelope, barrel, and manifest.json', () => {
    const { output } = generate(baseView);

    expect([...output.files.keys()].sort()).toEqual([
      'views/content-page.ts',
      'views/envelope.ts',
      'views/index.ts',
      'views/manifest.json',
    ]);
    expect(output.files.get('views/index.ts')).toContain("export * from './content-page';");
    expect(output.files.get('views/index.ts')).toContain("export * from './envelope';");
    expect(JSON.parse(output.files.get('views/manifest.json') ?? '')).toMatchObject({
      manifestVersion: 1,
    });
    expect(output.files.get('views/envelope.ts')).toContain('BffErrorEnvelopeSchema');
  });

  it('emits the served scalar subset with base nullability semantics', () => {
    const { content } = generate(baseView);

    expect(content).toContain('export const ContentPageDataSchema = object({');
    // runtime always returns the row id even though planners never select it
    expect(content).toContain('export const ContentPageDataSchema = object({\n  id: number(),');
    expect(content).toContain('  documentId: string(),');
    expect(content).toContain('  title: string(),');
    expect(content).toContain('  summary: nullish(string()),');
    // body is not served by the view and must not appear
    expect(content).not.toContain('body:');
  });

  it('references shared component schemas for component fields', () => {
    const { content } = generate(baseView);

    expect(content).toContain('  seo: nullish(SharedSeoSchema),');
    expect(content).toContain("import { SharedSeoSchema } from '../components/shared/seo';");
  });

  it('restricts dynamic zones to the zone members served by the view', () => {
    const narrowed = { ...baseView, dynamicZones: { modules: ['content.faq'] } };
    const { content } = generate(narrowed);

    expect(content).toContain("  modules: array(variant('__component', [ContentFaqSchema])),");
    expect(content).not.toContain('HeroSchema');
  });

  it('emits inline narrowed relation shapes including populated media', () => {
    const { content } = generate(baseView);

    expect(content).toContain('  author: nullish(object({');
    expect(content).toContain('    documentId: string(),');
    expect(content).toContain('    name: string(),');
    expect(content).toContain('    avatar: nullish(UploadFileSchema),');
    expect(content).toContain("import { UploadFileSchema } from '../shared/upload-file';");
  });

  it('maps `true` overlays to all target scalars and wraps to-many in arrays', () => {
    const view = { ...baseView, relations: { author: true as const, related: true as const } };
    const { content } = generate(view);

    expect(content).toContain("    level: picklist(['junior', 'senior']),");
    expect(content).toContain('  related: nullish(array(object({');
    // `true` never populates nested populatables
    expect(content).not.toContain('avatar');
  });

  it('wraps the response with a view-literal meta and open meta object', () => {
    const { content } = generate(baseView);

    expect(content).toContain('export const ContentPageResponseSchema = object({');
    expect(content).toContain("  meta: looseObject({ view: literal('content-page') }),");
    expect(content).toContain('export type ContentPageResponse = InferOutput<');
  });

  describe('transforms', () => {
    const richtextTransform = { name: 'compile-richtext', match: { fieldType: 'richtext' } };

    it('relies on base typeOverrides when a fieldType transform is covered', () => {
      const view = {
        ...baseView,
        fields: [...(baseView.fields ?? []), 'body'],
        transforms: [richtextTransform],
      };
      const options = {
        ...baseOptions,
        typeOverrides: {
          richtext: { schema: 'object({})', name: 'RenderedHtmlSchema', typeName: 'RenderedHtml' },
        },
      };
      const { content, output } = generate(view, options);

      expect(content).toContain('  body: nullish(RenderedHtmlSchema),');
      // Covered by base schemas - the DZ (whose components contain richtext) stays exact
      expect(content).toContain("variant('__component', [ContentHeroSchema, ContentFaqSchema])");
      expect(output.warnings).toEqual([]);
    });

    it('uses viewTransformSchemas for fieldName-matched transforms', () => {
      const view = {
        ...baseView,
        transforms: [{ name: 'shout-title', match: { fieldName: '^title$' } }],
      };
      const options = {
        ...baseOptions,
        viewTransformSchemas: {
          'shout-title': { schema: 'string()', name: 'ShoutSchema', typeName: 'Shout' },
        },
      };
      const { content, output } = generate(view, options);

      expect(content).toContain('  title: ShoutSchema,');
      expect(content).toContain("import { ShoutSchema } from '../shared/overrides';");
      expect(output.usedOverrides.map((o) => o.name)).toEqual(['ShoutSchema']);
    });

    it('degrades uncovered transformed fields to unknown with a warning', () => {
      const view = {
        ...baseView,
        transforms: [{ name: 'mystery', match: { fieldName: '^summary$' } }],
      };
      const { content, output } = generate(view);

      expect(content).toContain('  summary: nullish(unknown()),');
      expect(output.warnings.join('\n')).toContain("transformed by 'mystery'");
      expect(content).toContain('GENERATOR WARNINGS');
    });

    it('degrades DZs whose components are reached by uncovered transforms', () => {
      const view = {
        ...baseView,
        transforms: [{ name: 'shout-question', match: { fieldName: '^question$' } }],
      };
      const { content, output } = generate(view);

      // content.faq-item.question is inside content.faq → the zone cannot be exact
      expect(content).toContain('  modules: array(unknown()),');
      expect(output.warnings.join('\n')).toContain('transform-affected components');
    });

    it('degrades component fields reached by uncovered transforms', () => {
      const view = {
        ...baseView,
        transforms: [{ name: 'meta', match: { fieldName: '^metaTitle$' } }],
      };
      const { content } = generate(view);

      expect(content).toContain('  seo: nullish(unknown()),');
    });
  });

  it('emits media fields as UploadFileSchema, arrays when multiple', () => {
    const view = {
      ...baseView,
      mediaFields: { cover: { multiple: false }, gallery: { multiple: true } },
    };
    const withMedia: ContentTypeIR = {
      ...contentTypes[0]!,
      attributes: [
        ...contentTypes[0]!.attributes,
        { name: 'cover', type: 'media', required: false, mediaMultiple: false },
        { name: 'gallery', type: 'media', required: false, mediaMultiple: true },
      ],
    };
    const output = generateViewFiles(
      manifestWith(view),
      [withMedia, contentTypes[1]!],
      components,
      registry,
      baseOptions,
    );
    const content = output.files.get('views/content-page.ts') ?? '';

    expect(content).toContain('  cover: nullish(UploadFileSchema),');
    expect(content).toContain('  gallery: nullish(array(UploadFileSchema)),');
    expect(content).toContain("import { UploadFileSchema } from '../shared/upload-file';");
  });

  describe('planner.components override narrowing', () => {
    it('emits a view-local slice for a fields-narrowed component field', () => {
      const view = {
        ...baseView,
        componentOverrides: { 'shared.seo': { fields: ['metaTitle'] } },
      };
      const { content, output } = generate(view);

      expect(content).toContain('export const ContentPageSharedSeoSliceSchema = object({');
      expect(content).toContain('  metaTitle: string(),');
      // slice for a plain component field carries no __component discriminator
      expect(content).not.toContain("__component: literal('shared.seo')");
      // metaImage is not populated by the override → absent from the slice
      expect(content).not.toContain('metaImage');
      expect(content).toContain('  seo: nullish(ContentPageSharedSeoSliceSchema),');
      expect(content).toContain(
        'export type ContentPageSharedSeoSlice = InferOutput<typeof ContentPageSharedSeoSliceSchema>;',
      );
      expect(output.warnings).toEqual([]);
    });

    it('keeps DZs discriminated with slice members carrying __component literals', () => {
      const view = {
        ...baseView,
        componentOverrides: { 'content.hero': { fields: ['heading'] } },
      };
      const { content, output } = generate(view);

      expect(content).toContain('export const ContentPageContentHeroSliceSchema = object({');
      expect(content).toContain("  __component: literal('content.hero'),");
      expect(content).toContain(
        "  modules: array(variant('__component', [ContentPageContentHeroSliceSchema, ContentFaqSchema])),",
      );
      expect(output.warnings).toEqual([]);
    });

    it('interprets nested populate: relation slices with fields and media', () => {
      const view = {
        ...baseView,
        componentFields: { seo: 'shared.seo' },
        componentOverrides: {
          'shared.seo': {
            fields: ['metaTitle'],
            populate: { metaImage: true },
          },
        },
      };
      const { content } = generate(view);

      expect(content).toContain('  metaImage: nullish(UploadFileSchema),');
      expect(content).toContain("import { UploadFileSchema } from '../shared/upload-file';");
    });

    it('populate: true on a nested component yields a scalars-only slice', () => {
      const view = {
        ...baseView,
        dynamicZones: { modules: ['content.faq'] },
        componentOverrides: {
          'content.faq': { populate: { items: true } },
        },
      };
      const { content } = generate(view);

      // faq slice includes its scalar + the populated nested component
      expect(content).toContain('export const ContentPageContentFaqSliceSchema = object({');
      expect(content).toContain('  title: nullish(string()),');
      // nested faq-item slice: scalars only, inline, no shared schema reference
      expect(content).toContain('question: string(),');
      expect(content).not.toContain('ContentFaqItemSchema');
    });

    it('resolves view transforms inside slices via typeOverrides', () => {
      const view = {
        ...baseView,
        dynamicZones: { modules: ['content.hero'] },
        transforms: [{ name: 'compile-richtext', match: { fieldType: 'richtext' } }],
        componentOverrides: { 'content.hero': { fields: ['heading'] } },
      };
      const options = {
        ...baseOptions,
        typeOverrides: {
          richtext: { schema: 'object({})', name: 'RenderedHtmlSchema', typeName: 'RenderedHtml' },
        },
      };
      const { content, output } = generate(view, options);

      expect(content).toContain('  heading: RenderedHtmlSchema,');
      expect(output.warnings).toEqual([]);
    });

    it('degrades uninterpretable overrides to unknown with a warning', () => {
      const view = {
        ...baseView,
        componentOverrides: { 'shared.seo': { weirdKey: 1 } },
      };
      const { content, output } = generate(view);

      expect(content).toContain('  seo: nullish(unknown()),');
      expect(output.warnings.join('\n')).toContain('cannot interpret');
    });

    it('degrades whole DZs when a member override is uninterpretable', () => {
      const view = {
        ...baseView,
        componentOverrides: { 'content.hero': { weirdKey: 1 } },
      };
      const { content, output } = generate(view);

      expect(content).toContain('  modules: array(unknown()),');
      expect(output.warnings.join('\n')).toContain('cannot interpret [content.hero]');
    });

    it('interprets narrowed relation overlay populate values', () => {
      const view = {
        ...baseView,
        relations: {
          author: { fields: ['name'], populate: { avatar: { fields: ['url'] } } },
        },
      };
      const { content, output } = generate(view);

      // media narrowed by fields → inline upload-file slice
      expect(content).toContain('url: string(),');
      expect(content).not.toContain('avatar: nullish(UploadFileSchema)');
      expect(output.warnings).toEqual([]);
    });

    it('never applies transforms or type overrides below relation boundaries', () => {
      // The bff-views transformer walk stops at relations - payloads there
      // carry raw values even for fields a transform would match
      const view = {
        ...baseView,
        transforms: [
          { name: 'compile-richtext', match: { fieldType: 'richtext' } },
          { name: 'shout-meta', match: { fieldName: '^metaTitle$' } },
        ],
        fields: ['title', 'body'],
        // no core component fields - the metaTitle transform would correctly
        // contaminate them; this test isolates the relation boundary
        componentFields: {},
        relations: {
          related: { fields: ['summary', 'body'], populate: { seo: true } },
        },
      };
      const options = {
        ...baseOptions,
        typeOverrides: {
          richtext: { schema: 'object({})', name: 'RenderedHtmlSchema', typeName: 'RenderedHtml' },
        },
        viewTransformSchemas: {
          'shout-meta': { schema: 'string()', name: 'ShoutSchema', typeName: 'Shout' },
        },
      };
      const { content, output } = generate(view, options);

      // core document: transform applies
      expect(content).toContain('  body: nullish(RenderedHtmlSchema),');
      // inside the relation slice: raw richtext string, raw metaTitle
      expect(content).toContain('    body: nullish(string()),');
      expect(content).toContain('metaTitle: string(),');
      expect(content).not.toContain('metaTitle: ShoutSchema');
      expect(output.warnings).toEqual([]);
    });

    it('emits timestamp fields selected on relation targets as nullish datetimes', () => {
      const view = {
        ...baseView,
        relations: {
          author: { fields: ['name', 'createdAt', 'publishedAt'] },
        },
      };
      const { content, output } = generate(view);

      expect(content).toContain('    createdAt: nullish(string()),');
      expect(content).toContain('    publishedAt: nullish(string()),');
      expect(output.warnings).toEqual([]);
    });

    it('includes id in relation slices (the runtime always returns it)', () => {
      const { content } = generate(baseView);

      // author slice head: id + documentId
      expect(content).toContain('  author: nullish(object({');
      expect(content).toContain('    id: number(),');
    });
  });

  describe('viewResponseSchemas declarations', () => {
    const assembleView = { ...baseView, hasAssemble: true };

    it('emits the declared schema verbatim with type, Success and Result wrappers', () => {
      const options = {
        ...baseOptions,
        viewResponseSchemas: {
          'content-page': {
            schema: `object({ page: ContentPageMergedSchema })`,
            name: 'ContentPageAssembledSchema',
            typeName: 'ContentPageAssembled',
          },
        },
      };
      const { content } = generate(assembleView, options);

      expect(content).toContain(
        'export const ContentPageAssembledSchema = object({ page: ContentPageMergedSchema });',
      );
      expect(content).toContain(
        'export type ContentPageAssembled = InferOutput<typeof ContentPageAssembledSchema>;',
      );
      expect(content).toContain('export const ContentPageAssembledSuccessSchema = object({');
      expect(content).toContain("meta: looseObject({ view: literal('content-page') })");
      expect(content).toContain(
        'export const ContentPageAssembledResultSchema = union([ContentPageAssembledSuccessSchema, BffErrorEnvelopeSchema]);',
      );
      expect(content).toContain("import { BffErrorEnvelopeSchema } from './envelope';");
    });

    it('auto-imports referenced generated schemas; slices need no import', () => {
      const view = {
        ...assembleView,
        componentOverrides: { 'shared.seo': { fields: ['metaTitle'] } },
      };
      const options = {
        ...baseOptions,
        viewResponseSchemas: {
          'content-page': {
            schema: `object({\n  seoSlice: ContentPageSharedSeoSliceSchema,\n  hero: ContentHeroSchema,\n  file: UploadFileSchema,\n})`,
            name: 'ContentPageAssembledSchema',
            typeName: 'ContentPageAssembled',
          },
        },
      };
      const { content, output } = generate(view, options);

      expect(content).toContain("import { ContentHeroSchema } from '../components/content/hero';");
      expect(content).toContain("import { UploadFileSchema } from '../shared/upload-file';");
      // the slice const lives in this same file - no import for it
      expect(content).not.toContain('import { ContentPageSharedSeoSliceSchema');
      expect(output.warnings).toEqual([]);
    });

    it('registers overrides referenced only by the declaration', () => {
      const options = {
        ...baseOptions,
        typeOverrides: {
          richtext: { schema: 'object({})', name: 'RenderedHtmlSchema', typeName: 'RenderedHtml' },
        },
        viewResponseSchemas: {
          'content-page': {
            schema: `object({ body: RenderedHtmlSchema })`,
            name: 'ContentPageAssembledSchema',
            typeName: 'ContentPageAssembled',
          },
        },
      };
      // a view serving no richtext field - the override is used ONLY here
      const view = { ...assembleView, fields: ['title'], componentFields: {}, dynamicZones: {} };
      const { content, output } = generate(view, options);

      expect(content).toContain("import { RenderedHtmlSchema } from '../shared/overrides';");
      expect(output.usedOverrides.map((o) => o.name)).toContain('RenderedHtmlSchema');
    });

    it('passes explicit imports through verbatim', () => {
      const options = {
        ...baseOptions,
        viewResponseSchemas: {
          'content-page': {
            schema: `object({})`,
            name: 'ContentPageAssembledSchema',
            typeName: 'ContentPageAssembled',
            imports: [`import { HelperSchema } from '../shared/overrides';`],
          },
        },
      };
      const { content } = generate(assembleView, options);

      expect(content).toContain("import { HelperSchema } from '../shared/overrides';");
    });

    it('allows the natural X + XSchema naming pair on assemble views', () => {
      // ContentPageResponseSchema is NOT generated for assemble views - the
      // guard must not reserve names this file never emits
      const options = {
        ...baseOptions,
        viewResponseSchemas: {
          'content-page': {
            schema: `object({ page: ContentPageMergedSchema })`,
            name: 'ContentPageResponseSchema',
            typeName: 'ContentPageResponse',
          },
        },
      };
      const { content, output } = generate(assembleView, options);

      expect(content).toContain('export const ContentPageResponseSchema = object({');
      expect(content).toContain('export const ContentPageResponseSuccessSchema = object({');
      expect(output.warnings).toEqual([]);
    });

    it('still skips that pair on hook-free views where the name IS generated', () => {
      const options = {
        ...baseOptions,
        viewResponseSchemas: {
          'content-page': {
            schema: `object({})`,
            name: 'ContentPageResponseSchema',
            typeName: 'ContentPageResponse',
          },
        },
      };
      const { output } = generate(baseView, options);

      expect(output.warnings.join('\n')).toContain('collides with a generated export');
    });

    it('skips a declaration whose name collides with a generated export', () => {
      const options = {
        ...baseOptions,
        viewResponseSchemas: {
          'content-page': {
            schema: `object({})`,
            name: 'ContentPageMergedSchema',
            typeName: 'ContentPageMerged',
          },
        },
      };
      const { content, output } = generate(assembleView, options);

      expect(output.warnings.join('\n')).toContain('collides with a generated export');
      expect(content).not.toContain('SuccessSchema');
    });

    it('emits the zod variant', () => {
      const options = {
        ...baseOptions,
        target: 'zod' as const,
        viewResponseSchemas: {
          'content-page': {
            schema: `z.object({ page: ContentPageMergedSchema })`,
            name: 'ContentPageAssembledSchema',
            typeName: 'ContentPageAssembled',
          },
        },
      };
      const { content } = generate(assembleView, options);

      expect(content).toContain(
        'export const ContentPageAssembledSchema = z.object({ page: ContentPageMergedSchema });',
      );
      expect(content).toContain(
        'export type ContentPageAssembled = z.infer<typeof ContentPageAssembledSchema>;',
      );
      expect(content).toContain(
        'export const ContentPageAssembledResultSchema = z.union([ContentPageAssembledSuccessSchema, BffErrorEnvelopeSchema]);',
      );
    });
  });

  describe('keyless views (bff-views 0.2.0)', () => {
    it('generates singleton views exactly like keyed views', () => {
      const singleton: BffViewManifestEntry = {
        id: 'site-header',
        path: '/site-header',
        kind: 'singleton',
        contentType: 'api::page.page',
        fields: ['title'],
        componentFields: { seo: 'shared.seo' },
        dynamicZones: {},
        relations: {},
        componentOverrides: {},
        transforms: [],
        hasEnrich: false,
        hasAssemble: false,
      };
      const { content, output } = generate(singleton);

      expect(content).toContain('export const SiteHeaderDataSchema = object({');
      expect(content).toContain('  title: string(),');
      expect(content).toContain('  seo: nullish(SharedSeoSchema),');
      expect(content).toContain('export const SiteHeaderResponseSchema = object({');
      expect(output.warnings).toEqual([]);
    });

    it('generates composite views as an object of per-source shapes', () => {
      const composite: BffViewManifestEntry = {
        id: 'chrome',
        path: '/chrome',
        kind: 'composite',
        sources: {
          header: {
            contentType: 'api::page.page',
            many: false,
            fields: ['title'],
            componentFields: { seo: 'shared.seo' },
            dynamicZones: {},
            relations: {},
            componentOverrides: {},
          },
          authors: {
            contentType: 'api::author.author',
            many: true,
            fields: ['name'],
            componentFields: {},
            mediaFields: { avatar: { multiple: false } },
            dynamicZones: {},
            relations: {},
            componentOverrides: {},
          },
        },
        transforms: [],
        hasEnrich: false,
        hasAssemble: false,
      };
      const { content, output } = generate(composite);

      // single-doc source: nullable object (composites never 404)
      expect(content).toContain('header: nullish(object({');
      expect(content).toContain('    title: string(),');
      expect(content).toContain('    seo: nullish(SharedSeoSchema),');
      // every per-source object leads with the runtime-guaranteed row id
      expect(content).toContain('header: nullish(object({\n    id: number(),');
      expect(content).toContain('authors: array(object({\n    id: number(),');
      // many source: full-list array
      expect(content).toContain('authors: array(object({');
      expect(content).toContain('    name: string(),');
      expect(content).toContain('    avatar: nullish(UploadFileSchema),');
      expect(content).toContain('export const ChromeResponseSchema = object({');
      expect(output.warnings).toEqual([]);
    });

    it('prefixes per-source slice names and applies per-source overrides', () => {
      const composite: BffViewManifestEntry = {
        id: 'chrome',
        path: '/chrome',
        kind: 'composite',
        sources: {
          header: {
            contentType: 'api::page.page',
            many: false,
            fields: [],
            componentFields: { seo: 'shared.seo' },
            dynamicZones: {},
            relations: {},
            componentOverrides: { 'shared.seo': { fields: ['metaTitle'] } },
          },
        },
        transforms: [],
        hasEnrich: false,
        hasAssemble: false,
      };
      const { content, output } = generate(composite);

      expect(content).toContain('export const ChromeHeaderSharedSeoSliceSchema = object({');
      expect(content).toContain('seo: nullish(ChromeHeaderSharedSeoSliceSchema),');
      expect(output.warnings).toEqual([]);
    });

    it('emits unknown for a composite source whose content type is not generated', () => {
      const composite: BffViewManifestEntry = {
        id: 'chrome',
        path: '/chrome',
        kind: 'composite',
        sources: {
          ghost: {
            contentType: 'api::ghost.ghost',
            many: false,
            fields: ['title'],
            componentFields: {},
            dynamicZones: {},
            relations: {},
            componentOverrides: {},
          },
        },
        transforms: [],
        hasEnrich: false,
        hasAssemble: false,
      };
      const { content, output } = generate(composite);

      expect(content).toContain('ghost: nullish(unknown()),');
      expect(output.warnings.join('\n')).toContain("source 'ghost'");
    });

    it('skips composite entries without sources, and entries without contentType', () => {
      const empty: BffViewManifestEntry = {
        id: 'broken',
        path: '/broken',
        kind: 'composite',
        transforms: [],
        hasEnrich: false,
        hasAssemble: false,
      };
      const output = generateViewFiles(
        manifestWith(empty),
        contentTypes,
        components,
        registry,
        baseOptions,
      );

      expect(output.files.size).toBe(0);
      expect(output.warnings.join('\n')).toContain('unsupported manifest entry');
    });
  });

  describe('hooks', () => {
    it('emits only a merged schema for assemble views', () => {
      const view = { ...baseView, hasAssemble: true };
      const { content } = generate(view);

      expect(content).toContain('export const ContentPageMergedSchema = object({');
      expect(content).not.toContain('ContentPageResponseSchema');
      expect(content).toContain('assemble hook');
    });

    it('emits a loose object for enrich views', () => {
      const view = { ...baseView, hasEnrich: true };
      const { content } = generate(view);

      expect(content).toContain('export const ContentPageDataSchema = looseObject({');
      expect(content).toContain('ContentPageResponseSchema');
    });
  });

  it('skips views whose content type is not generated, with a warning', () => {
    const view = { ...baseView, id: 'ghost', contentType: 'api::ghost.ghost' };
    const output = generateViewFiles(
      manifestWith(view),
      contentTypes,
      components,
      registry,
      baseOptions,
    );

    expect(output.files.size).toBe(0);
    expect(output.warnings.join('\n')).toContain("content type 'api::ghost.ghost'");
  });
});

describe('code-writer integration', async () => {
  const { default: codeWriter } = await import('../../../../server/src/services/code-writer');

  it('emits view files, extends the barrel, and merges view transform overrides', () => {
    const options = {
      ...baseOptions,
      viewTransformSchemas: {
        'shout-title': { schema: 'string()', name: 'ShoutSchema', typeName: 'Shout' },
      },
    };
    const view = {
      ...baseView,
      transforms: [{ name: 'shout-title', match: { fieldName: '^title$' } }],
    };

    const files = codeWriter().buildSchemaFiles(
      contentTypes,
      components,
      options,
      manifestWith(view),
    );

    expect(files.get('views/content-page.ts')).toContain('ContentPageResponseSchema');
    expect(files.get('views/manifest.json')).toBeDefined();
    expect(files.get('index.ts')).toContain("export * from './views';");
    expect(files.get('shared/overrides.ts')).toContain('ShoutSchema');
  });

  it('emits no views output without a manifest', () => {
    const files = codeWriter().buildSchemaFiles(contentTypes, components, baseOptions);

    expect([...files.keys()].some((key) => key.startsWith('views/'))).toBe(false);
    expect(files.get('index.ts')).not.toContain('./views');
  });

  describe('media typeOverride', () => {
    const mediaCt: ContentTypeIR = {
      uid: 'api::asset.asset',
      singularName: 'asset',
      pluralName: 'assets',
      displayName: 'Asset',
      kind: 'collectionType',
      attributes: [
        { name: 'documentId', type: 'string', required: true },
        { name: 'cover', type: 'media', required: false, mediaMultiple: false },
        { name: 'gallery', type: 'media', required: false, mediaMultiple: true },
      ],
    };
    const mediaOverride = {
      media: {
        schema: 'object({ url: string() })',
        name: 'MediaFieldSchema',
        typeName: 'MediaField',
      },
    };

    it('replaces media schemas everywhere, array-wrapped for multiple media (valibot)', () => {
      const files = codeWriter().buildSchemaFiles([mediaCt], components, {
        ...baseOptions,
        typeOverrides: mediaOverride,
      });

      const ct = files.get('content-types/asset.ts') ?? '';
      expect(ct).toContain('cover: nullish(MediaFieldSchema),');
      expect(ct).toContain('gallery: nullish(array(MediaFieldSchema)),');
      expect(files.get('shared/overrides.ts')).toContain('MediaFieldSchema');

      // media inside components follows the same override
      const hero = files.get('components/content/hero.ts') ?? '';
      expect(hero).toContain('image: nullish(MediaFieldSchema),');
    });

    it('replaces media schemas for zod with z.array wrapping', () => {
      const files = codeWriter().buildSchemaFiles([mediaCt], [], {
        ...baseOptions,
        target: 'zod',
        typeOverrides: {
          media: {
            schema: 'z.object({ url: z.string() })',
            name: 'MediaFieldSchema',
            typeName: 'MediaField',
          },
        },
      });

      const ct = files.get('content-types/asset.ts') ?? '';
      expect(ct).toContain('cover: MediaFieldSchema.nullish(),');
      expect(ct).toContain('gallery: z.array(MediaFieldSchema).nullish(),');
    });

    it('keeps view mediaFields as full UploadFileSchema - runtime serves them unnarrowed', () => {
      const view = { ...baseView, mediaFields: { hero: { multiple: false } } };
      const withMedia: ContentTypeIR = {
        ...contentTypes[0]!,
        attributes: [
          ...contentTypes[0]!.attributes,
          { name: 'hero', type: 'media', required: false, mediaMultiple: false },
        ],
      };
      const output = generateViewFiles(
        manifestWith(view),
        [withMedia, contentTypes[1]!],
        components,
        registry,
        { ...baseOptions, typeOverrides: mediaOverride },
      );
      const content = output.files.get('views/content-page.ts') ?? '';

      expect(content).toContain('  hero: nullish(UploadFileSchema),');
      expect(content).not.toContain('hero: nullish(MediaFieldSchema)');
    });
  });
});

describe('view-schema-generator (zod)', () => {
  const zodOptions: GenerationOptions = { ...baseOptions, target: 'zod' };

  it('emits zod syntax throughout', () => {
    const { content } = generate(baseView, zodOptions);

    expect(content).toContain("import { z } from 'zod';");
    expect(content).toContain('export const ContentPageDataSchema = z.object({');
    expect(content).toContain('  title: z.string(),');
    expect(content).toContain('  summary: z.string().nullish(),');
    expect(content).toContain(
      "z.discriminatedUnion('__component', [ContentHeroSchema, ContentFaqSchema])",
    );
    expect(content).toContain("z.object({ view: z.literal('content-page') }).passthrough()");
    expect(content).toContain(
      'export type ContentPageData = z.infer<typeof ContentPageDataSchema>;',
    );
  });

  it('uses passthrough for enrich views', () => {
    const { content } = generate({ ...baseView, hasEnrich: true }, zodOptions);

    expect(content).toContain('}).passthrough();');
  });
});
