# Policies

This folder contains machine-readable policy inputs consumed by a Superskill runner.

- `temperature-policy.yaml`: canonical temp -> scenario/output caps -> provider mapping
- `model-capabilities.yaml`: what knobs each provider/model family supports
- `output-policy.yaml`: verbosity rules + output contracts + handoff requirement
- `retry-policy.yaml`: convergence rules to reduce rerolls
- `intent-map.yaml`: heuristics to map user intent into policy inputs

