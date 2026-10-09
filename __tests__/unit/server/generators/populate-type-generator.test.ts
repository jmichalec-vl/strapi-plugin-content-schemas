import { describe, it, expect } from 'vitest';

import {
  generateContentTypePopulateType,
  generateComponentPopulateType,
} from '../../../../server/src/generators/populate-type-generator';
import { buildSchemaRegistry } from '../../../../server/src/generators/schema-registry';
import type { ContentTypeIR, ComponentIR } from '../../../../server/src/types';
import type { ComponentRegistry } from '../../../../server/src/generators/populate-generator';

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

describe('generateContentTypePopulateType', () => {
  it('returns null for content type with only scalar fields', () => {
    const ct = makeCt('tag', [{ name: 'name', type: 'string', required: true }]);
    const result = generateContentTypePopulateType(ct, {}, buildSchemaRegistry([ct], []));

    expect(result).toBeNull();
  });

  it('generates populate type for media fields', () => {
    const ct = makeCt('article', [
      { name: 'image', type: 'media', required: true, mediaMultiple: false },
    ]);
    const result = generateContentTypePopulateType(ct, {}, buildSchemaRegistry([ct], []));

    expect(result).toContain('export interface ArticlePopulateInput');
    expect(result).toContain('readonly image?: true;');
  });

  it('generates populate type for relation with target populate type', () => {
    const ct = makeCt('article', [
      {
        name: 'author',
        type: 'relation',
        required: false,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      },
    ]);
    const authorCt = makeCt('author', [
      { name: 'avatar', type: 'media', required: false, mediaMultiple: false },
    ]);
    const registry = buildSchemaRegistry([ct, authorCt], []);
    const result = generateContentTypePopulateType(
      ct,
      {},
      registry,
      new Set(['api::author.author']),
    );

    expect(result).toContain('readonly author?:');
    expect(result).toContain('AuthorPopulateInput');
    expect(result).toContain('keyof Author');
  });

  it('omits PopulateInput reference for scalar-only relation targets', () => {
    const ct = makeCt('article', [
      {
        name: 'notice',
        type: 'relation',
        required: false,
        relationKind: 'manyToOne',
        relationTarget: 'api::announcement.announcement',
      },
    ]);
    const announcementCt = makeCt('announcement', [
      { name: 'title', type: 'string', required: true },
    ]);
    const registry = buildSchemaRegistry([ct, announcementCt], []);
    const result = generateContentTypePopulateType(ct, {}, registry, new Set());

    expect(result).toContain('readonly notice?:');
    expect(result).toContain('keyof Announcement');
    expect(result).not.toContain('AnnouncementPopulateInput');
  });

  it('generates populate type for component with nested populate', () => {
    const seo = makeComp('shared.seo', [
      { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
    ]);
    const ct = makeCt('page', [
      {
        name: 'seo',
        type: 'component',
        required: false,
        componentUID: 'shared.seo',
        repeatable: false,
      },
    ]);
    const registry = buildSchemaRegistry([ct], [seo]);
    const compRegistry: ComponentRegistry = { 'shared.seo': seo };

    const result = generateContentTypePopulateType(ct, compRegistry, registry);

    expect(result).toContain('readonly seo?:');
    expect(result).toContain('SharedSeoPopulateInput');
  });

  it('generates populate type for dynamic zone with on syntax', () => {
    const hero = makeComp('modules.hero', [
      { name: 'image', type: 'media', required: true, mediaMultiple: false },
    ]);
    const ct = makeCt('page', [
      { name: 'modules', type: 'dynamiczone', required: true, componentUIDs: ['modules.hero'] },
    ]);
    const registry = buildSchemaRegistry([ct], [hero]);
    const compRegistry: ComponentRegistry = { 'modules.hero': hero };

    const result = generateContentTypePopulateType(ct, compRegistry, registry);

    expect(result).toContain('readonly on?:');
    expect(result).toContain("'modules.hero'");
  });
});

describe('generateComponentPopulateType', () => {
  it('returns null for component with only scalar fields', () => {
    const comp = makeComp('shared.link', [
      { name: 'label', type: 'string', required: true },
      { name: 'url', type: 'string', required: true },
    ]);
    const result = generateComponentPopulateType(comp, {});

    expect(result).toBeNull();
  });

  it('generates populate type for component with media', () => {
    const comp = makeComp('shared.seo', [
      { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
    ]);
    const result = generateComponentPopulateType(comp, {});

    expect(result).toContain('export interface SharedSeoPopulateInput');
    expect(result).toContain('readonly metaImage?: true;');
  });

  it('includes fields option with keyof for nested components', () => {
    const nested = makeComp('shared.meta-social', [
      { name: 'image', type: 'media', required: false, mediaMultiple: false },
    ]);
    const comp = makeComp('shared.seo', [
      {
        name: 'metaSocial',
        type: 'component',
        required: false,
        componentUID: 'shared.meta-social',
        repeatable: true,
      },
    ]);
    const compRegistry: ComponentRegistry = { 'shared.seo': comp, 'shared.meta-social': nested };

    const result = generateComponentPopulateType(comp, compRegistry);

    expect(result).toContain('keyof SharedMetaSocial');
    expect(result).toContain('SharedMetaSocialPopulateInput');
  });
});
