/**
 * CLI sizing limits (Phase 5: shared constants for trace / outcomes commands).
 */

/** Max UTF-8 bytes for one trace JSONL line (append). */
export const MAX_TRACE_LINE_BYTES = 256 * 1024;

/** Max bytes read from trace file for `trace-tail` (tail window). */
export const MAX_TRACE_TAIL_READ_BYTES = 8 * 1024 * 1024;

/** Default max bytes for `outcomes-report` aggregation window (tail of trace file). */
export const DEFAULT_OUTCOMES_REPORT_BYTES = 32 * 1024 * 1024;

/** Hard cap for --max-bytes on outcomes-report. */
export const MAX_OUTCOMES_REPORT_BYTES_CAP = 64 * 1024 * 1024;
