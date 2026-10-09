import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { GENERATED_DIR } from './helpers/generated-dir';

const readGenerated = (relPath: string): string =>
  fs.readFileSync(path.join(GENERATED_DIR, relPath), 'utf-8');

const fileExists = (relPath: string): boolean => fs.existsSync(path.join(GENERATED_DIR, relPath));

describe('shared components', () => {
  it('shared.seo has nested meta-social component', () => {
    const content = readGenerated('components/shared/seo.ts');
    expect(content).not.toContain('__component');
    expect(content).toContain('id: number()');
    expect(content).toContain('metaTitle: string()');
    expect(content).toContain('metaDescription: string()');
    expect(content).toContain('metaImage: UploadFileSchema');
    expect(content).toContain('excludeFromSitemap: boolean()');
    expect(content).toContain('structuredData: nullish(unknown())');
    expect(content).toContain('metaSocial: nullish(array(SharedMetaSocialSchema))');
  });

  it('shared.meta-social has enumeration', () => {
    const content = readGenerated('components/shared/meta-social.ts');
    expect(content).not.toContain('__component');
    expect(content).toContain("picklist(['Facebook', 'Twitter'])");
    expect(content).toContain('image: nullish(UploadFileSchema)');
  });

  it('meta-social enum emits a const object named via the enumName hint', () => {
    const content = readGenerated('components/shared/meta-social.ts');
    expect(content).toContain('export const SocialNetwork = {');
    expect(content).toContain("Facebook: 'Facebook',");
    expect(content).toContain('readonly socialNetwork: SocialNetwork;');
  });

  it('shared.tag is dual-use: nullish __component discriminator', () => {
    // In the page DZ (needs __component) AND nested in product/promo-tile
    // (Strapi omits __component there) - so the literal must be nullish
    const content = readGenerated('components/shared/tag.ts');
    expect(content).toContain("__component: nullish(literal('shared.tag'))");
    expect(content).toContain('name: string()');
    expect(content).toContain('color: nullish(string())');
  });
});

describe('catalog components', () => {
  it('one-time-option has nested associated-variant', () => {
    const content = readGenerated('components/catalog/one-time-option.ts');
    expect(content).toContain("__component: literal('catalog.one-time-option')");
    expect(content).toContain('price: number()');
    expect(content).toContain("picklist(['shipped', 'local pickup', 'virtual'])");
    expect(content).toContain('associatedVariants: nullish(array(CatalogAssociatedVariantSchema))');
  });

  it('subscription-option has integer fields', () => {
    const content = readGenerated('components/catalog/subscription-option.ts');
    expect(content).toContain("__component: literal('catalog.subscription-option')");
    expect(content).toContain('intervalDays: number()');
    expect(content).toContain('initialDelayDays: number()');
  });

  it('associated-variant has relation to content type', () => {
    const content = readGenerated('components/catalog/associated-variant.ts');
    expect(content).not.toContain('__component');
    expect(content).toContain("variant: nullish(ref('ProductVariant'))");
  });

  it('marketing-metadata has large enumeration (14 values)', () => {
    const content = readGenerated('components/catalog/marketing-metadata.ts');
    expect(content).toContain('skincare');
    expect(content).toContain('gift_card');
  });
});

describe('module components', () => {
  it('hero-section has richtext, media, enum, nested button', () => {
    const content = readGenerated('components/modules/hero-section.ts');
    expect(content).toContain("__component: literal('modules.hero-section')");
    expect(content).toContain('image: UploadFileSchema');
    expect(content).toContain('mobileImage: nullish(UploadFileSchema)');
    expect(content).toContain("picklist(['left', 'center'])");
    expect(content).toContain('buttons: nullish(array(ModulesButtonSchema))');
  });

  it('faq-item self-references (circular ref handled)', () => {
    const content = readGenerated('components/modules/faq-item.ts');
    expect(content).not.toContain('__component');
    expect(content).toContain('question: string()');
    expect(content).toContain('nestedItems:');
  });

  it('product-grid has relation to content type', () => {
    const content = readGenerated('components/modules/product-grid.ts');
    expect(content).toContain("products: nullish(array(ref('Product')))");
    expect(content).toContain('promoTiles: nullish(array(ModulesPromoTileSchema))');
  });

  it('promo-tile nests a cross-category component with correct imports', () => {
    const content = readGenerated('components/modules/promo-tile.ts');
    expect(content).toContain('badge: nullish(SharedTagSchema)');
    expect(content).toContain("from '../shared/tag'");
    expect(content).not.toContain("from './tag'");
  });

  it('review-section has relation to content type', () => {
    const content = readGenerated('components/modules/review-section.ts');
    expect(content).toContain("products: nullish(array(ref('Product')))");
    expect(content).toContain("picklist(['company_reviews', 'product_reviews'])");
  });
});

describe('navigation components (3-level nesting)', () => {
  it('navigation.link has enum', () => {
    const content = readGenerated('components/navigation/link.ts');
    expect(content).not.toContain('__component');
    expect(content).toContain("picklist(['profile', 'notepad', 'gear'])");
  });

  it('dropdown has nested dropdown-section', () => {
    const content = readGenerated('components/navigation/dropdown.ts');
    expect(content).toContain('sections: nullish(array(NavigationDropdownSectionSchema))');
  });

  it('dropdown-section has nested link (3rd level)', () => {
    const content = readGenerated('components/navigation/dropdown-section.ts');
    expect(content).toContain('links: nullish(array(NavigationLinkSchema))');
    expect(content).toContain('image: nullish(UploadFileSchema)');
  });

  it('footer-section has richtext and nested links', () => {
    const content = readGenerated('components/navigation/footer-section.ts');
    expect(content).toContain('isContent: boolean()');
    expect(content).toContain('links: nullish(array(NavigationLinkSchema))');
  });

  it('icon-link has required media', () => {
    const content = readGenerated('components/navigation/icon-link.ts');
    expect(content).toContain('iconImage: UploadFileSchema');
  });
});

describe('component file structure', () => {
  const expectedComponents = [
    'components/shared/seo.ts',
    'components/shared/meta-social.ts',
    'components/shared/tag.ts',
    'components/catalog/one-time-option.ts',
    'components/catalog/subscription-option.ts',
    'components/catalog/associated-variant.ts',
    'components/catalog/marketing-metadata.ts',
    'components/catalog/operations-metadata.ts',
    'components/modules/hero-section.ts',
    'components/modules/faq-section.ts',
    'components/modules/faq-item.ts',
    'components/modules/content-block.ts',
    'components/modules/product-grid.ts',
    'components/modules/promo-tile.ts',
    'components/modules/image-section.ts',
    'components/modules/review-section.ts',
    'components/modules/button.ts',
    'components/navigation/link.ts',
    'components/navigation/icon-link.ts',
    'components/navigation/dropdown.ts',
    'components/navigation/dropdown-section.ts',
    'components/navigation/footer-section.ts',
  ];

  it.each(expectedComponents)('generates %s', (file) => {
    expect(fileExists(file)).toBe(true);
  });
});
