/**
 * Append-only JSONL trace under `.superskill/trace.jsonl` (or configured path).
 * ═══════════════════════════════════════════════════
 * Fixed by: Fixer Agent | Cycle: 8 (Bug Finder Cycle 8 — readSync loop, maxReadBytes, skipTraceValidation)
 * Bugs fixed: 4 (0 critical, 3 major, 0 minor) — M2, M3, PERF-8-1 + structural cleanup
 * Performance improvements: 1 (single Ajv pass on outcome-append when skipTraceValidation)
 * Proactive improvements: 1 (assertPositiveIntMaxReadBytes helper)
 * Code health: Excellent → Excellent
 * Safe to build on: YES
 * ═══════════════════════════════════════════════════
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("ajv").ValidateFunction | null} */
let traceLineValidate = null;

/**
 * @param {import("ajv").ErrorObject[] | null | undefined} errors
 * @returns {Array<{ instancePath?: string, keyword?: string, message?: string }>}
 */
function summarizeTraceAjvErrors(errors) {
  if (!errors?.length) return [];
  return errors.map((e) => ({
    instancePath: e.instancePath,
    keyword: e.keyword,
    message: e.message,
  }));
}

function getTraceLineValidator() {
  if (!traceLineValidate) {
    const schemaPath = path.join(__dirname, "..", "schemas", "trace-line.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    traceLineValidate = ajv.compile(schema);
  }
  return traceLineValidate;
}

/**
 * @param {string} paramName - e.g. `readTraceLinesInWindow: maxReadBytes`
 * @param {number} n
 */
function assertPositiveIntMaxReadBytes(paramName, n) {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    throw new Error(`${paramName} must be a positive finite integer.`);
  }
}

/**
 * Reads exactly `length` bytes into `buffer` starting at file offset `filePositionStart`.
 * Node's `fs.readSync` may return short reads; looping avoids silent buffer garbage.
 *
 * @param {number} fd
 * @param {Buffer} buffer
 * @param {number} bufferOffset - offset within buffer to start writing
 * @param {number} length - bytes to read
 * @param {number} filePositionStart - offset in file
 */
function readSyncFull(fd, buffer, bufferOffset, length, filePositionStart) {
  let total = 0;
  while (total < length) {
    const n = fs.readSync(fd, buffer, bufferOffset + total, length - total, filePositionStart + total);
    if (n === 0) {
      throw new Error(
        `trace read: expected ${length} bytes at file offset ${filePositionStart}, got EOF after ${total} bytes`,
      );
    }
    total += n;
  }
}

/**
 * Validates and appends one JSON object as a line to the trace file.
 * Concurrent processes appending the same file may interleave bytes; use a single writer or external queue.
 *
 * @param {string} traceAbsPath - Absolute path to trace.jsonl
 * @param {unknown} record - One trace event object
 * @param {{ maxLineBytes?: number, skipTraceValidation?: boolean }} [options] - `skipTraceValidation` is for callers that already validated (e.g. `appendOutcomeLine`); do not set from untrusted input.
 * @returns {void}
 * @throws {Error} When validation fails or line exceeds maxLineBytes
 */
export function appendTraceLine(traceAbsPath, record, options) {
  const maxLineBytes = options?.maxLineBytes ?? 256 * 1024;
  if (!options?.skipTraceValidation) {
    const validate = getTraceLineValidator();
    const ok = validate(record);
    if (!ok) {
      const summarized = summarizeTraceAjvErrors(validate.errors);
      throw new Error(`trace line invalid: ${JSON.stringify(summarized)}`);
    }
  }
  const line = JSON.stringify(record) + "\n";
  if (Buffer.byteLength(line, "utf8") > maxLineBytes) {
    throw new Error(`trace line exceeds maximum size (${maxLineBytes} bytes)`);
  }
  fs.mkdirSync(path.dirname(traceAbsPath), { recursive: true });
  fs.appendFileSync(traceAbsPath, line, "utf8");
}

/**
 * Reads the last N complete non-empty lines from a JSONL file (bounded read from end of file).
 * When the read window starts mid-file, the leading fragment before the first newline is dropped so lines align with real records.
 * Invalid JSON lines yield `{ _parse_error: true, line: "..." }` (not omitted).
 *
 * @param {string} traceAbsPath
 * @param {number} lineCount - Must be a positive integer (throws otherwise).
 * @param {number} maxReadBytes - Cap on file read size (tail window); very long single-line records may still truncate results.
 * @returns {unknown[]}
 */
export function readTraceTailLines(traceAbsPath, lineCount, maxReadBytes) {
  if (!Number.isFinite(lineCount) || !Number.isInteger(lineCount) || lineCount < 1) {
    throw new Error("readTraceTailLines: lineCount must be a positive integer.");
  }
  assertPositiveIntMaxReadBytes("readTraceTailLines: maxReadBytes", maxReadBytes);
  if (!fs.existsSync(traceAbsPath)) {
    return [];
  }
  const st = fs.statSync(traceAbsPath);
  const readSize = Math.min(st.size, maxReadBytes);
  const start = Math.max(0, st.size - readSize);
  const len = Math.min(readSize, st.size - start);
  const fd = fs.openSync(traceAbsPath, "r");
  try {
    const buf = Buffer.alloc(len);
    if (len > 0) {
      readSyncFull(fd, buf, 0, len, start);
    }
    let text = buf.toString("utf8");
    if (start > 0) {
      const firstNl = text.indexOf("\n");
      if (firstNl === -1) {
        return [];
      }
      text = text.slice(firstNl + 1);
    }
    const allLines = text.split(/\r?\n/).filter((l) => l.length > 0);
    const slice = allLines.slice(-lineCount);
    /** @type {unknown[]} */
    const out = [];
    for (const line of slice) {
      try {
        out.push(JSON.parse(line));
      } catch {
        out.push({ _parse_error: true, line: line.slice(0, 200) });
      }
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Reads all complete lines in the last `maxReadBytes` of the file (same boundary fix as `readTraceTailLines`).
 * Use for aggregation over a bounded window when the full file may be large.
 *
 * @param {string} traceAbsPath
 * @param {number} maxReadBytes - Must be a positive integer (throws otherwise).
 * @returns {unknown[]}
 */
export function readTraceLinesInWindow(traceAbsPath, maxReadBytes) {
  assertPositiveIntMaxReadBytes("readTraceLinesInWindow: maxReadBytes", maxReadBytes);
  if (!fs.existsSync(traceAbsPath)) {
    return [];
  }
  const st = fs.statSync(traceAbsPath);
  const readSize = Math.min(st.size, maxReadBytes);
  const start = Math.max(0, st.size - readSize);
  const len = Math.min(readSize, st.size - start);
  const fd = fs.openSync(traceAbsPath, "r");
  try {
    const buf = Buffer.alloc(len);
    if (len > 0) {
      readSyncFull(fd, buf, 0, len, start);
    }
    let text = buf.toString("utf8");
    if (start > 0) {
      const firstNl = text.indexOf("\n");
      if (firstNl === -1) {
        return [];
      }
      text = text.slice(firstNl + 1);
    }
    const allLines = text.split(/\r?\n/).filter((l) => l.length > 0);
    /** @type {unknown[]} */
    const out = [];
    for (const line of allLines) {
      try {
        out.push(JSON.parse(line));
      } catch {
        out.push({ _parse_error: true, line: line.slice(0, 200) });
      }
    }
    return out;
  } finally {
    fs.closeSync(fd);
  }
}
