import { UPLOAD_FILE_SCHEMA_NAME } from '../constants';
import type { ComponentIR, ContentTypeIR } from '../types';
import { toSchemaVarName, componentUidToSchemaVarName } from '../utils';

export interface SchemaRegistry {
  readonly components: ReadonlyMap<string, string>;
  readonly contentTypes: ReadonlyMap<string, string>;
  // Components used both inside a dynamic zone AND as a plain nested component;
  // their __component discriminator is nullish, so dynamic zones containing them
  // cannot use variant()/discriminatedUnion()
  readonly dualUseUIDs?: ReadonlySet<string>;
  // Components participating in a reference cycle; refs to them must be lazy()
  readonly cycleUIDs?: ReadonlySet<string>;
}

export interface ExternalImport {
  readonly schemaVarName: string;
  readonly source: 'upload-file' | 'component' | 'content-type' | 'override';
  readonly uid?: string;
}

export const buildSchemaRegistry = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
  dualUseUIDs?: ReadonlySet<string>,
  cycleUIDs?: ReadonlySet<string>,
): SchemaRegistry => ({
  components: new Map(components.map((c) => [c.uid, componentUidToSchemaVarName(c.uid)])),
  contentTypes: new Map(contentTypes.map((ct) => [ct.uid, toSchemaVarName(ct.singularName)])),
  ...(dualUseUIDs && { dualUseUIDs }),
  ...(cycleUIDs && { cycleUIDs }),
});

export const buildReverseMap = (registry: SchemaRegistry): ReadonlyMap<string, ExternalImport> =>
  new Map<string, ExternalImport>([
    ...[...registry.components].map(([uid, name]): [string, ExternalImport] => [
      name,
      { schemaVarName: name, source: 'component', uid },
    ]),
    ...[...registry.contentTypes].map(([uid, name]): [string, ExternalImport] => [
      name,
      { schemaVarName: name, source: 'content-type', uid },
    ]),
  ]);

export const classifyExternalRef = (
  ref: string,
  reverseMap: ReadonlyMap<string, ExternalImport>,
): ExternalImport =>
  ref === UPLOAD_FILE_SCHEMA_NAME
    ? { schemaVarName: ref, source: 'upload-file' }
    : (reverseMap.get(ref) ?? { schemaVarName: ref, source: 'override' });
