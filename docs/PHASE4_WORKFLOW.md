# Phase 4 workflow: log → report → proposal → PR

Phase 4 supports a **human-reviewed** learning loop: runners record what happened, you inspect aggregates locally, and optional **proposal** files capture suggested policy follow-ups. Nothing in this package trains a model or mutates `policies/` automatically.

## Flow

1. **Log** — After a run, append a trace line with `event: "outcome"` using the CLI `outcome-append` or `appendOutcomeLine()` from `lib/outcome.mjs`. Lines validate against `schemas/outcome-line.schema.json` and are stored in `paths.artifacts.trace` (same file as generic `trace-append`).

2. **Report** — Run `outcomes-report` to aggregate counts in a **bounded tail window** of the trace file (same path resolution as `trace-tail`). Output defaults to JSON with `trace_file_exists`; if the trace file has not been created yet, counts are zero and a `note` explains that (avoid mistaking “no data” for “no failures”). Use `--max-bytes` to cap the read window (1024–64 MiB).

3. **Proposal** — Use `outcomes-report --format proposal` to print a Markdown summary. With `--write-proposal`, the CLI also writes `.superskill/proposals/proposal-<timestamp>.md` and `.yaml` under the current working directory (for review in git — add that folder to `.gitignore` if you prefer not to commit artifacts).

4. **Human PR** — Edit `policies/intent-map.yaml`, `policies/output-policy.yaml`, caps, or other module policy files in a normal branch/PR. Never apply proposal YAML automatically.

## Constraints

- **Single writer** for the trace file remains recommended; concurrent `trace-append` / `outcome-append` can corrupt JSONL.
- **Privacy:** Outcome payloads may include paths or task ids; treat shared reports like handoff output (see `--omit-handoff` discipline in `read-handoff` docs).

## Publishing consumers

If you ship this module as an npm package, see [PUBLISHING_NPM.md](./PUBLISHING_NPM.md) for publish steps; Phase 4 behavior is included in the same CLI and `lib` exports.
