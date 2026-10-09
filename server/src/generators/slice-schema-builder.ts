import { UPLOAD_FILE_SCHEMA_NAME } from '../constants';
import { isToMany, POPULATABLE_TYPES } from '../types/ir';
import type { AttributeIR, ComponentIR, ContentTypeIR, NullableStyle } from '../types';
import type { TargetPrimitives } from '../mappers/shared/types';
import { mapAttribute } from '../mappers/shared/attribute-mapper';
import type { OverrideConfig } from './override-resolver';
import type { SchemaRegistry } from './schema-registry';
import type { Narrowing } from './populate-interpreter';

// Builds "slice" schema expressions for components / relation targets narrowed
// by a Document-Service populate (parsed via populate-interpreter). A slice
// mirrors what the Document Service actually returns for the narrowed
// populate: scalar fields (all, or the `fields` subset) plus only the
// explicitly populated non-scalar attributes. Like the interpreter, this
// module is bff-agnostic - callers decide where narrowings come from.

export interface AttrExpression {
  readonly expression: string;
  readonly externalRefs: readonly string[];
}

export interface SliceContext {
  readonly primitives: TargetPrimitives;
  readonly registry: SchemaRegistry;
  readonly nullableStyle: NullableStyle;
  readonly componentsByUid: ReadonlyMap<string, ComponentIR>;
  readonly contentTypesByUid: ReadonlyMap<string, ContentTypeIR>;
  readonly overrideConfig: OverrideConfig;
  // View-transform resolution for a single attribute: an expression when a
  // transform override applies, 'uncovered' when a transform matches with no
  // schema mapping (caller degrades that attribute), null when no transform
  // touches the attribute.
  readonly resolveTransformExpression: (attr: AttributeIR) => AttrExpression | 'uncovered' | null;
}

// The UploadFile schema shape is plugin-defined (mappers/*/index.ts) - this
// table mirrors it so media `fields` narrowing can emit matching slices.
const UPLOAD_FILE_SCALARS: Readonly<
  Record<string, { readonly type: string; readonly required: boolean }>
> = {
  name: { type: 'string', required: true },
  alternativeText: { type: 'string', required: false },
  caption: { type: 'string', required: false },
  width: { type: 'integer', required: false },
  height: { type: 'integer', required: false },
  url: { type: 'string', required: true },
  hash: { type: 'string', required: true },
  ext: { type: 'string', required: false },
  mime: { type: 'string', required: true },
  size: { type: 'float', required: true },
  previewUrl: { type: 'string', required: false },
  provider: { type: 'string', required: true },
  provider_metadata: { type: 'json', required: false },
  formats: { type: 'json', required: false },
};

const pad = (indent: number): string => '  '.repeat(indent);

const componentLiteral = (ctx: SliceContext, uid: string): string =>
  ctx.primitives.componentDiscriminator(uid, true);

const unknownFor = (ctx: SliceContext, required: boolean): string =>
  ctx.primitives.wrapNullability(ctx.primitives.unknownExpression, required, ctx.nullableStyle);

const discriminatedWrap = (ctx: SliceContext, memberExprs: readonly string[]): string =>
  ctx.primitives.discriminatedUnion(memberExprs);

const closeObject = (ctx: SliceContext, lines: readonly string[], indent: number): string =>
  `${ctx.primitives.objectOpen(false)}\n${lines.join('\n')}\n${pad(indent)}${ctx.primitives.objectClose(false)}`;

const buildMediaFieldsSlice = (
  narrowing: Narrowing,
  attr: AttributeIR,
  indent: number,
  ctx: SliceContext,
  warn: (msg: string) => void,
): string | null => {
  if (narrowing === true || narrowing.populate || narrowing.on) return null;

  const inner = pad(indent + 1);
  const lines = [
    `${inner}id: ${ctx.primitives.idExpression},`,
    `${inner}documentId: ${ctx.primitives.primitiveMap['string'] ?? 'string()'},`,
  ];
  for (const name of narrowing.fields ?? []) {
    const scalar = UPLOAD_FILE_SCALARS[name];
    if (!scalar) {
      warn(`media '${attr.name}' selects unknown upload-file field '${name}' - skipped`);
      continue;
    }
    const base = ctx.primitives.primitiveMap[scalar.type] ?? ctx.primitives.unknownExpression;
    lines.push(
      `${inner}${name}: ${ctx.primitives.wrapNullability(base, scalar.required, ctx.nullableStyle)},`,
    );
  }
  return closeObject(ctx, lines, indent);
};

// One builder per populatable attribute type; the dispatcher only handles
// transforms, which apply uniformly before any of them
type PopulatedBuilder = (
  attr: AttributeIR,
  value: Narrowing,
  indent: number,
  ctx: SliceContext,
  warn: (msg: string) => void,
  insideRelation: boolean,
) => AttrExpression;

const nullableWrap = (ctx: SliceContext, expression: string, required: boolean): string =>
  ctx.primitives.wrapNullability(expression, required, ctx.nullableStyle);

const buildMediaPopulated: PopulatedBuilder = (attr, value, indent, ctx, warn) => {
  if (value === true) {
    const base = attr.mediaMultiple
      ? ctx.primitives.arrayWrap(UPLOAD_FILE_SCHEMA_NAME)
      : UPLOAD_FILE_SCHEMA_NAME;
    return {
      expression: nullableWrap(ctx, base, attr.required),
      externalRefs: [UPLOAD_FILE_SCHEMA_NAME],
    };
  }
  const slice = buildMediaFieldsSlice(value, attr, indent, ctx, warn);
  if (slice === null) {
    warn(
      `media '${attr.name}' uses a populate shape the generator cannot express - emitted as unknown`,
    );
    return { expression: unknownFor(ctx, attr.required), externalRefs: [] };
  }
  const base = attr.mediaMultiple ? ctx.primitives.arrayWrap(slice) : slice;
  return { expression: nullableWrap(ctx, base, attr.required), externalRefs: [] };
};

const buildComponentPopulated: PopulatedBuilder = (
  attr,
  value,
  indent,
  ctx,
  warn,
  insideRelation,
) => {
  if (!attr.componentUID) {
    warn(`'${attr.name}' (${attr.type}) cannot appear in a populate - emitted as unknown`);
    return { expression: unknownFor(ctx, attr.required), externalRefs: [] };
  }
  const slice = buildComponentSlice(
    attr.componentUID,
    value,
    false,
    indent,
    ctx,
    warn,
    insideRelation,
  );
  const base = attr.repeatable ? ctx.primitives.arrayWrap(slice.expression) : slice.expression;
  return { expression: nullableWrap(ctx, base, attr.required), externalRefs: slice.externalRefs };
};

const buildRelationPopulated: PopulatedBuilder = (attr, value, indent, ctx, warn) => {
  if (!attr.relationTarget || !ctx.contentTypesByUid.has(attr.relationTarget)) {
    warn(
      `relation '${attr.name}' targets '${attr.relationTarget}', which is not in the generated content types - emitted as unknown`,
    );
    return { expression: unknownFor(ctx, false), externalRefs: [] };
  }
  const slice = buildContentTypeSlice(attr.relationTarget, value, indent, ctx, warn);
  const base = isToMany(attr.relationKind)
    ? ctx.primitives.arrayWrap(slice.expression)
    : slice.expression;
  // Relations are always nullish: presence depends on the populate param
  return { expression: nullableWrap(ctx, base, false), externalRefs: slice.externalRefs };
};

const unknownArray = (ctx: SliceContext, required: boolean): AttrExpression => ({
  expression: nullableWrap(
    ctx,
    ctx.primitives.arrayWrap(ctx.primitives.unknownExpression),
    required,
  ),
  externalRefs: [],
});

const buildDynamicZonePopulated: PopulatedBuilder = (
  attr,
  value,
  indent,
  ctx,
  warn,
  insideRelation,
) => {
  if (value === true || !value.on) {
    warn(
      `dynamic zone '${attr.name}' is populated without an \`on\` selection - member shapes are unknown`,
    );
    return unknownArray(ctx, attr.required);
  }
  const memberUids = new Set(attr.componentUIDs ?? []);
  const exprs: string[] = [];
  const refs: string[] = [];
  for (const [uid, memberValue] of Object.entries(value.on)) {
    if (!memberUids.has(uid)) {
      warn(`dynamic zone '${attr.name}' populates '${uid}', which is not a zone member - skipped`);
      continue;
    }
    const slice = buildComponentSlice(
      uid,
      memberValue,
      true,
      indent + 1,
      ctx,
      warn,
      insideRelation,
    );
    exprs.push(slice.expression);
    refs.push(...slice.externalRefs);
  }
  if (exprs.length === 0) return unknownArray(ctx, attr.required);
  // Slices always carry a required __component literal, so the zone stays
  // discriminated even when the base component would be dual-use
  return {
    expression: nullableWrap(
      ctx,
      ctx.primitives.arrayWrap(discriminatedWrap(ctx, exprs)),
      attr.required,
    ),
    externalRefs: refs,
  };
};

const POPULATED_BUILDERS: Readonly<Record<string, PopulatedBuilder>> = {
  media: buildMediaPopulated,
  component: buildComponentPopulated,
  relation: buildRelationPopulated,
  dynamiczone: buildDynamicZonePopulated,
};

const buildPopulatedAttrExpression = (
  attr: AttributeIR,
  value: Narrowing,
  indent: number,
  ctx: SliceContext,
  warn: (msg: string) => void,
  insideRelation: boolean,
): AttrExpression => {
  // Transforms never reach below a relation boundary (see buildScalarLine)
  const transform = insideRelation ? null : ctx.resolveTransformExpression(attr);
  if (transform === 'uncovered') {
    warn(`'${attr.name}' is transformed with no schema mapping - emitted as unknown`);
    return { expression: unknownFor(ctx, attr.required), externalRefs: [] };
  }
  if (transform) {
    return {
      expression: nullableWrap(ctx, transform.expression, attr.required),
      externalRefs: transform.externalRefs,
    };
  }

  const builder = POPULATED_BUILDERS[attr.type];
  if (!builder) {
    warn(`'${attr.name}' (${attr.type}) cannot appear in a populate - emitted as unknown`);
    return { expression: unknownFor(ctx, attr.required), externalRefs: [] };
  }
  return builder(attr, value, indent, ctx, warn, insideRelation);
};

const buildScalarLine = (
  attr: AttributeIR,
  parentUid: string,
  indent: number,
  ctx: SliceContext,
  warn: (msg: string) => void,
  insideRelation: boolean,
): AttrExpression => {
  // The bff-views transformer walk stops at relation boundaries: relation
  // payloads carry raw values, so neither view transforms nor type overrides
  // (which describe transformed output) apply below a relation.
  if (insideRelation) {
    const mapped = mapAttribute(attr, ctx.nullableStyle, ctx.registry, ctx.primitives);
    return { expression: mapped.expression, externalRefs: mapped.externalRefs };
  }

  const transform = ctx.resolveTransformExpression(attr);
  if (transform === 'uncovered') {
    warn(`'${attr.name}' is transformed with no schema mapping - emitted as unknown`);
    return { expression: unknownFor(ctx, attr.required), externalRefs: [] };
  }
  if (transform) {
    return {
      expression: ctx.primitives.wrapNullability(
        transform.expression,
        attr.required,
        ctx.nullableStyle,
      ),
      externalRefs: transform.externalRefs,
    };
  }
  const mapped = mapAttribute(
    attr,
    ctx.nullableStyle,
    ctx.registry,
    ctx.primitives,
    parentUid,
    ctx.overrideConfig,
  );
  return { expression: mapped.expression, externalRefs: mapped.externalRefs };
};

// Excluded from the IR by default (schema-reader internal-fields filtering)
// but valid `fields` selections that the runtime returns as ISO strings
const TIMESTAMP_FIELDS = new Set(['createdAt', 'updatedAt', 'publishedAt']);

const buildSliceLines = (
  attributes: readonly AttributeIR[],
  parentUid: string,
  narrowing: Narrowing,
  alwaysIncluded: readonly string[],
  indent: number,
  ctx: SliceContext,
  warn: (msg: string) => void,
  insideRelation: boolean,
  allowTimestampFields: boolean,
): { readonly lines: string[]; readonly refs: string[] } => {
  const attrsByName = new Map(attributes.map((a) => [a.name, a]));
  const inner = pad(indent + 1);
  const lines: string[] = [];
  const refs: string[] = [];

  const scalarNames =
    narrowing === true || narrowing.fields === undefined
      ? attributes.filter((a) => !POPULATABLE_TYPES.has(a.type)).map((a) => a.name)
      : [...alwaysIncluded, ...narrowing.fields];

  for (const name of [...new Set(scalarNames)]) {
    const attr = attrsByName.get(name);
    if (!attr) {
      if (allowTimestampFields && TIMESTAMP_FIELDS.has(name)) {
        const base = ctx.primitives.primitiveMap['datetime'] ?? ctx.primitives.unknownExpression;
        // nullish: publishedAt is null for drafts, and the IR carries no
        // requiredness information for excluded internal fields
        lines.push(
          `${inner}${name}: ${ctx.primitives.wrapNullability(base, false, ctx.nullableStyle)},`,
        );
        continue;
      }
      warn(`\`fields\` selects unknown field '${name}' on '${parentUid}' - skipped`);
      continue;
    }
    if (POPULATABLE_TYPES.has(attr.type)) {
      warn(
        `\`fields\` selects '${name}' (${attr.type}) on '${parentUid}' - request it via \`populate\` instead; skipped`,
      );
      continue;
    }
    const scalar = buildScalarLine(attr, parentUid, indent, ctx, warn, insideRelation);
    lines.push(`${inner}${name}: ${scalar.expression},`);
    refs.push(...scalar.externalRefs);
  }

  if (narrowing !== true && narrowing.populate) {
    for (const [name, value] of Object.entries(narrowing.populate)) {
      const attr = attrsByName.get(name);
      if (!attr) {
        warn(`\`populate\` selects unknown field '${name}' on '${parentUid}' - skipped`);
        continue;
      }
      const populated = buildPopulatedAttrExpression(
        attr,
        value,
        indent + 1,
        ctx,
        warn,
        insideRelation,
      );
      lines.push(`${inner}${name}: ${populated.expression},`);
      refs.push(...populated.externalRefs);
    }
  }

  return { lines, refs };
};

export const buildComponentSlice = (
  uid: string,
  narrowing: Narrowing,
  withComponentLiteral: boolean,
  indent: number,
  ctx: SliceContext,
  warn: (msg: string) => void,
  insideRelation = false,
): AttrExpression => {
  const component = ctx.componentsByUid.get(uid);
  if (!component) {
    warn(`component '${uid}' is not in the generated components - emitted as unknown`);
    return { expression: ctx.primitives.unknownExpression, externalRefs: [] };
  }

  const inner = pad(indent + 1);
  const head = [
    ...(withComponentLiteral ? [`${inner}__component: ${componentLiteral(ctx, uid)},`] : []),
    `${inner}id: ${ctx.primitives.idExpression},`,
  ];
  const { lines, refs } = buildSliceLines(
    component.attributes,
    uid,
    narrowing,
    [],
    indent,
    ctx,
    warn,
    insideRelation,
    false,
  );

  return { expression: closeObject(ctx, [...head, ...lines], indent), externalRefs: refs };
};

export const buildContentTypeSlice = (
  uid: string,
  narrowing: Narrowing,
  indent: number,
  ctx: SliceContext,
  warn: (msg: string) => void,
): AttrExpression => {
  const ct = ctx.contentTypesByUid.get(uid);
  if (!ct) {
    warn(`content type '${uid}' is not in the generated content types - emitted as unknown`);
    return { expression: ctx.primitives.unknownExpression, externalRefs: [] };
  }

  // Content-type slices only exist below relation boundaries - the runtime
  // transformer walk never descends into relations, so everything beneath maps
  // raw. The runtime also always returns `id` alongside documentId.
  const idLine = `${pad(indent + 1)}id: ${ctx.primitives.idExpression},`;
  const { lines, refs } = buildSliceLines(
    ct.attributes,
    uid,
    narrowing,
    ['documentId'],
    indent,
    ctx,
    warn,
    true,
    true,
  );
  return { expression: closeObject(ctx, [idLine, ...lines], indent), externalRefs: refs };
};
