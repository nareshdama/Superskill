# Temperature layer (module)

This module implements a "temperature setting layer" that maps:

- task (canonical temperature on `0.0-1.0`)
- scenario (incident/security/debugging/brainstorming)
- output mode (tool args / strict JSON / freeform)
- provider + model family

into final inference settings that reduce retries and hallucinations.

## Files

- Policy: `Superskill/policies/temperature-policy.yaml`
- Capabilities: `Superskill/policies/model-capabilities.yaml`
- Retry convergence: `Superskill/policies/retry-policy.yaml`

## Rule of thumb

- Tool args / strict JSON: cap low (boring wins).
- Incident/security/migrations: cap low (facts and contracts).
- Debugging: allow moderate exploration, then verify.
- Brainstorming: higher, then refine with a low-temp pass.

