import { describe, it, expect } from 'vitest';

import {
  collectReferencedComponents,
  topologicalSort,
} from '../../../../server/src/generators/dependency-graph';
import type { ComponentIR, ContentTypeIR } from '../../../../server/src/types';

const makeComponent = (uid: string, attrs: ComponentIR['attributes'] = []): ComponentIR => ({
  uid,
  category: uid.split('.')[0] ?? uid,
  displayName: uid.split('.')[1] ?? uid,
  attributes: attrs,
});

const makeContentType = (uid: string, attrs: ContentTypeIR['attributes'] = []): ContentTypeIR => ({
  uid,
  singularName: uid.split('.').pop()!,
  pluralName: `${uid.split('.').pop()!}s`,
  displayName: uid.split('.').pop()!,
  kind: 'collectionType',
  attributes: attrs,
});

describe('collectReferencedComponents', () => {
  it('collects direct component references from content types', () => {
    const ct = makeContentType('api::page.page', [
      { name: 'seo', type: 'component', required: false, componentUID: 'shared.seo' },
    ]);
    const components = {
      'shared.seo': makeComponent('shared.seo'),
    };

    const result = collectReferencedComponents([ct], components);
    expect(result).toContain('shared.seo');
  });

  it('collects dynamiczone component references', () => {
    const ct = makeContentType('api::page.page', [
      {
        name: 'modules',
        type: 'dynamiczone',
        required: false,
        componentUIDs: ['hero.hero-section', 'faq.faq'],
      },
    ]);
    const components = {
      'hero.hero-section': makeComponent('hero.hero-section'),
      'faq.faq': makeComponent('faq.faq'),
    };

    const result = collectReferencedComponents([ct], components);
    expect(result).toContain('hero.hero-section');
    expect(result).toContain('faq.faq');
  });

  it('collects nested component references transitively', () => {
    const ct = makeContentType('api::page.page', [
      { name: 'hero', type: 'component', required: false, componentUID: 'hero.hero-section' },
    ]);
    const components = {
      'hero.hero-section': makeComponent('hero.hero-section', [
        {
          name: 'buttons',
          type: 'component',
          required: false,
          componentUID: 'hero.buttons',
          repeatable: true,
        },
      ]),
      'hero.buttons': makeComponent('hero.buttons', [
        { name: 'label', type: 'string', required: true },
      ]),
    };

    const result = collectReferencedComponents([ct], components);
    expect(result).toContain('hero.hero-section');
    expect(result).toContain('hero.buttons');
  });

  it('does not include unreferenced components', () => {
    const ct = makeContentType('api::page.page', [
      { name: 'title', type: 'string', required: true },
    ]);
    const components = {
      'shared.seo': makeComponent('shared.seo'),
    };

    const result = collectReferencedComponents([ct], components);
    expect(result.size).toBe(0);
  });
});

describe('topologicalSort', () => {
  it('sorts leaf components before parents', () => {
    const buttons = makeComponent('hero.buttons', [
      { name: 'label', type: 'string', required: true },
    ]);
    const hero = makeComponent('hero.hero-section', [
      {
        name: 'buttons',
        type: 'component',
        required: false,
        componentUID: 'hero.buttons',
        repeatable: true,
      },
    ]);

    const sorted = topologicalSort([hero, buttons]);
    const uids = sorted.map((c) => c.uid);

    expect(uids.indexOf('hero.buttons')).toBeLessThan(uids.indexOf('hero.hero-section'));
  });

  it('handles components with no dependencies', () => {
    const a = makeComponent('a.a', [{ name: 'x', type: 'string', required: true }]);
    const b = makeComponent('b.b', [{ name: 'y', type: 'string', required: true }]);

    const sorted = topologicalSort([a, b]);
    expect(sorted).toHaveLength(2);
  });

  it('handles deep dependency chains', () => {
    const c = makeComponent('c.c', [{ name: 'x', type: 'string', required: true }]);
    const b = makeComponent('b.b', [
      { name: 'ref', type: 'component', required: false, componentUID: 'c.c' },
    ]);
    const a = makeComponent('a.a', [
      { name: 'ref', type: 'component', required: false, componentUID: 'b.b' },
    ]);

    const sorted = topologicalSort([a, b, c]);
    const uids = sorted.map((comp) => comp.uid);

    expect(uids.indexOf('c.c')).toBeLessThan(uids.indexOf('b.b'));
    expect(uids.indexOf('b.b')).toBeLessThan(uids.indexOf('a.a'));
  });
});
