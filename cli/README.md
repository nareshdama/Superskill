# Superskill CLI

Policy engine commands (Node 18+). Run from the **package root** (directory containing `superskill.yaml`) unless you pass `--config /path/to/superskill.yaml`.

User-provided file paths (`--file`, `--input`, `--out`, `--trace`, etc.) must stay under the current working directory (enforced with realpath checks).

## Commands (Phase 1)

```bash
node cli/src/index.mjs resolve --input cli/src/resolve-input.example.json
node cli/src/index.mjs route --text "review this PR for security issues"
node cli/src/index.mjs validate-handoff --file cli/src/handoff.example.json
node cli/src/index.mjs write-handoff --file cli/src/handoff.example.json
node cli/src/index.mjs compile-prompt --provider openai --environment terminal --intent implement --scenario normal
```

## Phase 2 (runner integration)

**Retry planning** — `retry-plan` reads `policies/retry-policy.yaml` and a JSON retry context (requires `paths.policies.retry` in `superskill.yaml`):

```bash
node cli/src/index.mjs retry-plan --input cli/src/retry-context.example.json
```

**Output contract check** — validates assistant markdown against `contracts` in `policies/output-policy.yaml`:

```bash
node cli/src/index.mjs validate-output --contract concise_engineering --text-file cli/src/sample-output.contract.md
# stdin:   ... | node cli/src/index.mjs validate-output --contract concise_engineering --text-file -
```

**Tool-args gate** — validate tool JSON against a schema before execution:

```bash
node cli/src/index.mjs validate-tool-args --payload cli/src/tool-args.example.json --schema schemas/tool-args.example.schema.json
```

**Dry-run** — single JSON file with optional `resolve_input`, `compile`, and `retry_context`; prints merged `resolve` output, optional compiled prompts, and optional retry plan (no network):

```bash
node cli/src/index.mjs runner-dry-run --input cli/src/runner-dry-run.example.json
```

Programmatic use: import from `lib/index.mjs` (package export `.` / `./lib`) for `validateOutputContract`, `validateToolArgsWithSchema`, `validateToolArgsWithSchemaAtPath`, `planRetry`, `runRetryPlan(retryContextRaw, retryPolicy)`, etc.

User paths are checked with **`fs.realpathSync`** so symlinks cannot point outside the workspace for `--file`, `--input`, `--out`, `--payload`, `--schema`, `--text-file` (use `--text-file -` for stdin).

### Typical runner sequence (text)

1. `resolve` → temperature, output contract, handoff requirement.  
2. `compile-prompt` → system/developer blocks for the provider.  
3. After the model returns → `validate-output` (and/or `validate-handoff` if applicable).  
4. On failure → `retry-plan` or `runRetryPlan` from `lib/retry-plan.mjs`; before tool execute → `validate-tool-args`.

## Phase 3 (artifacts + continuity)

**Read handoff** — validate and export `resolve_input` seed + `continuity` (`task_id`, `intent`) for the next run:

```bash
node cli/src/index.mjs read-handoff
node cli/src/index.mjs read-handoff --file cli/src/handoff.example.json
node cli/src/index.mjs read-handoff --omit-handoff
```

Output includes **`merged_resolve_preview`** — the same merge `resolve` would apply from `resolve_input` + module `defaults` (use this to build a full `resolve-input` file). Use **`--omit-handoff`** when you want settings without echoing the full handoff packet (paths, work items) to stdout. For **`compile-prompt`**, use **`continuity.intent`** (and related fields) alongside the merged resolve fields.

**Trace file:** Prefer **one writer** at a time; parallel `trace-append` can corrupt JSONL. API: `appendTraceLine(traceAbsPath, record, options?)` in `lib/trace.mjs` (positional path first).

**Trace JSONL** (requires `paths.artifacts.trace` in `superskill.yaml`, e.g. `.superskill/trace.jsonl`):

```bash
node cli/src/index.mjs trace-append --payload cli/src/trace-line.example.json
node cli/src/index.mjs trace-tail --lines 20
```

Programmatic: `handoffPacketToResolveInput`, `appendTraceLine`, `readTraceTailLines` from `lib/index.mjs`.

## Phase 4 (outcomes + proposals, human reviewed)

Append a structured **outcome** line (`event: "outcome"`) to the trace file — same path as `trace-append`, validated with `schemas/outcome-line.schema.json`:

```bash
node cli/src/index.mjs outcome-append --payload cli/src/outcome-line.example.json
```

Summarize recent outcome events (bounded read from the end of the trace file; default max window 32 MiB, override with `--max-bytes`):

```bash
node cli/src/index.mjs outcomes-report
node cli/src/index.mjs outcomes-report --format json --max-bytes 1048576
```

Emit a **proposal** (Markdown on stdout; optional files under `.superskill/proposals/` — not auto-applied):

```bash
node cli/src/index.mjs outcomes-report --format proposal
node cli/src/index.mjs outcomes-report --format proposal --write-proposal
```

With `--format json --write-proposal`, only a YAML file is written (no Markdown); use `--format proposal --write-proposal` for both `.md` and `.yaml`.

Programmatic: `appendOutcomeLine`, `summarizeOutcomeRecords`, `readTraceLinesInWindow` from `lib/index.mjs`. Workflow: `docs/PHASE4_WORKFLOW.md`.

## Phase 5 (tests + proposal file validation)

Validate a proposal YAML snapshot (read-only; matches `schemas/proposal-file.schema.json`):

```bash
node cli/src/index.mjs validate-proposal --file cli/src/proposal-valid.example.yaml
```

Unit tests (trace/outcome/proposal validation): run `npm test` from the package root. Full CLI smoke: `npm run smoke`.

Embedder-oriented export list: `docs/PROGRAMMATIC_API.md`.

## Flags

- `--config path/to/superskill.yaml` — optional; otherwise searches `./superskill.yaml`, `./Superskill/superskill.yaml`, or the packaged default.
- `--key=value` form is supported (e.g. `--file=cli/src/handoff.example.json`).

## Examples location

| File | Use |
|------|-----|
| `cli/src/resolve-input.example.json` | `resolve --input` |
| `cli/src/handoff.example.json` | `validate-handoff` / `write-handoff` |
| `cli/src/retry-context.example.json` | `retry-plan --input` |
| `cli/src/sample-output.contract.md` | `validate-output --text-file` |
| `cli/src/tool-args.example.json` + `schemas/tool-args.example.schema.json` | `validate-tool-args` |
| `cli/src/runner-dry-run.example.json` | `runner-dry-run --input` |
| `cli/src/trace-line.example.json` | `trace-append --payload` |
| `cli/src/outcome-line.example.json` | `outcome-append --payload` |
| `cli/src/proposal-valid.example.yaml` | `validate-proposal --file` |

After `npm link` or global install, use the `superskill` binary instead of `node cli/src/index.mjs`.
