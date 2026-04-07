# Security policy

## Supported versions

Security fixes are applied to the **latest published minor release** on the `main` branch and released as patch versions when needed. Older lines may not receive backports unless agreed by maintainers.

| Version | Supported |
|---------|-----------|
| Current `main` / latest npm | Yes |
| Older minors | Best effort |

Package: `@nareshdama/superskill-policy-engine` (see [`package.json`](package.json)).

## Reporting a vulnerability

**Please do not** file a public issue for undisclosed security problems.

1. Use **[GitHub Security advisories](https://github.com/nareshdama/Superskill/security/advisories)** for this repository: *Security* tab → *Report a vulnerability* (private to maintainers).
2. If you cannot use GitHub, contact the repository owner via their GitHub profile and ask for a secure channel.

Include:

- A short description of the impact and affected components (CLI, `lib/`, schema validation, path handling, etc.).
- Steps to reproduce or a proof-of-concept, if safe to share.
- Suggested fix (optional).

We aim to acknowledge reports promptly and coordinate disclosure after a fix is available.

## Scope notes

This project is a **policy and validation** toolkit; it does not call remote model APIs. Reports about **path traversal**, **unsafe deserialization**, or **unexpected writes** outside the intended working directory are especially welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how we handle path checks in the CLI.
