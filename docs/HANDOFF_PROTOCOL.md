# Agent handoff protocol (module copy)

This is the module-local copy of the handoff protocol.

Source of truth in this module:

- `schemas/handoff-schema.json`
- `policies/output-policy.yaml` requires the packet in IDE/terminal environments

See the top-level `HANDOFF_PROTOCOL.md` for a longer narrative if present.

## Rules

- Every pointer must be marked `verified: true/false`.
- Dependencies must include a concrete `next_read` query or file path.
- Work items are expressed as ops (`read/edit/add/delete/run/investigate`), not prose.
- Verification is explicit commands.

