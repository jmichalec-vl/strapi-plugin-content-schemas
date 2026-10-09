import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { GENERATED_DIR } from './helpers/generated-dir';

const readGenerated = (relPath: string): string =>
  fs.readFileSync(path.join(GENERATED_DIR, relPath), 'utf-8');

describe('client/strapi-client.ts', () => {
  let content: string;

  it('exists', () => {
    expect(fs.existsSync(path.join(GENERATED_DIR, 'client', 'strapi-client.ts'))).toBe(true);
    content = readGenerated('client/strapi-client.ts');
  });

  it('imports schemas for all content types', () => {
    expect(content).toContain('ArticleSchema');
    expect(content).toContain('ProductSchema');
    expect(content).toContain('PageSchema');
    expect(content).toContain('ProductVariantSchema');
    expect(content).toContain('CategorySchema');
    expect(content).toContain('AuthorSchema');
    expect(content).toContain('HeaderSchema');
    expect(content).toContain('FooterSchema');
  });

  it('has findMany/findOne for collection types', () => {
    expect(content).toContain('articles:');
    expect(content).toContain('products:');
    expect(content).toContain('findMany:');
    expect(content).toContain('findOne:');
  });

  it('has find for singleTypes under singular accessors', () => {
    expect(content).toContain('readonly header: {');
    expect(content).not.toContain('readonly headers: {');
    expect(content).toContain('readonly footer: {');
    expect(content).toContain('find:');
  });

  it('uses array wrapper for findMany', () => {
    expect(content).toContain('array(ArticleSchema)');
  });

  it('uses the generated serializer for query params', () => {
    expect(content).toContain('serializeQuery({');
    expect(content).not.toContain("from 'qs'");
  });

  it('exports StrapiClient interface and factory', () => {
    expect(content).toContain('export interface StrapiClient');
    expect(content).toContain('export const createStrapiClient');
  });

  it('has the views group with typed methods and the request error class', () => {
    expect(content).toContain('readonly views: {');
    expect(content).toContain('articleView:');
    expect(content).toContain('productView:');
    expect(content).toContain("import { StrapiRequestError } from './request-error'");
    expect(fs.existsSync(path.join(GENERATED_DIR, 'client', 'request-error.ts'))).toBe(true);
  });

  it('is read-only - no write methods or input types are generated', () => {
    expect(content).not.toContain('create:');
    expect(content).not.toContain('delete:');
    expect(content).not.toContain('CreateInput');
    expect(fs.existsSync(path.join(GENERATED_DIR, 'shared', 'write-inputs.ts'))).toBe(false);
  });
});

describe('client/schema-validation-error.ts', () => {
  let content: string;

  it('exists', () => {
    expect(fs.existsSync(path.join(GENERATED_DIR, 'client', 'schema-validation-error.ts'))).toBe(
      true,
    );
    content = readGenerated('client/schema-validation-error.ts');
  });

  it('exports StrapiSchemaValidationError', () => {
    expect(content).toContain('export class StrapiSchemaValidationError extends Error');
  });

  it('has IDENTIFIER_FIELDS with documentId', () => {
    expect(content).toContain('documentId');
  });
});
