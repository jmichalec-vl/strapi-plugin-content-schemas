import { describe, it, expect } from 'vitest';

import {
  generateContentTypeMock,
  generateComponentMock,
  generateUploadFileMock,
  generateMockBarrel,
  generateMockFiles,
} from '../../../../server/src/generators/mock-generator';
import { collectCycleUIDs } from '../../../../server/src/generators/dependency-graph';
import type { ComponentIR, ContentTypeIR } from '../../../../server/src/types';
import type { OverrideConfig } from '../../../../server/src/generators/override-resolver';

const ARTICLE: ContentTypeIR = {
  uid: 'api::article.article',
  singularName: 'article',
  pluralName: 'articles',
  displayName: 'Article',
  kind: 'collectionType',
  attributes: [
    { name: 'title', type: 'string', required: true },
    { name: 'views', type: 'biginteger', required: true },
    { name: 'body', type: 'richtext', required: true },
  ],
};

const SEO_COMPONENT: ComponentIR = {
  uid: 'shared.seo',
  category: 'shared',
  displayName: 'SEO',
  attributes: [
    { name: 'metaTitle', type: 'string', required: true },
    { name: 'metaImage', type: 'media', required: false, mediaMultiple: false },
  ],
};

const CUSTOM_OVERRIDES: OverrideConfig = {
  typeOverrides: {
    richtext: {
      schema: 'object({ html: string() })',
      name: 'RenderedHtmlSchema',
      typeName: 'RenderedHtml',
    },
  },
  fieldOverrides: {},
};

const NO_CYCLES: ReadonlySet<string> = new Set();

describe('generateContentTypeMock', () => {
  it('mocks biginteger as a string value', () => {
    const code = generateContentTypeMock(ARTICLE, {}, NO_CYCLES);
    expect(code).toContain('views: String(faker.number.int({ min: 0, max: 100000 }))');
  });

  it('emits a typed placeholder for overridden fields instead of a hardcoded RenderedHtml shape', () => {
    const code = generateContentTypeMock(ARTICLE, {}, NO_CYCLES, CUSTOM_OVERRIDES);

    expect(code).toContain('{} as unknown as RenderedHtml');
    // no hardcoded override shape fields - the placeholder stays empty
    expect(code).not.toContain('html:');
  });

  it('imports the override type from shared/overrides', () => {
    const code = generateContentTypeMock(ARTICLE, {}, NO_CYCLES, CUSTOM_OVERRIDES);

    expect(code).toContain("import type { RenderedHtml } from '../shared/overrides';");
  });
});

describe('generateComponentMock', () => {
  it('imports its interface from the real components directory', () => {
    const code = generateComponentMock(SEO_COMPONENT, {}, NO_CYCLES);

    expect(code).toContain("import type { SharedSeo } from '../../../components/shared/seo';");
  });

  it('imports mockUploadFile from the mocks root', () => {
    const code = generateComponentMock(SEO_COMPONENT, {}, NO_CYCLES);

    expect(code).toContain("import { mockUploadFile } from '../../upload-file.mock';");
  });

  it('emits __component for dynamic-zone components', () => {
    const code = generateComponentMock(SEO_COMPONENT, {}, NO_CYCLES, {
      inDynamicZone: true,
      inComponent: false,
    });

    expect(code).toContain("__component: 'shared.seo',");
  });

  it('omits __component for nested-only components', () => {
    const code = generateComponentMock(SEO_COMPONENT, {}, NO_CYCLES, {
      inDynamicZone: false,
      inComponent: true,
    });

    expect(code).not.toContain('__component');
  });

  it('breaks required self-references instead of recursing', () => {
    const selfRef: ComponentIR = {
      uid: 'modules.faq-item',
      category: 'modules',
      displayName: 'FAQ Item',
      attributes: [
        { name: 'question', type: 'string', required: true },
        {
          name: 'nested',
          type: 'component',
          required: true,
          componentUID: 'modules.faq-item',
        },
      ],
    };
    const code = generateComponentMock(selfRef, { 'modules.faq-item': selfRef }, NO_CYCLES);

    expect(code).not.toContain('mockModulesFaqItem()');
    expect(code).toContain('undefined as never');
  });

  it('breaks mutual cycles deterministically on one edge only', () => {
    const compA: ComponentIR = {
      uid: 'modules.aaa',
      category: 'modules',
      displayName: 'A',
      attributes: [{ name: 'b', type: 'component', required: false, componentUID: 'modules.bbb' }],
    };
    const compB: ComponentIR = {
      uid: 'modules.bbb',
      category: 'modules',
      displayName: 'B',
      attributes: [{ name: 'a', type: 'component', required: false, componentUID: 'modules.aaa' }],
    };
    const registry = { 'modules.aaa': compA, 'modules.bbb': compB };
    const cycles: ReadonlySet<string> = new Set(['modules.aaa', 'modules.bbb']);

    // Edge from the smaller UID survives; the back edge breaks
    const codeA = generateComponentMock(compA, registry, cycles);
    const codeB = generateComponentMock(compB, registry, cycles);

    expect(codeA).toContain('mockModulesBbb()');
    expect(codeB).not.toContain('mockModulesAaa()');
    expect(codeB).not.toContain('import { mockModulesAaa }');
  });
});

describe('generateUploadFileMock', () => {
  it('covers the extended UploadFile fields', () => {
    const code = generateUploadFileMock();

    for (const field of ['documentId', 'hash', 'previewUrl', 'provider', 'provider_metadata']) {
      expect(code).toContain(field);
    }
  });
});

describe('generateMockBarrel', () => {
  it('re-exports the upload-file factory, every content type and every component factory', () => {
    const barrel = generateMockBarrel([ARTICLE], [SEO_COMPONENT]);

    expect(barrel).toContain("export { mockUploadFile } from './upload-file.mock';");
    expect(barrel).toContain("export { mockArticle } from './article.mock';");
    expect(barrel).toContain("export { mockSharedSeo } from './components/shared/seo.mock';");
  });
});

describe('generateMockFiles', () => {
  it('emits one file per entity plus the upload-file mock and the barrel, content types sorted', () => {
    const zebra: ContentTypeIR = { ...ARTICLE, uid: 'api::zebra.zebra', singularName: 'zebra' };
    const files = generateMockFiles([zebra, ARTICLE], [SEO_COMPONENT]);

    expect([...files.keys()]).toEqual([
      'mocks/upload-file.mock.ts',
      'mocks/article.mock.ts',
      'mocks/zebra.mock.ts',
      'mocks/components/shared/seo.mock.ts',
      'mocks/index.ts',
    ]);
  });

  it('drops dynamic-zone members on broken cycle edges instead of recursing forever', () => {
    const alpha: ComponentIR = {
      uid: 'blocks.alpha',
      category: 'blocks',
      displayName: 'Alpha',
      attributes: [
        { name: 'children', type: 'dynamiczone', required: true, componentUIDs: ['blocks.zeta'] },
      ],
    };
    const zeta: ComponentIR = {
      uid: 'blocks.zeta',
      category: 'blocks',
      displayName: 'Zeta',
      attributes: [
        { name: 'parent', type: 'component', required: false, componentUID: 'blocks.alpha' },
      ],
    };
    const registry = { 'blocks.alpha': alpha, 'blocks.zeta': zeta };
    const cycles = collectCycleUIDs([alpha, zeta]);
    const usage = { inDynamicZone: false, inComponent: false };

    // The edge from the lexicographically larger uid (zeta) to the smaller
    // (alpha) breaks; alpha's zone still reaches zeta
    const alphaMock = generateComponentMock(alpha, registry, cycles, usage);
    const zetaMock = generateComponentMock(zeta, registry, cycles, usage);

    expect(alphaMock).toContain('mockBlocksZeta()');
    expect(zetaMock).not.toContain('mockBlocksAlpha');
    expect(zetaMock).not.toContain('import { mockBlocksAlpha }');
  });
});
