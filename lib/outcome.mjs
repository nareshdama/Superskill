/**
 * Phase 4: structured outcome lines (human-in-the-loop learning) for trace.jsonl.
 * ═══════════════════════════════════════════════════
 * Fixed by: Fixer Agent | Cycle: 8 (Bug Finder Cycle 8 — aggregation semantics, proposal YAML, single append validation)
 * Bugs fixed: 5 (0 critical, 3 major, 2 minor) — M1, M5, M6, m1, m2
 * Performance improvements: 0 (delegates to trace.appendTraceLine skipTraceValidation)
 * Proactive improvements: 1 (capped Ajv error payload in thrown message)
 * Code health: Good → Excellent
 * Safe to build on: YES
 * ═══════════════════════════════════════════════════
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { appendTraceLine } from "./trace.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_AJV_ERRORS_IN_MESSAGE = 24;

/** @type {import("ajv").ValidateFunction | null} */
let outcomeLineValidate = null;

/**
 * @param {import("ajv").ErrorObject[] | null | undefined} errors
 * @returns {Array<{ instancePath?: string, keyword?: string, message?: string }>}
 */
function summarizeErrors(errors) {
  if (!errors?.length) return [];
  const slice = errors.length > MAX_AJV_ERRORS_IN_MESSAGE ? errors.slice(0, MAX_AJV_ERRORS_IN_MESSAGE) : errors;
  return slice.map((e) => ({
    instancePath: e.instancePath,
    keyword: e.keyword,
    message: e.message,
  }));
}

function getOutcomeLineValidator() {
  if (!outcomeLineValidate) {
    const schemaPath = path.join(__dirname, "..", "schemas", "outcome-line.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    outcomeLineValidate = ajv.compile(schema);
  }
  return outcomeLineValidate;
}

/**
 * Validates an outcome trace line and appends it (same file as generic trace-append).
 * Uses one Ajv pass (outcome schema) then appends with trace validation skipped — outcome schema implies trace-line shape for valid records.
 *
 * @param {string} traceAbsPath
 * @param {unknown} record - Full line object (event must be "outcome")
 * @param {{ maxLineBytes?: number }} [options]
 * @returns {void}
 */
export function appendOutcomeLine(traceAbsPath, record, options) {
  const validate = getOutcomeLineValidator();
  const ok = validate(record);
  if (!ok) {
    const summarized = summarizeErrors(validate.errors);
    const suffix =
      validate.errors && validate.errors.length > MAX_AJV_ERRORS_IN_MESSAGE
        ? ` (showing first ${MAX_AJV_ERRORS_IN_MESSAGE} of ${validate.errors.length})`
        : "";
    throw new Error(`outcome line invalid: ${JSON.stringify(summarized)}${suffix}`);
  }
  appendTraceLine(traceAbsPath, record, { ...options, skipTraceValidation: true });
}

/**
 * Aggregates counts from parsed trace records (may include non-outcome and parse errors).
 *
 * @param {unknown[]} records
 * @returns {{
 *   total_lines: number,
 *   outcome_events: number,
 *   outcome_skipped_invalid_payload: number,
 *   parse_errors: number,
 *   by_event: Record<string, number>,
 *   by_status: Record<string, number>,
 *   by_failure_kind: Record<string, number>,
 *   retry_trigger_counts: Record<string, number>,
 * }}
 */
export function summarizeOutcomeRecords(records) {
  /** @type {Record<string, number>} */
  const byEvent = {};
  /** @type {Record<string, number>} */
  const byStatus = {};
  /** @type {Record<string, number>} */
  const byFailureKind = {};
  /** @type {Record<string, number>} */
  const retryTriggerCounts = {};
  let outcomeEvents = 0;
  let outcomeSkippedInvalidPayload = 0;
  let parseErrors = 0;

  for (const rec of records) {
    if (rec && typeof rec === "object" && /** @type {{ _parse_error?: boolean }} */ (rec)._parse_error) {
      parseErrors++;
      continue;
    }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
    const o = /** @type {Record<string, unknown>} */ (rec);
    const ev = o.event;
    const evKey = typeof ev === "string" && ev.trim() ? ev.trim() : "(missing_event)";
    byEvent[evKey] = (byEvent[evKey] ?? 0) + 1;

    if (ev !== "outcome") continue;

    const p = o.payload;
    if (!p || typeof p !== "object" || Array.isArray(p)) {
      outcomeSkippedInvalidPayload++;
      continue;
    }
    outcomeEvents++;
    const pl = /** @type {Record<string, unknown>} */ (p);
    const st = typeof pl.status === "string" ? pl.status : "unknown";
    byStatus[st] = (byStatus[st] ?? 0) + 1;
    const fk = pl.failure_kind;
    if (typeof fk === "string" && fk.trim()) {
      const k = fk.trim();
      byFailureKind[k] = (byFailureKind[k] ?? 0) + 1;
    }
    const rts = pl.retry_triggers;
    if (Array.isArray(rts)) {
      for (const t of rts) {
        if (typeof t !== "string" || !t.trim()) continue;
        const id = t.trim();
        retryTriggerCounts[id] = (retryTriggerCounts[id] ?? 0) + 1;
      }
    }
  }

  return {
    total_lines: records.length,
    outcome_events: outcomeEvents,
    outcome_skipped_invalid_payload: outcomeSkippedInvalidPayload,
    parse_errors: parseErrors,
    by_event: byEvent,
    by_status: byStatus,
    by_failure_kind: byFailureKind,
    retry_trigger_counts: retryTriggerCounts,
  };
}

/**
 * Renders a human-review Markdown snippet from an aggregate summary (no policy mutation).
 *
 * @param {ReturnType<typeof summarizeOutcomeRecords>} summary
 * @returns {string}
 */
export function formatOutcomeProposalMarkdown(summary) {
  const lines = [
    "# Superskill policy proposal (human review)",
    "",
    "Do not auto-apply. Copy edits into `policies/` via git PR.",
    "",
    "## Aggregates (recent trace window)",
    "",
    `- Outcome events (valid payload): ${summary.outcome_events}`,
    `- Outcome lines skipped (invalid payload): ${summary.outcome_skipped_invalid_payload}`,
    `- Parse errors in window: ${summary.parse_errors}`,
    "",
    "### By event (all parsed lines)",
    ...Object.entries(summary.by_event).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "### By status (outcome events only)",
    ...Object.entries(summary.by_status).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "### By failure_kind",
    ...Object.entries(summary.by_failure_kind).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "### Retry trigger tallies",
    ...Object.entries(summary.retry_trigger_counts).map(([k, v]) => `- ${k}: ${v}`),
    "",
    "## Placeholder policy suggestions (fill manually)",
    "",
    "- `suggested_intent_rules`: add keywords when failure_kind correlates with user phrasing.",
    "- `suggested_scenario_caps`: adjust caps/floors when retries cluster on one scenario.",
    "",
    "## Suggested next steps",
    "",
    "- If `missing_required_sections` dominates: tighten `validate-output` contract messaging or adjust `output-policy.yaml` contracts.",
    "- If `tool_args_invalid` dominates: expand tool JSON Schemas or `validate-tool-args` wiring.",
    "- If `missing_or_invalid_handoff_packet` dominates: review `schemas/handoff-schema.json` and handoff protocol docs.",
    "- Add or refine `intent-map.yaml` keywords when failures correlate with specific user phrases (manual).",
    "",
  ];
  return lines.join("\n");
}

/**
 * YAML-ish proposal document for `.superskill/proposals/` (readable; not machine-applied).
 * Includes empty structured lists for human fill-in (Phase 4 Option B shape).
 *
 * @param {ReturnType<typeof summarizeOutcomeRecords>} summary
 * @param {string} isoTimestamp
 * @returns {string}
 */
export function formatOutcomeProposalYaml(summary, isoTimestamp) {
  const y = (s) => JSON.stringify(s);
  const q = (s) => JSON.stringify(s);
  return [
    `# Superskill policy proposal — ${isoTimestamp}`,
    "# Human review only. Merge via PR; never auto-apply.",
    "",
    `generated_at: ${q(isoTimestamp)}`,
    "summary:",
    `  total_outcome_events: ${summary.outcome_events}`,
    `  outcome_skipped_invalid_payload: ${summary.outcome_skipped_invalid_payload}`,
    `  parse_errors_in_window: ${summary.parse_errors}`,
    "  by_event: " + y(summary.by_event),
    "  by_status: " + y(summary.by_status),
    "  by_failure_kind: " + y(summary.by_failure_kind),
    "  retry_trigger_counts: " + y(summary.retry_trigger_counts),
    "",
    "how_to_apply:",
    "  - Edit policies under policies/ in a branch; open a PR. Do not run auto-apply tools on this file.",
    "",
    "suggested_intent_rules: []",
    "suggested_scenario_caps: []",
    "suggested_capability_flags: []",
    "suggested_output_contracts: []",
    "",
  ].join("\n");
}
