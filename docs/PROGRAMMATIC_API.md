# Programmatic API (embedders)

Import from the package root or `./lib` (see [`package.json`](../package.json) `exports`):

```javascript
import { ... } from "@nareshdama/superskill-policy-engine";
// or: import { ... } from "@nareshdama/superskill-policy-engine/lib";
```

The CLI (`superskill` / `node cli/src/index.mjs`) is a thin layer over the same libraries. Runners keep transport and API keys; this module supplies **policy resolution**, **validation**, and **artifacts**.

## Handoff continuity

| Export | Module | Use |
|--------|--------|-----|
| `handoffPacketToResolveInput` | [`lib/handoff-continuity.mjs`](../lib/handoff-continuity.mjs) | Map a validated handoff packet to partial `resolve` input seed. |
| `handoffContinuityMeta` | same | `task_id`, `intent`, etc. for the next `compile-prompt` / tooling. |

Typical flow: read handoff JSON → validate with schema → merge `handoffPacketToResolveInput` with runner defaults → `resolve` (CLI or future programmatic resolve). See [`HANDOFF_PROTOCOL.md`](HANDOFF_PROTOCOL.md) and CLI `read-handoff`.

## Output contracts and tools

| Export | Use |
|--------|-----|
| `validateOutputContract` | Check assistant markdown/text against a contract id from output policy (same logic as CLI `validate-output`). |
| `stripCodeFences`, `extractSectionBodyLines` | Helpers used by contract checks. |
| `validateToolArgsWithSchema`, `validateToolArgsWithSchemaAtPath` | Validate tool JSON with a JSON Schema before execute. |

## Retry planning

| Export | Use |
|--------|-----|
| `parseRetryContext`, `planRetry`, `runRetryPlan` | Build a retry plan from context + policy YAML (same as CLI `retry-plan`). **Note:** `runRetryPlan(retryContextRaw, retryPolicy)` — context first, parsed policy second. |

## Trace and outcomes (Phase 3–4)

| Export | Use |
|--------|-----|
| `appendTraceLine`, `readTraceTailLines`, `readTraceLinesInWindow` | Append/read JSONL trace (single writer recommended). |
| `appendOutcomeLine` | Append `event: "outcome"` line validated against [`schemas/outcome-line.schema.json`](../schemas/outcome-line.schema.json). |
| `summarizeOutcomeRecords`, `formatOutcomeProposalMarkdown`, `formatOutcomeProposalYaml` | Aggregate trace window and format proposal text (no policy mutation). |

## Proposal file validation (Phase 5)

| Export | Use |
|--------|-----|
| `validateProposalDocument` | Validate a **parsed** proposal object (e.g. after `YAML.parse`) against [`schemas/proposal-file.schema.json`](../schemas/proposal-file.schema.json). CLI: `validate-proposal --file <path>`. |

## What is not in `lib/index.mjs`

- Full `resolve` / `route` / `compile-prompt` **pipeline** as a single function — use CLI `runner-dry-run` or compose `resolve`-style inputs from your runner (see [`cli/src/runner-dry-run.example.json`](../cli/src/runner-dry-run.example.json)).
- **Handoff JSON Schema validation** — use the same Ajv + [`schemas/handoff-schema.json`](../schemas/handoff-schema.json) pattern as [`cli/src/index.mjs`](../cli/src/index.mjs) `validate-handoff`, or shell out to `validate-handoff`.

## CI / checks

- Fast gate: `npm run smoke`
- Unit tests: `npm test`
- Proposal YAML shape: `node cli/src/index.mjs validate-proposal --file path/to/proposal.yaml`

See [`POLICY_CHANGE_PLAYBOOK.md`](POLICY_CHANGE_PLAYBOOK.md) for workflow when changing policies and code together.
