import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { ZOD_DIR } from '../helpers/generated-dir';

const read = (relPath: string): string => fs.readFileSync(path.join(ZOD_DIR, relPath), 'utf-8');

describe('zod schema syntax', () => {
  it('imports from zod', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain("from 'zod'");
  });

  it('uses z.object() wrapper', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('= z.object({');
  });

  it('uses z.string() for string fields', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('title: z.string(),');
  });

  it('uses .nullish() for optional fields', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('z.string().nullish()');
  });

  it('uses z.enum() for enums', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('z.enum([');
  });

  it('uses z.array() for media multiple', () => {
    const content = read('content-types/product.ts');
    expect(content).toContain('z.array(UploadFileSchema)');
  });

  it('uses z.discriminatedUnion() for dynamic zones', () => {
    const content = read('content-types/product.ts');
    expect(content).toContain("z.discriminatedUnion('__component', [");
  });

  it('falls back to z.union() for dynamic zones containing dual-use components', () => {
    // shared.tag is in the page DZ AND nested (product.tags, promo-tile.badge),
    // so its __component is nullish and discriminatedUnion cannot key on it
    // prettier may split the call across lines - match the union call alone
    const content = read('content-types/page.ts');
    expect(content).toContain('z.union([');
    expect(content).not.toContain('z.discriminatedUnion(');
  });

  it('uses ref() for relations (same as valibot)', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain("ref('Category')");
  });

  it('uses z.literal() for __component', () => {
    const content = read('components/modules/hero-section.ts');
    expect(content).toContain("z.literal('modules.hero-section')");
  });

  it('uses z.number() for id field', () => {
    const content = read('components/shared/seo.ts');
    expect(content).toContain('id: z.number(),');
  });
});

describe('zod override syntax', () => {
  it('uses z.infer for type extraction', () => {
    const content = read('shared/overrides.ts');
    expect(content).toContain('z.infer<typeof RenderedHtmlSchema>');
  });

  it('uses zod import for overrides', () => {
    const content = read('shared/overrides.ts');
    expect(content).toContain("from 'zod'");
  });

  it('uses zod syntax in override schema', () => {
    const content = read('shared/overrides.ts');
    expect(content).toContain('html: z.string()');
  });
});

describe('zod upload file schema', () => {
  it('uses z.infer for UploadFile type', () => {
    const content = read('shared/upload-file.ts');
    expect(content).toContain('z.infer<typeof UploadFileSchema>');
  });

  it('uses z.object() syntax', () => {
    const content = read('shared/upload-file.ts');
    expect(content).toContain('= z.object({');
  });
});

describe('zod registry', () => {
  it('uses z.lazy from zod', () => {
    const content = read('content-types/registry.ts');
    expect(content).toContain("import { z } from 'zod'");
    expect(content).toContain('z.lazy(');
  });
});

describe('zod generates same interfaces as valibot', () => {
  it('generates same Article interface', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('export interface Article {');
    expect(content).toContain('readonly documentId: string;');
    expect(content).toContain('readonly title: string;');
  });

  it('generates same populate types', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('export interface ArticlePopulateInput {');
  });

  it('generates same JSDoc comments', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('/** @unique */');
    expect(content).toContain('/** Media (images) */');
    expect(content).toContain('/** @default "draft" */');
  });

  it('generates same populate constants', () => {
    const content = read('content-types/article.ts');
    expect(content).toContain('export const articlePopulate');
  });
});
