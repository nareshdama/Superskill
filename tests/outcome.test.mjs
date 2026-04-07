import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeOutcomeRecords } from "../lib/outcome.mjs";

describe("lib/outcome.mjs summarizeOutcomeRecords", () => {
  it("counts by_event and only valid outcome payloads in outcome_events", () => {
    const records = [
      { trace_version: 1, ts: "t", event: "model_turn", payload: {} },
      { trace_version: 1, ts: "t", event: "outcome", payload: null },
      {
        trace_version: 1,
        ts: "t",
        event: "outcome",
        payload: {
          outcome_version: 1,
          status: "failure",
          failure_kind: "validate_output",
          retry_triggers: ["missing_required_sections"],
        },
      },
    ];
    const s = summarizeOutcomeRecords(records);
    assert.equal(s.total_lines, 3);
    assert.equal(s.outcome_events, 1);
    assert.equal(s.outcome_skipped_invalid_payload, 1);
    assert.equal(s.by_event.model_turn, 1);
    assert.equal(s.by_event.outcome, 2);
    assert.equal(s.by_status.failure, 1);
    assert.equal(s.retry_trigger_counts.missing_required_sections, 1);
  });

  it("treats parse error markers as parse_errors", () => {
    const s = summarizeOutcomeRecords([{ _parse_error: true, line: "bad" }]);
    assert.equal(s.parse_errors, 1);
    assert.equal(s.total_lines, 1);
  });
});
