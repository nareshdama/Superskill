/**
 * Pure retry planning from `retry-policy.yaml` (no filesystem I/O).
 * Imported by CLI and available for programmatic runners.
 */

/**
 * @param {unknown} raw
 * @returns {{
 *   attempt: number,
 *   success: boolean,
 *   triggers: string[],
 *   output_mode: string,
 *   omit_temperature: boolean,
 *   tool_args_retry: boolean
 * }}
 */
export function parseRetryContext(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error('retry context JSON must be a non-null object (e.g. {"attempt":1,"success":false,"triggers":[]}).');
  }
  const o = /** @type {Record<string, unknown>} */ (raw);

  const att = o.attempt;
  if (typeof att !== "number" || !Number.isFinite(att) || att < 1 || !Number.isInteger(att)) {
    throw new Error(`retry context "attempt" must be a positive integer (got ${String(att)}).`);
  }

  if (typeof o.success !== "boolean") {
    throw new Error('retry context "success" must be a boolean.');
  }

  const tr = o.triggers;
  if (!Array.isArray(tr)) {
    throw new Error('retry context "triggers" must be an array (retry trigger ids as strings).');
  }
  const triggers = tr.map((x, i) => {
    if (typeof x !== "string") {
      throw new Error(`retry context triggers[${i}] must be a string (got ${typeof x}).`);
    }
    const s = x.trim();
    if (!s.length) {
      throw new Error(`retry context triggers[${i}] must be non-empty after trim.`);
    }
    return s;
  });

  const om = o.output_mode;
  const output_mode = typeof om === "string" && om.trim().length > 0 ? om.trim() : "structured_text";

  return {
    attempt: att,
    success: o.success,
    triggers,
    output_mode,
    omit_temperature: o.omit_temperature === true,
    tool_args_retry: o.tool_args_retry === true,
  };
}

/**
 * @param {Record<string, unknown>} retryPolicy
 * @param {string} outputMode
 * @returns {number}
 */
export function getMaxAttemptsForOutputMode(retryPolicy, outputMode) {
  const ma = retryPolicy.max_attempts;
  if (!ma || typeof ma !== "object" || Array.isArray(ma)) {
    throw new Error("retry policy must define max_attempts as an object.");
  }
  const m = /** @type {Record<string, unknown>} */ (ma);
  const def = m.default;
  const byOm = m.by_output_mode;
  const by =
    byOm && typeof byOm === "object" && !Array.isArray(byOm)
      ? /** @type {Record<string, unknown>} */ (byOm)[outputMode]
      : undefined;
  const pick = typeof by === "number" && Number.isFinite(by) && by >= 1 ? by : def;
  if (typeof pick !== "number" || !Number.isFinite(pick) || pick < 1) {
    throw new Error("retry policy max_attempts.default must be a positive finite number.");
  }
  return Math.min(1000, Math.floor(pick));
}

/**
 * @param {unknown} action
 * @param {string[]} triggers
 * @returns {boolean}
 */
export function retryActionMatchesTriggers(action, triggers) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return false;
  const a = /** @type {Record<string, unknown>} */ (action);
  const when = a.when;
  if (when === undefined || when === null) return true;
  if (typeof when !== "object" || Array.isArray(when)) return false;
  const w = /** @type {Record<string, unknown>} */ (when);
  const any = w.any_trigger;
  if (!Array.isArray(any) || any.length === 0) return false;
  const set = new Set(triggers.map(String));
  return any.some((t) => typeof t === "string" && set.has(t.trim()));
}

/**
 * @param {Record<string, unknown>} retryPolicy
 * @param {string[]} triggers
 */
export function collectDefaultRetryActions(retryPolicy, triggers) {
  const ra = retryPolicy.retry_actions;
  if (!ra || typeof ra !== "object") return { actions: [], warnings: [] };
  const def = /** @type {Record<string, unknown>} */ (ra).default;
  if (!Array.isArray(def)) return { actions: [], warnings: [] };

  const out = [];
  /** @type {Array<{ kind: string, index: number, detail?: string }>} */
  const warnings = [];

  def.forEach((action, index) => {
    if (action === null || action === undefined) {
      warnings.push({ kind: "skipped_null", index });
      return;
    }
    if (typeof action !== "object" || Array.isArray(action)) {
      warnings.push({
        kind: "skipped_non_object",
        index,
        detail: Array.isArray(action) ? "array" : typeof action,
      });
      return;
    }
    if (!retryActionMatchesTriggers(action, triggers)) return;
    out.push({ .../** @type {object} */ (action) });
  });

  return { actions: out, warnings };
}

/**
 * @param {Record<string, unknown>} retryPolicy
 * @returns {unknown[]}
 */
export function collectToolArgsHardening(retryPolicy) {
  const ta = retryPolicy.tool_args_hardening;
  if (!ta || typeof ta !== "object") return [];
  const on = /** @type {Record<string, unknown>} */ (ta).on_retry;
  if (!Array.isArray(on)) return [];
  return on.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? { .../** @type {object} */ (x) } : x));
}

/**
 * @param {{ retryPolicy: Record<string, unknown>, context: ReturnType<typeof parseRetryContext> }} params
 * @returns {Record<string, unknown>}
 */
export function planRetry({ retryPolicy, context }) {
  const maxAttempts = getMaxAttemptsForOutputMode(retryPolicy, context.output_mode);
  const { attempt, success, triggers, tool_args_retry, omit_temperature } = context;

  const should_retry = success === false && attempt < maxAttempts;

  const collected = should_retry ? collectDefaultRetryActions(retryPolicy, triggers) : { actions: [], warnings: [] };
  const default_actions = collected.actions;
  const retry_action_warnings = collected.warnings;

  let tool_actions = [];
  if (should_retry && tool_args_retry) {
    tool_actions = collectToolArgsHardening(retryPolicy);
  }

  const notes = Array.isArray(retryPolicy.notes)
    ? retryPolicy.notes.map((n) => (typeof n === "string" ? n : JSON.stringify(n)))
    : [];

  const temperature_actions = default_actions.filter(
    (a) => a && typeof a === "object" && /** @type {{ action?: string }} */ (a).action === "lower_temperature",
  );
  const skip_temperature_hints = omit_temperature === true;

  const reason = success ? "success" : attempt >= maxAttempts ? "exhausted_attempts" : "eligible";

  return {
    ok: true,
    should_retry,
    reason,
    attempt,
    max_attempts: maxAttempts,
    remaining_attempts: Math.max(0, maxAttempts - attempt),
    output_mode: context.output_mode,
    triggers,
    default_actions,
    retry_action_warnings,
    tool_args_hardening_actions: tool_actions,
    omit_temperature: omit_temperature,
    temperature_actions_skipped: skip_temperature_hints && temperature_actions.length > 0,
    policy_notes: notes,
  };
}

/**
 * Programmatic entry: same semantics as CLI `retry-plan` (parsed policy + parsed context).
 * Argument order matches Phase 2 plan: context first, then policy.
 *
 * @param {unknown} retryContextRaw - JSON-parsed retry context object
 * @param {Record<string, unknown>} retryPolicy - Parsed retry-policy YAML
 * @returns {Record<string, unknown>}
 */
export function runRetryPlan(retryContextRaw, retryPolicy) {
  const context = parseRetryContext(retryContextRaw);
  return planRetry({ retryPolicy: /** @type {Record<string, unknown>} */ (retryPolicy), context });
}
