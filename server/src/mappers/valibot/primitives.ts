import { UPLOAD_FILE_SCHEMA_NAME } from '../../constants';
import type { AttributeIR, NullableStyle } from '../../types';
import type { SchemaRegistry } from '../../generators/schema-registry';
import type { MappedAttribute, RefWrapOptions, TargetPrimitives } from '../shared/types';
import { escapeSingleQuoted } from '../../utils';
import { detectUsedFunctions } from './functions';

const PRIMITIVE_MAP: Readonly<Record<string, string>> = {
  string: 'string()',
  text: 'string()',
  richtext: 'string()',
  uid: 'string()',
  email: 'string()',
  boolean: 'boolean()',
  integer: 'number()',
  // Strapi serializes biginteger as a JSON string to avoid precision loss
  biginteger: 'string()',
  float: 'number()',
  decimal: 'number()',
  date: 'string()',
  datetime: 'string()',
  time: 'string()',
  timestamp: 'string()',
  json: 'unknown()',
  blocks: 'unknown()',
};

const literal = (value: string): string => `literal('${escapeSingleQuoted(value)}')`;

const union = (members: readonly string[]): string => `union([${members.join(', ')}])`;

const discriminatedUnion = (members: readonly string[]): string =>
  `variant('__component', [${members.join(', ')}])`;

const wrapNullability = (expr: string, required: boolean, style: NullableStyle): string => {
  if (required) return expr;
  return style === 'nullish' ? `nullish(${expr})` : `optional(union([${expr}, null_()]))`;
};

const wrapRef = (schemaRef: string, options: RefWrapOptions, isMany: boolean): MappedAttribute => {
  const ref = options.lazy ? `lazy(() => ${schemaRef})` : schemaRef;
  const expression = isMany ? `array(${ref})` : ref;
  return { expression, externalRefs: options.selfRef ? [] : [schemaRef] };
};

const mapEnumeration = (attr: AttributeIR): string =>
  `picklist([${(attr.enumValues ?? []).map((v) => `'${escapeSingleQuoted(v)}'`).join(', ')}])`;

const mapMedia = (attr: AttributeIR): MappedAttribute => ({
  expression: attr.mediaMultiple ? 'array(UploadFileSchema)' : UPLOAD_FILE_SCHEMA_NAME,
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
    registry.cycleUIDs?.has(uid) ? `lazy(() => ${varName})` : varName,
  );
  const hasLazyMember = members.some((member, index) => member !== varNames[index]);

  if (varNames.length === 0) return { expression: 'array(unknown())', externalRefs: [] };

  // variant() requires plain object schemas with a required discriminator:
  // dual-use components (also nested outside a dynamic zone) carry a nullish
  // __component, and lazy() members are not object schemas - either forces union()
  const hasDualUse = uids.some((uid) => registry.dualUseUIDs?.has(uid));
  const expression =
    hasDualUse || hasLazyMember
      ? `array(${union(members)})`
      : `array(${discriminatedUnion(members)})`;

  return { expression, externalRefs: varNames };
};

const objectWrap = (varName: string, lines: readonly string[], recursiveType?: string): string => {
  const declaration = recursiveType
    ? `export const ${varName}: GenericSchema<${recursiveType}> = object({`
    : `export const ${varName} = object({`;
  return [declaration, ...lines, `});`].join('\n');
};

const extractUsedFunctions = (lines: readonly string[]): readonly string[] => {
  // `object` always appears via objectWrap, which runs after import detection;
  // everything else must be detected from the attribute lines themselves
  const functions = new Set<string>(['object']);
  for (const fn of detectUsedFunctions(lines.join('\n'))) functions.add(fn);
  return Array.from(functions).sort();
};

const buildImportStatement = (lines: readonly string[]): string => {
  const usedFunctions = extractUsedFunctions(lines);
  return `import { ${usedFunctions.join(', ')} } from 'valibot';`;
};

export const valibotPrimitives: TargetPrimitives = {
  primitiveMap: PRIMITIVE_MAP,
  unknownExpression: 'unknown()',
  nullExpression: 'null_()',
  idExpression: 'number()',
  literal,
  componentDiscriminator: (uid, required) => (required ? literal(uid) : `nullish(${literal(uid)})`),
  inferType: (schemaVarName) => `InferOutput<typeof ${schemaVarName}>`,
  objectOpen: (loose) => (loose ? 'looseObject({' : 'object({'),
  objectClose: () => '})',
  union,
  discriminatedUnion,
  typeImportStatements: [`import type { InferOutput } from 'valibot';`],
  wrapNullability,
  wrapRef,
  mapEnumeration,
  mapMedia,
  mapDynamiczone,
  objectWrap,
  recursiveTypeImports: [`import type { GenericSchema } from 'valibot';`],
  buildImportStatement,
  arrayWrap: (schemaVar: string) => `array(${schemaVar})`,
};
