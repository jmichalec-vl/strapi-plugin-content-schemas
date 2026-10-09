import type { AttributeIR } from '../types';
import { escapeSingleQuoted } from '../utils';

// Emits the modern enum pattern for every enumeration attribute: a literal
// union stays the source of truth (schemas keep validating raw wire values),
// and a same-named `as const` object provides autocompleted, refactor-safe
// value references. Declaration merging lets the const and the type share one
// name. TS `enum` is deliberately not used: it is non-erasable syntax
// (rejected by --erasableSyntaxOnly and Node type stripping) and nominally
// typed, which would force casts on raw REST values.

export interface EnumArtifact {
  // Shared by the const object and the derived type
  readonly name: string;
  readonly attrName: string;
  readonly values: readonly string[];
}

// 'SOCIAL_NETWORK' → SocialNetwork, 'ModelType' → ModelType, 'top10' → Top10.
// All-caps segments are title-cased; mixed-case segments keep their interior
// casing so camelCase inputs survive.
const pascalSegment = (segment: string): string => {
  const isAllCaps = /^[A-Z0-9]+$/.test(segment) && /[A-Z]/.test(segment);
  const body = isAllCaps ? segment.slice(1).toLowerCase() : segment.slice(1);
  return segment.charAt(0).toUpperCase() + body;
};

const toPascalIdentifier = (input: string): string =>
  input
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map(pascalSegment)
    .join('');

// Key for a raw enum value: 'At-home test kit' → AtHomeTestKit. Values stay
// raw - only the key is an identifier. Leading digits are prefixed and empty
// results fall back to a placeholder so every value gets a key.
export const enumKeyName = (value: string): string => {
  const pascal = toPascalIdentifier(value);
  if (pascal.length === 0) return 'Empty';
  return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal;
};

// The parent file already exports `<Parent>`, `<Parent>Schema` and
// `<Parent>PopulateInput`; an enum artifact landing on one of those names
// (attribute named `schema`, enumName equal to the type) would redeclare it
const PARENT_EXPORT_SUFFIXES = ['', 'Schema', 'PopulateInput'] as const;

const avoidParentExports = (name: string, parentTypeName: string): string =>
  PARENT_EXPORT_SUFFIXES.some((suffix) => name === `${parentTypeName}${suffix}`)
    ? `${name}Enum`
    : name;

const perAttributeName = (parentTypeName: string, attr: AttributeIR): string =>
  avoidParentExports(`${parentTypeName}${toPascalIdentifier(attr.name)}`, parentTypeName);

export const enumArtifactName = (parentTypeName: string, attr: AttributeIR): string =>
  attr.enumName
    ? avoidParentExports(toPascalIdentifier(attr.enumName), parentTypeName)
    : perAttributeName(parentTypeName, attr);

const sameValues = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const collectEnumArtifacts = (
  parentTypeName: string,
  attributes: readonly AttributeIR[],
): readonly EnumArtifact[] => {
  const byName = new Map<string, EnumArtifact>();

  for (const attr of attributes) {
    if (attr.type !== 'enumeration') continue;
    const values = attr.enumValues ?? [];
    if (values.length === 0) continue;

    let name = enumArtifactName(parentTypeName, attr);
    const existing = byName.get(name);
    if (existing) {
      // Two attrs sharing an enumName with identical values share one artifact;
      // divergent values fall back to the collision-free per-attr name
      if (sameValues(existing.values, values)) continue;
      name = perAttributeName(parentTypeName, attr);
    }
    byName.set(name, { name, attrName: attr.name, values });
  }

  return [...byName.values()];
};

// The artifact type name an interface field should reference, or null when the
// attribute gets no artifact (no values) and the caller should fall back.
export const enumTypeNameFor = (
  parentTypeName: string,
  attr: AttributeIR,
  artifacts: readonly EnumArtifact[],
): string | null => {
  if (attr.type !== 'enumeration' || (attr.enumValues ?? []).length === 0) return null;
  const values = attr.enumValues ?? [];
  const match = artifacts.find(
    (artifact) =>
      sameValues(artifact.values, values) &&
      (artifact.attrName === attr.name || artifact.name === enumArtifactName(parentTypeName, attr)),
  );
  return match?.name ?? null;
};

const buildKeyLines = (values: readonly string[]): readonly string[] => {
  const used = new Map<string, number>();
  return values.map((value) => {
    const base = enumKeyName(value);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    // Distinct raw values can sanitize to the same key ('a-b' and 'a b') -
    // deterministic numeric suffixes keep every value reachable
    const key = count === 0 ? base : `${base}${count + 1}`;
    return `  ${key}: '${escapeSingleQuoted(value)}',`;
  });
};

export const generateEnumArtifactCode = (artifacts: readonly EnumArtifact[]): string | null => {
  if (artifacts.length === 0) return null;

  return artifacts
    .map((artifact) =>
      [
        `export const ${artifact.name} = {`,
        ...buildKeyLines(artifact.values),
        `} as const;`,
        `export type ${artifact.name} = (typeof ${artifact.name})[keyof typeof ${artifact.name}];`,
      ].join('\n'),
    )
    .join('\n\n');
};
