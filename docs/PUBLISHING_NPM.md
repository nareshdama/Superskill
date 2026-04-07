# Publishing to npm

This module can be published as an npm package.

**Public package page (users):** [npmjs.com/package/@nareshdama/superskill-policy-engine](https://www.npmjs.com/package/@nareshdama/superskill-policy-engine)

The package is **published**. Install in another project:

```bash
npm i @nareshdama/superskill-policy-engine
```

## Checklist

- Run `npm test` and `npm run smoke` from the package root before publishing.
- Pick a unique package name in `package.json` (current: `@nareshdama/superskill-policy-engine`).
- Set `version` appropriately.
- Ensure `license` is correct for your project and company.
- Ensure the `files` allowlist includes everything required at runtime.
- Ensure the CLI does not write artifacts into the installed package directory.

## Recommended workflow

From the **package root** (the directory that contains this `package.json` — often the repo root when this project is checked out on its own):

1. Install deps (once): `npm install`

2. Sanity check local pack: `npm pack --dry-run`

3. Publish: `npm publish`

If this module lives in a monorepo subfolder, `cd` into that folder first so `package.json` is the one you intend to publish.

## Using without vendoring

- `npx @nareshdama/superskill-policy-engine compile-prompt --provider openai --environment terminal --intent implement --scenario normal`

If you vendor the module into a repo, you can also run (from the vendored package root):

- `node cli/src/index.mjs ...`
