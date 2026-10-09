import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { GENERATED_DIR } from './helpers/generated-dir';

const readGenerated = (relPath: string): string =>
  fs.readFileSync(path.join(GENERATED_DIR, relPath), 'utf-8');

describe('barrel index.ts', () => {
  let content: string;
  beforeAll(() => {
    content = readGenerated('index.ts');
  });

  it('re-exports all 8 content type schemas', () => {
    expect(content).toContain('ArticleSchema');
    expect(content).toContain('ProductSchema');
    expect(content).toContain('PageSchema');
    expect(content).toContain('ProductVariantSchema');
    expect(content).toContain('CategorySchema');
    expect(content).toContain('AuthorSchema');
    expect(content).toContain('HeaderSchema');
    expect(content).toContain('FooterSchema');
  });

  it('re-exports populate configs', () => {
    expect(content).toContain('articlePopulate');
    expect(content).toContain('productPopulate');
    expect(content).toContain('pagePopulate');
    expect(content).toContain('headerPopulate');
    expect(content).toContain('footerPopulate');
  });

  it('re-exports client', () => {
    expect(content).toContain('createStrapiClient');
    expect(content).toContain('StrapiClient');
    expect(content).toContain('StrapiSchemaValidationError');
  });

  it('re-exports content-type enum const objects', () => {
    expect(content).toContain('ArticleStatus');
  });
});

describe('generated directory structure', () => {
  it('has all expected directories', () => {
    const dirs = ['content-types', 'shared', 'components', 'client'];
    for (const dir of dirs) {
      expect(fs.existsSync(path.join(GENERATED_DIR, dir))).toBe(true);
    }
  });

  it('has all 9 content type files', () => {
    const expected = [
      'article',
      'product',
      'page',
      'product-variant',
      'category',
      'author',
      'header',
      'footer',
      'announcement',
    ];
    for (const name of expected) {
      expect(fs.existsSync(path.join(GENERATED_DIR, 'content-types', `${name}.ts`))).toBe(true);
    }
  });

  it('has component category directories', () => {
    const categories = ['shared', 'catalog', 'modules', 'navigation'];
    for (const cat of categories) {
      expect(fs.existsSync(path.join(GENERATED_DIR, 'components', cat))).toBe(true);
    }
  });
});
