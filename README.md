# Superskill module

Superskill is a repo-local module that turns skills + scenarios into:

- model settings (temperature mapping with model-family exceptions)
- output contracts (low narration, high signal)
- a strict agent-to-agent handoff packet (schema-validated)
- retry/convergence behavior that reduces roundtrips (policy + optional `retry-plan` CLI)
- trace + outcome logging and **human-reviewed** policy proposals (no automatic policy writes)

This folder is designed to be vendored into other repos or installed from npm. The package **[@nareshdama/superskill-policy-engine](https://www.npmjs.com/package/@nareshdama/superskill-policy-engine)** is **published** on the public npm registry.

| Where | Link |
|-------|------|
| **GitHub** | [github.com/nareshdama/Superskill](https://github.com/nareshdama/Superskill) |
| **npm package** | [npmjs.com/package/@nareshdama/superskill-policy-engine](https://www.npmjs.com/package/@nareshdama/superskill-policy-engine) |

[![npm version](https://img.shields.io/npm/v/@nareshdama/superskill-policy-engine.svg)](https://www.npmjs.com/package/@nareshdama/superskill-policy-engine)
[![Node.js](https://img.shields.io/node/v/@nareshdama/superskill-policy-engine.svg)](https://www.npmjs.com/package/@nareshdama/superskill-policy-engine)

## Install from npm

```bash
npm i @nareshdama/superskill-policy-engine
```

(`npm install @nareshdama/superskill-policy-engine` is equivalent.)

Run the CLI without a global install:

```bash
npx @nareshdama/superskill-policy-engine --help
npx @nareshdama/superskill-policy-engine compile-prompt --provider openai --environment terminal --intent implement --scenario normal
```

Import the library (Node 18+):

```javascript
import { /* see docs/PROGRAMMATIC_API.md */ } from "@nareshdama/superskill-policy-engine";
```

## Community

| Resource | Purpose |
|----------|---------|
| [CONTRIBUTING.md](CONTRIBUTING.md) | Git workflow, dev setup, PR checklist |
| [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) | Community standards ([Contributor Covenant](https://www.contributor-covenant.org/) 2.1) |
| [SECURITY.md](SECURITY.md) | How to report vulnerabilities privately |
| [Issues](https://github.com/nareshdama/Superskill/issues) | Bugs and feature discussion |

## Entry points

- Config: `superskill.yaml` (at repo root when using this package directly)
- Policies: `policies/`
- Schemas: `schemas/` (handoff, trace line, outcome line, proposal file, …)
- Docs: `docs/` — start with [`docs/CURRENT_DEVELOPMENT.md`](docs/CURRENT_DEVELOPMENT.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md)
- CLI: `cli/src/index.mjs` (see [`cli/README.md`](cli/README.md))

## Current status (Phases 1–5 baseline)

Roadmap phases **1 through 5** are implemented at baseline: policy resolution and prompts; runner-facing validation (`validate-output`, `validate-tool-args`, `retry-plan`, `runner-dry-run`); handoff + trace (`read-handoff`, `trace-append`, `trace-tail`); Phase 4 outcomes and `outcomes-report` / proposal artifacts; tests, [`docs/PROGRAMMATIC_API.md`](docs/PROGRAMMATIC_API.md), and `validate-proposal`. The CLI does **not** call model APIs — runners own transport and keys.

**Next steps and out-of-scope items** are listed under **Future development scope** in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Docs (current set)

| Doc | Purpose |
|-----|---------|
| [`docs/CURRENT_DEVELOPMENT.md`](docs/CURRENT_DEVELOPMENT.md) | What is implemented now (by phase). |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Snapshot, **roadmap**, **future dev scope**, completed milestones. |
| [`docs/PHASE4_WORKFLOW.md`](docs/PHASE4_WORKFLOW.md) | Log → report → proposal → PR. |
| [`docs/HANDOFF_PROTOCOL.md`](docs/HANDOFF_PROTOCOL.md) | Handoff packet protocol. |
| [`docs/TEMPERATURE_LAYER.md`](docs/TEMPERATURE_LAYER.md) | Temperature layer. |
| [`docs/POLICY_CHANGE_PLAYBOOK.md`](docs/POLICY_CHANGE_PLAYBOOK.md) | Policy changes + `resources/skills/`. |
| [`docs/PROGRAMMATIC_API.md`](docs/PROGRAMMATIC_API.md) | Embeds: `lib/` exports. |
| [`docs/PUBLISHING_NPM.md`](docs/PUBLISHING_NPM.md) | npm publishing. |

## Goals

- Fewer API calls by default (converge via policy, not rerolls)
- Less hallucination (verified pointers + schema gating)
- Maximum actionable output (structured work items)

## npm (reference)

- **Status:** Published — install with `npm i @nareshdama/superskill-policy-engine`
- **Registry:** [npmjs.com/package/@nareshdama/superskill-policy-engine](https://www.npmjs.com/package/@nareshdama/superskill-policy-engine)
- **Package name:** `@nareshdama/superskill-policy-engine`
- **Binary:** `superskill` (via `npx` or after `npm i` / `npm install`)
- **Develop in this repo:** `npm run smoke`, `npm test` (from clone root)

Publishing workflow: [`docs/PUBLISHING_NPM.md`](docs/PUBLISHING_NPM.md).
