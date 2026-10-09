import { describe, it, expect } from 'vitest';

import '../../../../server/src/mappers/zod/index';
import { mapAttribute } from '../../../../server/src/mappers/shared/attribute-mapper';
import {
  buildContentTypeSchema,
  buildComponentSchema,
} from '../../../../server/src/mappers/shared/schema-builder';
import { zodPrimitives } from '../../../../server/src/mappers/zod/primitives';
import { buildOverridesFileContent } from '../../../../server/src/mappers/zod/overrides';
import { buildSchemaRegistry } from '../../../../server/src/generators/schema-registry';
import type { AttributeIR, ContentTypeIR, ComponentIR } from '../../../../server/src/types';

const EMPTY_REGISTRY = buildSchemaRegistry([], []);

const makeAttr = (
  overrides: Partial<AttributeIR> & { name: string; type: AttributeIR['type'] },
): AttributeIR => ({
  required: true,
  ...overrides,
});

const makeCt = (singularName: string, attrs: ContentTypeIR['attributes']): ContentTypeIR => ({
  uid: `api::${singularName}.${singularName}`,
  singularName,
  pluralName: `${singularName}s`,
  displayName: singularName,
  kind: 'collectionType',
  attributes: attrs,
});

const makeComp = (uid: string, attrs: ComponentIR['attributes']): ComponentIR => ({
  uid,
  category: uid.split('.')[0] ?? uid,
  displayName: uid.split('.')[1] ?? uid,
  attributes: attrs,
});

describe('zod attribute mapping', () => {
  it.each([
    { type: 'string', expected: 'z.string()' },
    { type: 'text', expected: 'z.string()' },
    { type: 'boolean', expected: 'z.boolean()' },
    { type: 'integer', expected: 'z.number()' },
    // Strapi serializes biginteger as a string
    { type: 'biginteger', expected: 'z.string()' },
    { type: 'decimal', expected: 'z.number()' },
    { type: 'json', expected: 'z.unknown()' },
    { type: 'date', expected: 'z.string()' },
  ])('maps $type (required) to $expected', ({ type, expected }) => {
    const attr = makeAttr({ name: 'field', type: type as AttributeIR['type'] });
    const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, zodPrimitives);

    expect(result.expression).toBe(expected);
  });

  it('wraps optional fields with .nullish()', () => {
    const attr = makeAttr({ name: 'bio', type: 'string', required: false });
    const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, zodPrimitives);

    expect(result.expression).toBe('z.string().nullish()');
  });

  it('wraps optional fields with .nullable().optional() for optional-union-null style', () => {
    const attr = makeAttr({ name: 'bio', type: 'string', required: false });
    const result = mapAttribute(attr, 'optional-union-null', EMPTY_REGISTRY, zodPrimitives);

    expect(result.expression).toBe('z.string().nullable().optional()');
  });

  it('maps enumeration to z.enum()', () => {
    const attr = makeAttr({
      name: 'status',
      type: 'enumeration',
      enumValues: ['draft', 'published'],
    });
    const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, zodPrimitives);

    expect(result.expression).toBe("z.enum(['draft', 'published'])");
  });

  it('escapes single quotes and backslashes in enum values', () => {
    const attr = makeAttr({
      name: 'label',
      type: 'enumeration',
      enumValues: ["it's live", 'back\\slash'],
    });
    const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, zodPrimitives);

    expect(result.expression).toBe("z.enum(['it\\'s live', 'back\\\\slash'])");
  });

  it('maps media to UploadFileSchema', () => {
    const attr = makeAttr({ name: 'image', type: 'media', mediaMultiple: false });
    const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, zodPrimitives);

    expect(result.expression).toBe('UploadFileSchema');
    expect(result.externalRefs).toContain('UploadFileSchema');
  });

  it('maps dynamiczone to z.discriminatedUnion on __component', () => {
    const registry = buildSchemaRegistry(
      [],
      [makeComp('hero.hero-section', []), makeComp('faq.faq', [])],
    );
    const attr = makeAttr({
      name: 'blocks',
      type: 'dynamiczone',
      componentUIDs: ['hero.hero-section', 'faq.faq'],
    });
    const result = mapAttribute(attr, 'nullish', registry, zodPrimitives);

    expect(result.expression).toBe(
      "z.array(z.discriminatedUnion('__component', [HeroHeroSectionSchema, FaqFaqSchema]))",
    );
  });

  it('defers cycle members with z.lazy() and falls back to z.union()', () => {
    const registry = buildSchemaRegistry(
      [],
      [makeComp('hero.hero-section', []), makeComp('faq.faq', [])],
      undefined,
      new Set(['faq.faq']),
    );
    const attr = makeAttr({
      name: 'blocks',
      type: 'dynamiczone',
      componentUIDs: ['hero.hero-section', 'faq.faq'],
    });
    const result = mapAttribute(attr, 'nullish', registry, zodPrimitives);

    expect(result.expression).toBe(
      'z.array(z.union([HeroHeroSectionSchema, z.lazy(() => FaqFaqSchema)]))',
    );
  });

  it('falls back to plain z.union() when a dynamiczone component is dual-use', () => {
    const base = buildSchemaRegistry(
      [],
      [makeComp('hero.hero-section', []), makeComp('faq.faq', [])],
    );
    const dualUseRegistry = {
      components: base.components,
      contentTypes: base.contentTypes,
      dualUseUIDs: new Set(['faq.faq']),
    };
    const attr = makeAttr({
      name: 'blocks',
      type: 'dynamiczone',
      componentUIDs: ['hero.hero-section', 'faq.faq'],
    });
    const result = mapAttribute(attr, 'nullish', dualUseRegistry, zodPrimitives);

    expect(result.expression).toBe('z.array(z.union([HeroHeroSectionSchema, FaqFaqSchema]))');
  });

  it('maps media multiple to z.array(UploadFileSchema)', () => {
    const attr = makeAttr({ name: 'gallery', type: 'media', mediaMultiple: true });
    const result = mapAttribute(attr, 'nullish', EMPTY_REGISTRY, zodPrimitives);

    expect(result.expression).toBe('z.array(UploadFileSchema)');
  });
});

describe('zod content type schema', () => {
  it('generates z.object() schema', () => {
    const ct = makeCt('article', [{ name: 'title', type: 'string', required: true }]);
    const result = buildContentTypeSchema({
      ct,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: zodPrimitives,
    });

    expect(result.code).toContain('export const ArticleSchema = z.object({');
    expect(result.code).toContain('title: z.string(),');
    expect(result.importStatement).toBe("import { z } from 'zod';");
  });

  it('includes register call', () => {
    const ct = makeCt('article', [{ name: 'title', type: 'string', required: true }]);
    const result = buildContentTypeSchema({
      ct,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: zodPrimitives,
    });

    expect(result.code).toContain("register('Article', ArticleSchema);");
  });

  it('generates TypeScript interface alongside schema', () => {
    const ct = makeCt('article', [{ name: 'title', type: 'string', required: true }]);
    const result = buildContentTypeSchema({
      ct,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: zodPrimitives,
    });

    expect(result.code).toContain('export interface Article {');
    expect(result.code).toContain('readonly title: string;');
  });
});

describe('zod component schema', () => {
  it('generates z.object() with id field', () => {
    const comp = makeComp('shared.seo', [{ name: 'metaTitle', type: 'string', required: true }]);
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: zodPrimitives,
    });

    expect(result.code).toContain('export const SharedSeoSchema = z.object({');
    expect(result.code).toContain('id: z.number(),');
    expect(result.code).toContain('metaTitle: z.string(),');
  });

  it('adds z.literal __component for dynamic zone components', () => {
    const comp = makeComp('modules.hero', [{ name: 'title', type: 'string', required: true }]);
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: zodPrimitives,
      componentUsage: { inDynamicZone: true, inComponent: false },
    });

    expect(result.code).toContain("__component: z.literal('modules.hero'),");
  });

  it('adds nullish z.literal __component when used in both contexts', () => {
    const comp = makeComp('modules.hero', [{ name: 'title', type: 'string', required: true }]);
    const result = buildComponentSchema({
      component: comp,
      nullableStyle: 'nullish',
      registry: EMPTY_REGISTRY,
      primitives: zodPrimitives,
      componentUsage: { inDynamicZone: true, inComponent: true },
    });

    expect(result.code).toContain("__component: z.literal('modules.hero').nullish(),");
  });
});

describe('zod overrides', () => {
  it('generates z.infer type extraction', () => {
    const result = buildOverridesFileContent([
      {
        schema: 'z.object({ html: z.string() })',
        name: 'RenderedHtmlSchema',
        typeName: 'RenderedHtml',
      },
    ]);

    expect(result).toContain('export const RenderedHtmlSchema = z.object({ html: z.string() })');
    expect(result).toContain('export type RenderedHtml = z.infer<typeof RenderedHtmlSchema>');
    expect(result).toContain("import { z } from 'zod'");
  });
});

describe('recursive component schemas', () => {
  it('annotates a self-referencing component with z.ZodType<Interface>', () => {
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
      primitives: zodPrimitives,
      componentUsage: { inDynamicZone: false, inComponent: true },
    });

    expect(result.code).toContain(
      'export const ModulesFaqItemSchema: z.ZodType<ModulesFaqItem> = z.object({',
    );
    expect(result.typeImportStatements ?? []).toEqual([]);
  });
});
