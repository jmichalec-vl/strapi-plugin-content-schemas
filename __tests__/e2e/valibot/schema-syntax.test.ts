import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { VALIBOT_DIR } from '../helpers/generated-dir';

const read = (relPath: string): string => fs.readFileSync(path.join(VALIBOT_DIR, relPath), 'utf-8');

describe('valibot schema syntax', () => {
  it('imports from valibot', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain("from 'valibot'");
  });

  it('uses object() wrapper', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('= object({');
  });

  it('uses string() for string fields', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('title: string(),');
  });

  it('uses nullish() for optional fields', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('nullish(string())');
  });

  it('uses picklist() for enums', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('picklist([');
  });

  it('uses array() for media multiple', () => {
    const content = read('content-types/product.ts');
    expect(content).toContain('array(UploadFileSchema)');
  });

  it('uses variant() discriminated unions for dynamic zones', () => {
    const content = read('content-types/product.ts');
    expect(content).toContain("variant('__component', [");
  });

  it('falls back to union() for dynamic zones containing dual-use components', () => {
    // shared.tag is in the page DZ AND nested (product.tags, promo-tile.badge),
    // so its __component is nullish and variant() cannot discriminate on it
    // prettier may split the call across lines - match the union call alone
    const content = read('content-types/page.ts');
    expect(content).toContain('union([');
    expect(content).not.toContain('variant(');
  });

  it('uses ref() for relations', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain("ref('Category')");
  });

  it('uses literal() for __component', () => {
    const content = read('components/modules/hero-section.ts');
    expect(content).toContain("literal('modules.hero-section')");
  });

  it('uses number() for id field', () => {
    const content = read('components/shared/seo.ts');
    expect(content).toContain('id: number(),');
  });
});

describe('valibot override syntax', () => {
  it('uses InferInput for type extraction', () => {
    const content = read('shared/overrides.ts');
    expect(content).toContain('InferInput<typeof RenderedHtmlSchema>');
  });

  it('uses valibot import for overrides', () => {
    const content = read('shared/overrides.ts');
    expect(content).toContain("from 'valibot'");
  });

  it('uses valibot syntax in override schema', () => {
    const content = read('shared/overrides.ts');
    expect(content).toContain('html: string()');
  });
});

describe('valibot upload file schema', () => {
  it('uses InferInput for UploadFile type', () => {
    const content = read('shared/upload-file.ts');
    expect(content).toContain('InferInput<typeof UploadFileSchema>');
  });

  it('uses valibot object() syntax', () => {
    const content = read('shared/upload-file.ts');
    expect(content).toContain('= object({');
  });
});

describe('valibot registry', () => {
  it('uses lazy from valibot', () => {
    const content = read('content-types/registry.ts');
    expect(content).toContain("import { lazy } from 'valibot'");
  });
});
