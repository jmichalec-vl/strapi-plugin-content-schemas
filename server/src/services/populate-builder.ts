import type { Core } from '@strapi/types';

import type { ComponentIR, ContentTypeIR } from '../types';
import type { ComponentRegistry, RuntimePopulateValue } from '../generators/populate-generator';
import {
  buildRuntimeComponentPopulate,
  buildRuntimePopulateFromAttributes,
} from '../generators/populate-generator';
import { getService } from '../utils';

const NO_INTERNAL_FIELDS = { timestamps: false } as const;

/**
 * Runtime IR and populate-object access for other plugins (notably
 * strapi-plugin-bff-views). Semver-minor stable: method signatures only change
 * with a minor version bump.
 *
 * Results are memoized per service instance - content types and components are
 * immutable after Strapi loads (dev auto-reload restarts the process).
 */
const populateBuilder = ({ strapi }: { strapi: Core.Strapi }) => {
  let componentRegistry: ComponentRegistry | null = null;
  const contentTypeCache = new Map<string, ContentTypeIR | undefined>();

  const getComponentRegistry = (): ComponentRegistry => {
    if (!componentRegistry) {
      const components: readonly ComponentIR[] = getService(strapi, 'schema-reader').readComponents(
        'all',
        [],
        NO_INTERNAL_FIELDS,
      );
      componentRegistry = Object.fromEntries(components.map((c) => [c.uid, c]));
    }
    return componentRegistry;
  };

  const getContentTypeIR = (uid: string): ContentTypeIR | undefined => {
    if (!contentTypeCache.has(uid)) {
      const irs: readonly ContentTypeIR[] = getService(strapi, 'schema-reader').readContentTypes(
        [uid],
        NO_INTERNAL_FIELDS,
      );
      contentTypeCache.set(uid, irs[0]);
    }
    return contentTypeCache.get(uid);
  };

  const buildComponentPopulateTree = (componentUid: string): RuntimePopulateValue =>
    buildRuntimeComponentPopulate(componentUid, getComponentRegistry());

  const buildContentTypePopulateTree = (
    uid: string,
  ): Readonly<Record<string, RuntimePopulateValue>> | null => {
    const ir = getContentTypeIR(uid);
    if (!ir) return null;
    return buildRuntimePopulateFromAttributes(ir.attributes, getComponentRegistry());
  };

  return {
    getComponentRegistry,
    getContentTypeIR,
    buildComponentPopulateTree,
    buildContentTypePopulateTree,
  };
};

export default populateBuilder;
