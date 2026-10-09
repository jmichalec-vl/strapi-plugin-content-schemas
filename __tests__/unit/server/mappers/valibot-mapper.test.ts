import { describe, it, expect } from 'vitest';

import '../../../../server/src/mappers/valibot/index';
import { mapAttribute } from '../../../../server/src/mappers/shared/attribute-mapper';
import {
  buildContentTypeSchema,
  buildComponentSchema,
} from '../../../../server/src/mappers/shared/schema-builder';
import { valibotPrimitives } from '../../../../server/src/mappers/valibot/primitives';
import {
  buildSchemaRegistry,
  type SchemaRegistry,
} from '../../../../server/src/generators/schema-registry';
import type {
  AttributeIR,
  ComponentIR,
  ContentTypeIR,
  TypeOverride,
} from '../../../../server/src/types';
import type { OverrideConfig } from '../../../../server/src/generators/override-resolver';

const EMPTY_REGISTRY: SchemaRegistry = {
  components: new Map(),
  contentTypes: new Map(),
};

const makeAttr = (
  overrides: Partial<AttributeIR> & { type: AttributeIR['type'] },
): AttributeIR => ({
  name: 'testField',
  required: false,
  ...overrides,
});

describe('mapAttribute', () => {
  describe('primitive type mapping', () => {
    const primitiveTests: ReadonlyArray<{ type: AttributeIR['type']; expected: string }> = [
      { type: 'string', expected: 'string()' },
      { type: 'text', expected: 'string()' },
      { type: 'richtext', expected: 'string()' },
      { type: 'uid', expected: 'string()' },
      { type: 'email', expected: 'string()' },
      { type: 'boolean', expected: 'boolean()' },
      { type: 'integer', expected: 'number()' },
      // Strapi serializes biginteger as a string
      { type: 'biginteger', expected: 'string()' },
      { type: 'float', expected: 'number()' },
      { type: 'decimal', expected: 'number()' },
      { type: 'date', expected: 'string()' },
      { type: 'datetime', expected: 'string()' },
      { type: 'time', expected: 'string()' },
      { type: 'timestamp', expected: 'string()' },
      { type: 'json', expected: 'unknown()' },
      { type: 'blocks', expected: 'unknown()' },
    ];

    it.each(primitiveTests)('maps $type (required) to $expected', ({ type, expected }) => {
      const attr = makeAttr({ type, required: true });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);
      expect(result.expression).toBe(expected);
      expect(result.externalRefs).toEqual([]);
    });
  });

  describe('enumeration mapping', () => {
    it('maps enumeration with values', () => {
      const attr = makeAttr({
        type: 'enumeration',
        required: true,
        enumValues: ['draft', 'published', 'archived'],
      });

      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);
      expect(result.expression).toBe("picklist(['draft', 'published', 'archived'])");
    });

    it('maps enumeration with empty values', () => {
      const attr = makeAttr({ type: 'enumeration', required: true, enumValues: [] });

      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);
      expect(result.expression).toBe('picklist([])');
    });

    it('escapes single quotes and backslashes in enum values', () => {
      const attr = makeAttr({
        type: 'enumeration',
        required: true,
        enumValues: ["it's live", 'back\\slash'],
      });

      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);
      expect(result.expression).toBe("picklist(['it\\'s live', 'back\\\\slash'])");
    });
  });

  describe('media mapping', () => {
    it('maps single media to UploadFileSchema', () => {
      const attr = makeAttr({ type: 'media', required: true, mediaMultiple: false });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('UploadFileSchema');
      expect(result.externalRefs).toContain('UploadFileSchema');
    });

    it('maps multiple media to array(UploadFileSchema)', () => {
      const attr = makeAttr({ type: 'media', required: true, mediaMultiple: true });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('array(UploadFileSchema)');
      expect(result.externalRefs).toContain('UploadFileSchema');
    });

    it('wraps non-required media with nullish', () => {
      const attr = makeAttr({ type: 'media', required: false, mediaMultiple: false });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('nullish(UploadFileSchema)');
    });
  });

  describe('component mapping', () => {
    const registry: SchemaRegistry = {
      components: new Map([['shared.seo', 'SeoSchema']]),
      contentTypes: new Map(),
    };

    it('maps single component to schema reference', () => {
      const attr = makeAttr({
        type: 'component',
        required: true,
        componentUID: 'shared.seo',
        repeatable: false,
      });
      const result = mapAttribute(attr, 'nullish', registry, valibotPrimitives);

      expect(result.expression).toBe('SeoSchema');
      expect(result.externalRefs).toContain('SeoSchema');
    });

    it('maps repeatable component to array(schema)', () => {
      const attr = makeAttr({
        type: 'component',
        required: true,
        componentUID: 'shared.seo',
        repeatable: true,
      });
      const result = mapAttribute(attr, 'nullish', registry, valibotPrimitives);

      expect(result.expression).toBe('array(SeoSchema)');
    });

    it('falls back to unknown() for unresolved component', () => {
      const attr = makeAttr({
        type: 'component',
        required: true,
        componentUID: 'unknown.component',
      });
      const result = mapAttribute(attr, 'nullish', registry, valibotPrimitives);

      expect(result.expression).toBe('unknown()');
      expect(result.externalRefs).toEqual([]);
    });

    it('wraps non-required component with nullish', () => {
      const attr = makeAttr({
        type: 'component',
        required: false,
        componentUID: 'shared.seo',
        repeatable: false,
      });
      const result = mapAttribute(attr, 'nullish', registry, valibotPrimitives);

      expect(result.expression).toBe('nullish(SeoSchema)');
    });
  });

  describe('relation mapping (registry-based ref())', () => {
    const registryWithAuthor: SchemaRegistry = {
      components: new Map(),
      contentTypes: new Map([['api::author.author', 'AuthorSchema']]),
    };

    it('maps xToOne relation to ref() when target is in registry', () => {
      const attr = makeAttr({
        type: 'relation',
        required: false,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      });
      const result = mapAttribute(attr, 'nullish', registryWithAuthor, valibotPrimitives);

      expect(result.expression).toBe("nullish(ref('Author'))");
    });

    it('treats morph to-many kinds as arrays', () => {
      const attr = makeAttr({
        type: 'relation',
        required: false,
        relationKind: 'morphMany',
        relationTarget: 'api::author.author',
      });
      const result = mapAttribute(attr, 'nullish', registryWithAuthor, valibotPrimitives);

      expect(result.expression).toBe("nullish(array(ref('Author')))");
    });

    it('maps xToMany relation to array(ref()) when target is in registry', () => {
      const attr = makeAttr({
        type: 'relation',
        required: false,
        relationKind: 'oneToMany',
        relationTarget: 'api::author.author',
      });
      const result = mapAttribute(attr, 'nullish', registryWithAuthor, valibotPrimitives);

      expect(result.expression).toBe("nullish(array(ref('Author')))");
    });

    it('falls back to nullish(unknown()) for unresolved target', () => {
      const attr = makeAttr({
        type: 'relation',
        required: true,
        relationKind: 'manyToOne',
        relationTarget: 'api::unknown.unknown',
      });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('nullish(unknown())');
      expect(result.externalRefs).toEqual([]);
    });

    it('falls back to nullish(array(unknown())) for unresolved xToMany', () => {
      const attr = makeAttr({
        type: 'relation',
        required: true,
        relationKind: 'oneToMany',
        relationTarget: 'api::unknown.unknown',
      });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('nullish(array(unknown()))');
    });

    it('wraps required relations in nullish - presence depends on populate', () => {
      const attr = makeAttr({
        type: 'relation',
        required: true,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      });
      const result = mapAttribute(attr, 'nullish', registryWithAuthor, valibotPrimitives);

      expect(result.expression).toBe("nullish(ref('Author'))");
    });
  });

  describe('dynamiczone mapping', () => {
    const registry: SchemaRegistry = {
      components: new Map([
        ['hero.hero-section', 'HeroSectionSchema'],
        ['faq.faq', 'FaqSchema'],
      ]),
      contentTypes: new Map(),
    };

    it('maps dynamiczone to a variant() discriminated union', () => {
      const attr = makeAttr({
        type: 'dynamiczone',
        required: true,
        componentUIDs: ['hero.hero-section', 'faq.faq'],
      });
      const result = mapAttribute(attr, 'nullish', registry, valibotPrimitives);

      expect(result.expression).toBe(
        "array(variant('__component', [HeroSectionSchema, FaqSchema]))",
      );
      expect(result.externalRefs).toContain('HeroSectionSchema');
      expect(result.externalRefs).toContain('FaqSchema');
    });

    it('defers cycle members with lazy() and falls back to union()', () => {
      const cyclic: SchemaRegistry = { ...registry, cycleUIDs: new Set(['faq.faq']) };
      const attr = makeAttr({
        type: 'dynamiczone',
        required: true,
        componentUIDs: ['hero.hero-section', 'faq.faq'],
      });
      const result = mapAttribute(attr, 'nullish', cyclic, valibotPrimitives);

      expect(result.expression).toBe('array(union([HeroSectionSchema, lazy(() => FaqSchema)]))');
      expect(result.externalRefs).toEqual(['HeroSectionSchema', 'FaqSchema']);
    });

    it('wraps non-required dynamiczone with nullish', () => {
      const attr = makeAttr({
        type: 'dynamiczone',
        required: false,
        componentUIDs: ['hero.hero-section'],
      });
      const result = mapAttribute(attr, 'nullish', registry, valibotPrimitives);

      expect(result.expression).toBe("nullish(array(variant('__component', [HeroSectionSchema])))");
    });

    it('falls back to plain union() when a variant component is dual-use', () => {
      const dualUseRegistry: SchemaRegistry = {
        components: registry.components,
        contentTypes: new Map(),
        dualUseUIDs: new Set(['faq.faq']),
      };
      const attr = makeAttr({
        type: 'dynamiczone',
        required: true,
        componentUIDs: ['hero.hero-section', 'faq.faq'],
      });
      const result = mapAttribute(attr, 'nullish', dualUseRegistry, valibotPrimitives);

      expect(result.expression).toBe('array(union([HeroSectionSchema, FaqSchema]))');
    });

    it('falls back to array(unknown()) when no variants resolved', () => {
      const attr = makeAttr({
        type: 'dynamiczone',
        required: true,
        componentUIDs: ['unknown.component'],
      });
      const result = mapAttribute(attr, 'nullish', registry, valibotPrimitives);

      expect(result.expression).toBe('array(unknown())');
    });
  });

  describe('nullability wrapping', () => {
    it('wraps non-required field with nullish()', () => {
      const attr = makeAttr({ type: 'string', required: false });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('nullish(string())');
    });

    it('wraps non-required field with optional(union([..., null_()]))', () => {
      const attr = makeAttr({ type: 'string', required: false });
      const result = mapAttribute(attr, 'optional-union-null', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('optional(union([string(), null_()]))');
    });

    it('does not wrap required field', () => {
      const attr = makeAttr({ type: 'string', required: true });
      const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, valibotPrimitives);

      expect(result.expression).toBe('string()');
    });
  });
});

describe('mapContentTypeSchema', () => {
  const makeContentType = (overrides?: Partial<ContentTypeIR>): ContentTypeIR => ({
    uid: 'api::article.article',
    singularName: 'article',
    pluralName: 'articles',
    displayName: 'Article',
    kind: 'collectionType',
    attributes: [
      { name: 'title', type: 'string', required: true },
      { name: 'body', type: 'richtext', required: false },
    ],
    ...overrides,
  });

  it('generates correct schema code', () => {
    const ct = makeContentType();
    const result = buildContentTypeSchema({
      ct,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.code).toContain('export const ArticleSchema = object({');
    expect(result.code).toContain('  title: string(),');
    expect(result.code).toContain('  body: nullish(string()),');
    expect(result.code).toContain('});');
    expect(result.code).toContain('export interface Article {');
  });

  it('generates correct import statement', () => {
    const ct = makeContentType();
    const result = buildContentTypeSchema({
      ct,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.importStatement).toContain('object');
    expect(result.importStatement).toContain('string');
    expect(result.importStatement).toContain("from 'valibot'");
    expect(result.importStatement).not.toContain('InferInput');
  });

  it('tracks external imports for media fields', () => {
    const ct = makeContentType({
      attributes: [{ name: 'image', type: 'media', required: true, mediaMultiple: false }],
    });
    const result = buildContentTypeSchema({
      ct,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.externalImports).toContainEqual({
      schemaVarName: 'UploadFileSchema',
      source: 'upload-file',
    });
  });

  it('handles PascalCase for hyphenated names', () => {
    const ct = makeContentType({ singularName: 'blog-post' });
    const result = buildContentTypeSchema({
      ct,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.code).toContain('export const BlogPostSchema = object({');
    expect(result.code).toContain('export interface BlogPost {');
  });
});

describe('mapComponentSchema', () => {
  it('annotates a self-referencing component with GenericSchema<Interface> and imports the type', () => {
    const faqItem: ComponentIR = {
      uid: 'modules.faq-item',
      category: 'modules',
      displayName: 'FAQ item',
      attributes: [
        { name: 'question', type: 'string', required: true },
        {
          name: 'nestedItems',
          type: 'component',
          required: false,
          componentUID: 'modules.faq-item',
          repeatable: true,
        },
      ],
    };
    const registry = buildSchemaRegistry([], [faqItem], undefined, new Set(['modules.faq-item']));

    const result = buildComponentSchema({
      component: faqItem,
      nullableStyle: 'nullish',
      registry,
      primitives: valibotPrimitives,
      componentUsage: { inDynamicZone: false, inComponent: true },
    });

    expect(result.code).toContain(
      'export const ModulesFaqItemSchema: GenericSchema<ModulesFaqItem> = object({',
    );
    expect(result.code).toContain('nestedItems: nullish(array(lazy(() => ModulesFaqItemSchema))),');
    expect(result.typeImportStatements).toContain("import type { GenericSchema } from 'valibot';");
  });

  const makeComponent = (overrides?: Partial<ComponentIR>): ComponentIR => ({
    uid: 'shared.seo',
    category: 'shared',
    displayName: 'SEO',
    attributes: [
      { name: 'metaTitle', type: 'string', required: true },
      { name: 'metaDescription', type: 'text', required: false },
    ],
    ...overrides,
  });

  it('no __component when used only as single/repeatable component', () => {
    const comp = makeComponent();
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
      componentUsage: { inDynamicZone: false, inComponent: true },
    });

    expect(result.code).toContain('export const SharedSeoSchema = object({');
    expect(result.code).not.toContain('__component');
    expect(result.code).toContain('  id: number(),');
    expect(result.code).toContain('  metaTitle: string(),');
  });

  it('required __component when used only in dynamic zone', () => {
    const comp = makeComponent();
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
      componentUsage: { inDynamicZone: true, inComponent: false },
    });

    expect(result.code).toContain("  __component: literal('shared.seo'),");
    expect(result.code).not.toContain('nullish(literal(');
  });

  it('optional __component when used in both dynamic zone and component', () => {
    const comp = makeComponent();
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
      componentUsage: { inDynamicZone: true, inComponent: true },
    });

    expect(result.code).toContain("  __component: nullish(literal('shared.seo')),");
  });

  it('has id field', () => {
    const comp = makeComponent();
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.code).toContain('  id: number(),');
  });

  it('includes number in imports', () => {
    const comp = makeComponent();
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.importStatement).toContain('number');
  });

  it('generates interface', () => {
    const comp = makeComponent();
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.code).toContain('export interface SharedSeo {');
  });

  it('handles component with media field', () => {
    const comp = makeComponent({
      attributes: [{ name: 'image', type: 'media', required: true, mediaMultiple: false }],
    });
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: valibotPrimitives,
    });

    expect(result.code).toContain('  image: UploadFileSchema,');
    expect(result.externalImports).toContainEqual({
      schemaVarName: 'UploadFileSchema',
      source: 'upload-file',
    });
  });
});

describe('buildSchemaRegistry', () => {
  it('maps content types to schema var names', () => {
    const contentTypes: ContentTypeIR[] = [
      {
        uid: 'api::article.article',
        singularName: 'article',
        pluralName: 'articles',
        displayName: 'Article',
        kind: 'collectionType',
        attributes: [],
      },
    ];

    const registry = buildSchemaRegistry(contentTypes, []);

    expect(registry.contentTypes.get('api::article.article')).toBe('ArticleSchema');
  });

  it('maps components to schema var names', () => {
    const components: ComponentIR[] = [
      { uid: 'shared.seo', category: 'shared', displayName: 'SEO', attributes: [] },
    ];

    const registry = buildSchemaRegistry([], components);

    expect(registry.components.get('shared.seo')).toBe('SharedSeoSchema');
  });
});

describe('override support', () => {
  const RENDERED_HTML_OVERRIDE: TypeOverride = {
    schema: 'object({ html: string() })',
    name: 'RenderedHtmlSchema',
    typeName: 'RenderedHtml',
  };

  const CUSTOM_BODY: TypeOverride = {
    schema: 'string()',
    name: 'CustomBodySchema',
    typeName: 'CustomBody',
  };

  describe('mapAttribute with overrides', () => {
    it('uses type override for matching type', () => {
      const attr = makeAttr({ name: 'body', type: 'richtext', required: true });
      const overrides: OverrideConfig = {
        typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
        fieldOverrides: {},
      };

      const result = mapAttribute(
        attr,
        'nullish',
        EMPTY_REGISTRY,
        valibotPrimitives,
        'api::article.article',
        overrides,
      );

      expect(result.expression).toBe('RenderedHtmlSchema');
      expect(result.externalRefs).toContain('RenderedHtmlSchema');
    });

    it('wraps non-required override with nullish', () => {
      const attr = makeAttr({ name: 'body', type: 'richtext', required: false });
      const overrides: OverrideConfig = {
        typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
        fieldOverrides: {},
      };

      const result = mapAttribute(
        attr,
        'nullish',
        EMPTY_REGISTRY,
        valibotPrimitives,
        'api::article.article',
        overrides,
      );

      expect(result.expression).toBe('nullish(RenderedHtmlSchema)');
    });

    it('keeps an overridden relation nullish even when required', () => {
      const attr = makeAttr({
        name: 'author',
        type: 'relation',
        required: true,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      });
      const overrides: OverrideConfig = {
        typeOverrides: {},
        fieldOverrides: { 'api::article.article.author': RENDERED_HTML_OVERRIDE },
      };

      const result = mapAttribute(
        attr,
        'nullish',
        EMPTY_REGISTRY,
        valibotPrimitives,
        'api::article.article',
        overrides,
      );

      expect(result.expression).toBe('nullish(RenderedHtmlSchema)');
    });

    it('uses field override over type override', () => {
      const attr = makeAttr({ name: 'body', type: 'richtext', required: true });
      const overrides: OverrideConfig = {
        typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
        fieldOverrides: { 'api::article.article.body': CUSTOM_BODY },
      };

      const result = mapAttribute(
        attr,
        'nullish',
        EMPTY_REGISTRY,
        valibotPrimitives,
        'api::article.article',
        overrides,
      );

      expect(result.expression).toBe('CustomBodySchema');
    });

    it('falls through to default mapping when no override matches', () => {
      const attr = makeAttr({ name: 'title', type: 'string', required: true });
      const overrides: OverrideConfig = {
        typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
        fieldOverrides: {},
      };

      const result = mapAttribute(
        attr,
        'nullish',
        EMPTY_REGISTRY,
        valibotPrimitives,
        'api::article.article',
        overrides,
      );

      expect(result.expression).toBe('string()');
      expect(result.externalRefs).toEqual([]);
    });
  });

  describe('mapContentTypeSchema with overrides', () => {
    it('uses override for richtext fields', () => {
      const ct: ContentTypeIR = {
        uid: 'api::article.article',
        singularName: 'article',
        pluralName: 'articles',
        displayName: 'Article',
        kind: 'collectionType',
        attributes: [
          { name: 'title', type: 'string', required: true },
          { name: 'body', type: 'richtext', required: false },
        ],
      };
      const overrides: OverrideConfig = {
        typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
        fieldOverrides: {},
      };

      const result = buildContentTypeSchema({
        ct,
        nullableStyle: 'nullish',
        registry: EMPTY_REGISTRY,
        primitives: valibotPrimitives,
        overrides,
      });

      expect(result.code).toContain('title: string()');
      expect(result.code).toContain('body: nullish(RenderedHtmlSchema)');
      expect(result.externalImports).toContainEqual({
        schemaVarName: 'RenderedHtmlSchema',
        source: 'override',
      });
    });
  });

  describe('mapComponentSchema with overrides', () => {
    it('uses override for richtext fields in components', () => {
      const comp: ComponentIR = {
        uid: 'hero.hero-section',
        category: 'hero',
        displayName: 'Hero Section',
        attributes: [
          { name: 'title', type: 'richtext', required: true },
          { name: 'subtitle', type: 'text', required: false },
        ],
      };
      const overrides: OverrideConfig = {
        typeOverrides: { richtext: RENDERED_HTML_OVERRIDE },
        fieldOverrides: {},
      };

      const result = buildComponentSchema({
        component: comp,
        nullableStyle: 'nullish',
        registry: EMPTY_REGISTRY,
        primitives: valibotPrimitives,
        overrides,
      });

      expect(result.code).toContain('title: RenderedHtmlSchema');
      expect(result.code).toContain('subtitle: nullish(string())');
    });
  });
});
