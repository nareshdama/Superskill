# CLI command modules (Phase 5)

`cli/src/index.mjs` remains the single entrypoint (`superskill` binary). Command implementations currently live in `index.mjs` to avoid circular imports with shared config/path helpers.

When the CLI grows further, prefer extracting **self-contained** groups into `commands/<name>.mjs` that import only from `../../lib/*` and small local helpers—never from `index.mjs`.

See `docs/ROADMAP.md` Phase 5 (CLI maintainability).
