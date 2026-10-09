# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

First public release, published by the `Publish to npm` workflow with a
`major` bump (0.2.3 -> 1.0.0); the workflow sets the version and tag.
The generated output layout is unchanged from 0.2.x
(`schemaFormatVersion` stays `1`); the changes below fix correctness and
robustness issues found in a full code audit and prepare the codebase for
open-source maintenance.

### Fixed

- Generated tarballs are byte-identical for identical input: header mtimes are
  fixed and entries are written in sorted path order.
- Content types and components are emitted in uid order instead of the
  registry's filesystem discovery order, so output no longer differs between
  machines.
- The schema hash (manifest, tarball cache, watch mode) now covers the plugin
  and schema-format versions, so a plugin upgrade invalidates cached output.
- The generated client no longer drops `defaultParams` (for example a default
  `locale`) when a request passes no value for the same option, and a
  `Headers` instance in `request.headers` is preserved.
- The client only imports a declared view `SuccessSchema` when the view
  generator actually emitted the declaration.
- `morphMany` / `morphToMany` relations are typed and validated as arrays.
- Enum artifacts never redeclare their parent's `Schema`, type or
  `PopulateInput` export (an `Enum` suffix is added on collision).
- An overridden relation stays nullish like every other relation.
- Dynamic-zone members that take part in a component cycle are deferred with
  `lazy()` and their populate exports are imported.
- Component schemas that reference themselves (directly or through a cycle)
  carry an explicit type annotation (`GenericSchema<T>` / `z.ZodType<T>`), so
  the generated output compiles under strict TypeScript (TS7022).
- Line terminators in enum values and template-literal syntax in bff-views
  manifest paths are escaped in generated code.
- `strapi-schemas hash` prints exactly one line even when a config file is
  present (the "Loaded config" message moved to stderr).
- `strapi-schemas check` ignores `.strapi-schemas-meta.json`, so a CLI upgrade
  alone is not reported as drift, and it creates a missing output parent
  directory instead of failing.
- Tar extraction rejects negative or non-octal entry sizes (previously an
  endless loop), verifies the ustar magic and header checksum, fails on
  truncated entries, and caps response and decompressed sizes.

### Changed

- `--prettier` resolves the prettier installed in the consumer project and runs
  it through the current Node binary; `npx` is no longer used, so nothing is
  downloaded on demand and formatting works on Windows. Prettier errors are
  shown instead of swallowed.
- Pruning only deletes files whose first line carries the generated-file
  marker and only removes directories it emptied. `--output` must be a
  dedicated directory; the project root (or one of its parents) is refused.
- Non-2xx responses surface the server's error message; redirects hint at the
  final URL. A `401`/`403` on the manifest endpoint is reported as a token
  permission problem rather than an old plugin version.
- Exit code `2` for CLI failures; `1` stays reserved for `check` reporting
  stale schemas.
- The server returns `400` for invalid request options, its own generation
  error messages (name collisions, path limits) with `500`, and a generic
  message for anything else (details go to the server log).
- Override `name` / `typeName` values and bff-views view ids are validated as
  identifiers; invalid ones fail at boot or are skipped with a warning.
- Attributes of an unknown type are skipped with a warning naming the field.

### Added

- `strapi-schemas pack`: builds an installable package directory from the
  generated output (dual ESM + CJS with declarations, types-only `./types`
  entry, peer dependency on the schema library, embedded output hash) for CI
  to publish.
- `--flag=value` syntax; duplicate flags and stray positional arguments are
  rejected.
- `--no-jsdoc`, `--no-mocks`, `--no-prettier` to switch off a toggle a config
  file enables.
- The API token can be supplied through `STRAPI_SCHEMAS_TOKEN`; a warning is
  printed when a bearer token would travel over plain `http://` to a remote
  host.
- Watch mode takes its baseline hash before the first pull and logs a
  repeating poll error once.
- Staging and candidate directories are removed on Ctrl+C.

### Internal

- Dead code removed; duplicated helpers consolidated (`isToMany`, populatable
  type sets, override resolution, component usage, upload-file schema name).
- All target-specific syntax lives in the target primitives; the view
  generator and slice builder are target-agnostic.
- Large functions split into composable emitters; typed domain errors; typed
  service access; type guards instead of casts.
- ESLint 9 flat config with stricter rules, `node16` module resolution,
  CLI included in coverage, dependency bumps.
- New unit suites for the slice builder, schema registry, import merging,
  mocks, the CLI HTTP/watch layers and the emitted client runtime.
