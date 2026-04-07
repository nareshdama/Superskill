# Current development

## Phase 1 (policy engine MVP) — implemented

The CLI under `cli/` reads `superskill.yaml` and module policies. Implemented commands:

| Command | Role |
|--------|------|
| `resolve` | Computes temperature mapping, output contract, handoff requirement from JSON input + defaults |
| `validate-handoff` | Validates a handoff JSON file against `schemas/handoff-schema.json` |
| `route` | Maps free text to an intent bundle via `policies/intent-map.yaml` |
| `compile-prompt` | Emits provider system/developer blocks from `policies/prompt-templates.yaml` |
| `write-handoff` | Validates a packet and writes `.superskill/handoff.json` (or `--out`) |

Policy sources in `policies/` include temperature, capabilities, output, intent, prompts, and (optional for minimal configs) retry — see `superskill.yaml` paths.

## Phase 2 — runner-facing layer (implemented)

| Capability | How |
|------------|-----|
| Validate assistant text vs output contract | CLI `validate-output --contract <id> --text-file <path>` or `--text "..."`; logic in `lib/validate-output-contract.mjs` |
| Validate tool-call JSON before execute | CLI `validate-tool-args --payload <file> --schema <schema.json>`; `lib/validate-tool-args.mjs` (Ajv) |
| Retry planning without shelling out | Import `planRetry`, `runRetryPlan`, `parseRetryContext` from `lib/retry-plan.mjs` or package export `@nareshdama/superskill-policy-engine` → `./lib`. **`runRetryPlan(retryContextRaw, retryPolicy)`** — context object first, parsed policy YAML second. |
| Dry-run orchestration (no model I/O) | CLI `runner-dry-run --input <json>` with optional `resolve_input`, `compile`, `retry_context` — see `cli/src/runner-dry-run.example.json` |

**Not in this package:** calling the model or automatic retry loops. Contract validation is heuristic (markdown headings, bullets); unusual formatting can produce false positives or negatives.

## Phase 3 (handoff + trace continuity) — implemented

| Command / API | Role |
|---------------|------|
| `read-handoff` | Reads `paths.artifacts.handoff` (or `--file`), validates, prints `resolve_input`, **`merged_resolve_preview`** (same merge as `resolve` for that partial input + module `defaults`), `continuity`, and full `handoff` unless **`--omit-handoff`** (reduces sensitive data on stdout). |
| `trace-append` | Appends one JSON object to `paths.artifacts.trace` (requires `paths.artifacts.trace` in config). Line must match `schemas/trace-line.schema.json`. **Use a single writer process** — concurrent appends can interleave bytes and corrupt JSONL. |
| `trace-tail` | Returns the last N **complete** lines from a tail byte window (leading fragment dropped if the window starts mid-line). Read window is capped; `--lines` must be a plain integer. |
| `lib/handoff-continuity.mjs` | `handoffPacketToResolveInput`, `handoffContinuityMeta` for embedders. |
| `lib/trace.mjs` | `appendTraceLine`, `readTraceTailLines`. |

**Mapping note:** Handoff `intent` and `task_id` are **not** part of `mergeResolveInput` today; they appear under `continuity`. Use **`merged_resolve_preview`** from `read-handoff` to see the exact merged knobs (`environment`, `scenario`, `output_mode`, etc.) after applying `defaults` — write that object to a file and pass **`resolve --input`** for a faithful continuation without guessing defaults.

## Phase 4 (human-in-the-loop learning) — implemented

No model training in this package; no automatic writes to `policies/` or `superskill.yaml`. Runners append structured lines to the same JSONL as `trace-append` (`paths.artifacts.trace`).

| Command / API | Role |
|---------------|------|
| `outcome-append` | Validates a line against `schemas/outcome-line.schema.json` and appends via `appendOutcomeLine` → `appendTraceLine`. |
| `outcomes-report` | Bounded tail read of the trace file; JSON includes `trace_file_exists` and a `note` when the file is absent; aggregates include `by_event` (all lines), `outcome_events` (valid outcome payloads only), `outcome_skipped_invalid_payload`, plus `status` / `failure_kind` / `retry_triggers`. |
| `outcomes-report --format proposal` | Prints a Markdown review snippet; with `--write-proposal`, writes `.superskill/proposals/proposal-<iso>.md` and `.yaml` (human review only). |
| `lib/outcome.mjs` | `appendOutcomeLine`, `summarizeOutcomeRecords`, `formatOutcomeProposalMarkdown`, `formatOutcomeProposalYaml`. |

**Privacy:** Like `read-handoff --omit-handoff`, avoid echoing sensitive paths in outcome payloads when sharing reports; aggregation reads the trace file under cwd.

See `docs/PHASE4_WORKFLOW.md` and `docs/ROADMAP.md` Phase 4.

**See also:** [`POLICY_CHANGE_PLAYBOOK.md`](POLICY_CHANGE_PLAYBOOK.md) — how to align policy YAML, schemas, and `lib/` / CLI changes with `resources/skills/` (methodology and review discipline; not a runtime dependency).

## Phase 5 (hardening + embedder docs) — baseline implemented

| Item | Location |
|------|----------|
| Unit tests | `npm test` — `tests/*.test.mjs` |
| Programmatic API overview | [`PROGRAMMATIC_API.md`](PROGRAMMATIC_API.md) |
| Proposal YAML validation (CLI + `validateProposalDocument`) | `validate-proposal --file`; [`schemas/proposal-file.schema.json`](../schemas/proposal-file.schema.json) |
| CLI shared constants | `cli/src/constants.mjs` |
