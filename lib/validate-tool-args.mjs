/**
 * Validates tool-call JSON payloads against a JSON Schema (Ajv 2020).
 */

import fs from "node:fs";
import path from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

/** Cache compiled validators by normalized absolute schema path (PERF: avoid recompile per call). */
const schemaValidatorCache = new Map();

/**
 * Validates payload against an already-parsed JSON Schema object (no path cache).
 *
 * @param {unknown} payload - Parsed JSON tool arguments
 * @param {unknown} schema - JSON Schema document
 * @returns {{ ok: boolean, errors: import("ajv").ErrorObject[] | null }}
 */
export function validateToolArgsWithSchema(payload, schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  const ok = validate(payload);
  return { ok, errors: validate.errors ?? null };
}

/**
 * Validates payload against a schema file on disk; caches compiled validators per absolute path.
 *
 * @param {unknown} payload - Parsed JSON tool arguments
 * @param {string} schemaAbsPath - Absolute path to JSON Schema
 * @param {number} maxBytes - Max schema file size (bytes)
 * @returns {{ ok: boolean, errors: import("ajv").ErrorObject[] | null }}
 * @throws {Error} When the schema file cannot be read, exceeds maxBytes, contains invalid JSON, or Ajv compile fails
 */
export function validateToolArgsWithSchemaAtPath(payload, schemaAbsPath, maxBytes) {
  const key = path.normalize(schemaAbsPath);
  let validate = schemaValidatorCache.get(key);
  if (!validate) {
    const st = fs.statSync(schemaAbsPath);
    if (st.size > maxBytes) {
      throw new Error(`Schema file exceeds maximum allowed size (${maxBytes} bytes).`);
    }
    const schemaText = fs.readFileSync(schemaAbsPath, "utf8");
    let schema;
    try {
      schema = JSON.parse(schemaText);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid JSON in schema file: ${msg}`);
    }
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    try {
      validate = ajv.compile(schema);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Invalid JSON Schema (compile failed): ${msg}`);
    }
    schemaValidatorCache.set(key, validate);
  }
  const ok = validate(payload);
  return { ok, errors: validate.errors ?? null };
}
