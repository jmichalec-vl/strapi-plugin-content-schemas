import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { GENERATED_DIR } from './helpers/generated-dir';

const readGenerated = (relPath: string): string =>
  fs.readFileSync(path.join(GENERATED_DIR, relPath), 'utf-8');

describe('article schema (collectionType, draftAndPublish)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/article.ts');
  });

  it('exports ArticleSchema and type', () => {
    expect(content).toContain('export const ArticleSchema = object({');
    expect(content).toContain('export interface Article {');
  });

  it('has documentId (required)', () => {
    expect(content).toContain('documentId: string()');
  });

  it('has required string fields', () => {
    expect(content).toContain('title: string()');
    expect(content).toContain('slug: string()');
  });

  it('has required richtext with override', () => {
    expect(content).toContain('content: RenderedHtmlSchema');
  });

  it('has optional text field', () => {
    expect(content).toContain('excerpt: nullish(string())');
  });

  it('has date field as string', () => {
    expect(content).toContain('publishDate: nullish(string())');
  });

  it('has required media (single)', () => {
    expect(content).toContain('image: UploadFileSchema');
  });

  it('has required enumeration', () => {
    expect(content).toContain("picklist(['draft', 'in_review', 'published', 'archived'])");
  });

  it('emits an enum const object referenced by the interface', () => {
    expect(content).toContain('export const ArticleStatus = {');
    expect(content).toContain("  Draft: 'draft',");
    expect(content).toContain("  InReview: 'in_review',");
    expect(content).toContain(
      'export type ArticleStatus = (typeof ArticleStatus)[keyof typeof ArticleStatus];',
    );
    expect(content).toContain('readonly status: ArticleStatus;');
  });

  it('has optional component (seo)', () => {
    expect(content).toContain('seo: nullish(SharedSeoSchema)');
  });

  it('has manyToMany relation via registry ref', () => {
    expect(content).toContain("categories: nullish(array(ref('Category')))");
  });

  it('has manyToOne relation via registry ref', () => {
    expect(content).toContain("author: nullish(ref('Author'))");
  });

  it('imports from shared and components', () => {
    expect(content).toContain("from '../shared/overrides'");
    expect(content).toContain("from '../shared/upload-file'");
    expect(content).toContain("from '../components/shared/seo'");
  });
});

describe('product schema (collectionType, many field types)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/product.ts');
  });

  it('has required decimal as number', () => {
    expect(content).toContain('price: number()');
  });

  it('has optional float as number', () => {
    expect(content).toContain('compareAtPrice: nullish(number())');
  });

  it('has required integer as number', () => {
    expect(content).toContain('quantity: number()');
  });

  it('has required boolean', () => {
    expect(content).toContain('isActive: boolean()');
  });

  it('has json as any', () => {
    expect(content).toContain('metadata: nullish(unknown())');
  });

  it('excludes private attributes (sanitizer strips them from responses)', () => {
    expect(content).not.toContain('costPrice');
  });

  it('has required media (multiple)', () => {
    expect(content).toContain('images: array(UploadFileSchema)');
  });

  it('has optional media (single)', () => {
    expect(content).toContain('thumbnail: nullish(UploadFileSchema)');
  });

  it('has two dynamic zones', () => {
    expect(content).toContain('fulfillmentOptions:');
    expect(content).toContain('productMetadata:');
    expect(content).toContain("variant('__component', [");
  });

  it('has repeatable component (tags)', () => {
    expect(content).toContain('tags: nullish(array(SharedTagSchema))');
  });

  it('has oneToMany relation (variants)', () => {
    expect(content).toContain("variants: nullish(array(ref('ProductVariant')))");
  });

  it('has oneToOne relation via registry ref (relatedProduct)', () => {
    expect(content).toContain("relatedProduct: nullish(ref('Product'))");
  });

  it('has manyToOne relation via registry ref (category)', () => {
    expect(content).toContain("category: nullish(ref('Category'))");
  });
});

describe('page schema (dynamiczone with 7 components incl. dual-use tag)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/page.ts');
  });

  it('has dynamiczone with all member schemas', () => {
    expect(content).toContain('modules:');
    expect(content).toContain('ModulesHeroSectionSchema');
    expect(content).toContain('ModulesFaqSectionSchema');
    expect(content).toContain('ModulesContentBlockSchema');
    expect(content).toContain('ModulesProductGridSchema');
    expect(content).toContain('ModulesImageSectionSchema');
    expect(content).toContain('ModulesReviewSectionSchema');
    expect(content).toContain('SharedTagSchema');
  });

  it('has boolean field', () => {
    expect(content).toContain('removeFooterLinks: nullish(boolean())');
  });

  it('has optional seo component', () => {
    expect(content).toContain('seo: nullish(SharedSeoSchema)');
  });
});

describe('product-variant schema', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/product-variant.ts');
  });

  it('exports ProductVariantSchema', () => {
    expect(content).toContain('export const ProductVariantSchema = object({');
  });

  it('reuses same dynamic zone components as product', () => {
    expect(content).toContain('CatalogOneTimeOptionSchema');
    expect(content).toContain('CatalogSubscriptionOptionSchema');
  });

  it('has manyToOne relation to product', () => {
    expect(content).toContain("product: nullish(ref('Product'))");
  });

  it('has manyToMany relation to pages', () => {
    expect(content).toContain("pages: nullish(array(ref('Page')))");
  });
});

describe('author schema (email type)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/author.ts');
  });

  it('has email field as string', () => {
    expect(content).toContain('email: string()');
  });

  it('has oneToMany relation (articles)', () => {
    expect(content).toContain("articles: nullish(array(ref('Article')))");
  });

  it('has optional media (avatar)', () => {
    expect(content).toContain('avatar: nullish(UploadFileSchema)');
  });
});

describe('header schema (singleType)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/header.ts');
  });

  it('exports HeaderSchema', () => {
    expect(content).toContain('export const HeaderSchema = object({');
  });

  it('has repeatable component (links)', () => {
    expect(content).toContain('links: nullish(array(NavigationLinkSchema))');
  });

  it('has dynamiczone (dropdowns)', () => {
    expect(content).toContain('dropdowns:');
    expect(content).toContain('NavigationDropdownSchema');
  });
});

describe('footer schema (singleType, multiple richtext)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/footer.ts');
  });

  it('exports FooterSchema', () => {
    expect(content).toContain('export const FooterSchema = object({');
  });

  it('has multiple richtext fields with override', () => {
    expect(content).toContain('subtitle: nullish(RenderedHtmlSchema)');
    expect(content).toContain('bottomText: nullish(RenderedHtmlSchema)');
    expect(content).toContain('copyrightNotice: nullish(RenderedHtmlSchema)');
  });

  it('has required media', () => {
    expect(content).toContain('paymentMethodsImage: UploadFileSchema');
  });

  it('has two repeatable components', () => {
    expect(content).toContain('links: nullish(array(NavigationLinkSchema))');
    expect(content).toContain('iconLinks: nullish(array(NavigationIconLinkSchema))');
  });

  it('has dynamiczone (sections)', () => {
    expect(content).toContain('NavigationFooterSectionSchema');
  });
});
