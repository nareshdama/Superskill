# Contributing to Superskill

Thank you for helping improve Superskill. This document describes how we work in Git, what to run before you open a pull request, and where to read project rules.

## Code of conduct

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By engaging, you agree to uphold it.

## Git workflow

- **Branch from `main`** for changes. Use a short, descriptive branch name (for example `fix/trace-tail-window`, `docs/roadmap-update`).
- **Fork** the repository if you do not have write access, then open a pull request from your fork.
- **Commits:** Prefer focused commits with clear messages (imperative mood is fine: “Add validation for proposal schema”).
- **Pull requests:** One logical change per PR when possible. Link related issues or discussions in the PR description.
- **Rebase or merge** as you prefer locally; we care most about a readable history and a clean review, not a specific merge strategy.

Repository: [github.com/nareshdama/Superskill](https://github.com/nareshdama/Superskill).

## Development setup

Requirements:

- **Node.js 18+** (see [`package.json`](package.json) `engines`).
- **npm** (or compatible client) for dependencies.

From the repository root:

```bash
npm install
npm test
npm run smoke
```

- **`npm test`** — unit tests under `tests/`.
- **`npm run smoke`** — integration smoke script (`scripts/smoke-phase1.mjs`); keep this passing for CLI and policy changes.

Run the CLI from package root (directory containing `superskill.yaml`), for example:

```bash
node cli/src/index.mjs resolve --input cli/src/resolve-input.example.json
```

Details and all commands: [`cli/README.md`](cli/README.md).

## What to change where

| Area | Location | Notes |
|------|----------|--------|
| Policies (YAML) | `policies/` | Human-reviewed; no silent auto-updates in tooling. |
| JSON Schemas | `schemas/` | Keep in sync with CLI and `lib/` validators. |
| Library | `lib/` | Prefer exports through [`lib/index.mjs`](lib/index.mjs); document in [`docs/PROGRAMMATIC_API.md`](docs/PROGRAMMATIC_API.md). |
| CLI | `cli/src/` | Path safety and cwd rules matter; see existing commands. |
| Product docs | `docs/` | See roadmap and “current development” when behavior changes. |

For methodology on policy and schema changes, see [`docs/POLICY_CHANGE_PLAYBOOK.md`](docs/POLICY_CHANGE_PLAYBOOK.md).

## Pull request checklist

- [ ] `npm test` passes.
- [ ] `npm run smoke` passes (required for CLI, schemas, or policy loader changes).
- [ ] Documentation updated if you changed flags, schemas, or public `lib/` exports ([`docs/CURRENT_DEVELOPMENT.md`](docs/CURRENT_DEVELOPMENT.md), [`docs/PROGRAMMATIC_API.md`](docs/PROGRAMMATIC_API.md), [`docs/POLICY_CHANGE_PLAYBOOK.md`](docs/POLICY_CHANGE_PLAYBOOK.md), or [`docs/ROADMAP.md`](docs/ROADMAP.md) as appropriate).
- [ ] No new secrets or credentials committed (use `.gitignore` patterns; see [`SECURITY.md`](SECURITY.md) for reporting issues).

## Security

Do not open public issues for **undisclosed** security vulnerabilities. See [SECURITY.md](SECURITY.md).

## Questions

Open a [GitHub issue](https://github.com/nareshdama/Superskill/issues) for bugs or feature discussion. For design direction, [`docs/ROADMAP.md`](docs/ROADMAP.md) lists completed phases and future scope.
