import { POPULATABLE_TYPES } from '../types/ir';
import type { AttributeIR, ComponentIR, ContentTypeIR } from '../types';
import {
  toPopulateTypeName,
  toTypeExportName,
  componentUidToPopulateTypeName,
  componentUidToTypeName,
  contentTypeUidToSingularName,
} from '../utils';
import type { ComponentRegistry } from './populate-generator';
import type { SchemaRegistry } from './schema-registry';

interface PopulateTypeField {
  readonly name: string;
  readonly typeExpression: string;
}

const buildComponentPopulateFields = (
  uid: string,
  componentRegistry: ComponentRegistry,
  visited: Set<string>,
): readonly PopulateTypeField[] => {
  if (visited.has(uid)) return [];

  const component = componentRegistry[uid];
  if (!component) return [];

  visited.add(uid);
  const fields = buildPopulateFields(component.attributes, componentRegistry, visited);
  visited.delete(uid);

  return fields;
};

const buildPopulateObjectType = (populateType: string | null, entityType: string): string => {
  const parts = [
    `readonly fields?: readonly (keyof ${entityType})[]`,
    ...(populateType ? [`readonly populate?: ${populateType}`] : []),
  ];
  return `true | { ${parts.join('; ')} }`;
};

const buildRelationFieldType = (
  attr: AttributeIR,
  registry: SchemaRegistry,
  populatableContentTypeUIDs: ReadonlySet<string>,
): string => {
  const target = attr.relationTarget;
  if (!target || !registry.contentTypes.has(target)) return 'true';

  const targetSingularName = contentTypeUidToSingularName(target);
  const targetEntityType = toTypeExportName(targetSingularName);
  // Scalar-only targets get no PopulateInput interface - referencing one
  // would import a type that is never generated
  const targetPopulateType = populatableContentTypeUIDs.has(target)
    ? toPopulateTypeName(targetSingularName)
    : null;
  return buildPopulateObjectType(targetPopulateType, targetEntityType);
};

const buildDynamicZoneFieldType = (
  attr: AttributeIR,
  componentRegistry: ComponentRegistry,
  visited: Set<string>,
): string => {
  // Excluded components have no generated type to reference in `keyof`
  const uids = (attr.componentUIDs ?? []).filter((uid) => componentRegistry[uid]);
  if (uids.length === 0) return 'true';

  const onEntries = uids.map((uid) => {
    const compFields = buildComponentPopulateFields(uid, componentRegistry, visited);
    const entityType = componentUidToTypeName(uid);

    if (compFields.length === 0) {
      return `    readonly '${uid}'?: true | { readonly fields?: readonly (keyof ${entityType})[] };`;
    }

    const populateType = componentUidToPopulateTypeName(uid);
    return `    readonly '${uid}'?: ${buildPopulateObjectType(populateType, entityType)};`;
  });

  return `true | {\n    readonly on?: {\n  ${onEntries.join('\n  ')}\n    };\n  }`;
};

const buildPopulateFields = (
  attributes: readonly AttributeIR[],
  componentRegistry: ComponentRegistry,
  visited: Set<string>,
  registry?: SchemaRegistry,
  populatableContentTypeUIDs?: ReadonlySet<string>,
): readonly PopulateTypeField[] =>
  attributes
    .filter((attr) => POPULATABLE_TYPES.has(attr.type))
    .map((attr): PopulateTypeField | null => {
      if (attr.type === 'media') {
        return { name: attr.name, typeExpression: 'true' };
      }

      if (attr.type === 'relation') {
        if (!registry) return { name: attr.name, typeExpression: 'true' };
        return {
          name: attr.name,
          typeExpression: buildRelationFieldType(
            attr,
            registry,
            populatableContentTypeUIDs ?? new Set(),
          ),
        };
      }

      if (attr.type === 'component' && attr.componentUID) {
        if (!componentRegistry[attr.componentUID]) {
          return { name: attr.name, typeExpression: 'true' };
        }
        const compFields = buildComponentPopulateFields(
          attr.componentUID,
          componentRegistry,
          visited,
        );
        const entityType = componentUidToTypeName(attr.componentUID);

        if (compFields.length === 0) {
          return {
            name: attr.name,
            typeExpression: `true | { readonly fields?: readonly (keyof ${entityType})[] }`,
          };
        }

        const populateType = componentUidToPopulateTypeName(attr.componentUID);
        return {
          name: attr.name,
          typeExpression: buildPopulateObjectType(populateType, entityType),
        };
      }

      if (attr.type === 'dynamiczone') {
        return {
          name: attr.name,
          typeExpression: buildDynamicZoneFieldType(attr, componentRegistry, visited),
        };
      }

      return null;
    })
    .filter((f): f is PopulateTypeField => f !== null);

const formatPopulateType = (typeName: string, fields: readonly PopulateTypeField[]): string => {
  if (fields.length === 0) return '';

  const lines = fields.map((f) => `  readonly ${f.name}?: ${f.typeExpression};`);

  return [`export interface ${typeName} {`, ...lines, '}'].join('\n');
};

export const generateContentTypePopulateType = (
  ct: ContentTypeIR,
  componentRegistry: ComponentRegistry,
  registry: SchemaRegistry,
  populatableContentTypeUIDs?: ReadonlySet<string>,
): string | null => {
  const fields = buildPopulateFields(
    ct.attributes,
    componentRegistry,
    new Set(),
    registry,
    populatableContentTypeUIDs,
  );
  if (fields.length === 0) return null;

  const typeName = toPopulateTypeName(ct.singularName);
  return formatPopulateType(typeName, fields);
};

export const generateComponentPopulateType = (
  component: ComponentIR,
  componentRegistry: ComponentRegistry,
): string | null => {
  const fields = buildPopulateFields(component.attributes, componentRegistry, new Set());
  if (fields.length === 0) return null;

  const typeName = componentUidToPopulateTypeName(component.uid);
  return formatPopulateType(typeName, fields);
};
