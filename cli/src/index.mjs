#!/usr/bin/env node
/* ═══════════════════════════════════════════════════
 * Fixed by: Fixer Agent | Cycle: 5 (Bug Finder Cycle 3 — trace tail, read-handoff merge preview, docs)
 * Also: Fixer Agent | Cycle: 8 (Bug Finder Cycle 8 — trace readSync loop, outcomes-report metadata, trace skipValidation on outcome-append)
 * Bugs fixed: 12 + 8 (Cycle 8: M1, M2, M3, M4, M5, M6, m1–m3, STRUCT-8-2, PERF-8-1)
 * Performance improvements: 2 (Cycle 5 tail; Cycle 8 single Ajv on outcome-append + full readSync)
 * Proactive improvements: 3 + 2 (Cycle 8: by_event rollup, proposal YAML placeholders)
 * Code health: Excellent → Excellent
 * Safe to build on: YES
 * ═══════════════════════════════════════════════════
 * Prior: Cycle 4 path hardening; Phase 3 read-handoff / trace commands
 * Phase 4: outcome-append, outcomes-report (human-reviewed learning loop)
 * Phase 5: validate-proposal, tests (tests/*.test.mjs), cli/src/constants.mjs, docs/PROGRAMMATIC_API.md
 * ═══════════════════════════════════════════════════ */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

import { handoffContinuityMeta, handoffPacketToResolveInput } from "../../lib/handoff-continuity.mjs";
import {
  appendOutcomeLine,
  formatOutcomeProposalMarkdown,
  formatOutcomeProposalYaml,
  summarizeOutcomeRecords,
} from "../../lib/outcome.mjs";
import { validateOutputContract } from "../../lib/validate-output-contract.mjs";
import { appendTraceLine, readTraceLinesInWindow, readTraceTailLines } from "../../lib/trace.mjs";
import { validateToolArgsWithSchemaAtPath } from "../../lib/validate-tool-args.mjs";
import { parseRetryContext, planRetry } from "../../lib/retry-plan.mjs";
import { validateProposalDocument } from "../../lib/validate-proposal-file.mjs";
import {
  DEFAULT_OUTCOMES_REPORT_BYTES,
  MAX_OUTCOMES_REPORT_BYTES_CAP,
  MAX_TRACE_LINE_BYTES,
  MAX_TRACE_TAIL_READ_BYTES,
} from "./constants.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Maximum JSON file size read from user-supplied paths (bytes). */
const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** Cache compiled validators by absolute schema path (PERF-1-1). */
const schemaValidatorCache = new Map();

/**
 * Returns a minimal, stable summary of Ajv errors for stderr (BUG-1-m1).
 *
 * @param {import("ajv").ErrorObject[] | null | undefined} errors
 * @returns {Array<{ instancePath?: string, keyword?: string, message?: string }>}
 */
function summarizeAjvErrors(errors) {
  if (!errors || !errors.length) return [];
  return errors.map((e) => ({
    instancePath: e.instancePath,
    keyword: e.keyword,
    message: e.message,
  }));
}

/**
 * Compiles (or returns cached) JSON Schema validator for a given absolute schema path.
 *
 * @param {string} schemaAbsPath
 * @returns {import("ajv").ValidateFunction}
 */
function getValidatorForSchemaPath(schemaAbsPath) {
  const key = path.normalize(schemaAbsPath);
  let v = schemaValidatorCache.get(key);
  if (v) return v;
  const schemaText = readTextWithSizeCap(key, MAX_JSON_BYTES);
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  v = ajv.compile(schema);
  schemaValidatorCache.set(key, v);
  return v;
}

/**
 * Reads UTF-8 text with a byte-size cap before allocating a full string (PERF-1-3 / BUG-1-m4).
 *
 * @param {string} filePath
 * @param {number} maxBytes
 * @returns {string}
 * @throws {Error} When file exceeds maxBytes or cannot be read
 */
function readTextWithSizeCap(filePath, maxBytes) {
  const st = fs.statSync(filePath);
  if (st.size > maxBytes) {
    throw new Error(`File exceeds maximum allowed size (${maxBytes} bytes): ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

/**
 * Reads a UTF-8 text file synchronously (internal small files; still capped for safety).
 *
 * @param {string} filePath - Absolute or relative filesystem path
 * @returns {string} File contents
 * @throws {Error} When the file cannot be read (propagated from `fs.readFileSync`)
 */
function readText(filePath) {
  return readTextWithSizeCap(filePath, MAX_JSON_BYTES);
}

/**
 * Parses a YAML file into a JavaScript value.
 *
 * @param {string} filePath - Path to a `.yaml` / `.yml` file
 * @returns {unknown} Parsed document root
 * @throws {Error} On read failure or YAML syntax errors
 */
function readYaml(filePath) {
  return YAML.parse(readText(filePath));
}

/**
 * Parses JSON from a user-supplied path with a strict byte cap.
 *
 * @param {string} filePath
 * @returns {unknown}
 */
function readJsonUserFile(filePath) {
  const text = readTextWithSizeCap(filePath, MAX_JSON_BYTES);
  return JSON.parse(text);
}

/**
 * Requires a CLI flag value to be a non-empty string (fixes boolean `true` placeholders) (BUG-1-C1).
 *
 * @param {unknown} value
 * @param {string} flagName - e.g. `--file`
 * @param {string} example - Example invocation fragment
 * @returns {string}
 * @throws {Error} When value is not a usable path string
 */
function requireStringFlag(value, flagName, example) {
  if (value === true || value === false) {
    throw new Error(`${flagName} requires a path string after the flag. ${example}`);
  }
  if (typeof value !== "string") {
    throw new Error(`${flagName} requires a path string (got ${typeof value}). ${example}`);
  }
  const t = value.trim();
  if (!t.length) {
    throw new Error(`${flagName} requires a non-empty path. ${example}`);
  }
  return t;
}

/**
 * Normalizes optional `--config` argv (undefined allowed; booleans rejected).
 *
 * @param {unknown} raw
 * @returns {string | undefined}
 * @throws {Error} When provided but not a non-empty string
 */
function normalizeExplicitConfigArg(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (raw === true || raw === false) {
    throw new Error(
      '--config requires a path string after the flag (e.g. --config ./superskill.yaml). Do not end with bare "--config".',
    );
  }
  if (typeof raw !== "string") {
    throw new Error(`--config must be a path string (got ${typeof raw}).`);
  }
  const t = raw.trim();
  if (!t.length) {
    throw new Error("--config requires a non-empty path string.");
  }
  return t;
}

/**
 * Resolves a user path and ensures the **real** path (after symlinks) stays inside cwd (BUG-2-C1).
 *
 * @param {string} userPath - Trimmed relative or absolute path
 * @param {string} flagName - For error messages
 * @returns {string} Absolute real path within cwd (or a new file path whose parent is verified)
 * @throws {Error} When the path escapes the workspace via `..`, absolute paths, or symlink targets
 */
function resolvePathInsideCwd(userPath, flagName) {
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, userPath);
  let realCwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch {
    throw new Error(`${flagName}: cannot resolve working directory.`);
  }

  try {
    const realResolved = fs.realpathSync(resolved);
    const rel = path.relative(realCwd, realResolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(`${flagName}: path escapes workspace (symlink or path outside cwd).`);
    }
    return realResolved;
  } catch (first) {
    if (first instanceof Error && first.message.includes("escapes workspace")) throw first;
    const parentDir = path.dirname(resolved);
    const base = path.basename(resolved);
    let realParent;
    try {
      realParent = fs.realpathSync(parentDir);
    } catch {
      throw new Error(`${flagName}: parent directory missing or not reachable (create parent directories first).`);
    }
    const relParent = path.relative(realCwd, realParent);
    if (relParent.startsWith("..") || path.isAbsolute(relParent)) {
      throw new Error(`${flagName}: path escapes workspace (symlink outside cwd).`);
    }
    return path.join(realParent, base);
  }
}

/**
 * Reads stdin up to maxBytes (for `--text-file -`).
 *
 * @param {number} maxBytes
 * @returns {string}
 */
function readStdinWithSizeCap(maxBytes) {
  const chunks = [];
  let total = 0;
  const fd = 0;
  while (total < maxBytes) {
    const space = maxBytes - total;
    const toRead = Math.min(65536, space);
    const buf = Buffer.alloc(toRead);
    let n;
    try {
      n = fs.readSync(fd, buf, 0, toRead, null);
    } catch {
      break;
    }
    if (n === 0) break;
    total += n;
    chunks.push(buf.subarray(0, n));
  }
  let extra = 0;
  const probe = Buffer.alloc(1);
  try {
    extra = fs.readSync(fd, probe, 0, 1, null);
  } catch {
    extra = 0;
  }
  if (extra > 0) {
    throw new Error("stdin exceeds maximum allowed size for --text-file -");
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Resolves a path relative to the Superskill package root (two levels above this file).
 *
 * @param {string} rel - Relative path from package root (e.g. `policies/foo.yaml`)
 * @returns {string} Absolute path
 */
function resolveModulePath(rel) {
  return path.resolve(__dirname, "..", "..", rel);
}

/**
 * Locates `superskill.yaml`: explicit path, cwd, `Superskill/`, or packaged default.
 *
 * @param {unknown} explicitPathRaw - Optional `--config` path
 * @returns {string} Absolute path to the config file (may not exist if all candidates fail)
 */
function findConfigPath(explicitPathRaw) {
  const explicitPath = normalizeExplicitConfigArg(explicitPathRaw);
  if (explicitPath !== undefined) {
    return path.isAbsolute(explicitPath) ? explicitPath : path.resolve(process.cwd(), explicitPath);
  }

  const candidates = [
    path.resolve(process.cwd(), "superskill.yaml"),
    path.resolve(process.cwd(), "Superskill", "superskill.yaml"),
    resolveModulePath("superskill.yaml"),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return resolveModulePath("superskill.yaml");
}

/**
 * Validates minimal shape of `superskill.yaml` needed by the CLI (BUG-1-M4 / STRUCT-1-3).
 *
 * @param {unknown} cfg
 * @returns {asserts cfg is Record<string, unknown>}
 * @throws {Error} When required keys are missing or wrong type
 */
function assertSuperskillConfigShape(cfg) {
  if (cfg === null || typeof cfg !== "object" || Array.isArray(cfg)) {
    throw new Error("superskill.yaml must parse to a YAML object at the root.");
  }
  const c = /** @type {Record<string, unknown>} */ (cfg);
  const paths = c.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new Error("superskill.yaml must include a `paths` object.");
  }
  const p = /** @type {Record<string, unknown>} */ (paths);
  const policies = p.policies;
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) {
    throw new Error("superskill.yaml must include `paths.policies` as an object.");
  }
  const pol = /** @type {Record<string, unknown>} */ (policies);
  for (const key of ["temperature", "capabilities", "output", "intent", "prompts"]) {
    const v = pol[key];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`superskill.yaml must set paths.policies.${key} to a non-empty string.`);
    }
  }
  // paths.policies.retry is optional for Phase-1-only configs; required when using `retry-plan`.
  const schemas = p.schemas;
  if (!schemas || typeof schemas !== "object" || Array.isArray(schemas)) {
    throw new Error("superskill.yaml must include `paths.schemas` as an object.");
  }
  const sch = /** @type {Record<string, unknown>} */ (schemas);
  if (typeof sch.handoff !== "string" || !sch.handoff.trim()) {
    throw new Error("superskill.yaml must set paths.schemas.handoff to a non-empty string.");
  }
  const artifacts = p.artifacts;
  if (!artifacts || typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new Error("superskill.yaml must include `paths.artifacts` as an object.");
  }
  const art = /** @type {Record<string, unknown>} */ (artifacts);
  if (typeof art.handoff !== "string" || !art.handoff.trim()) {
    throw new Error("superskill.yaml must set paths.artifacts.handoff to a non-empty string.");
  }
  if (art.trace !== undefined && (typeof art.trace !== "string" || !String(art.trace).trim())) {
    throw new Error("superskill.yaml paths.artifacts.trace must be a non-empty string when set.");
  }
}

/**
 * Warns when the resolved config path lies outside `process.cwd()` (BUG-3-M4 visibility).
 *
 * @param {string} configAbsPath - Absolute path to `superskill.yaml`
 * @returns {void}
 */
function warnIfConfigOutsideCwd(configAbsPath) {
  const cwd = process.cwd();
  const resolved = path.resolve(configAbsPath);
  const rel = path.relative(cwd, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    console.warn(`[superskill] Warning: loading config from outside cwd (${cwd}): ${resolved}`);
  }
}

/**
 * Loads and parses `superskill.yaml`, resolving the path if relative.
 *
 * @param {string} configPath - Path to config (absolute or cwd-relative)
 * @returns {{ absPath: string, cfg: Record<string, unknown> }}
 * @throws {Error} When the file is missing or YAML is invalid
 */
function loadSuperskillConfig(configPath) {
  const abs = path.isAbsolute(configPath) ? configPath : path.resolve(process.cwd(), configPath);
  warnIfConfigOutsideCwd(abs);
  const cfg = readYaml(abs);
  assertSuperskillConfigShape(cfg);
  return { absPath: abs, cfg: /** @type {Record<string, unknown>} */ (cfg) };
}

/**
 * Returns `paths.artifacts.trace` or throws (for `trace-append`, `trace-tail`, `outcome-append`, `outcomes-report`).
 *
 * @param {Record<string, unknown>} cfg - Loaded superskill.yaml root
 * @returns {string} Relative path from module root to trace JSONL
 * @throws {Error} When trace path is missing or not a non-empty string
 */
function requireTraceArtifactPath(cfg) {
  const paths = cfg.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new Error("trace commands require superskill.yaml to include a top-level `paths` object.");
  }
  const art = /** @type {Record<string, unknown>} */ (paths).artifacts;
  if (!art || typeof art !== "object" || Array.isArray(art)) {
    throw new Error("trace commands require superskill.yaml to include `paths.artifacts`.");
  }
  const t = /** @type {Record<string, unknown>} */ (art).trace;
  if (typeof t !== "string" || !t.trim()) {
    throw new Error(
      "trace / outcome / outcomes-report commands require superskill.yaml paths.artifacts.trace (e.g. .superskill/trace.jsonl).",
    );
  }
  return t.trim();
}

/**
 * Returns `paths.policies.retry` or throws (for `retry-plan` only).
 *
 * @param {Record<string, unknown>} cfg - Loaded superskill.yaml root
 * @returns {string} Relative path from module root to retry policy YAML
 */
function requireRetryPolicyPath(cfg) {
  const paths = cfg.paths;
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) {
    throw new Error('retry-plan requires superskill.yaml to include a top-level `paths` object.');
  }
  const pol = /** @type {Record<string, unknown>} */ (paths).policies;
  if (!pol || typeof pol !== "object" || Array.isArray(pol)) {
    throw new Error("retry-plan requires superskill.yaml to include `paths.policies` as an object.");
  }
  const r = /** @type {Record<string, unknown>} */ (pol).retry;
  if (typeof r !== "string" || !r.trim()) {
    throw new Error(
      "retry-plan requires superskill.yaml to set paths.policies.retry to a non-empty string (e.g. policies/retry-policy.yaml).",
    );
  }
  return r.trim();
}

/**
 * Prints CLI usage to stdout.
 *
 * @returns {void}
 */
function usage() {
  console.log(
    [
      "superskill <command> [args]",
      "",
      "Commands:",
      "  validate-handoff --file <handoff.json> [--config <superskill.yaml>]",
      "  write-handoff --file <handoff.json> [--out <path>] [--config <superskill.yaml>]",
      "  read-handoff [--file <handoff.json>] [--omit-handoff] [--config <superskill.yaml>]  (default file: paths.artifacts.handoff)",
      "  resolve --input <resolve-input.json> [--config <superskill.yaml>]",
      "  route --text <string> [--config <superskill.yaml>]",
      "  compile-prompt --provider <openai|anthropic|gemini> --environment <terminal|ide|ci|docs> --intent <implement|debug|review|plan|verify> --scenario <name> [--config <superskill.yaml>]",
      "  retry-plan --input <retry-context.json> [--config <superskill.yaml>]",
      "  validate-output --contract <id> (--text-file <path|- for stdin> | --text <string>) [--config <superskill.yaml>]",
      "  validate-tool-args --payload <jsonfile> --schema <schema.json>",
      "  runner-dry-run --input <dry-run.json> [--config <superskill.yaml>]",
      "  trace-append --payload <event.json> [--config <superskill.yaml>]",
      "  trace-tail [--lines <n>] [--config <superskill.yaml>]",
      "  outcome-append --payload <outcome.json> [--config <superskill.yaml>]  (schemas/outcome-line.schema.json)",
      "  outcomes-report [--format json|proposal] [--max-bytes <n>] [--write-proposal] [--config <superskill.yaml>]",
      "  validate-proposal --file <proposal.yaml>  (schemas/proposal-file.schema.json; read-only)",
      "",
      "Notes:",
      "  This CLI loads policies from superskill.yaml; it does not call model APIs.",
      "  Flags accept `--key value` or `--key=value`. User file paths must stay under the current working directory.",
      "  outcomes-report: `--format json --write-proposal` writes YAML only under .superskill/proposals/; use `--format proposal --write-proposal` for .md + .yaml.",
    ].join("\n"),
  );
}

/**
 * Minimal argv parser: `--key value`, boolean `--flag`, or `--key=value` (BUG-1-m2).
 *
 * @param {string[]} argv - Arguments after the script name
 * @returns {Record<string, string | boolean> & { _: string[] }}
 */
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      let key = a.slice(2);
      let val = argv[i + 1];
      const eq = key.indexOf("=");
      if (eq !== -1) {
        val = key.slice(eq + 1);
        key = key.slice(0, eq);
      }
      if (!key) continue;
      if (eq !== -1) {
        out[key] = val ?? "";
        continue;
      }
      if (!val || val.startsWith("--")) out[key] = true;
      else {
        out[key] = val;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/**
 * Validates a handoff JSON file against the JSON Schema and prints `{ ok }` or errors.
 *
 * @param {{ file: string, schemaPath: string }} params - Input path and schema path
 * @returns {void}
 */
function validateHandoff({ file, schemaPath }) {
  const validate = getValidatorForSchemaPath(schemaPath);
  const packet = readJsonUserFile(file);
  const ok = validate(packet);
  if (!ok) {
    console.error(JSON.stringify({ ok: false, errors: summarizeAjvErrors(validate.errors) }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({ ok: true }, null, 2));
}

/**
 * Validates an in-memory handoff packet against the schema.
 *
 * @param {{ packet: unknown, schemaPath: string }} params
 * @returns {{ ok: boolean, errors: import("ajv").ErrorObject[] | null }}
 */
function validateHandoffPacket({ packet, schemaPath }) {
  const validate = getValidatorForSchemaPath(schemaPath);
  const ok = validate(packet);
  return { ok, errors: validate.errors ?? null };
}

/**
 * Clamps a number to the closed interval [0, 1]. Non-finite input becomes 0 (BUG-1-M2).
 *
 * @param {number} x - Value to clamp
 * @returns {number}
 */
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Returns `Math.min(t, cap)` when `cap` is a finite number; otherwise returns `t` (BUG-1-M2).
 *
 * @param {number} t - Temperature
 * @param {number | null | undefined} cap - Optional cap
 * @returns {number}
 */
function applyCap(t, cap) {
  if (cap === null || cap === undefined) return t;
  if (!Number.isFinite(cap)) return t;
  return Math.min(t, cap);
}

/**
 * Returns `Math.max(t, floor)` when `floor` is a finite number; otherwise returns `t` (BUG-1-M2).
 *
 * @param {number} t - Temperature
 * @param {number | null | undefined} floor - Optional floor
 * @returns {number}
 */
function applyFloor(t, floor) {
  if (floor === null || floor === undefined) return t;
  if (!Number.isFinite(floor)) return t;
  return Math.max(t, floor);
}

/**
 * Shared contract id resolution for `resolve` and `compile-prompt` (BUG-1-M5).
 *
 * @param {Record<string, unknown>} outputPolicy
 * @param {string} scenario
 * @param {Record<string, unknown>} moduleDefaults - Typically `cfg.defaults`
 * @returns {string}
 */
function selectOutputContract(outputPolicy, scenario, moduleDefaults) {
  const byScenario = outputPolicy.by_scenario;
  const scenarioEntry = byScenario && typeof byScenario === "object" ? byScenario[scenario] : undefined;
  const contractFromScenario = scenarioEntry && typeof scenarioEntry === "object" ? scenarioEntry.contract : undefined;

  const rawFallback =
    typeof moduleDefaults.output_contract === "string" ? moduleDefaults.output_contract.trim() : "concise_engineering";

  if (typeof contractFromScenario === "string" && contractFromScenario.trim().length > 0) {
    return contractFromScenario.trim();
  }
  return rawFallback.length > 0 ? rawFallback : "concise_engineering";
}

/**
 * Maps canonical subskill temperature through caps, provider rules, and capabilities.
 *
 * @param {{ input: Record<string, unknown>, policies: Record<string, unknown>, capabilities: Record<string, unknown> | null }} params
 * @returns {Record<string, unknown>} Fields such as `temperature`, `omit_temperature`, `mapped_by`
 */
function resolvePolicy({ input, policies, capabilities }) {
  const base = policies.base_from_subskill;
  const baseTemp = base && typeof base === "object" ? /** @type {{ default_temperature?: unknown }} */ (base).default_temperature : undefined;
  if (typeof baseTemp !== "number" || !Number.isFinite(baseTemp)) {
    throw new Error("temperature policy must define base_from_subskill.default_temperature as a finite number.");
  }

  const subskillTemp = input?.canonical_temperature;
  let t = typeof subskillTemp === "number" && Number.isFinite(subskillTemp) ? subskillTemp : baseTemp;
  t = clamp01(t);

  const outputMode = input.output_mode ?? "structured_text";
  const scenario = input.scenario ?? "normal";
  const provider = input.provider ?? "openai";
  const modelFamily = input.model_family ?? "sampling_chat";

  const om = policies.output_mode_overrides?.[outputMode];
  if (om?.cap !== undefined) t = applyCap(t, om.cap);

  const so = policies.scenario_overrides?.[scenario];
  if (so?.cap !== undefined) t = applyCap(t, so.cap);
  if (so?.floor !== undefined) t = applyFloor(t, so.floor);

  if (typeof input.user_temperature === "number" && Number.isFinite(input.user_temperature) && input.allow_user_override === true) {
    t = clamp01(input.user_temperature);
  }

  const providerCfg = policies.provider_mapping?.providers?.[provider];
  const famOverride = providerCfg?.model_family_overrides?.[modelFamily] ?? {};

  const provCaps = capabilities?.providers?.[provider]?.families?.[modelFamily] ??
    capabilities?.providers?.[provider]?.families?.default ??
    null;
  const supportsTemp = provCaps?.supports?.temperature;
  const omit = famOverride?.omit_temperature === true || supportsTemp === false;

  const mapped = { canonical_temperature: t };
  if (omit) {
    mapped.temperature = null;
    mapped.omit_temperature = true;
    mapped.mapped_by = "omit";
    return mapped;
  }

  if (famOverride?.map_kind === "fixed") {
    mapped.temperature = famOverride.fixed_value;
    mapped.mapped_by = "fixed";
    return mapped;
  }

  mapped.temperature = t;
  mapped.mapped_by = "identity";
  return mapped;
}
// DESIGN NOTE: Temperature resolution stays isolated so runners can unit-test mapping without I/O.

/**
 * Merges runner JSON with module `defaults` from `superskill.yaml` for deterministic resolution.
 *
 * @param {unknown} input - Raw object from resolve JSON file
 * @param {Record<string, unknown> | undefined} moduleDefaults - `defaults` block from config
 * @returns {Record<string, unknown>} Normalized fields used by policy resolvers
 */
function mergeResolveInput(input, moduleDefaults) {
  const d = moduleDefaults ?? {};
  const i = input !== null && typeof input === "object" && !Array.isArray(input) ? /** @type {Record<string, unknown>} */ (input) : {};

  const envRaw = i.environment;
  const environment =
    typeof envRaw === "string" && envRaw.trim().length > 0 ? envRaw.trim() : String(d.environment ?? "terminal");

  const scenRaw = i.scenario;
  const scenario =
    typeof scenRaw === "string" && scenRaw.trim().length > 0 ? scenRaw.trim() : String(d.scenario ?? "normal");

  const omRaw = i.output_mode;
  const output_mode =
    typeof omRaw === "string" && omRaw.trim().length > 0 ? omRaw.trim() : String(d.output_mode ?? "structured_text");

  const provRaw = i.provider;
  const provider = typeof provRaw === "string" && provRaw.trim().length > 0 ? provRaw.trim() : String(d.provider ?? "openai");

  const mfRaw = i.model_family;
  const model_family =
    typeof mfRaw === "string" && mfRaw.trim().length > 0 ? mfRaw.trim() : String(d.model_family ?? "sampling_chat");

  const allow_user_override = i.allow_user_override === true;

  const ut = i.user_temperature;
  const user_temperature = typeof ut === "number" && Number.isFinite(ut) ? ut : undefined;

  const ct = i.canonical_temperature;
  const canonical_temperature = typeof ct === "number" && Number.isFinite(ct) ? ct : undefined;

  return {
    environment,
    scenario,
    output_mode,
    provider,
    model_family,
    allow_user_override,
    ...(user_temperature !== undefined ? { user_temperature } : {}),
    ...(canonical_temperature !== undefined ? { canonical_temperature } : {}),
  };
}

/**
 * Returns whether a handoff packet is required for the given environment (matches `compile-prompt` logic).
 *
 * @param {Record<string, unknown>} outputPolicy - Parsed `output-policy.yaml`
 * @param {string} environment - Environment id (e.g. `terminal`, `ide`)
 * @returns {boolean}
 */
function computeRequireHandoffPacket(outputPolicy, environment) {
  const requireHandoff =
    (outputPolicy.defaults?.handoff_packet?.required_for_environments ?? []).includes(environment) ||
    outputPolicy.by_environment?.[environment]?.require_handoff_packet === true;
  return requireHandoff === true;
}
// DESIGN NOTE: One function for handoff requirement avoids `resolve` and `compile-prompt` drifting apart.

/**
 * Selects output contract id and handoff metadata from output policy and module defaults.
 *
 * @param {{ mergedInput: Record<string, unknown>, outputPolicy: Record<string, unknown>, moduleDefaults: Record<string, unknown> }} params
 * @returns {{
 *   output_contract: string,
 *   require_handoff_packet: boolean,
 *   handoff_schema_ref: string | null,
 *   handoff_protocol_doc: string | null
 * }}
 */
function resolveOutputAndHandoff({ mergedInput, outputPolicy, moduleDefaults }) {
  const scenario = String(mergedInput.scenario ?? "normal");
  const environment = String(mergedInput.environment ?? "terminal");

  const output_contract = selectOutputContract(outputPolicy, scenario, moduleDefaults);

  const require_handoff_packet = computeRequireHandoffPacket(outputPolicy, environment);

  const hp = outputPolicy.defaults?.handoff_packet;
  const handoff_schema_ref = hp && typeof hp.schema === "string" ? hp.schema : null;
  const handoff_protocol_doc = hp && typeof hp.protocol_doc === "string" ? hp.protocol_doc : null;

  return { output_contract, require_handoff_packet, handoff_schema_ref, handoff_protocol_doc };
}
// DESIGN NOTE: Contract selection mirrors `compile-prompt` via selectOutputContract.

/**
 * Computes resolve JSON (same shape as `resolve` command) from merged input and loaded config.
 *
 * @param {Record<string, unknown>} cfg - Loaded superskill.yaml
 * @param {Record<string, unknown>} mergedInput - Output of mergeResolveInput
 * @returns {Record<string, unknown>}
 */
function computeResolveOutput(cfg, mergedInput) {
  const moduleDefaults = /** @type {Record<string, unknown>} */ (cfg.defaults ?? {});
  const policiesPath = /** @type {string} */ (cfg.paths.policies.temperature);
  const capsPath = /** @type {string} */ (cfg.paths.policies.capabilities);
  const outputPath = /** @type {string} */ (cfg.paths.policies.output);

  const policies = readYaml(resolveModulePath(policiesPath));
  const capabilities = readYaml(resolveModulePath(capsPath));
  const outputPolicy = readYaml(resolveModulePath(outputPath));

  const temperatureBlock = resolvePolicy({
    input: mergedInput,
    policies,
    capabilities,
  });

  const outputBlock = resolveOutputAndHandoff({
    mergedInput,
    outputPolicy,
    moduleDefaults,
  });

  return {
    ok: true,
    environment: mergedInput.environment,
    scenario: mergedInput.scenario,
    output_mode: mergedInput.output_mode,
    provider: mergedInput.provider,
    model_family: mergedInput.model_family,
    ...temperatureBlock,
    ...outputBlock,
  };
}

/**
 * Runs `retry-plan`: loads retry-policy.yaml and a JSON context file; prints a retry plan.
 *
 * @param {{ inputFile: string, configPath: unknown }} params
 * @returns {void}
 */
function retryPlanCmd({ inputFile, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const retryRel = requireRetryPolicyPath(cfg);
  const retryPolicy = readYaml(resolveModulePath(retryRel));

  const absInput = resolvePathInsideCwd(inputFile, "--input");
  const raw = readJsonUserFile(absInput);
  const context = parseRetryContext(raw);
  const plan = planRetry({ retryPolicy: /** @type {Record<string, unknown>} */ (retryPolicy), context });
  console.log(JSON.stringify(plan, null, 2));
}

/**
 * Runs `resolve`: loads policies, merges input with module defaults, prints JSON settings.
 *
 * @param {{ inputFile: string, configPath: unknown }} params
 * @returns {void}
 */
function resolveCmd({ inputFile, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const moduleDefaults = /** @type {Record<string, unknown>} */ (cfg.defaults ?? {});

  const absInput = resolvePathInsideCwd(inputFile, "--input");
  const rawInput = readJsonUserFile(absInput);
  const mergedInput = mergeResolveInput(rawInput, moduleDefaults);

  console.log(JSON.stringify(computeResolveOutput(cfg, mergedInput), null, 2));
}

/**
 * Validates assistant text against an output-policy contract (sections, line limits, bullets).
 *
 * @param {{ textFile: string | undefined, textInline: string | undefined, contractId: string, configPath: unknown }} params
 * @returns {void}
 */
function validateOutputCmd({ textFile, textInline, contractId, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const outputPath = /** @type {string} */ (cfg.paths.policies.output);
  const outputPolicy = readYaml(resolveModulePath(outputPath));
  const contracts = outputPolicy.contracts;
  if (!contracts || typeof contracts !== "object" || Array.isArray(contracts)) {
    throw new Error("output policy must define contracts as an object.");
  }
  const contractDef = /** @type {Record<string, unknown>} */ (contracts)[contractId];
  if (contractDef === undefined) {
    throw new Error(`Unknown contract id: ${contractId}`);
  }

  let text;
  if (textInline !== undefined) {
    text = textInline;
  } else if (textFile) {
    if (textFile === "-") {
      text = readStdinWithSizeCap(MAX_JSON_BYTES);
    } else {
      const abs = resolvePathInsideCwd(textFile, "--text-file");
      text = readTextWithSizeCap(abs, MAX_JSON_BYTES);
    }
  } else {
    throw new Error('Provide assistant text via --text-file <path> or --text "..."');
  }

  const result = validateOutputContract(text, contractDef, contractId);
  console.log(
    JSON.stringify(
      { ok: result.ok, contract_id: contractId, violations: result.violations },
      null,
      2,
    ),
  );
  if (!result.ok) process.exitCode = 2;
}

/**
 * Validates a JSON tool-args payload against a JSON Schema file (Ajv).
 *
 * @param {{ payloadFile: string, schemaFile: string }} params
 * @returns {void}
 */
function validateToolArgsCmd({ payloadFile, schemaFile }) {
  const absP = resolvePathInsideCwd(payloadFile, "--payload");
  const absS = resolvePathInsideCwd(schemaFile, "--schema");
  const payload = readJsonUserFile(absP);
  try {
    const { ok, errors } = validateToolArgsWithSchemaAtPath(payload, absS, MAX_JSON_BYTES);
    const summarized = summarizeAjvErrors(errors);
    console.log(JSON.stringify({ ok, errors: summarized }, null, 2));
    if (!ok) process.exitCode = 2;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(JSON.stringify({ ok: false, errors: [{ instancePath: "", message: msg }] }, null, 2));
    process.exitCode = 2;
  }
}

/**
 * Dry-run: single JSON with resolve_input, optional compile, optional retry_context — no network.
 *
 * @param {{ inputFile: string, configPath: unknown }} params
 * @returns {void}
 */
function runnerDryRunCmd({ inputFile, configPath }) {
  const abs = resolvePathInsideCwd(inputFile, "--input");
  const raw = readJsonUserFile(abs);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("runner-dry-run input must be a JSON object.");
  }
  const o = /** @type {Record<string, unknown>} */ (raw);

  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const moduleDefaults = /** @type {Record<string, unknown>} */ (cfg.defaults ?? {});

  const resolveRaw = o.resolve_input;
  const mergedInput = mergeResolveInput(
    resolveRaw && typeof resolveRaw === "object" && !Array.isArray(resolveRaw)
      ? /** @type {Record<string, unknown>} */ (resolveRaw)
      : {},
    moduleDefaults,
  );
  const resolve_out = computeResolveOutput(cfg, mergedInput);

  const compileRaw = o.compile;
  /** @type {Record<string, unknown> | null} */
  let compile_out = null;
  if (compileRaw !== undefined && compileRaw !== null) {
    if (typeof compileRaw !== "object" || Array.isArray(compileRaw)) {
      throw new Error('runner-dry-run "compile" must be an object when present.');
    }
    const c = /** @type {Record<string, unknown>} */ (compileRaw);
    const provider = String(c.provider ?? "openai");
    const environment = String(c.environment ?? "terminal");
    const intent = String(c.intent ?? "implement");
    const scenario = String(c.scenario ?? "normal");
    compile_out = buildCompilePromptResult(cfg, provider, environment, intent, scenario);
  }

  /** @type {Record<string, unknown> | null} */
  let retry_plan_out = null;
  if (o.retry_context !== undefined) {
    const retryRel = requireRetryPolicyPath(cfg);
    const retryPolicy = readYaml(resolveModulePath(retryRel));
    retry_plan_out = planRetry({
      retryPolicy: /** @type {Record<string, unknown>} */ (retryPolicy),
      context: parseRetryContext(o.retry_context),
    });
  }

  let rootOk = true;
  if (compile_out !== null && /** @type {{ ok?: boolean }} */ (compile_out).ok === false) {
    rootOk = false;
  }

  console.log(
    JSON.stringify(
      { ok: rootOk, resolve: resolve_out, compile: compile_out, retry_plan: retry_plan_out },
      null,
      2,
    ),
  );
}

/**
 * Routes free text to an intent bundle using `intent-map.yaml` keyword rules.
 *
 * @param {{ text: string | undefined, configPath: unknown }} params
 * @returns {void}
 */
function routeCmd({ text, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const intentPath = /** @type {string} */ (cfg.paths.policies.intent);
  const intentMap = readYaml(resolveModulePath(intentPath));

  const hay = String(text ?? "").toLowerCase();
  const defaults = intentMap.defaults ?? {};

  /**
   * Returns true when any `when.any_keywords` entry is a substring of the routed text.
   *
   * @param {unknown} rule - One intent rule from `intent-map.yaml`
   * @returns {boolean}
   */
  function matchRule(rule) {
    const raw = rule?.when?.any_keywords;
    const kws = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
    return kws.some((k) => hay.includes(String(k).toLowerCase()));
  }

  const hit = (intentMap.rules ?? []).find(matchRule);
  const routed = { ...defaults, ...(hit?.set ?? {}) };
  console.log(JSON.stringify({ ok: true, rule_id: hit?.id ?? null, routed }, null, 2));
}

/**
 * Validates a handoff file against the configured schema path.
 *
 * @param {{ file: string, configPath: unknown }} params
 * @returns {void}
 */
function validateHandoffCmd({ file, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const schemaRel = /** @type {string} */ (cfg.paths.schemas.handoff);
  const schemaPath = resolveModulePath(schemaRel);
  const absFile = resolvePathInsideCwd(file, "--file");
  validateHandoff({ file: absFile, schemaPath });
}

/**
 * Validates a handoff JSON file and writes it to the default artifact path or `--out`.
 *
 * @param {{ file: string, out: unknown, configPath: unknown }} params
 * @returns {void}
 */
function writeHandoffCmd({ file, out, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const schemaPath = resolveModulePath(/** @type {string} */ (cfg.paths.schemas.handoff));
  const artifactRel = /** @type {string} */ (cfg.paths.artifacts.handoff);
  const resolvedDefault = path.resolve(process.cwd(), artifactRel);
  fs.mkdirSync(path.dirname(resolvedDefault), { recursive: true });
  const realCwd = fs.realpathSync(process.cwd());
  const realDir = fs.realpathSync(path.dirname(resolvedDefault));
  const relToCwd = path.relative(realCwd, realDir);
  if (relToCwd.startsWith("..") || path.isAbsolute(relToCwd)) {
    throw new Error("paths.artifacts.handoff would write outside the working directory (check symlinks).");
  }
  const artifactDefault = path.join(realDir, path.basename(resolvedDefault));

  const absIn = resolvePathInsideCwd(file, "--file");
  const packet = readJsonUserFile(absIn);
  const res = validateHandoffPacket({ packet, schemaPath });
  if (!res.ok) {
    console.error(JSON.stringify({ ok: false, errors: summarizeAjvErrors(res.errors) }, null, 2));
    process.exitCode = 2;
    return;
  }

  const absOut = out ? resolvePathInsideCwd(/** @type {string} */ (out), "--out") : artifactDefault;
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(packet, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ok: true, wrote: absOut }, null, 2));
}

/**
 * Reads a validated handoff file (default: `paths.artifacts.handoff`) and prints resolve bridge + optional full packet.
 *
 * @param {{ file: string | undefined, configPath: unknown, omitHandoff: boolean }} params
 * @returns {void}
 */
function readHandoffCmd({ file, configPath, omitHandoff }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const schemaPath = resolveModulePath(/** @type {string} */ (cfg.paths.schemas.handoff));
  const rel = file ?? /** @type {string} */ (cfg.paths.artifacts.handoff);
  const absFile = resolvePathInsideCwd(rel, "--file");
  const packet = readJsonUserFile(absFile);
  const res = validateHandoffPacket({ packet, schemaPath });
  if (!res.ok) {
    console.error(JSON.stringify({ ok: false, errors: summarizeAjvErrors(res.errors) }, null, 2));
    process.exitCode = 2;
    return;
  }
  const moduleDefaults = /** @type {Record<string, unknown>} */ (cfg.defaults ?? {});
  const resolve_input = handoffPacketToResolveInput(packet);
  const merged_resolve_preview = mergeResolveInput(resolve_input, moduleDefaults);
  const continuity = handoffContinuityMeta(packet);
  /** @type {Record<string, unknown>} */
  const out = {
    ok: true,
    file: absFile,
    resolve_input,
    merged_resolve_preview,
    continuity,
  };
  if (!omitHandoff) {
    out.handoff = packet;
  }
  console.log(JSON.stringify(out, null, 2));
}

/**
 * Appends one JSONL trace line (validated against `schemas/trace-line.schema.json`).
 *
 * @param {{ payloadFile: string, configPath: unknown }} params
 * @returns {void}
 */
function traceAppendCmd({ payloadFile, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const traceRel = requireTraceArtifactPath(cfg);
  const absTrace = resolvePathInsideCwd(traceRel, "--trace");
  const absPayload = resolvePathInsideCwd(payloadFile, "--payload");
  const record = readJsonUserFile(absPayload);
  try {
    appendTraceLine(absTrace, record, { maxLineBytes: MAX_TRACE_LINE_BYTES });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({ ok: true, wrote: absTrace }, null, 2));
}

/**
 * Returns the last N parsed JSON objects from the trace file (read window capped).
 *
 * @param {{ lines: unknown, configPath: unknown }} params
 * @returns {void}
 */
function traceTailCmd({ lines, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const traceRel = requireTraceArtifactPath(cfg);
  const absTrace = resolvePathInsideCwd(traceRel, "--trace");
  let n = 20;
  if (lines !== undefined && lines !== false) {
    if (lines === true) {
      throw new Error('--lines requires a number (e.g. --lines 50).');
    }
    const raw = typeof lines === "number" ? lines : String(lines).trim();
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new Error("--lines must be a positive integer (no decimals or trailing text).");
    }
    n = parsed;
  }
  if (n < 1 || n > 10000) {
    throw new Error("--lines must be between 1 and 10000.");
  }
  const tailLines = readTraceTailLines(absTrace, n, MAX_TRACE_TAIL_READ_BYTES);
  console.log(JSON.stringify({ ok: true, file: absTrace, lines: tailLines }, null, 2));
}

/**
 * Appends one validated outcome line (`event: "outcome"`) to the trace file.
 *
 * @param {{ payloadFile: string, configPath: unknown }} params
 * @returns {void}
 */
function outcomeAppendCmd({ payloadFile, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const traceRel = requireTraceArtifactPath(cfg);
  const absTrace = resolvePathInsideCwd(traceRel, "--trace");
  const absPayload = resolvePathInsideCwd(payloadFile, "--payload");
  const record = readJsonUserFile(absPayload);
  try {
    appendOutcomeLine(absTrace, record, { maxLineBytes: MAX_TRACE_LINE_BYTES });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({ ok: true, wrote: absTrace }, null, 2));
}

/**
 * Aggregates outcome events from a bounded tail read of the trace file; optional Markdown/YAML proposal artifacts.
 *
 * @param {{
 *   configPath: unknown,
 *   format: string,
 *   writeProposal: boolean,
 *   maxBytes: number,
 * }} params
 * @returns {void}
 */
function outcomesReportCmd({ configPath, format, writeProposal, maxBytes }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const traceRel = requireTraceArtifactPath(cfg);
  const absTrace = resolvePathInsideCwd(traceRel, "--trace");
  const traceFileExists = fs.existsSync(absTrace);
  const records = readTraceLinesInWindow(absTrace, maxBytes);
  const summary = summarizeOutcomeRecords(records);
  const iso = new Date().toISOString();
  const safeTs = iso.replace(/:/g, "-");

  /** @returns {Record<string, unknown>} */
  function reportBase() {
    return {
      ok: true,
      file: absTrace,
      trace_file_exists: traceFileExists,
      read_bytes_cap: maxBytes,
      ...(traceFileExists
        ? {}
        : {
            note: "Trace file does not exist yet; aggregates are zero (no lines read).",
          }),
    };
  }

  if (format === "proposal") {
    const md = formatOutcomeProposalMarkdown(summary);
    if (writeProposal) {
      const relMd = path.join(".superskill", "proposals", `proposal-${safeTs}.md`);
      const absMd = resolvePathInsideCwd(relMd, "--out");
      fs.mkdirSync(path.dirname(absMd), { recursive: true });
      fs.writeFileSync(absMd, md, "utf8");
      const yml = formatOutcomeProposalYaml(summary, iso);
      const relY = path.join(".superskill", "proposals", `proposal-${safeTs}.yaml`);
      const absY = resolvePathInsideCwd(relY, "--out");
      fs.mkdirSync(path.dirname(absY), { recursive: true });
      fs.writeFileSync(absY, yml, "utf8");
      console.log(JSON.stringify({ ...reportBase(), wrote: [absMd, absY] }, null, 2));
      return;
    }
    console.log(md);
    return;
  }

  if (writeProposal) {
    const yml = formatOutcomeProposalYaml(summary, iso);
    const relY = path.join(".superskill", "proposals", `proposal-${safeTs}.yaml`);
    const absY = resolvePathInsideCwd(relY, "--out");
    fs.mkdirSync(path.dirname(absY), { recursive: true });
    fs.writeFileSync(absY, yml, "utf8");
    console.log(JSON.stringify({ ...reportBase(), wrote: absY, summary }, null, 2));
    return;
  }

  console.log(JSON.stringify({ ...reportBase(), ...summary }, null, 2));
}

/**
 * Validates a proposal YAML file (Phase 5) against `schemas/proposal-file.schema.json`. Read-only.
 *
 * @param {{ file: string }} params
 * @returns {void}
 */
function validateProposalCmd({ file }) {
  const abs = resolvePathInsideCwd(file, "--file");
  const text = readTextWithSizeCap(abs, MAX_JSON_BYTES);
  /** @type {unknown} */
  let doc;
  try {
    doc = YAML.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(JSON.stringify({ ok: false, file: abs, error: `YAML parse failed: ${msg}` }, null, 2));
    process.exitCode = 2;
    return;
  }
  if (doc === null || doc === undefined) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          file: abs,
          error: "YAML document is empty or null; expected an object matching schemas/proposal-file.schema.json.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          file: abs,
          error: "Proposal file must be a YAML mapping (object), not an array or scalar.",
        },
        null,
        2,
      ),
    );
    process.exitCode = 2;
    return;
  }
  const r = validateProposalDocument(doc);
  if (r.ok) {
    console.log(JSON.stringify({ ok: true, file: abs }, null, 2));
    return;
  }
  console.error(JSON.stringify({ ok: false, file: abs, errors: summarizeAjvErrors(r.errors) }, null, 2));
  process.exitCode = 2;
}

/**
 * Replaces `{{ var }}` placeholders in a template string.
 *
 * @param {string} s - Template
 * @param {Record<string, unknown>} vars - Variable map
 * @returns {string}
 */
function renderTemplate(s, vars) {
  return s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  });
}

/**
 * Shared by `compile-prompt` and `runner-dry-run` so prompt blocks stay identical (BUG-2-M5).
 *
 * @param {Record<string, unknown>} cfg - Loaded superskill.yaml
 * @param {string} provider
 * @param {string} environment
 * @param {string} intent
 * @param {string} scenario
 * @returns {{ ok: true, system: string, developer: string } | { ok: false, error: string }}
 */
function buildCompilePromptResult(cfg, provider, environment, intent, scenario) {
  const templates = readYaml(resolveModulePath(/** @type {string} */ (cfg.paths.policies.prompts)));
  const outputPolicy = readYaml(resolveModulePath(/** @type {string} */ (cfg.paths.policies.output)));
  const moduleDefaults = /** @type {Record<string, unknown>} */ (cfg.defaults ?? {});
  const requireHandoff = computeRequireHandoffPacket(outputPolicy, environment);
  const output_contract = selectOutputContract(outputPolicy, scenario, moduleDefaults);
  const tpl = templates.templates?.[provider];
  if (!tpl) {
    return { ok: false, error: `Unknown provider template: ${provider}` };
  }
  const vars = {
    provider,
    environment,
    intent,
    scenario,
    output_contract,
    require_handoff_packet: requireHandoff ? "true" : "false",
  };
  return {
    ok: true,
    system: renderTemplate(tpl.system ?? "", vars).trim(),
    developer: renderTemplate(tpl.developer ?? "", vars).trim(),
  };
}

/**
 * Builds provider system/developer prompt blocks from templates and output policy.
 *
 * @param {{
 *   provider: string,
 *   environment: string,
 *   intent: string,
 *   scenario: string,
 *   configPath: unknown
 * }} params
 * @returns {void}
 */
function compilePromptCmd({ provider, environment, intent, scenario, configPath }) {
  const { cfg } = loadSuperskillConfig(findConfigPath(configPath));
  const r = buildCompilePromptResult(cfg, provider, environment, intent, scenario);
  if (!r.ok) {
    console.error(JSON.stringify({ ok: false, error: r.error }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({ ok: true, system: r.system, developer: r.developer }, null, 2));
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];

function main() {
  if (!cmd) {
    usage();
    process.exit(1);
  }

  if (cmd === "validate-handoff") {
    const file = requireStringFlag(args.file, "--file", "Example: --file ./handoff.json");
    validateHandoffCmd({ file, configPath: args.config });
  } else if (cmd === "write-handoff") {
    const file = requireStringFlag(args.file, "--file", "Example: --file ./handoff.json");
    const outRaw = args.out;
    const out = outRaw === undefined || outRaw === false ? undefined : requireStringFlag(outRaw, "--out", "Example: --out ./.superskill/handoff.json");
    writeHandoffCmd({ file, out, configPath: args.config });
  } else if (cmd === "read-handoff") {
    const fileRaw = args.file;
    const fileHandoff =
      fileRaw === undefined || fileRaw === false
        ? undefined
        : requireStringFlag(fileRaw, "--file", "Example: --file ./.superskill/handoff.json");
    readHandoffCmd({
      file: fileHandoff,
      configPath: args.config,
      omitHandoff: args["omit-handoff"] === true,
    });
  } else if (cmd === "resolve") {
    const inputFile = requireStringFlag(args.input, "--input", "Example: --input ./resolve-input.json");
    resolveCmd({ inputFile, configPath: args.config });
  } else if (cmd === "route") {
    const text = requireStringFlag(args.text, "--text", 'Example: --text "fix the failing test"');
    routeCmd({ text, configPath: args.config });
  } else if (cmd === "compile-prompt") {
    const provider = requireStringFlag(args.provider, "--provider", "Example: --provider openai");
    const environment = requireStringFlag(args.environment, "--environment", "Example: --environment terminal");
    const intent = requireStringFlag(args.intent, "--intent", "Example: --intent implement");
    const scenario = requireStringFlag(args.scenario, "--scenario", "Example: --scenario normal");
    compilePromptCmd({
      provider,
      environment,
      intent,
      scenario,
      configPath: args.config,
    });
  } else if (cmd === "retry-plan") {
    const inputFile = requireStringFlag(args.input, "--input", "Example: --input ./retry-context.json");
    retryPlanCmd({ inputFile, configPath: args.config });
  } else if (cmd === "validate-output") {
    const contractId = requireStringFlag(args.contract, "--contract", "Example: --contract concise_engineering");
    const tf = args["text-file"];
    const textRaw = args.text;
    /** @type {string | undefined} */
    let textInline;
    if (textRaw === undefined || textRaw === false) {
      textInline = undefined;
    } else if (textRaw === true) {
      throw new Error('--text requires a string after the flag (e.g. --text "## What changed\\n- item").');
    } else if (typeof textRaw === "string") {
      textInline = textRaw;
    } else {
      throw new Error(`--text must be a string (got ${typeof textRaw}).`);
    }
    const textFileStr =
      tf === undefined || tf === false ? undefined : requireStringFlag(tf, "--text-file", "Example: --text-file ./assistant.md");
    if (textInline !== undefined && textFileStr) {
      throw new Error("Use only one of --text or --text-file.");
    }
    validateOutputCmd({
      textFile: textFileStr,
      textInline,
      contractId,
      configPath: args.config,
    });
  } else if (cmd === "validate-tool-args") {
    const payloadFile = requireStringFlag(args.payload, "--payload", "Example: --payload ./tool-args.json");
    const schemaFile = requireStringFlag(args.schema, "--schema", "Example: --schema ./schemas/tool-args.example.schema.json");
    validateToolArgsCmd({ payloadFile, schemaFile });
  } else if (cmd === "runner-dry-run") {
    const inputFile = requireStringFlag(args.input, "--input", "Example: --input ./runner-dry-run.example.json");
    runnerDryRunCmd({ inputFile, configPath: args.config });
  } else if (cmd === "trace-append") {
    const payloadFile = requireStringFlag(args.payload, "--payload", "Example: --payload ./trace-line.example.json");
    traceAppendCmd({ payloadFile, configPath: args.config });
  } else if (cmd === "trace-tail") {
    traceTailCmd({ lines: args.lines, configPath: args.config });
  } else if (cmd === "outcome-append") {
    const payloadFile = requireStringFlag(args.payload, "--payload", "Example: --payload ./outcome-line.example.json");
    outcomeAppendCmd({ payloadFile, configPath: args.config });
  } else if (cmd === "outcomes-report") {
    const fmtRaw = args.format;
    const format =
      fmtRaw === undefined || fmtRaw === false ? "json" : String(fmtRaw).trim().toLowerCase();
    if (format !== "json" && format !== "proposal") {
      throw new Error('--format must be "json" or "proposal".');
    }
    const mbRaw = args["max-bytes"];
    let maxBytes = DEFAULT_OUTCOMES_REPORT_BYTES;
    if (mbRaw !== undefined && mbRaw !== false) {
      if (mbRaw === true) {
        throw new Error("--max-bytes requires a number (bytes).");
      }
      const n = Number(String(mbRaw).trim());
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1024) {
        throw new Error("--max-bytes must be an integer >= 1024.");
      }
      maxBytes = Math.min(n, MAX_OUTCOMES_REPORT_BYTES_CAP);
    }
    outcomesReportCmd({
      configPath: args.config,
      format,
      writeProposal: args["write-proposal"] === true,
      maxBytes,
    });
  } else if (cmd === "validate-proposal") {
    const file = requireStringFlag(args.file, "--file", "Example: --file ./.superskill/proposals/proposal.yaml");
    validateProposalCmd({ file });
  } else {
    usage();
    process.exit(1);
  }
}

try {
  main();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(msg);
  process.exitCode = 1;
}
