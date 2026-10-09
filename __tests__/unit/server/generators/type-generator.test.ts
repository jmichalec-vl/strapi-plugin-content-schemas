import { describe, it, expect } from 'vitest';

import {
  generateContentTypeInterface,
  generateComponentInterface,
} from '../../../../server/src/generators/type-generator';
import { buildSchemaRegistry } from '../../../../server/src/generators/schema-registry';
import type { ContentTypeIR, ComponentIR } from '../../../../server/src/types';

const EMPTY_REGISTRY = buildSchemaRegistry([], []);

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

describe('generateContentTypeInterface', () => {
  it('generates interface with PascalCase name', () => {
    const ct = makeCt('article', [{ name: 'title', type: 'string', required: true }]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY);

    expect(result).toContain('export interface Article {');
    expect(result).toContain('readonly title: string;');
  });

  it.each([
    { type: 'string', expected: 'string' },
    { type: 'text', expected: 'string' },
    { type: 'boolean', expected: 'boolean' },
    { type: 'integer', expected: 'number' },
    { type: 'decimal', expected: 'number' },
    { type: 'json', expected: 'unknown' },
  ])('maps $type to $expected', ({ type, expected }) => {
    const ct = makeCt('test', [
      { name: 'field', type: type as ContentTypeIR['attributes'][0]['type'], required: true },
    ]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY);

    expect(result).toContain(`readonly field: ${expected};`);
  });

  it('marks optional fields as nullable', () => {
    const ct = makeCt('test', [{ name: 'bio', type: 'text', required: false }]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY);

    expect(result).toContain('readonly bio?: string | null;');
  });

  it('marks relation fields as optional (may not be populated)', () => {
    const authorCt = makeCt('author', [{ name: 'name', type: 'string', required: true }]);
    const ct = makeCt('article', [
      {
        name: 'author',
        type: 'relation',
        required: false,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      },
    ]);
    const registry = buildSchemaRegistry([ct, authorCt], []);
    const result = generateContentTypeInterface(ct, registry);

    expect(result).toContain('readonly author?: Author | null;');
  });

  it('types morph to-many relations as arrays', () => {
    const ct = makeCt('article', [
      {
        name: 'related',
        type: 'relation',
        required: false,
        relationKind: 'morphToMany',
        relationTarget: 'api::author.author',
      },
    ]);
    const registry = buildSchemaRegistry([makeCt('author', [])], []);
    const result = generateContentTypeInterface(ct, registry);

    expect(result).toMatch(/readonly related\?: (readonly )?Author\[\] \| null;/);
  });

  it('maps media to UploadFile', () => {
    const ct = makeCt('test', [
      { name: 'image', type: 'media', required: true, mediaMultiple: false },
      { name: 'gallery', type: 'media', required: false, mediaMultiple: true },
    ]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY);

    expect(result).toContain('readonly image: UploadFile;');
    expect(result).toContain('readonly gallery?: UploadFile[] | null;');
  });

  it('maps enumeration to union of literals', () => {
    const ct = makeCt('test', [
      { name: 'status', type: 'enumeration', required: true, enumValues: ['draft', 'published'] },
    ]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY);

    expect(result).toContain("readonly status: 'draft' | 'published';");
  });
});

describe('generateContentTypeInterface with JSDoc', () => {
  it('adds JSDoc for relation fields', () => {
    const ct = makeCt('article', [
      {
        name: 'author',
        type: 'relation',
        required: false,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      },
    ]);
    const registry = buildSchemaRegistry([ct], []);
    const result = generateContentTypeInterface(ct, registry, undefined, true);

    expect(result).toContain('/** Relation: manyToOne → api::author.author */');
  });

  it('adds JSDoc for media fields', () => {
    const ct = makeCt('test', [
      {
        name: 'image',
        type: 'media',
        required: true,
        mediaMultiple: false,
        mediaAllowedTypes: ['images'],
      },
    ]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY, undefined, true);

    expect(result).toContain('/** Media (images) */');
  });

  it('adds JSDoc for unique fields', () => {
    const ct = makeCt('test', [{ name: 'slug', type: 'string', required: true, unique: true }]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY, undefined, true);

    expect(result).toContain('/** @unique */');
  });

  it('adds JSDoc for default values', () => {
    const ct = makeCt('test', [
      {
        name: 'status',
        type: 'enumeration',
        required: true,
        enumValues: ['draft'],
        defaultValue: 'draft',
      },
    ]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY, undefined, true);

    expect(result).toContain('/** @default "draft" */');
  });

  it('omits JSDoc when disabled', () => {
    const ct = makeCt('test', [{ name: 'slug', type: 'string', required: true, unique: true }]);
    const result = generateContentTypeInterface(ct, EMPTY_REGISTRY, undefined, false);

    expect(result).not.toContain('/**');
  });
});

describe('generateComponentInterface', () => {
  it('generates interface with id field', () => {
    const comp = makeComp('shared.seo', [{ name: 'title', type: 'string', required: true }]);
    const result = generateComponentInterface(comp, EMPTY_REGISTRY);

    expect(result).toContain('export interface SharedSeo {');
    expect(result).toContain('readonly id: number;');
    expect(result).toContain('readonly title: string;');
  });

  it('includes __component for dynamic-zone-only components', () => {
    const comp = makeComp('modules.hero', [{ name: 'title', type: 'string', required: true }]);
    const result = generateComponentInterface(comp, EMPTY_REGISTRY, undefined, {
      inDynamicZone: true,
      inComponent: false,
    });

    expect(result).toContain("readonly __component: 'modules.hero';");
  });

  it('makes __component optional when used in both contexts', () => {
    const comp = makeComp('modules.hero', [{ name: 'title', type: 'string', required: true }]);
    const result = generateComponentInterface(comp, EMPTY_REGISTRY, undefined, {
      inDynamicZone: true,
      inComponent: true,
    });

    expect(result).toContain("readonly __component?: 'modules.hero';");
  });

  it('omits __component for component-only usage', () => {
    const comp = makeComp('shared.seo', [{ name: 'title', type: 'string', required: true }]);
    const result = generateComponentInterface(comp, EMPTY_REGISTRY, undefined, {
      inDynamicZone: false,
      inComponent: true,
    });

    expect(result).not.toContain('__component');
  });
});
