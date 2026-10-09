import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { GENERATED_DIR } from './helpers/generated-dir';

const readGenerated = (relPath: string): string =>
  fs.readFileSync(path.join(GENERATED_DIR, relPath), 'utf-8');

describe('JSDoc comments on content type interfaces', () => {
  it('article has JSDoc for unique field', () => {
    const content = readGenerated('content-types/article.ts');
    expect(content).toContain('/** @unique */\n  readonly slug:');
  });

  it('article has JSDoc for media field', () => {
    const content = readGenerated('content-types/article.ts');
    expect(content).toContain('/** Media (images) */\n  readonly image:');
  });

  it('article has JSDoc for enum default', () => {
    const content = readGenerated('content-types/article.ts');
    expect(content).toContain('/** @default "draft" */\n  readonly status:');
  });

  it('article has JSDoc for component field', () => {
    const content = readGenerated('content-types/article.ts');
    expect(content).toContain('/** Component: shared.seo */\n  readonly seo?:');
  });

  it('article has JSDoc for manyToMany relation', () => {
    const content = readGenerated('content-types/article.ts');
    expect(content).toContain('/** Relation: manyToMany → api::category.category */');
  });

  it('article has JSDoc for manyToOne relation', () => {
    const content = readGenerated('content-types/article.ts');
    expect(content).toContain('/** Relation: manyToOne → api::author.author */');
  });
});

describe('JSDoc comments on product (complex types)', () => {
  it('product has JSDoc for media multiple', () => {
    const content = readGenerated('content-types/product.ts');
    expect(content).toContain('/** Media (images) (multiple) */');
  });

  it('product has JSDoc for dynamic zone', () => {
    const content = readGenerated('content-types/product.ts');
    expect(content).toContain(
      '/** Dynamic zone: catalog.one-time-option | catalog.subscription-option */',
    );
  });

  it('product has JSDoc for repeatable component', () => {
    const content = readGenerated('content-types/product.ts');
    expect(content).toContain('/** Component: shared.tag (repeatable) */');
  });

  it('product has JSDoc for boolean default', () => {
    const content = readGenerated('content-types/product.ts');
    expect(content).toContain('/** @default true */');
  });

  it('product has JSDoc for integer default', () => {
    const content = readGenerated('content-types/product.ts');
    expect(content).toContain('/** @default 0 */');
  });
});

describe('JSDoc on component interfaces', () => {
  it('hero-section has JSDoc for media field', () => {
    const content = readGenerated('components/modules/hero-section.ts');
    expect(content).toContain('/** Media (images) */');
  });

  it('associated-variant has JSDoc for relation', () => {
    const content = readGenerated('components/catalog/associated-variant.ts');
    expect(content).toContain('/** Relation:');
  });
});

describe('no JSDoc on scalar fields without metadata', () => {
  it('article title has no JSDoc (plain string, no metadata)', () => {
    const content = readGenerated('content-types/article.ts');
    const lines = content.split('\n');
    const titleIdx = lines.findIndex((l) => l.includes('readonly title:'));
    const prevLine = lines[titleIdx - 1];
    expect(prevLine).not.toContain('/**');
  });
});
