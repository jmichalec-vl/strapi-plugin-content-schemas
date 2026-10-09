import type {
  ContentSchemasConfig,
  TypeOverride,
  TargetOverrides,
  TargetViewResponseSchemas,
} from '../types';
import { ContentSchemasConfigError } from '../errors';

// Override names are emitted verbatim as `export const <name>` / `export type
// <typeName>`; anything that is not an identifier produces a broken file
const TS_IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

const validateIdentifier = (value: unknown, label: string): void => {
  if (!value || typeof value !== 'string') {
    throw new ContentSchemasConfigError(`[content-schemas] ${label} must be a non-empty string.`);
  }
  if (!TS_IDENTIFIER_PATTERN.test(value)) {
    throw new ContentSchemasConfigError(
      `[content-schemas] ${label} must be a valid TypeScript identifier. Got: ${JSON.stringify(value)}`,
    );
  }
};

const validateOverride = (key: string, override: TypeOverride, context: string): void => {
  if (!override.schema || typeof override.schema !== 'string') {
    throw new ContentSchemasConfigError(
      `[content-schemas] ${context}.${key}.schema must be a non-empty string.`,
    );
  }
  validateIdentifier(override.name, `${context}.${key}.name`);
  validateIdentifier(override.typeName, `${context}.${key}.typeName`);
};

const validateTargetOverrides = (overrides: TargetOverrides, context: string): void => {
  for (const [target, targetOverrides] of Object.entries(overrides)) {
    if (typeof targetOverrides !== 'object' || targetOverrides === null) continue;
    for (const [key, override] of Object.entries(targetOverrides)) {
      validateOverride(key, override, `${context}.${target}`);
    }
  }
};

const validateUniqueNames = (overrides: TargetOverrides, context: string): void => {
  for (const [target, targetOverrides] of Object.entries(overrides)) {
    if (typeof targetOverrides !== 'object' || targetOverrides === null) continue;
    const seenNames = new Set<string>();
    for (const override of Object.values(targetOverrides)) {
      if (seenNames.has(override.name)) {
        throw new ContentSchemasConfigError(
          `[content-schemas] Duplicate override name "${override.name}" in ${context}.${target}. Override names must be unique.`,
        );
      }
      seenNames.add(override.name);
    }
  }
};

const IDENTIFIER_BASE_PATTERN = /^[A-Z][A-Za-z0-9]*$/;

const validateNameOverrides = (overrides: Readonly<Record<string, string>>): void => {
  for (const [uid, name] of Object.entries(overrides)) {
    if (!uid.includes('.') || uid.includes('::')) {
      throw new ContentSchemasConfigError(
        `[content-schemas] nameOverrides keys must be component uids ('<category>.<name>'). Got: "${uid}"`,
      );
    }
    if (typeof name !== 'string' || !IDENTIFIER_BASE_PATTERN.test(name)) {
      throw new ContentSchemasConfigError(
        `[content-schemas] nameOverrides["${uid}"] must be a PascalCase identifier base ` +
          `(e.g. 'CatalogFormComponent'). Got: ${JSON.stringify(name)}`,
      );
    }
  }
};

const validateViewResponseImports = (declarations: TargetViewResponseSchemas): void => {
  for (const [target, byView] of Object.entries(declarations)) {
    if (typeof byView !== 'object' || byView === null) continue;
    for (const [viewId, declaration] of Object.entries(byView)) {
      const imports = declaration.imports;
      if (imports === undefined) continue;
      if (!Array.isArray(imports) || imports.some((line) => typeof line !== 'string')) {
        throw new ContentSchemasConfigError(
          `[content-schemas] viewResponseSchemas.${target}.${viewId}.imports must be an array of import-line strings.`,
        );
      }
    }
  }
};

export const defaultConfig: ContentSchemasConfig = {
  contentTypes: ['api::*'],
  components: 'referenced',
  includeInternalFields: { timestamps: false },
  typeOverrides: {},
  fieldOverrides: {},
  viewTransformSchemas: {},
  viewResponseSchemas: {},
  nameOverrides: {},
};

const validator = (config: ContentSchemasConfig): void => {
  if (!Array.isArray(config.contentTypes) || config.contentTypes.length === 0) {
    throw new ContentSchemasConfigError(
      '[content-schemas] contentTypes must be a non-empty array of UID patterns.',
    );
  }
  for (const pattern of config.contentTypes) {
    if (typeof pattern !== 'string') {
      throw new ContentSchemasConfigError(
        `[content-schemas] contentTypes entries must be strings. Got: ${JSON.stringify(pattern)}`,
      );
    }
  }

  if (typeof config.includeInternalFields !== 'object' || config.includeInternalFields === null) {
    throw new ContentSchemasConfigError(
      '[content-schemas] includeInternalFields must be an object.',
    );
  }
  if (typeof config.includeInternalFields.timestamps !== 'boolean') {
    throw new ContentSchemasConfigError(
      '[content-schemas] includeInternalFields.timestamps must be a boolean.',
    );
  }

  const validComponentFilters = ['referenced', 'all'];
  if (typeof config.components !== 'string' && !Array.isArray(config.components)) {
    throw new ContentSchemasConfigError(
      '[content-schemas] components must be "referenced", "all", or an array of component UIDs.',
    );
  }
  if (Array.isArray(config.components)) {
    for (const uid of config.components) {
      if (typeof uid !== 'string') {
        throw new ContentSchemasConfigError(
          `[content-schemas] components entries must be strings. Got: ${JSON.stringify(uid)}`,
        );
      }
    }
  }
  if (typeof config.components === 'string' && !validComponentFilters.includes(config.components)) {
    throw new ContentSchemasConfigError(
      `[content-schemas] components must be one of: ${validComponentFilters.join(', ')}. Got: "${config.components}"`,
    );
  }

  validateTargetOverrides(config.typeOverrides, 'typeOverrides');
  validateTargetOverrides(config.fieldOverrides, 'fieldOverrides');
  validateTargetOverrides(config.viewTransformSchemas ?? {}, 'viewTransformSchemas');
  validateTargetOverrides(config.viewResponseSchemas ?? {}, 'viewResponseSchemas');
  validateUniqueNames(config.typeOverrides, 'typeOverrides');
  validateUniqueNames(config.fieldOverrides, 'fieldOverrides');
  validateUniqueNames(config.viewTransformSchemas ?? {}, 'viewTransformSchemas');
  validateUniqueNames(config.viewResponseSchemas ?? {}, 'viewResponseSchemas');
  validateViewResponseImports(config.viewResponseSchemas ?? {});
  validateNameOverrides(config.nameOverrides ?? {});
};

export default {
  default: defaultConfig,
  validator,
};
