import { describe, it, expect } from 'vitest';

import {
  generatePopulateCode,
  type ComponentRegistry,
} from '../../../../server/src/generators/populate-generator';
import type { ComponentIR, ContentTypeIR } from '../../../../server/src/types';

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

describe('generatePopulateCode', () => {
  it('returns null for content type with only scalar fields', () => {
    const ct = makeCt('tag', [
      { name: 'name', type: 'string', required: true },
      { name: 'slug', type: 'uid', required: true },
    ]);

    expect(generatePopulateCode(ct, {})).toBeNull();
  });

  it('generates populate for media fields', () => {
    const ct = makeCt('article', [
      { name: 'title', type: 'string', required: true },
      { name: 'coverImage', type: 'media', required: false, mediaMultiple: false },
      { name: 'gallery', type: 'media', required: false, mediaMultiple: true },
    ]);

    const code = generatePopulateCode(ct, {});
    expect(code).toContain('export const articlePopulate');
    expect(code).toContain('coverImage: true');
    expect(code).toContain('gallery: true');
  });

  it('does not populate relation fields (relations are shallow)', () => {
    const ct = makeCt('article', [
      {
        name: 'author',
        type: 'relation',
        required: false,
        relationKind: 'manyToOne',
        relationTarget: 'api::author.author',
      },
    ]);

    const code = generatePopulateCode(ct, {});
    expect(code).toBeNull();
  });

  it('generates populate for component with nested populatable fields', () => {
    const registry: ComponentRegistry = {
      'shared.seo': makeComp('shared.seo', [
        { name: 'metaTitle', type: 'string', required: true },
        { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
      ]),
    };

    const ct = makeCt('page', [
      {
        name: 'seo',
        type: 'component',
        required: false,
        componentUID: 'shared.seo',
        repeatable: false,
      },
    ]);

    const code = generatePopulateCode(ct, registry);
    expect(code).toContain('seo: sharedSeoPopulate,');
  });

  it('generates true for component with only scalar fields', () => {
    const registry: ComponentRegistry = {
      'shared.link': makeComp('shared.link', [
        { name: 'label', type: 'string', required: true },
        { name: 'url', type: 'string', required: true },
      ]),
    };

    const ct = makeCt('page', [
      {
        name: 'link',
        type: 'component',
        required: false,
        componentUID: 'shared.link',
        repeatable: false,
      },
    ]);

    const code = generatePopulateCode(ct, registry);
    expect(code).toContain('link: true');
  });

  it('generates on: syntax for dynamic zones', () => {
    const registry: ComponentRegistry = {
      'hero.hero-section': makeComp('hero.hero-section', [
        { name: 'image', type: 'media', required: true, mediaMultiple: false },
        { name: 'mobileImage', type: 'media', required: false, mediaMultiple: false },
      ]),
      'faq.faq': makeComp('faq.faq', [
        {
          name: 'faqItems',
          type: 'component',
          required: true,
          componentUID: 'faq.faq-item',
          repeatable: true,
        },
      ]),
      'faq.faq-item': makeComp('faq.faq-item', [
        { name: 'question', type: 'string', required: true },
        { name: 'answer', type: 'richtext', required: true },
      ]),
    };

    const ct = makeCt('page', [
      {
        name: 'modules',
        type: 'dynamiczone',
        required: true,
        componentUIDs: ['hero.hero-section', 'faq.faq'],
      },
    ]);

    const code = generatePopulateCode(ct, registry);
    expect(code).toContain('modules: {');
    expect(code).toContain('on: {');
    expect(code).toContain("'hero.hero-section': heroHeroSectionPopulate,");
    expect(code).toContain("'faq.faq': faqFaqPopulate,");
  });

  it('handles circular component references', () => {
    const registry: ComponentRegistry = {
      'tree.node': makeComp('tree.node', [
        { name: 'label', type: 'string', required: true },
        {
          name: 'children',
          type: 'component',
          required: false,
          componentUID: 'tree.node',
          repeatable: true,
        },
      ]),
    };

    const ct = makeCt('page', [
      {
        name: 'root',
        type: 'component',
        required: false,
        componentUID: 'tree.node',
        repeatable: false,
      },
    ]);

    const code = generatePopulateCode(ct, registry);
    expect(code).toBeDefined();
    expect(code).toContain('root: treeNodePopulate,');
  });

  it('handles unknown component UID gracefully', () => {
    const ct = makeCt('page', [
      {
        name: 'seo',
        type: 'component',
        required: false,
        componentUID: 'unknown.component',
        repeatable: false,
      },
    ]);

    const code = generatePopulateCode(ct, {});
    expect(code).toContain('seo: true');
  });

  it('uses camelCase variable name', () => {
    const ct = makeCt('product-page', [
      { name: 'image', type: 'media', required: false, mediaMultiple: false },
    ]);

    const code = generatePopulateCode(ct, {});
    expect(code).toContain('export const productPagePopulate');
  });

  it('generates complex nested populate', () => {
    const registry: ComponentRegistry = {
      'shared.seo': makeComp('shared.seo', [
        { name: 'metaTitle', type: 'string', required: true },
        { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
        {
          name: 'metaSocial',
          type: 'component',
          required: false,
          componentUID: 'shared.meta-social',
          repeatable: true,
        },
      ]),
      'shared.meta-social': makeComp('shared.meta-social', [
        {
          name: 'socialNetwork',
          type: 'enumeration',
          required: true,
          enumValues: ['facebook', 'twitter'],
        },
        { name: 'image', type: 'media', required: false, mediaMultiple: false },
      ]),
    };

    const ct = makeCt('article', [
      {
        name: 'seo',
        type: 'component',
        required: false,
        componentUID: 'shared.seo',
        repeatable: false,
      },
    ]);

    const code = generatePopulateCode(ct, registry);
    expect(code).toContain('seo: sharedSeoPopulate,');
  });
});
