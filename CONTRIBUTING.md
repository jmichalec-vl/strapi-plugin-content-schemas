# Contributing

Thanks for contributing! A few conventions keep this repo healthy.

## Development

```bash
npm install
npm run build        # plugin server + CLI
npm test             # unit tests (vitest)
npm run test:e2e     # boots a real Strapi app, pulls both targets through the
                     # built CLI, runs runtime validation against live data
npm run type-check
npm run lint && npm run format:check
```

Please include tests with behavior changes and run the full suite (including
e2e) before opening a PR. The e2e fixture app lives in
`__tests__/e2e/strapi-app/` - extend it when your change needs a content-model
shape it doesn't cover yet.

## Neutral identifiers in examples, fixtures, and docs

Everything in this repository - README examples, test fixtures, unit-test
override configs, doc snippets - must use **neutral, invented identifiers**,
never names, schemas, or domain vocabulary from real consumer projects.

- Good: `RenderedHtmlSchema`, `object({ html: string(), meta: any() })`,
  `ArticleStatus`, `shared.seo`, `modules.hero-section`
- Not OK: identifiers, type names, or field shapes copied from a specific
  company's CMS or frontend

The plugin itself has no built-in knowledge of any override or consumer schema:
`typeOverrides` / `fieldOverrides` / `viewTransformSchemas` are consumer config
emitted verbatim. Examples exist to demonstrate the _mechanism_, so any
realistic-but-invented name does the job - and keeps real projects' internals
out of an open-source repo.

## Generated-output stability

Generated code is a public contract: consumers commit it and diff it in CI
(`strapi-schemas check`). Changes that alter the output shape need e2e
assertions updated deliberately (never loosened to `toContain` on trivia), a
note in the README when behavior changes, and a version bump. Schemas must
always validate Strapi's **raw REST wire format** - transformations belong to
consumer overrides, never to default mappings.

## Plain ASCII punctuation

Use `-` rather than em or en dashes, and straight quotes, in code, comments,
docs and commit messages. It keeps diffs greppable and avoids write hooks that
reject non-ASCII punctuation.

## Changelog

Add an entry under the `Unreleased` heading in `CHANGELOG.md` for every
user-visible change (generated output, CLI behaviour, configuration). Versions
and tags are set by the publish workflow (`npm version`), never by hand.
