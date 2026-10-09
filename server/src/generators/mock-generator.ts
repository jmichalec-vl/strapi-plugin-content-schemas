import { buildComponentUsage } from './component-usage';
import type { AttributeIR, ComponentIR, ContentTypeIR } from '../types';
import { FILE_HEADER } from '../constants';
import {
  escapeSingleQuoted,
  toCamelCase,
  toPascalCase,
  toTypeExportName,
  componentUidToCategory,
  componentUidToFileName,
  componentUidToTypeName,
} from '../utils';
import type { OverrideConfig } from './override-resolver';
import { resolveOverride, resolveAttributeOverride } from './override-resolver';
import { collectCycleUIDs } from './dependency-graph';

// Mock factories call each other; cyclic components would recurse forever at
// runtime. Break each cycle deterministically: self-references always break,
// and among cycle members the edge from the lexicographically larger UID to
// the smaller one breaks (every cycle contains at least one such edge, and the
// surviving edges are strictly increasing, hence acyclic).
const shouldBreakRef = (uid: string, parentUid: string, cycleUIDs: ReadonlySet<string>): boolean =>
  uid === parentUid || (cycleUIDs.has(uid) && cycleUIDs.has(parentUid) && parentUid > uid);

const FAKER_TYPE_MAP: Readonly<Record<string, string>> = {
  string: 'faker.lorem.words(3)',
  text: 'faker.lorem.paragraph()',
  richtext: 'faker.lorem.paragraphs()',
  email: 'faker.internet.email()',
  uid: 'faker.helpers.slugify(faker.lorem.words(3))',
  boolean: 'faker.datatype.boolean()',
  integer: 'faker.number.int({ min: 0, max: 1000 })',
  biginteger: 'String(faker.number.int({ min: 0, max: 100000 }))',
  float: 'faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })',
  decimal: 'faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })',
  date: "faker.date.past().toISOString().split('T')[0] ?? ''",
  datetime: 'faker.date.past().toISOString()',
  time: "faker.date.past().toISOString().split('T')[1]?.split('.')[0] ?? '00:00:00'",
  timestamp: 'faker.date.past().toISOString()',
  json: '{}',
  blocks: '[]',
};

const mockFnName = (name: string): string => `mock${toPascalCase(name)}`;

const componentMockFnName = (uid: string): string =>
  mockFnName(componentUidToTypeName(uid).replace(/^./, (c) => c.toLowerCase()));

// Override schemas are opaque config-provided code - the generator cannot derive
// realistic values for them, so it emits a typed empty placeholder the consumer
// can fill via the factory's `overrides` parameter
const buildOverrideMock = (typeName: string, required: boolean): string => {
  const expr = `{} as unknown as ${typeName} /* TODO: provide realistic override mock */`;
  return required ? expr : `faker.datatype.boolean() ? (${expr}) : null`;
};

const buildAttributeMock = (
  attr: AttributeIR,
  parentUid: string,
  componentRegistry: Record<string, ComponentIR>,
  cycleUIDs: ReadonlySet<string>,
  overrides?: OverrideConfig,
): string => {
  if (overrides) {
    const override = resolveOverride(attr.name, attr.type, parentUid, overrides);
    if (override) {
      const entry = resolveAttributeOverride(attr, parentUid, overrides);
      return buildOverrideMock(entry?.typeName ?? 'unknown', attr.required);
    }
  }

  if (attr.type === 'relation') return 'undefined';

  if (attr.type === 'enumeration') {
    const values = (attr.enumValues ?? []).map((v) => `'${escapeSingleQuoted(v)}'`).join(', ');
    return `faker.helpers.arrayElement([${values}])`;
  }

  if (attr.type === 'media') {
    const expr = attr.mediaMultiple ? '[mockUploadFile()]' : 'mockUploadFile()';
    return attr.required ? expr : `faker.datatype.boolean() ? ${expr} : null`;
  }

  if (attr.type === 'component' && attr.componentUID) {
    const comp = componentRegistry[attr.componentUID];
    if (!comp) return attr.required ? '{}' : 'null';
    if (shouldBreakRef(attr.componentUID, parentUid, cycleUIDs)) {
      if (attr.repeatable) return '[]';
      return attr.required
        ? 'undefined as never /* circular reference - provide via overrides */'
        : 'null';
    }
    const fn = `${componentMockFnName(attr.componentUID)}()`;
    const expr = attr.repeatable ? `[${fn}]` : fn;
    return attr.required ? expr : `faker.datatype.boolean() ? ${expr} : null`;
  }

  if (attr.type === 'dynamiczone' && attr.componentUIDs) {
    const validUIDs = attr.componentUIDs.filter(
      (uid) => componentRegistry[uid] && !shouldBreakRef(uid, parentUid, cycleUIDs),
    );
    if (validUIDs.length === 0) return '[]';
    const randomPick = validUIDs.map((uid) => `${componentMockFnName(uid)}()`).join(', ');
    return validUIDs.length === 1
      ? `[${randomPick}]`
      : `[faker.helpers.arrayElement([${randomPick}])]`;
  }

  const fakerExpr = FAKER_TYPE_MAP[attr.type] ?? 'null';
  return attr.required ? fakerExpr : `faker.datatype.boolean() ? ${fakerExpr} : null`;
};

const collectOverrideTypeImports = (
  attributes: readonly AttributeIR[],
  parentUid: string,
  overridesPath: string,
  overrides?: OverrideConfig,
): readonly string[] => {
  if (!overrides) return [];

  const typeNames = new Set<string>(
    attributes.flatMap((attr) => {
      const override = resolveOverride(attr.name, attr.type, parentUid, overrides);
      if (!override) return [];
      const entry = resolveAttributeOverride(attr, parentUid, overrides);
      return entry ? [entry.typeName] : [];
    }),
  );

  return typeNames.size > 0
    ? [`import type { ${Array.from(typeNames).sort().join(', ')} } from '${overridesPath}';`]
    : [];
};

const collectComponentImports = (
  attributes: readonly AttributeIR[],
  componentRegistry: Record<string, ComponentIR>,
  fromDir: string,
  parentUid: string,
  cycleUIDs: ReadonlySet<string>,
): readonly string[] => {
  const seen = new Set<string>();
  const imports: string[] = [];

  for (const attr of attributes) {
    const uids =
      attr.type === 'component' && attr.componentUID
        ? [attr.componentUID]
        : attr.type === 'dynamiczone' && attr.componentUIDs
          ? [...attr.componentUIDs]
          : [];

    for (const uid of uids) {
      if (seen.has(uid) || !componentRegistry[uid]) continue;
      // Broken cycle edges emit no call, so importing the factory would leave
      // an unused import in the generated file
      if (shouldBreakRef(uid, parentUid, cycleUIDs)) continue;
      seen.add(uid);
      const category = componentUidToCategory(uid);
      const fileName = componentUidToFileName(uid);
      const fn = componentMockFnName(uid);
      imports.push(`import { ${fn} } from '${fromDir}/components/${category}/${fileName}.mock';`);
    }
  }

  return imports;
};

export const generateContentTypeMock = (
  ct: ContentTypeIR,
  componentRegistry: Record<string, ComponentIR>,
  cycleUIDs: ReadonlySet<string>,
  overrides?: OverrideConfig,
): string => {
  const typeName = toTypeExportName(ct.singularName);
  const fnName = mockFnName(toCamelCase(ct.singularName));

  const hasMedia = ct.attributes.some((a) => a.type === 'media');
  const compImports = collectComponentImports(
    ct.attributes,
    componentRegistry,
    '.',
    ct.uid,
    cycleUIDs,
  );

  const fields = ct.attributes
    .filter((attr) => attr.name !== 'documentId')
    .map((attr) => {
      const value = buildAttributeMock(attr, ct.uid, componentRegistry, cycleUIDs, overrides);
      return `  ${attr.name}: ${value},`;
    });

  const importLines = [
    `import { faker } from '@faker-js/faker';`,
    `import type { ${typeName} } from '../content-types/${ct.singularName}';`,
    ...(hasMedia ? [`import { mockUploadFile } from './upload-file.mock';`] : []),
    ...collectOverrideTypeImports(ct.attributes, ct.uid, '../shared/overrides', overrides),
    ...compImports,
  ];

  const code = [
    FILE_HEADER,
    ...importLines,
    '',
    `export const ${fnName} = (overrides?: Partial<${typeName}>): ${typeName} => ({`,
    `  documentId: faker.string.uuid(),`,
    ...fields,
    `  ...overrides,`,
    `});`,
    '',
  ].join('\n');

  return code;
};

export interface ComponentMockUsage {
  readonly inDynamicZone: boolean;
  readonly inComponent: boolean;
}

export const generateComponentMock = (
  component: ComponentIR,
  componentRegistry: Record<string, ComponentIR>,
  cycleUIDs: ReadonlySet<string>,
  usage?: ComponentMockUsage,
  overrides?: OverrideConfig,
): string => {
  const typeName = componentUidToTypeName(component.uid);
  const fnName = componentMockFnName(component.uid);

  const hasMedia = component.attributes.some((a) => a.type === 'media');
  const compImports = collectComponentImports(
    component.attributes,
    componentRegistry,
    '../..',
    component.uid,
    cycleUIDs,
  );

  const fields = component.attributes.map((attr) => {
    const value = buildAttributeMock(attr, component.uid, componentRegistry, cycleUIDs, overrides);
    return `  ${attr.name}: ${value},`;
  });

  const category = componentUidToCategory(component.uid);
  const fileName = componentUidToFileName(component.uid);

  const importLines = [
    `import { faker } from '@faker-js/faker';`,
    `import type { ${typeName} } from '../../../components/${category}/${fileName}';`,
    ...(hasMedia ? [`import { mockUploadFile } from '../../upload-file.mock';`] : []),
    ...collectOverrideTypeImports(
      component.attributes,
      component.uid,
      '../../../shared/overrides',
      overrides,
    ),
    ...compImports,
  ];

  // Dynamic-zone components have __component in their interface (required when
  // DZ-only) and the schemas discriminate on it - mock data must include it
  const componentFieldLine = usage?.inDynamicZone ? [`  __component: '${component.uid}',`] : [];

  const code = [
    FILE_HEADER,
    ...importLines,
    '',
    `export const ${fnName} = (overrides?: Partial<${typeName}>): ${typeName} => ({`,
    ...componentFieldLine,
    `  id: faker.number.int({ min: 1, max: 10000 }),`,
    ...fields,
    `  ...overrides,`,
    `});`,
    '',
  ].join('\n');

  return code;
};

export const generateUploadFileMock = (): string =>
  [
    FILE_HEADER,
    `import { faker } from '@faker-js/faker';`,
    `import type { UploadFile } from '../shared/upload-file';`,
    '',
    `export const mockUploadFile = (overrides?: Partial<UploadFile>): UploadFile => ({`,
    `  id: faker.number.int({ min: 1, max: 10000 }),`,
    `  documentId: faker.string.uuid(),`,
    `  name: faker.system.fileName(),`,
    `  alternativeText: faker.datatype.boolean() ? faker.lorem.sentence() : null,`,
    `  caption: null,`,
    `  width: faker.number.int({ min: 100, max: 2000 }),`,
    `  height: faker.number.int({ min: 100, max: 2000 }),`,
    `  url: faker.image.url(),`,
    `  formats: null,`,
    `  hash: faker.string.alphanumeric(10),`,
    `  mime: 'image/jpeg',`,
    `  size: faker.number.float({ min: 10, max: 5000, fractionDigits: 2 }),`,
    `  ext: '.jpg',`,
    `  previewUrl: null,`,
    `  provider: 'local',`,
    `  provider_metadata: null,`,
    `  ...overrides,`,
    `});`,
    '',
  ].join('\n');

export const generateMockBarrel = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
): string => {
  const parts = [FILE_HEADER];

  parts.push(`export { mockUploadFile } from './upload-file.mock';`);

  for (const ct of contentTypes) {
    const fnName = mockFnName(toCamelCase(ct.singularName));
    parts.push(`export { ${fnName} } from './${ct.singularName}.mock';`);
  }

  for (const comp of components) {
    const fnName = componentMockFnName(comp.uid);
    const category = componentUidToCategory(comp.uid);
    const fileName = componentUidToFileName(comp.uid);
    parts.push(`export { ${fnName} } from './components/${category}/${fileName}.mock';`);
  }

  parts.push('');
  return parts.join('\n');
};

export const generateMockFiles = (
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
  overrides?: OverrideConfig,
): ReadonlyMap<string, string> => {
  const files = new Map<string, string>();
  const componentRegistry = Object.fromEntries(components.map((c) => [c.uid, c]));
  const cycleUIDs = collectCycleUIDs(components);

  const componentUsage = buildComponentUsage(contentTypes, components);

  files.set('mocks/upload-file.mock.ts', generateUploadFileMock());

  const sortedCTs = [...contentTypes].sort((a, b) => a.singularName.localeCompare(b.singularName));

  for (const ct of sortedCTs) {
    files.set(
      `mocks/${ct.singularName}.mock.ts`,
      generateContentTypeMock(ct, componentRegistry, cycleUIDs, overrides),
    );
  }

  for (const comp of components) {
    const category = componentUidToCategory(comp.uid);
    const fileName = componentUidToFileName(comp.uid);
    const usage: ComponentMockUsage = componentUsage.usageOf(comp.uid);
    files.set(
      `mocks/components/${category}/${fileName}.mock.ts`,
      generateComponentMock(comp, componentRegistry, cycleUIDs, usage, overrides),
    );
  }

  files.set('mocks/index.ts', generateMockBarrel(sortedCTs, components));

  return files;
};
