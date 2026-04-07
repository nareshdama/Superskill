import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { appendTraceLine, readTraceLinesInWindow, readTraceTailLines } from "../lib/trace.mjs";

function withTempDir(fn) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "superskill-trace-"));
  try {
    fn(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("lib/trace.mjs", () => {
  it("readTraceLinesInWindow throws on invalid maxReadBytes", () => {
    withTempDir((tmpDir) => {
      const tracePath = path.join(tmpDir, "t.jsonl");
      assert.throws(() => readTraceLinesInWindow(tracePath, 0), /maxReadBytes/);
      assert.throws(() => readTraceLinesInWindow(tracePath, -1), /maxReadBytes/);
    });
  });

  it("append and read back lines in window", () => {
    withTempDir((tmpDir) => {
      const tracePath = path.join(tmpDir, "t.jsonl");
      const line = { trace_version: 1, ts: "2026-01-01T00:00:00.000Z", event: "unit", payload: {} };
      appendTraceLine(tracePath, line);
      appendTraceLine(tracePath, { ...line, event: "unit2" });
      const win = readTraceLinesInWindow(tracePath, 65536);
      assert.equal(win.length, 2);
      assert.equal(/** @type {{ event: string }} */ (win[1]).event, "unit2");
      const tail = readTraceTailLines(tracePath, 1, 65536);
      assert.equal(tail.length, 1);
      assert.equal(/** @type {{ event: string }} */ (tail[0]).event, "unit2");
    });
  });

  it("readTraceLinesInWindow returns empty array when file missing", () => {
    const p = path.join(os.tmpdir(), `missing-${Date.now()}.jsonl`);
    const win = readTraceLinesInWindow(p, 4096);
    assert.deepEqual(win, []);
  });
});
