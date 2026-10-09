import { isToMany } from '../types/ir';
import type {
  AttributeIR,
  BffRelationOverlay,
  BffViewManifest,
  BffViewManifestEntry,
  BffViewTransform,
  ComponentIR,
  ContentTypeIR,
  GenerationOptions,
  TypeOverride,
  ViewResponseDeclaration,
} from '../types';
import { FILE_HEADER, UPLOAD_FILE_SCHEMA_NAME } from '../constants';
import { toPascalCase, componentUidToTypeName } from '../utils';
import { mapAttribute } from '../mappers/shared/attribute-mapper';
import type { TargetPrimitives } from '../mappers/shared/types';
import { getAdapter } from '../mappers/target-adapter';
import { buildReverseMap, classifyExternalRef, type SchemaRegistry } from './schema-registry';
import { buildExternalImportStatements } from './import-resolver';
import type { OverrideConfig } from './override-resolver';
import { parseNarrowing, type Narrowing } from './populate-interpreter';
import {
  buildComponentSlice,
  buildContentTypeSlice,
  type AttrExpression,
  type SliceContext,
} from './slice-schema-builder';

export interface ViewGenerationOutput {
  readonly files: ReadonlyMap<string, string>;
  readonly usedOverrides: readonly TypeOverride[];
  readonly warnings: readonly string[];
  // View ids whose viewResponseSchemas declaration was actually emitted (a
  // colliding declaration is skipped with a warning); the client must only
  // import declared exports that exist
  readonly declaredViewIds: ReadonlySet<string>;
}

type TransformResolution =
  | { readonly kind: 'override'; readonly override: TypeOverride }
  | { readonly kind: 'covered' }
  | { readonly kind: 'uncovered'; readonly name: string };

const transformMatches = (transform: BffViewTransform, attr: AttributeIR): boolean => {
  const { fieldType, fieldName } = transform.match;
  if (fieldType === undefined && fieldName === undefined) return false;
  if (fieldType !== undefined && attr.type !== fieldType) return false;
  if (fieldName !== undefined && !new RegExp(fieldName).test(attr.name)) return false;
  return true;
};

// A transformed value needs a schema from somewhere: an explicit
// viewTransformSchemas entry, or - for pure fieldType matches - an existing
// typeOverride that already makes the base schemas describe the transformed
// shape. Anything else is 'uncovered' and must degrade to unknown() loudly.
const resolveTransform = (
  attr: AttributeIR,
  transforms: readonly BffViewTransform[],
  config: GenerationOptions,
): TransformResolution | null => {
  for (const transform of transforms) {
    if (!transformMatches(transform, attr)) continue;
    const override = config.viewTransformSchemas[transform.name];
    if (override) return { kind: 'override', override };
    if (
      transform.match.fieldType !== undefined &&
      transform.match.fieldName === undefined &&
      config.typeOverrides[transform.match.fieldType]
    ) {
      return { kind: 'covered' };
    }
    return { kind: 'uncovered', name: transform.name };
  }
  return null;
};

// Shared component schemas cannot express a per-view transform. If a transform
// reaches (transitively) inside a component and isn't already reflected in the
// base schemas, that component's shape is wrong for this view - the caller
// degrades it to unknown() instead of emitting a silently-wrong schema.
const buildContaminationChecker = (
  componentsByUid: ReadonlyMap<string, ComponentIR>,
  transforms: readonly BffViewTransform[],
  config: GenerationOptions,
): ((uid: string) => boolean) => {
  const cache = new Map<string, boolean>();

  const check = (uid: string, trail: Set<string>): boolean => {
    const cached = cache.get(uid);
    if (cached !== undefined) return cached;
    if (trail.has(uid)) return false;

    const component = componentsByUid.get(uid);
    if (!component) {
      cache.set(uid, false);
      return false;
    }

    trail.add(uid);
    const contaminated = component.attributes.some((attr) => {
      const resolution = resolveTransform(attr, transforms, config);
      if (resolution && resolution.kind !== 'covered') return true;
      if (attr.type === 'component' && attr.componentUID) return check(attr.componentUID, trail);
      if (attr.type === 'dynamiczone') {
        return (attr.componentUIDs ?? []).some((memberUid) => check(memberUid, trail));
      }
      return false;
    });
    trail.delete(uid);

    cache.set(uid, contaminated);
    return contaminated;
  };

  return (uid) => check(uid, new Set());
};

interface EmitContext {
  readonly primitives: TargetPrimitives;
  readonly registry: SchemaRegistry;
  readonly config: GenerationOptions;
  readonly contentTypesByUid: ReadonlyMap<string, ContentTypeIR>;
  readonly componentsByUid: ReadonlyMap<string, ComponentIR>;
  readonly overrideConfig: OverrideConfig;
}

// Relation overlays are Document-Service populate values - interpreted via the
// shared narrowing interpreter, so `fields` selections and arbitrarily nested
// `populate` objects all produce exact slices.
const buildRelationExpression = (
  fieldName: string,
  overlay: BffRelationOverlay,
  attr: AttributeIR,
  sliceCtx: SliceContext,
  warn: (msg: string) => void,
): AttrExpression => {
  const many = isToMany(attr.relationKind);
  const unknownWrapped = sliceCtx.primitives.wrapNullability(
    many
      ? sliceCtx.primitives.arrayWrap(sliceCtx.primitives.unknownExpression)
      : sliceCtx.primitives.unknownExpression,
    false,
    sliceCtx.nullableStyle,
  );

  if (!attr.relationTarget || !sliceCtx.contentTypesByUid.has(attr.relationTarget)) {
    warn(
      `relation '${fieldName}' targets '${attr.relationTarget}', which is not in the generated content types - emitted as unknown`,
    );
    return { expression: unknownWrapped, externalRefs: [] };
  }

  const narrowing = overlay === true ? true : parseNarrowing(overlay);
  if (narrowing === null) {
    warn(
      `relation '${fieldName}' overlay uses a populate shape the generator cannot interpret - emitted as unknown`,
    );
    return { expression: unknownWrapped, externalRefs: [] };
  }

  const slice = buildContentTypeSlice(attr.relationTarget, narrowing, 1, sliceCtx, (msg) =>
    warn(`relation '${fieldName}': ${msg}`),
  );
  const withMany = many ? sliceCtx.primitives.arrayWrap(slice.expression) : slice.expression;
  return {
    expression: sliceCtx.primitives.wrapNullability(withMany, false, sliceCtx.nullableStyle),
    externalRefs: slice.externalRefs,
  };
};

interface BuiltView {
  readonly path: string;
  readonly content: string;
  readonly usedOverrides: readonly TypeOverride[];
  readonly declarationEmitted: boolean;
  readonly viewId: string;
}

// One data source of a view. Keyed/singleton views have exactly one, unnamed;
// composite views (bff-views 0.2.0) have named sources composed into an object.
interface NormalizedSource {
  readonly name: string | null;
  readonly contentType: string;
  readonly many: boolean;
  readonly fields: readonly string[];
  readonly componentFields: Readonly<Record<string, string>>;
  readonly mediaFields: Readonly<Record<string, { readonly multiple: boolean }>>;
  readonly dynamicZones: Readonly<Record<string, readonly string[]>>;
  readonly relations: Readonly<Record<string, BffRelationOverlay>>;
  readonly componentOverrides: Readonly<Record<string, unknown>>;
}

type ViewSources =
  | { readonly kind: 'single'; readonly source: NormalizedSource }
  | { readonly kind: 'composite'; readonly sources: readonly NormalizedSource[] };

// Returns null for manifest entries this generator cannot interpret (future
// kinds, composite without sources, flat entries without a contentType) - the
// caller skips the view with a warning instead of guessing.
const normalizeViewSources = (view: BffViewManifestEntry): ViewSources | null => {
  if (view.kind === 'composite') {
    const entries = Object.entries(view.sources ?? {});
    if (entries.length === 0) return null;
    return {
      kind: 'composite',
      sources: entries.map(([name, source]) => ({
        name,
        contentType: source.contentType,
        many: source.many,
        fields: source.fields ?? [],
        componentFields: source.componentFields ?? {},
        mediaFields: source.mediaFields ?? {},
        dynamicZones: source.dynamicZones ?? {},
        relations: source.relations ?? {},
        componentOverrides: source.componentOverrides ?? {},
      })),
    };
  }
  if (!view.contentType) return null;
  return {
    kind: 'single',
    source: {
      name: null,
      contentType: view.contentType,
      many: false,
      fields: view.fields ?? [],
      componentFields: view.componentFields ?? {},
      mediaFields: view.mediaFields ?? {},
      dynamicZones: view.dynamicZones ?? {},
      relations: view.relations ?? {},
      componentOverrides: view.componentOverrides ?? {},
    },
  };
};

// Collectors every emitter appends to while one view file is built
interface ViewEmitState {
  readonly warnings: string[];
  readonly refs: string[];
  readonly usedOverrides: Map<string, TypeOverride>;
  readonly sliceDecls: string[];
  readonly usedSliceNames: Set<string>;
}

const createViewEmitState = (): ViewEmitState => ({
  warnings: [],
  refs: [],
  usedOverrides: new Map(),
  sliceDecls: [],
  usedSliceNames: new Set(),
});

type SliceConstFor = (
  uid: string,
  narrowing: Narrowing,
  withLiteral: boolean,
  sourcePrefix?: string,
) => string;

// Everything the per-attribute emitters need about the view being built
interface ViewEmitter {
  readonly view: BffViewManifestEntry;
  readonly ctx: EmitContext;
  readonly state: ViewEmitState;
  readonly sliceCtx: SliceContext;
  readonly pascal: string;
  readonly isContaminated: (uid: string) => boolean;
  readonly sliceConstFor: SliceConstFor;
}

// A source's attributes resolved against its content type, plus the prefix
// composite sources use to keep warnings and slice names apart
interface SourceScope {
  readonly source: NormalizedSource;
  readonly ct: ContentTypeIR;
  readonly attrsByName: ReadonlyMap<string, AttributeIR>;
  readonly sourcePrefix: string;
  readonly warnScope: string;
}

const buildSliceContext = (
  view: BffViewManifestEntry,
  ctx: EmitContext,
  state: ViewEmitState,
): SliceContext => ({
  primitives: ctx.primitives,
  registry: ctx.registry,
  nullableStyle: ctx.config.nullableStyle,
  componentsByUid: ctx.componentsByUid,
  contentTypesByUid: ctx.contentTypesByUid,
  overrideConfig: ctx.overrideConfig,
  resolveTransformExpression: (attr) => {
    const resolution = resolveTransform(attr, view.transforms, ctx.config);
    if (!resolution || resolution.kind === 'covered') return null;
    if (resolution.kind === 'uncovered') return 'uncovered';
    state.usedOverrides.set(resolution.override.name, resolution.override);
    return { expression: resolution.override.name, externalRefs: [resolution.override.name] };
  },
});

// Slices are cached per (source, uid, discriminator) - the same component may
// need a variant with a required __component literal (dynamic zones) and one
// without (plain component fields), and composite sources can override the
// same component differently
const createSliceCache = (
  pascal: string,
  sliceCtx: SliceContext,
  state: ViewEmitState,
): SliceConstFor => {
  const sliceNames = new Map<string, string>();

  return (uid, narrowing, withLiteral, sourcePrefix = '') => {
    const key = `${sourcePrefix}|${uid}|${withLiteral}`;
    const cached = sliceNames.get(key);
    if (cached) return cached;

    const base = `${pascal}${sourcePrefix}${componentUidToTypeName(uid)}`;
    const name = state.usedSliceNames.has(`${base}SliceSchema`)
      ? `${base}DzSliceSchema`
      : `${base}SliceSchema`;
    state.usedSliceNames.add(name);
    sliceNames.set(key, name);

    const slice = buildComponentSlice(uid, narrowing, withLiteral, 0, sliceCtx, (msg) =>
      state.warnings.push(`component '${uid}': ${msg}`),
    );
    state.refs.push(...slice.externalRefs);
    const typeName = name.replace(/Schema$/, '');
    const typeDecl = `export type ${typeName} = ${sliceCtx.primitives.inferType(name)};`;
    state.sliceDecls.push(`export const ${name} = ${slice.expression};`, typeDecl);
    return name;
  };
};

const unknownLine = (emitter: ViewEmitter, name: string, required: boolean): string => {
  const { primitives, config } = emitter.ctx;
  return `  ${name}: ${primitives.wrapNullability(primitives.unknownExpression, required, config.nullableStyle)},`;
};

const mappedLine = (emitter: ViewEmitter, scope: SourceScope, attr: AttributeIR): string => {
  const { primitives, config } = emitter.ctx;
  const mapped = mapAttribute(
    attr,
    config.nullableStyle,
    emitter.ctx.registry,
    primitives,
    scope.ct.uid,
    emitter.ctx.overrideConfig,
  );
  emitter.state.refs.push(...mapped.externalRefs);
  return `  ${attr.name}: ${mapped.expression},`;
};

const emitScalarFields = (emitter: ViewEmitter, scope: SourceScope): string[] => {
  const { primitives, config } = emitter.ctx;
  const { state } = emitter;
  const lines: string[] = [];

  for (const name of scope.source.fields) {
    const attr = scope.attrsByName.get(name);
    if (!attr) {
      state.warnings.push(
        `${scope.warnScope}field '${name}' not found on '${scope.ct.uid}' - skipped`,
      );
      continue;
    }
    const resolution = resolveTransform(attr, emitter.view.transforms, config);
    if (resolution?.kind === 'override') {
      lines.push(
        `  ${name}: ${primitives.wrapNullability(resolution.override.name, attr.required, config.nullableStyle)},`,
      );
      state.refs.push(resolution.override.name);
      state.usedOverrides.set(resolution.override.name, resolution.override);
      continue;
    }
    if (resolution?.kind === 'uncovered') {
      state.warnings.push(
        `${scope.warnScope}field '${name}' is transformed by '${resolution.name}' with no schema mapping - add viewTransformSchemas['${resolution.name}'] (or a typeOverride for its field type); emitted as unknown`,
      );
      lines.push(unknownLine(emitter, name, attr.required));
      continue;
    }
    lines.push(mappedLine(emitter, scope, attr));
  }

  return lines;
};

// planner.components overrides are Document-Service populate values - when
// declarative, emit an exact view-local slice; otherwise degrade loudly.
const emitComponentFields = (emitter: ViewEmitter, scope: SourceScope): string[] => {
  const { primitives, config } = emitter.ctx;
  const { state } = emitter;
  const lines: string[] = [];

  for (const [name, componentUid] of Object.entries(scope.source.componentFields)) {
    const attr = scope.attrsByName.get(name);
    if (!attr) {
      state.warnings.push(
        `${scope.warnScope}component field '${name}' not found on '${scope.ct.uid}' - skipped`,
      );
      continue;
    }
    if (scope.source.componentOverrides[componentUid] !== undefined) {
      const narrowing = parseNarrowing(scope.source.componentOverrides[componentUid]);
      if (narrowing === null) {
        state.warnings.push(
          `${scope.warnScope}component field '${name}' ('${componentUid}') has a planner.components override the generator cannot interpret - emitted as unknown`,
        );
        lines.push(unknownLine(emitter, name, attr.required));
        continue;
      }
      const sliceName = emitter.sliceConstFor(componentUid, narrowing, false, scope.sourcePrefix);
      const base = attr.repeatable ? primitives.arrayWrap(sliceName) : sliceName;
      lines.push(
        `  ${name}: ${primitives.wrapNullability(base, attr.required, config.nullableStyle)},`,
      );
      continue;
    }
    if (emitter.isContaminated(componentUid)) {
      state.warnings.push(
        `${scope.warnScope}component field '${name}' ('${componentUid}') contains transform-matched fields not reflected in the shared component schemas - emitted as unknown`,
      );
      lines.push(unknownLine(emitter, name, attr.required));
      continue;
    }
    lines.push(mappedLine(emitter, scope, attr));
  }

  return lines;
};

const emitMediaFields = (emitter: ViewEmitter, scope: SourceScope): string[] => {
  const { primitives, config } = emitter.ctx;
  const { state } = emitter;
  const lines: string[] = [];

  for (const [name, media] of Object.entries(scope.source.mediaFields)) {
    if (!scope.attrsByName.has(name)) {
      state.warnings.push(
        `${scope.warnScope}media field '${name}' not found on '${scope.ct.uid}' - skipped`,
      );
      continue;
    }
    const expression = media.multiple
      ? primitives.arrayWrap(UPLOAD_FILE_SCHEMA_NAME)
      : UPLOAD_FILE_SCHEMA_NAME;
    lines.push(
      `  ${name}: ${primitives.wrapNullability(expression, false, config.nullableStyle)},`,
    );
    state.refs.push(UPLOAD_FILE_SCHEMA_NAME);
  }

  return lines;
};

interface ZoneMembers {
  // Members with a declarative planner.components override -> exact slices
  readonly overridden: ReadonlyMap<string, Narrowing>;
  // Members whose override the generator cannot interpret
  readonly uninterpretable: readonly string[];
  // Members whose shared schema is wrong for this view (transform inside)
  readonly contaminated: readonly string[];
}

const classifyZoneMembers = (
  emitter: ViewEmitter,
  scope: SourceScope,
  memberUids: readonly string[],
): ZoneMembers => {
  const overridden = new Map<string, Narrowing>();
  const uninterpretable: string[] = [];
  for (const uid of memberUids) {
    if (scope.source.componentOverrides[uid] === undefined) continue;
    const narrowing = parseNarrowing(scope.source.componentOverrides[uid]);
    if (narrowing === null) uninterpretable.push(uid);
    else overridden.set(uid, narrowing);
  }
  const contaminated = memberUids.filter(
    (uid) => !overridden.has(uid) && !uninterpretable.includes(uid) && emitter.isContaminated(uid),
  );
  return { overridden, uninterpretable, contaminated };
};

const describeDegradedZone = (members: ZoneMembers): string =>
  [
    ...(members.uninterpretable.length > 0
      ? [
          `planner.components overrides the generator cannot interpret [${members.uninterpretable.join(', ')}]`,
        ]
      : []),
    ...(members.contaminated.length > 0
      ? [`transform-affected components [${members.contaminated.join(', ')}]`]
      : []),
  ].join('; ');

// Mixed zone: overridden members as view-local slices (with a required
// __component literal), the rest as their shared schemas. The discriminator
// survives unless a shared member is dual-use (nullish __component).
const buildMixedZoneUnion = (
  emitter: ViewEmitter,
  scope: SourceScope,
  memberUids: readonly string[],
  overridden: ReadonlyMap<string, Narrowing>,
): string => {
  const { primitives, registry } = emitter.ctx;
  const memberExprs: string[] = [];
  let hasDualUseSharedMember = false;
  for (const uid of memberUids) {
    const narrowing = overridden.get(uid);
    if (narrowing !== undefined) {
      memberExprs.push(emitter.sliceConstFor(uid, narrowing, true, scope.sourcePrefix));
      continue;
    }
    const varName = registry.components.get(uid);
    if (!varName) continue;
    if (registry.dualUseUIDs?.has(uid)) hasDualUseSharedMember = true;
    memberExprs.push(varName);
    emitter.state.refs.push(varName);
  }
  return hasDualUseSharedMember
    ? primitives.union(memberExprs)
    : primitives.discriminatedUnion(memberExprs);
};

// Overridden members with a declarative override get exact slices; only
// uninterpretable overrides or transform-contaminated members still force
// the whole zone to degrade.
const emitDynamicZones = (emitter: ViewEmitter, scope: SourceScope): string[] => {
  const { primitives, config, registry } = emitter.ctx;
  const { state } = emitter;
  const lines: string[] = [];

  for (const [zone, memberUids] of Object.entries(scope.source.dynamicZones)) {
    const attr = scope.attrsByName.get(zone);
    if (!attr) {
      state.warnings.push(
        `${scope.warnScope}dynamic zone '${zone}' not found on '${scope.ct.uid}' - skipped`,
      );
      continue;
    }

    const members = classifyZoneMembers(emitter, scope, memberUids);
    if (members.uninterpretable.length > 0 || members.contaminated.length > 0) {
      state.warnings.push(
        `${scope.warnScope}dynamic zone '${zone}' emitted as an array of unknown - ${describeDegradedZone(members)}`,
      );
      lines.push(
        `  ${zone}: ${primitives.wrapNullability(primitives.arrayWrap(primitives.unknownExpression), attr.required, config.nullableStyle)},`,
      );
      continue;
    }

    if (members.overridden.size === 0) {
      const restricted: AttributeIR = { ...attr, componentUIDs: memberUids };
      const mapped = primitives.mapDynamiczone(restricted, registry);
      lines.push(
        `  ${zone}: ${primitives.wrapNullability(mapped.expression, attr.required, config.nullableStyle)},`,
      );
      state.refs.push(...mapped.externalRefs);
      continue;
    }

    const union = buildMixedZoneUnion(emitter, scope, memberUids, members.overridden);
    lines.push(
      `  ${zone}: ${primitives.wrapNullability(primitives.arrayWrap(union), attr.required, config.nullableStyle)},`,
    );
  }

  return lines;
};

const emitRelations = (emitter: ViewEmitter, scope: SourceScope): string[] => {
  const { state } = emitter;
  const lines: string[] = [];

  for (const [name, overlay] of Object.entries(scope.source.relations)) {
    const attr = scope.attrsByName.get(name);
    if (!attr || attr.type !== 'relation') {
      state.warnings.push(
        `${scope.warnScope}relation '${name}' not found on '${scope.ct.uid}' - skipped`,
      );
      continue;
    }
    const relation = buildRelationExpression(name, overlay, attr, emitter.sliceCtx, (msg) =>
      state.warnings.push(`${scope.warnScope}${msg}`),
    );
    lines.push(`  ${name}: ${relation.expression},`);
    state.refs.push(...relation.externalRefs);
  }

  return lines;
};

// Returns null when the source's content type is not generated
const buildSourceLines = (emitter: ViewEmitter, source: NormalizedSource): string[] | null => {
  const ct = emitter.ctx.contentTypesByUid.get(source.contentType);
  if (!ct) return null;

  const scope: SourceScope = {
    source,
    ct,
    attrsByName: new Map(ct.attributes.map((a) => [a.name, a])),
    sourcePrefix: source.name ? toPascalCase(source.name) : '',
    warnScope: source.name ? `source '${source.name}': ` : '',
  };

  // The runtime always returns the numeric row id even when the planner
  // doesn't select it, and adapters pin on it - promise it like slices do.
  return [
    `  id: ${emitter.ctx.primitives.idExpression},`,
    ...emitScalarFields(emitter, scope),
    ...emitComponentFields(emitter, scope),
    ...emitMediaFields(emitter, scope),
    ...emitDynamicZones(emitter, scope),
    ...emitRelations(emitter, scope),
  ];
};

// Composite data = object of per-source shapes: single-doc sources are
// nullable (composites never 404 - an absent source is null), `many`
// sources are the full unfiltered list
const buildCompositeLines = (
  emitter: ViewEmitter,
  sources: readonly NormalizedSource[],
): string[] => {
  const { primitives, config } = emitter.ctx;
  const lines: string[] = [];

  for (const source of sources) {
    const sourceLines = buildSourceLines(emitter, source);
    if (sourceLines === null) {
      emitter.state.warnings.push(
        `source '${source.name}': content type '${source.contentType}' is not in the generated content types - emitted as unknown`,
      );
      lines.push(
        `  ${source.name}: ${primitives.wrapNullability(primitives.unknownExpression, false, config.nullableStyle)},`,
      );
      continue;
    }
    const inner = sourceLines.map((line) => `  ${line}`).join('\n');
    const objectExpr = `${primitives.objectOpen(false)}\n${inner}\n  ${primitives.objectClose(false)}`;
    const value = source.many
      ? primitives.arrayWrap(objectExpr)
      : primitives.wrapNullability(objectExpr, false, config.nullableStyle);
    lines.push(`  ${source.name}: ${value},`);
  }

  return lines;
};

interface DataSection {
  readonly dataName: string;
  readonly dataTypeName: string;
  readonly parts: readonly string[];
}

const buildDataSection = (emitter: ViewEmitter, lines: readonly string[]): DataSection => {
  const { view, pascal } = emitter;
  const { primitives } = emitter.ctx;
  const dataName = view.hasAssemble ? `${pascal}MergedSchema` : `${pascal}DataSchema`;
  const dataTypeName = view.hasAssemble ? `${pascal}Merged` : `${pascal}Data`;
  // Enrich hooks add fields the schema cannot know about - allow extras.
  const loose = view.hasEnrich;
  const body = lines.join('\n');

  const parts: string[] = [];
  if (view.hasAssemble) {
    parts.push(
      [
        `// View '${view.id}' declares an assemble hook: the final response shape is`,
        `// defined by that hook. ${dataName} describes the merged document the hook`,
        '// receives - compose your response schema on top of it.',
      ].join('\n'),
    );
  }
  parts.push(
    ...emitter.state.sliceDecls,
    `export const ${dataName} = ${primitives.objectOpen(loose)}\n${body}\n${primitives.objectClose(loose)};`,
    `export type ${dataTypeName} = ${primitives.inferType(dataName)};`,
  );

  if (!view.hasAssemble) {
    const responseName = `${pascal}ResponseSchema`;
    const metaExpr = buildViewMetaExpression(primitives, view.id);
    parts.push(
      buildEnvelopeDeclaration(primitives, responseName, dataName, metaExpr),
      `export type ${pascal}Response = ${primitives.inferType(responseName)};`,
    );
  }

  return { dataName, dataTypeName, parts };
};

// Auto-import: exact-match scan of the declared string against the generated
// export registry (component/CT schema vars, UploadFileSchema, override
// names). View slices are in scope in this file already.
const collectDeclarationRefs = (
  emitter: ViewEmitter,
  declaration: ViewResponseDeclaration,
): void => {
  const { config, registry } = emitter.ctx;
  const { state } = emitter;
  const knownOverridesByName = new Map(
    [
      ...Object.values(config.typeOverrides),
      ...Object.values(config.fieldOverrides),
      ...Object.values(config.viewTransformSchemas),
    ].map((override) => [override.name, override] as const),
  );
  const generatedExports = new Set([
    UPLOAD_FILE_SCHEMA_NAME,
    ...registry.components.values(),
    ...registry.contentTypes.values(),
  ]);
  const identifiers = new Set(declaration.schema.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []);
  for (const identifier of identifiers) {
    if (generatedExports.has(identifier)) {
      state.refs.push(identifier);
      continue;
    }
    const override = knownOverridesByName.get(identifier);
    if (override) {
      state.refs.push(identifier);
      state.usedOverrides.set(override.name, override);
    }
  }
};

interface DeclarationSection {
  readonly parts: readonly string[];
  readonly imports: readonly string[];
  readonly emitted: boolean;
}

const NO_DECLARATION: DeclarationSection = { parts: [], imports: [], emitted: false };

// The consumer-declared response schema is emitted verbatim; generated
// exports it references are imported automatically
const buildDeclarationSection = (emitter: ViewEmitter, data: DataSection): DeclarationSection => {
  const { view, pascal, state } = emitter;
  const { primitives, config } = emitter.ctx;
  const declaration = config.viewResponseSchemas[view.id];
  if (!declaration) return NO_DECLARATION;

  // Reserve only identifiers this file ACTUALLY emits: assemble views never
  // emit `${pascal}ResponseSchema`, so `X` + `XSchema` - the most natural
  // declaration naming pair - must not false-positive against it
  const reservedNames = new Set([
    data.dataName,
    data.dataTypeName,
    ...state.usedSliceNames,
    ...[...state.usedSliceNames].map((name) => name.replace(/Schema$/, '')),
    ...(view.hasAssemble ? [] : [`${pascal}ResponseSchema`, `${pascal}Response`]),
  ]);
  if (reservedNames.has(declaration.name) || reservedNames.has(declaration.typeName)) {
    state.warnings.push(
      `viewResponseSchemas declaration '${declaration.name}' collides with a generated export - declaration skipped`,
    );
    return NO_DECLARATION;
  }

  collectDeclarationRefs(emitter, declaration);

  const typeName = declaration.typeName;
  const successName = `${typeName}SuccessSchema`;
  const resultName = `${typeName}ResultSchema`;
  const metaExpr = buildViewMetaExpression(primitives, view.id);

  return {
    emitted: true,
    imports: [
      `import { BffErrorEnvelopeSchema } from './envelope';`,
      ...(declaration.imports ?? []),
    ],
    parts: [
      [
        `// Consumer-declared response schema for the '${view.id}' assemble output`,
        `// (viewResponseSchemas config). The declaration is a claim about the`,
        `// assemble hook's arbitrary code - runtime parity checks verify it.`,
      ].join('\n'),
      `export const ${declaration.name} = ${declaration.schema};`,
      `export type ${typeName} = ${primitives.inferType(declaration.name)};`,
      buildEnvelopeDeclaration(primitives, successName, declaration.name, metaExpr),
      `export type ${typeName}Success = ${primitives.inferType(successName)};`,
      `export const ${resultName} = ${primitives.union([successName, 'BffErrorEnvelopeSchema'])};`,
      `export type ${typeName}Result = ${primitives.inferType(resultName)};`,
    ],
  };
};

const buildWarningsHeader = (warnings: readonly string[]): readonly string[] =>
  warnings.length > 0
    ? [['/*', ' * GENERATOR WARNINGS:', ...warnings.map((w) => ` * - ${w}`), ' */'].join('\n')]
    : [];

const assembleViewFile = (
  emitter: ViewEmitter,
  codeParts: readonly string[],
  declarationImports: readonly string[],
): string => {
  const { primitives, registry } = emitter.ctx;
  const code = codeParts.join('\n\n');
  const reverseMap = buildReverseMap(registry);
  const externalImports = [...new Set(emitter.state.refs)].map((ref) =>
    classifyExternalRef(ref, reverseMap),
  );

  return [
    FILE_HEADER,
    primitives.buildImportStatement([code]),
    ...primitives.typeImportStatements,
    ...declarationImports,
    ...buildExternalImportStatements(externalImports, 'views'),
    '',
    code,
    '',
  ].join('\n');
};

const buildViewFile = (
  view: BffViewManifestEntry,
  ctx: EmitContext,
  isContaminated: (uid: string) => boolean,
  warnings: string[],
): BuiltView | null => {
  const sources = normalizeViewSources(view);
  if (!sources) {
    warnings.push(
      `view '${view.id}': unsupported manifest entry (composite without sources, or no contentType) - view skipped`,
    );
    return null;
  }

  const state = createViewEmitState();
  const pascal = toPascalCase(view.id);
  const sliceCtx = buildSliceContext(view, ctx, state);
  const emitter: ViewEmitter = {
    view,
    ctx,
    state,
    sliceCtx,
    pascal,
    isContaminated,
    sliceConstFor: createSliceCache(pascal, sliceCtx, state),
  };

  const lines =
    sources.kind === 'composite'
      ? buildCompositeLines(emitter, sources.sources)
      : buildSourceLines(emitter, sources.source);
  if (lines === null) {
    warnings.push(
      `view '${view.id}': content type '${sources.kind === 'single' ? sources.source.contentType : ''}' is not in the generated content types - view skipped`,
    );
    return null;
  }

  const data = buildDataSection(emitter, lines);
  const declaration = buildDeclarationSection(emitter, data);
  const codeParts = [...buildWarningsHeader(state.warnings), ...data.parts, ...declaration.parts];

  warnings.push(...state.warnings.map((w) => `view '${view.id}': ${w}`));

  return {
    viewId: view.id,
    path: `views/${view.id}.ts`,
    content: assembleViewFile(emitter, codeParts, declaration.imports),
    usedOverrides: [...state.usedOverrides.values()],
    declarationEmitted: declaration.emitted,
  };
};

// meta may additionally carry `explain` - keep it open
const buildViewMetaExpression = (primitives: TargetPrimitives, viewId: string): string =>
  `${primitives.objectOpen(true)} view: ${primitives.literal(viewId)} ${primitives.objectClose(true)}`;

const buildEnvelopeDeclaration = (
  primitives: TargetPrimitives,
  name: string,
  dataExpr: string,
  metaExpr: string,
): string =>
  `export const ${name} = ${primitives.objectOpen(false)}\n  data: ${dataExpr},\n  meta: ${metaExpr},\n${primitives.objectClose(false)};`;

const buildEnvelopeFile = (primitives: TargetPrimitives): string => {
  const code = [
    `export const BffErrorEnvelopeSchema = ${primitives.objectOpen(false)}`,
    `  data: ${primitives.nullExpression},`,
    `  error: ${primitives.objectOpen(false)}`,
    `    status: ${primitives.primitiveMap['integer'] ?? primitives.unknownExpression},`,
    `    name: ${primitives.primitiveMap['string'] ?? primitives.unknownExpression},`,
    `    message: ${primitives.primitiveMap['string'] ?? primitives.unknownExpression},`,
    `  ${primitives.objectClose(false)},`,
    `${primitives.objectClose(false)};`,
    ``,
    `export type BffErrorEnvelope = ${primitives.inferType('BffErrorEnvelopeSchema')};`,
  ].join('\n');

  const importStatement = [
    primitives.buildImportStatement([code]),
    ...primitives.typeImportStatements,
  ].join('\n');

  return [FILE_HEADER, importStatement, '', code, ''].join('\n');
};

/**
 * Emits per-view response schemas derived from the bff-views manifest. The
 * derivation follows the runtime exactly: scalar subset from the core query,
 * dynamic zones restricted to the zone's members, relations from the overlays,
 * transforms via configured schema overrides. Anything the generator cannot
 * express degrades to unknown() with a warning - never a silently-wrong schema.
 */
// View ids become file names (views/<id>.ts) and identifier bases, so only
// characters that are safe in both are accepted; anything else is skipped
const VIEW_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const generateViewFiles = (
  manifest: BffViewManifest,
  contentTypes: readonly ContentTypeIR[],
  components: readonly ComponentIR[],
  registry: SchemaRegistry,
  config: GenerationOptions,
): ViewGenerationOutput => {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  const allUsedOverrides = new Map<string, TypeOverride>();

  const componentsByUid = new Map(components.map((c) => [c.uid, c]));
  const ctx: EmitContext = {
    primitives: getAdapter(config.target).primitives,
    registry,
    config,
    contentTypesByUid: new Map(contentTypes.map((ct) => [ct.uid, ct])),
    componentsByUid,
    overrideConfig: { typeOverrides: config.typeOverrides, fieldOverrides: config.fieldOverrides },
  };

  const builtViews = manifest.views.flatMap((view) => {
    if (!VIEW_ID_PATTERN.test(view.id)) {
      warnings.push(
        `view '${view.id}': id must contain only letters, digits, '-' and '_' - view skipped`,
      );
      return [];
    }
    const isContaminated = buildContaminationChecker(componentsByUid, view.transforms, config);
    const built = buildViewFile(view, ctx, isContaminated, warnings);
    return built ? [built] : [];
  });

  const declaredViewIds = new Set(
    builtViews.filter((built) => built.declarationEmitted).map((built) => built.viewId),
  );

  if (builtViews.length === 0) {
    return { files, usedOverrides: [], warnings, declaredViewIds };
  }

  for (const built of builtViews) {
    files.set(built.path, built.content);
    for (const override of built.usedOverrides) allUsedOverrides.set(override.name, override);
  }

  files.set('views/envelope.ts', buildEnvelopeFile(ctx.primitives));

  const barrel = [
    FILE_HEADER,
    ...builtViews.map((built) => {
      const name = built.path.replace('views/', './').replace('.ts', '');
      return `export * from '${name}';`;
    }),
    `export * from './envelope';`,
    '',
  ].join('\n');
  files.set('views/index.ts', barrel);

  files.set(
    'views/manifest.json',
    `${JSON.stringify({ ...manifest, generatorWarnings: warnings }, null, 2)}\n`,
  );

  return { files, usedOverrides: [...allUsedOverrides.values()], warnings, declaredViewIds };
};
