import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { GENERATED_DIR } from './helpers/generated-dir';

const readGenerated = (relPath: string): string =>
  fs.readFileSync(path.join(GENERATED_DIR, relPath), 'utf-8');

describe('article populate (in content-types/article.ts)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/article.ts');
  });

  it('exports articlePopulate', () => {
    expect(content).toContain('export const articlePopulate');
  });

  it('populates media as true', () => {
    expect(content).toContain('image: true');
  });

  it('references seo component populate', () => {
    expect(content).toContain('seo: sharedSeoPopulate,');
  });

  it('excludes relations from populate', () => {
    expect(content).not.toContain('categories: true');
    expect(content).not.toContain('author: true');
  });
});

describe('product populate (multiple dynamic zones)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/product.ts');
  });

  it('exports productPopulate', () => {
    expect(content).toContain('export const productPopulate');
  });

  it('populates media fields', () => {
    expect(content).toContain('images: true');
    expect(content).toContain('thumbnail: true');
  });

  it('uses on: syntax for fulfillmentOptions dynamic zone', () => {
    expect(content).toContain('fulfillmentOptions:');
    expect(content).toContain('on:');
    expect(content).toContain("'catalog.one-time-option':");
    expect(content).toContain("'catalog.subscription-option':");
  });

  it('uses on: syntax for productMetadata dynamic zone', () => {
    expect(content).toContain('productMetadata:');
    expect(content).toContain("'catalog.marketing-metadata':");
    expect(content).toContain("'catalog.operations-metadata':");
  });

  it('excludes relations from populate', () => {
    expect(content).not.toContain('variants: true');
    expect(content).not.toContain('relatedProduct: true');
    expect(content).not.toContain('category: true');
  });
});

describe('page populate (6 module dynamic zone)', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('content-types/page.ts');
  });

  it('uses on: syntax for modules', () => {
    expect(content).toContain('modules:');
    expect(content).toContain('on:');
    expect(content).toContain("'modules.hero-section':");
    expect(content).toContain("'modules.faq-section':");
    expect(content).toContain("'modules.product-grid':");
  });

  it('populates seo component', () => {
    expect(content).toContain('seo:');
  });
});

describe('header populate (singleType)', () => {
  it('has populate in content type file', () => {
    const content = readGenerated('content-types/header.ts');
    expect(content).toContain('headerPopulate');
    expect(content).toContain('links: true');
    expect(content).toContain('dropdowns:');
  });
});

describe('footer populate (singleType)', () => {
  it('has populate in content type file', () => {
    const content = readGenerated('content-types/footer.ts');
    expect(content).toContain('footerPopulate');
    expect(content).toContain('paymentMethodsImage: true');
    expect(content).toContain('links: true');
    expect(content).toContain('iconLinks:');
    expect(content).toContain('sections:');
  });
});
