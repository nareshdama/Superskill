#!/usr/bin/env node
/* ═══════════════════════════════════════════════════
 * Fixed by: Fixer Agent | Cycle: 3
 * Extends smoke: write-handoff + retry-plan (STRUCT-3-2)
 * PERF-3-1: Multiple Node processes remain intentional for isolation.
 * ═══════════════════════════════════════════════════ */
/**
 * Phase 1–5 smoke: runs CLI commands from the package root (no model APIs).
 * Invoke via: npm run smoke
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const cli = path.join(root, "cli", "src", "index.mjs");

const smokeHandoffOut = path.join(root, "cli", "src", ".smoke-handoff-out.json");

/**
 * Runs the Superskill CLI with the given arguments; throws if exit code is non-zero.
 *
 * @param {string[]} args - Arguments after the script name
 * @returns {{ stdout: string, stderr: string }}
 */
function runCli(args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error(r.stdout || "");
    console.error(r.stderr || "");
    throw new Error(`smoke failed: node ${path.relative(root, cli)} ${args.join(" ")} (exit ${r.status})`);
  }
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const steps = [
  ["resolve", "--input", "cli/src/resolve-input.example.json"],
  ["route", "--text", "review this PR"],
  ["validate-handoff", "--file", "cli/src/handoff.example.json"],
  [
    "compile-prompt",
    "--provider",
    "openai",
    "--environment",
    "terminal",
    "--intent",
    "implement",
    "--scenario",
    "normal",
  ],
  ["write-handoff", "--file", "cli/src/handoff.example.json", "--out", "cli/src/.smoke-handoff-out.json"],
  ["read-handoff", "--file", "cli/src/.smoke-handoff-out.json"],
  ["retry-plan", "--input", "cli/src/retry-context.example.json"],
  [
    "validate-output",
    "--contract",
    "concise_engineering",
    "--text-file",
    "cli/src/sample-output.contract.md",
  ],
  [
    "validate-tool-args",
    "--payload",
    "cli/src/tool-args.example.json",
    "--schema",
    "schemas/tool-args.example.schema.json",
  ],
  ["runner-dry-run", "--input", "cli/src/runner-dry-run.example.json"],
  ["trace-append", "--payload", "cli/src/trace-line.example.json"],
  ["trace-tail", "--lines", "3"],
  ["outcome-append", "--payload", "cli/src/outcome-line.example.json"],
  ["outcomes-report"],
  ["validate-proposal", "--file", "cli/src/proposal-valid.example.yaml"],
];

for (const args of steps) {
  runCli(args);
}

try {
  fs.unlinkSync(smokeHandoffOut);
} catch {
  /* ignore */
}

console.log(`smoke-phase1: ok (${steps.length} commands)`);
