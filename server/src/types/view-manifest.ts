// Structural mirror of strapi-plugin-bff-views' view manifest - the versioned,
// plain-data contract returned by that plugin's
// `view-registry.describeViews()`. This is the ONLY coupling between the two
// plugins: no code is shared, and either plugin works without the other.

export interface BffViewTransform {
  readonly name: string;
  readonly match: {
    readonly fieldType?: string;
    readonly fieldName?: string;
  };
}

export type BffRelationOverlay =
  | true
  | {
      readonly fields?: readonly string[];
      readonly populate?: Readonly<Record<string, unknown>>;
    };

/** Added in bff-views 0.2.0; absent from older manifests → 'keyed'. */
export type BffViewKind = 'keyed' | 'singleton' | 'composite';

/** One named source of a composite view (bff-views 0.2.0). */
export interface BffViewSource {
  readonly contentType: string;
  readonly many: boolean;
  readonly fields: readonly string[];
  readonly componentFields: Readonly<Record<string, string>>;
  readonly mediaFields?: Readonly<Record<string, { readonly multiple: boolean }>>;
  readonly dynamicZones: Readonly<Record<string, readonly string[]>>;
  readonly relations: Readonly<Record<string, BffRelationOverlay>>;
  readonly componentOverrides: Readonly<Record<string, unknown>>;
}

export interface BffViewManifestEntry {
  readonly id: string;
  readonly path: string;
  /** Added in bff-views 0.2.0 (manifest still v1 - additive). */
  readonly kind?: BffViewKind;
  /** Keyed views only. */
  readonly keyParam?: string;
  readonly lookup?: { readonly field: string };
  /** Flat source description - present for keyed/singleton views. */
  readonly contentType?: string;
  readonly fields?: readonly string[];
  readonly componentFields?: Readonly<Record<string, string>>;
  /** Added in bff-views 0.1.2 (manifest still v1 - additive). */
  readonly mediaFields?: Readonly<Record<string, { readonly multiple: boolean }>>;
  readonly dynamicZones?: Readonly<Record<string, readonly string[]>>;
  readonly relations?: Readonly<Record<string, BffRelationOverlay>>;
  readonly componentOverrides?: Readonly<Record<string, unknown>>;
  /** Composite views only (bff-views 0.2.0): named source descriptions. */
  readonly sources?: Readonly<Record<string, BffViewSource>>;
  readonly transforms: readonly BffViewTransform[];
  readonly hasEnrich: boolean;
  readonly hasAssemble: boolean;
}

export interface BffViewManifest {
  readonly manifestVersion: number;
  readonly views: readonly BffViewManifestEntry[];
}

export const SUPPORTED_VIEW_MANIFEST_VERSION = 1;
