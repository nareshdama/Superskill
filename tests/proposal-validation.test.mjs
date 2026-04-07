import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import YAML from "yaml";

import { formatOutcomeProposalYaml, summarizeOutcomeRecords } from "../lib/outcome.mjs";
import { validateProposalDocument } from "../lib/validate-proposal-file.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("lib/validate-proposal-file.mjs", () => {
  it("accepts shipped example proposal", () => {
    const p = path.join(__dirname, "..", "cli", "src", "proposal-valid.example.yaml");
    const text = fs.readFileSync(p, "utf8");
    const doc = YAML.parse(text);
    const r = validateProposalDocument(doc);
    assert.equal(r.ok, true);
  });

  it("rejects fixture with missing summary fields", () => {
    const p = path.join(__dirname, "fixtures", "proposal-invalid.yaml");
    const text = fs.readFileSync(p, "utf8");
    const doc = YAML.parse(text);
    const r = validateProposalDocument(doc);
    assert.equal(r.ok, false);
  });

  it("formatOutcomeProposalYaml output validates after YAML parse (emitter/schema alignment)", () => {
    const summary = summarizeOutcomeRecords([]);
    const yml = formatOutcomeProposalYaml(summary, "2026-06-01T12:00:00.000Z");
    const doc = YAML.parse(yml);
    const r = validateProposalDocument(doc);
    assert.equal(r.ok, true);
  });
});
