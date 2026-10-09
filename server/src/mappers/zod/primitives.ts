import { UPLOAD_FILE_SCHEMA_NAME } from '../../constants';
import type { AttributeIR, NullableStyle } from '../../types';
import type { SchemaRegistry } from '../../generators/schema-registry';
import type { MappedAttribute, RefWrapOptions, TargetPrimitives } from '../shared/types';
import { escapeSingleQuoted } from '../../utils';

const PRIMITIVE_MAP: Readonly<Record<string, string>> = {
  string: 'z.string()',
  text: 'z.string()',
  richtext: 'z.string()',
  uid: 'z.string()',
  email: 'z.string()',
  boolean: 'z.boolean()',
  integer: 'z.number()',
  // Strapi serializes biginteger as a JSON string to avoid precision loss
  biginteger: 'z.string()',
  float: 'z.number()',
  decimal: 'z.number()',
  date: 'z.string()',
  datetime: 'z.string()',
  time: 'z.string()',
  timestamp: 'z.string()',
  json: 'z.unknown()',
  blocks: 'z.unknown()',
};

const literal = (value: string): string => `z.literal('${escapeSingleQuoted(value)}')`;

const union = (members: readonly string[]): string => `z.union([${members.join(', ')}])`;

const discriminatedUnion = (members: readonly string[]): string =>
  `z.discriminatedUnion('__component', [${members.join(', ')}])`;

const wrapNullability = (expr: string, required: boolean, style: NullableStyle): string => {
  if (required) return expr;
  return style === 'nullish' ? `${expr}.nullish()` : `${expr}.nullable().optional()`;
};

const wrapRef = (schemaRef: string, options: RefWrapOptions, isMany: boolean): MappedAttribute => {
  const ref = options.lazy ? `z.lazy(() => ${schemaRef})` : schemaRef;
  const expression = isMany ? `z.array(${ref})` : ref;
  return { expression, externalRefs: options.selfRef ? [] : [schemaRef] };
};

const mapEnumeration = (attr: AttributeIR): string =>
  `z.enum([${(attr.enumValues ?? []).map((v) => `'${escapeSingleQuoted(v)}'`).join(', ')}])`;

const mapMedia = (attr: AttributeIR): MappedAttribute => ({
  expression: attr.mediaMultiple ? 'z.array(UploadFileSchema)' : UPLOAD_FILE_SCHEMA_NAME,
  externalRefs: [UPLOAD_FILE_SCHEMA_NAME],
});

const mapDynamiczone = (attr: AttributeIR, registry: SchemaRegistry): MappedAttribute => {
  const known = (attr.componentUIDs ?? []).flatMap((uid) => {
    const varName = registry.components.get(uid);
    return varName ? [{ uid, varName }] : [];
  });
  const uids = known.map((entry) => entry.uid);
  const varNames = known.map((entry) => entry.varName);
  // Cycle members import each other; an eager reference would hit the TDZ at
  // module evaluation, so those members are deferred with lazy()
  const members = known.map(({ uid, varName }) =>
    registry.cycleUIDs?.has(uid) ? `z.lazy(() => ${varName})` : varName,
  );
  const hasLazyMember = members.some((member, index) => member !== varNames[index]);

  if (varNames.length === 0) return { expression: 'z.array(z.unknown())', externalRefs: [] };

  // discriminatedUnion requires plain object schemas with a required
  // discriminator: dual-use components (also nested outside a dynamic zone)
  // carry a nullish __component, and z.lazy() members are not object schemas -
  // either forces z.union()
  const hasDualUse = uids.some((uid) => registry.dualUseUIDs?.has(uid));
  const expression =
    hasDualUse || hasLazyMember
      ? `z.array(${union(members)})`
      : `z.array(${discriminatedUnion(members)})`;

  return { expression, externalRefs: varNames };
};

const objectWrap = (varName: string, lines: readonly string[], recursiveType?: string): string => {
  const declaration = recursiveType
    ? `export const ${varName}: z.ZodType<${recursiveType}> = z.object({`
    : `export const ${varName} = z.object({`;
  return [declaration, ...lines, `});`].join('\n');
};

const buildImportStatement = (): string => `import { z } from 'zod';`;

export const zodPrimitives: TargetPrimitives = {
  primitiveMap: PRIMITIVE_MAP,
  unknownExpression: 'z.unknown()',
  nullExpression: 'z.null()',
  idExpression: 'z.number()',
  literal,
  componentDiscriminator: (uid, required) =>
    required ? literal(uid) : `${literal(uid)}.nullish()`,
  inferType: (schemaVarName) => `z.infer<typeof ${schemaVarName}>`,
  objectOpen: () => 'z.object({',
  objectClose: (loose) => (loose ? '}).passthrough()' : '})'),
  union,
  discriminatedUnion,
  typeImportStatements: [],
  wrapNullability,
  wrapRef,
  mapEnumeration,
  mapMedia,
  mapDynamiczone,
  objectWrap,
  recursiveTypeImports: [],
  buildImportStatement: () => buildImportStatement(),
  arrayWrap: (schemaVar: string) => `z.array(${schemaVar})`,
};
