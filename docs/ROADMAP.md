# Roadmap

## Snapshot (April 2026)

| Area | State |
|------|--------|
| **Phases 1–5** | **Baseline complete** — CLI, policies, runner helpers, handoff + trace, outcomes and human-reviewed proposals, tests, `validate-proposal`, [`PROGRAMMATIC_API.md`](PROGRAMMATIC_API.md). |
| **Repository** | [github.com/nareshdama/Superskill](https://github.com/nareshdama/Superskill) |
| **npm package** | Published: [`@nareshdama/superskill-policy-engine`](https://www.npmjs.com/package/@nareshdama/superskill-policy-engine) (`npm i @nareshdama/superskill-policy-engine`) — [`PUBLISHING_NPM.md`](PUBLISHING_NPM.md) |
| **Integration checks** | `npm test`, `npm run smoke` from package root |
| **Non-goals** | No in-package model training; no silent writes to `policies/` or `superskill.yaml`; policy changes stay **human-reviewed** (PR-style). |

## Documentation index

| Doc | Purpose |
|-----|---------|
| [`CURRENT_DEVELOPMENT.md`](CURRENT_DEVELOPMENT.md) | What is implemented today (commands and APIs by phase). |
| [`HANDOFF_PROTOCOL.md`](HANDOFF_PROTOCOL.md) | Handoff packet shape and usage. |
| [`TEMPERATURE_LAYER.md`](TEMPERATURE_LAYER.md) | Temperature mapping and model-family behavior. |
| [`PHASE4_WORKFLOW.md`](PHASE4_WORKFLOW.md) | Trace → report → proposal → PR loop. |
| [`POLICY_CHANGE_PLAYBOOK.md`](POLICY_CHANGE_PLAYBOOK.md) | How to change policies safely; ties to `resources/skills/`. |
| [`PROGRAMMATIC_API.md`](PROGRAMMATIC_API.md) | Embeds: exports from `lib/`. |
| [`PUBLISHING_NPM.md`](PUBLISHING_NPM.md) | Publishing the package. |

CLI command reference: [`cli/README.md`](../cli/README.md).

Repository governance: [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`CODE_OF_CONDUCT.md`](../CODE_OF_CONDUCT.md), [`SECURITY.md`](../SECURITY.md).

## Future development scope

Work below is **not committed dates** — it reflects likely direction and open follow-ups from Phases 4–5.

### Near term (engineering backlog)

- **CLI structure** — Large-scale extraction of command bodies from `cli/src/index.mjs` into per-command modules (shared limits already live in `cli/src/constants.mjs`; see [`cli/src/commands/README.md`](../cli/src/commands/README.md)).
- **Proposal ergonomics** — Optional read-only **diff** of a proposal snapshot vs checked-in `policies/` (no auto-apply); complements `validate-proposal`.
- **Tests and smoke** — Broader fixtures for edge-case output contracts and malformed trace windows; keep smoke fast, tests thorough.
- **Documentation** — Keep [`CURRENT_DEVELOPMENT.md`](CURRENT_DEVELOPMENT.md) in sync when adding CLI flags or schema fields.

### Medium term (embedder-driven)

- **Contract validation** — Tighter heuristics or pluggable rules for `validate-output` where markdown shape varies by team; document trade-offs in [`CURRENT_DEVELOPMENT.md`](CURRENT_DEVELOPMENT.md).
- **Continuity** — If runners need it: optional alignment of handoff `intent` / `task_id` with `resolve` input merging (today they surface under `continuity`; see `read-handoff` / [`HANDOFF_PROTOCOL.md`](HANDOFF_PROTOCOL.md)).
- **Trace robustness** — Document or helper patterns for multi-process environments (today: **single writer** recommended for JSONL).

### Explicitly out of scope (unless product expands)

- Hosted trace ingestion, multi-tenant analytics, or sync-from-cloud policies.
- Automatic optimization of policies or online learning from traces.
- Replacing human PR review for policy changes.

---

## Phase 1: Policy engine MVP

**Status:** Implemented — CLI and policies in this repo; see `cli/README.md`, `docs/CURRENT_DEVELOPMENT.md`, and `npm run smoke`.

- CLI can load all module policies from `superskill.yaml` (package root or `--config`).
- `resolve` computes:
  - canonical temperature -> output/scenario caps -> provider mapping
  - output contract selection
  - whether handoff packet is required
- `validate-handoff` validates JSON against `schemas/handoff-schema.json`.
- `route` performs intent routing using `policies/intent-map.yaml`.

Milestone output:

- A runner can treat Superskill as the single source of truth for settings and validation.

## Phase 2: Runner integration

**Status:** Implemented (library + CLI). Runners own transport and API keys; this package supplies policy loading, validation, and planning only.

- **Prompt blocks:** `compile-prompt` (unchanged); optional programmatic use via the same resolution path as `runner-dry-run`’s `compile` block.
- **Output contracts:** `validate-output` checks assistant markdown/text against `policies/output-policy.yaml` `contracts.*` (sections, line limits, bullet rules). Best-effort heuristics; document edge cases in `docs/CURRENT_DEVELOPMENT.md`.
- **Retries:** `retry-plan` CLI plus programmatic exports from `lib/retry-plan.mjs` (`planRetry`, `runRetryPlan`, `parseRetryContext`, …). `runner-dry-run` merges `resolve` + optional `compile` + optional retry plan (no network).
- **Tool-args gating:** `validate-tool-args` validates a JSON payload against a JSON Schema file (paths under cwd); runners call this before executing tools.

## Phase 3: Handoff artifact + continuity

**Status:** Implemented — `read-handoff`, `trace-append`, `trace-tail`; see `cli/README.md` and `docs/CURRENT_DEVELOPMENT.md`.

- **Artifact locations** (from `superskill.yaml` `paths.artifacts`, defaults under `.superskill/`): `handoff.json`, optional `trace.jsonl`.
- **`read-handoff`** validates the packet and prints JSON with `handoff`, **`resolve_input`** (partial merge seed: e.g. `environment` from the packet), and **`continuity`** (`task_id`, `intent` for the next `compile-prompt` / tooling). Merge `resolve_input` with your runner JSON or module defaults, then run `resolve --input` as before.
- **Trace JSONL** — each line validates against `schemas/trace-line.schema.json`; append via `trace-append`; inspect recent events with `trace-tail` (bounded read).

## Phase 4: Self-training loop (human reviewed)

**Status:** Implemented — structured outcome lines, read-only aggregation, and proposal artifacts (no in-package training, no silent policy writes).

- **M4.1** — `schemas/outcome-line.schema.json` (`event: "outcome"`, versioned payload); `lib/outcome.mjs` (`appendOutcomeLine`, aggregation + proposal formatters); example `cli/src/outcome-line.example.json`.
- **M4.2** — CLI `outcomes-report` reads `paths.artifacts.trace` with a bounded tail window (`readTraceLinesInWindow` in `lib/trace.mjs`); JSON summary to stdout; `npm run smoke` covers `outcome-append` + `outcomes-report`.
- **M4.3** — `--format proposal` emits Markdown (and optional YAML under `.superskill/proposals/` with `--write-proposal`); humans merge policy changes via PR only.
- **M4.4** — Workflow notes in `docs/PHASE4_WORKFLOW.md`; CLI and current-development docs updated.

Original goals (unchanged):

- Log outcomes and failures.
- Distill improvements into intent rules, scenario caps/floors, capability flags, and output contracts (manual / PR-based).
- Update policies via PR-style changes (no silent mutation).

## Phase 5: Hardening, consumers, and proposal ergonomics

**Status:** Implemented (baseline) — tests, programmatic API doc, proposal validation, CLI constants + commands README; optional refactors can continue.

This phase is about **making the existing engine safer and easier to adopt** and **reducing friction from trace → proposal → PR**, without changing core constraints: **no in-package model training**, **no silent writes to `policies/` or `superskill.yaml`**, **human-reviewed policy changes**.

**Milestones**

- **M5.1 — Test and safety net:** `npm test` runs Node’s built-in test runner on `tests/*.test.mjs` (trace, outcome aggregation, proposal validation). `npm run smoke` remains the fast integration gate (includes `validate-proposal` on a shipped example file).
- **M5.2 — Programmatic API clarity:** [`docs/PROGRAMMATIC_API.md`](PROGRAMMATIC_API.md) describes exports from `lib/index.mjs` and embedder-oriented flows. `validateProposalDocument` exported for CI and programmatic checks.
- **M5.3 — Proposal ergonomics:** [`schemas/proposal-file.schema.json`](schemas/proposal-file.schema.json) documents the proposal snapshot shape; CLI **`validate-proposal --file`** validates YAML read-only. Example: [`cli/src/proposal-valid.example.yaml`](../cli/src/proposal-valid.example.yaml). Still **no auto-apply**; read-only **diff** vs `policies/` left as a future optional follow-up.
- **M5.4 — CLI maintainability:** Shared limits live in [`cli/src/constants.mjs`](../cli/src/constants.mjs); [`cli/src/commands/README.md`](../cli/src/commands/README.md) describes how to split further without circular imports. Large-scale extraction of command bodies from `index.mjs` is optional follow-up.

**Explicitly out of scope (unless product expands)**

- Hosted trace ingestion, multi-tenant analytics, or sync-from-cloud policies.
- Automatic optimization of policies or online learning from traces.
- Replacing human PR review for policy changes.

**Success look**

- New consumers can integrate using docs + exports without reading the whole CLI source.
- Proposal files remain review artifacts; CI can optionally validate structure without applying edits.

---

## Tracking

When scope moves from **future** to **shipped**, update [`CURRENT_DEVELOPMENT.md`](CURRENT_DEVELOPMENT.md) and the **Snapshot** table at the top of this file.
