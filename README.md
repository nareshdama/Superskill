# Superskill module

Superskill is a repo-local module that turns skills + scenarios into:

- model settings (temperature mapping with model-family exceptions)
- output contracts (low narration, high signal)
- a strict agent-to-agent handoff packet (schema-validated)
- retry/convergence behavior that reduces roundtrips (policy + optional `retry-plan` CLI)

This folder is designed to be vendored into other repos.

## Entry points

- Config: `superskill.yaml` (at repo root when using this package directly)
- Policies: `policies/`
- Schema: `schemas/handoff-schema.json`
- Docs: `docs/` (Phase 4 workflow: `docs/PHASE4_WORKFLOW.md`)
- CLI: `cli/src/index.mjs` (see `cli/README.md`)

## Phase 1 (complete) vs Phase 2

**Phase 1 — Policy engine MVP** is implemented: the CLI loads `superskill.yaml`, runs `resolve` (temperature + output contract + handoff flags), `validate-handoff`, `route`, plus `compile-prompt` and `write-handoff`. See `docs/ROADMAP.md`.

**Phase 2** adds deeper runner integration (model output validation, tool blocking, orchestration). The `retry-plan` command is a Phase 2-oriented helper that reads `policies/retry-policy.yaml`.

## Docs

- Current development: `docs/CURRENT_DEVELOPMENT.md`
- Roadmap: `docs/ROADMAP.md`
- Handoff protocol: `docs/HANDOFF_PROTOCOL.md`
- Temperature layer: `docs/TEMPERATURE_LAYER.md`
- Policy change playbook (methodology + `resources/skills/`): `docs/POLICY_CHANGE_PLAYBOOK.md`
- Programmatic API (embedders): `docs/PROGRAMMATIC_API.md`

## Goals

- Fewer API calls by default (converge via policy, not rerolls)
- Less hallucination (verified pointers + schema gating)
- Maximum actionable output (structured work items)

## npm

- Package name: `@nareshdama/superskill-policy-engine`
- Binary: `superskill` (example: `npx @nareshdama/superskill-policy-engine compile-prompt ...`)
- Smoke check: `npm run smoke` (from package root)
- Unit tests: `npm test`

## Status

**Phase 1 is complete** for the policy CLI: resolve, route, validate/write handoff, compile prompts. The CLI does not call model APIs; it emits settings and validated artifacts for runners.

See `docs/ROADMAP.md` for Phase 2+ milestones (**Phase 5** adds tests, `docs/PROGRAMMATIC_API.md`, and `validate-proposal`). **Phase 4** (outcome logging, `outcomes-report`, human-reviewed proposals) is described in `docs/PHASE4_WORKFLOW.md` and `cli/README.md`.
