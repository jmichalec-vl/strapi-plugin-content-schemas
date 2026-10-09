// Parses a Strapi Document-Service populate value into a narrowing IR the
// schema generators can interpret. This module knows nothing about bff-views -
// it understands core Strapi populate vocabulary (fields/populate/on, plus
// shape-irrelevant query keys); the view generator merely happens to receive
// such values via the bff-views manifest. Anything outside the understood
// vocabulary returns null so callers keep the honest unknown() degradation.

export interface NarrowingObject {
  readonly fields?: readonly string[];
  readonly populate?: Readonly<Record<string, Narrowing>>;
  readonly on?: Readonly<Record<string, Narrowing>>;
}

export type Narrowing = true | NarrowingObject;

// Query-shaping keys that never change the response shape
const SHAPE_IRRELEVANT_KEYS = new Set(['sort', 'filters', 'pagination', 'start', 'limit']);

const SHAPE_KEYS = new Set(['fields', 'populate', 'on']);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseRecord = (value: unknown): Readonly<Record<string, Narrowing>> | null => {
  if (!isPlainObject(value)) return null;
  const entries: [string, Narrowing][] = [];
  for (const [key, entry] of Object.entries(value)) {
    // `false` means "do not populate" - same as the key being absent
    if (entry === false) continue;
    const parsed = parseNarrowing(entry);
    if (parsed === null) return null;
    entries.push([key, parsed]);
  }
  return Object.fromEntries(entries);
};

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

export const parseNarrowing = (value: unknown): Narrowing | null => {
  if (value === true) return true;
  if (!isPlainObject(value)) return null;

  for (const key of Object.keys(value)) {
    if (!SHAPE_KEYS.has(key) && !SHAPE_IRRELEVANT_KEYS.has(key)) return null;
  }

  let fields: readonly string[] | undefined;
  if (value.fields !== undefined) {
    if (!isStringArray(value.fields)) return null;
    fields = value.fields;
  }

  let populate: Readonly<Record<string, Narrowing>> | undefined;
  if (value.populate !== undefined) {
    const parsed = parseRecord(value.populate);
    if (parsed === null) return null;
    populate = parsed;
  }

  let on: Readonly<Record<string, Narrowing>> | undefined;
  if (value.on !== undefined) {
    const parsed = parseRecord(value.on);
    if (parsed === null) return null;
    on = parsed;
  }

  return {
    ...(fields && { fields }),
    ...(populate && { populate }),
    ...(on && { on }),
  };
};
