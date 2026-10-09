import type { AttributeIR, ComponentIR, ContentTypeIR } from '../types';

const collectComponentRefsFromAttributes = (
  attributes: readonly AttributeIR[],
): readonly string[] =>
  attributes.flatMap((attr) => {
    if (attr.type === 'component' && attr.componentUID) return [attr.componentUID];
    if (attr.type === 'dynamiczone' && attr.componentUIDs) return [...attr.componentUIDs];
    return [];
  });

// Component uids an entity references (nested components and dynamic-zone
// members) that are part of this generation, each listed once
export const collectKnownComponentRefs = (
  attributes: readonly AttributeIR[],
  isKnown: (uid: string) => boolean,
): readonly string[] => [
  ...new Set(collectComponentRefsFromAttributes(attributes).filter(isKnown)),
];

export const collectReferencedComponents = (
  contentTypes: readonly ContentTypeIR[],
  allComponents: Readonly<Record<string, ComponentIR>>,
): ReadonlySet<string> => {
  const referenced = new Set<string>();
  const queue = contentTypes.flatMap((ct) => collectComponentRefsFromAttributes(ct.attributes));

  for (let uid = queue.pop(); uid !== undefined; uid = queue.pop()) {
    if (referenced.has(uid)) continue;

    referenced.add(uid);
    const component = allComponents[uid];
    if (component) {
      queue.push(...collectComponentRefsFromAttributes(component.attributes));
    }
  }

  return referenced;
};

// UIDs of components that can reach themselves through the reference graph.
// Refs between such components must be lazy() - their generated modules import
// each other and eager references hit the TDZ at module evaluation.
export const collectCycleUIDs = (components: readonly ComponentIR[]): ReadonlySet<string> => {
  const componentMap = new Map(components.map((c) => [c.uid, c]));
  const refsOf = (uid: string): readonly string[] => {
    const component = componentMap.get(uid);
    return component
      ? collectComponentRefsFromAttributes(component.attributes).filter((ref) =>
          componentMap.has(ref),
        )
      : [];
  };

  const cycleUIDs = new Set<string>();
  for (const start of componentMap.keys()) {
    const queue = [...refsOf(start)];
    const seen = new Set<string>();
    for (let uid = queue.pop(); uid !== undefined; uid = queue.pop()) {
      if (uid === start) {
        cycleUIDs.add(start);
        break;
      }
      if (seen.has(uid)) continue;
      seen.add(uid);
      queue.push(...refsOf(uid));
    }
  }
  return cycleUIDs;
};

export const topologicalSort = (components: readonly ComponentIR[]): readonly ComponentIR[] => {
  const componentMap = new Map(components.map((c) => [c.uid, c]));
  const visited = new Set<string>();
  const sorted: ComponentIR[] = [];

  const visit = (uid: string): void => {
    if (visited.has(uid)) return;
    visited.add(uid);

    const component = componentMap.get(uid);
    if (!component) return;

    collectComponentRefsFromAttributes(component.attributes)
      .filter((ref) => componentMap.has(ref))
      .forEach(visit);

    sorted.push(component);
  };

  components.forEach((c) => visit(c.uid));
  return sorted;
};
