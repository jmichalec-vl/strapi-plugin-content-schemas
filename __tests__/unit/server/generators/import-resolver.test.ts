import { describe, it, expect } from 'vitest';

import { buildExternalImportStatements } from '../../../../server/src/generators/import-resolver';
import type { ExternalImport } from '../../../../server/src/generators/schema-registry';

describe('buildExternalImportStatements', () => {
  it('resolves upload-file import from content-types dir', () => {
    const imports: ExternalImport[] = [
      { schemaVarName: 'UploadFileSchema', source: 'upload-file' },
    ];
    const result = buildExternalImportStatements(imports, 'content-types');

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("from '../shared/upload-file'");
    expect(result[0]).toContain('UploadFileSchema');
  });

  it('resolves component import from content-types dir', () => {
    const imports: ExternalImport[] = [
      { schemaVarName: 'SeoSchema', source: 'component', uid: 'shared.seo' },
    ];
    const result = buildExternalImportStatements(imports, 'content-types');

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("from '../components/shared/seo'");
  });

  it('resolves override import', () => {
    const imports: ExternalImport[] = [{ schemaVarName: 'RenderedHtmlSchema', source: 'override' }];
    const result = buildExternalImportStatements(imports, 'content-types');

    expect(result).toHaveLength(1);
    expect(result[0]).toContain("from '../shared/overrides'");
  });

  it('groups imports from the same path', () => {
    const imports: ExternalImport[] = [
      { schemaVarName: 'SeoSchema', source: 'component', uid: 'shared.seo' },
      { schemaVarName: 'MetaSocialSchema', source: 'component', uid: 'shared.meta-social' },
    ];
    const result = buildExternalImportStatements(imports, 'content-types');

    expect(result).toHaveLength(2);
  });

  it('resolves relative path from component dir to upload-file', () => {
    const imports: ExternalImport[] = [
      { schemaVarName: 'UploadFileSchema', source: 'upload-file' },
    ];
    const result = buildExternalImportStatements(imports, 'components/shared');

    expect(result[0]).toContain("from '../../shared/upload-file'");
  });

  it('returns empty array for no imports', () => {
    const result = buildExternalImportStatements([], 'content-types');
    expect(result).toEqual([]);
  });
});
