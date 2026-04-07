/**
 * Maps a validated handoff packet to a minimal `resolve` input object and continuity metadata.
 * Unknown handoff fields are not copied into `resolve_input` — the CLI `read-handoff` command also prints
 * `merged_resolve_preview` (via `mergeResolveInput`) so callers see full merged knobs without silent defaults.
 */

/**
 * Builds a partial resolve-input object from a handoff packet (only fields that exist on both models).
 *
 * @param {unknown} packet - Parsed handoff JSON (schema-valid)
 * @returns {Record<string, unknown>}
 */
export function handoffPacketToResolveInput(packet) {
  const p = packet !== null && typeof packet === "object" && !Array.isArray(packet) ? /** @type {Record<string, unknown>} */ (packet) : {};
  /** @type {Record<string, unknown>} */
  const out = {};
  const env = p.environment;
  if (typeof env === "string" && env.trim().length > 0) {
    out.environment = env.trim();
  }
  return out;
}

/**
 * Fields the next run typically needs for `compile-prompt` / routing, not for `resolve` temperature mapping.
 *
 * @param {unknown} packet - Parsed handoff JSON
 * @returns {{ task_id: string | null, intent: string | null }}
 */
export function handoffContinuityMeta(packet) {
  const p = packet !== null && typeof packet === "object" && !Array.isArray(packet) ? /** @type {Record<string, unknown>} */ (packet) : {};
  const task_id = typeof p.task_id === "string" && p.task_id.trim().length > 0 ? p.task_id.trim() : null;
  const intent = typeof p.intent === "string" && p.intent.trim().length > 0 ? p.intent.trim() : null;
  return { task_id, intent };
}
