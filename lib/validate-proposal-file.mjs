/**
 * Phase 5: validate `.superskill/proposals/*.yaml` shape (read-only; no policy mutation).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("ajv").ValidateFunction | null} */
let validateProposal = null;

function getProposalValidator() {
  if (!validateProposal) {
    const schemaPath = path.join(__dirname, "..", "schemas", "proposal-file.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    validateProposal = ajv.compile(schema);
  }
  return validateProposal;
}

/**
 * Validates a parsed proposal document (e.g. after YAML.parse).
 *
 * @param {unknown} doc
 * @returns {{ ok: true } | { ok: false, errors: import("ajv").ErrorObject[] | null | undefined }}
 */
export function validateProposalDocument(doc) {
  const v = getProposalValidator();
  const ok = v(doc);
  if (ok) return { ok: true };
  return { ok: false, errors: v.errors };
}
