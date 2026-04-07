/**
 * Best-effort validation of assistant markdown against `output-policy.yaml` contract definitions.
 * DESIGN NOTE: Heuristic matching on ## / ### headings; false positives/negatives are possible for unusual formatting.
 */

/** @typedef {{ code: string, message: string, section_id?: string }} OutputViolation */

/**
 * Normalizes a heading title for comparison.
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeTitle(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Removes fenced code blocks line-by-line so unclosed fences do not leave misleading content.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripCodeFences(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) out.push(line);
  }
  return out.join("\n");
}

/**
 * Counts ## or ### headings whose title matches (for duplicate detection).
 *
 * @param {string} text
 * @param {string} sectionTitle
 * @returns {number}
 */
function countMatchingHeadings(text, sectionTitle) {
  const lines = text.split(/\r?\n/);
  const target = normalizeTitle(sectionTitle);
  let n = 0;
  for (const line of lines) {
    const m = line.match(/^#{2,3}\s+(.+)$/);
    if (m && normalizeTitle(m[1]) === target) n++;
  }
  return n;
}

/**
 * Returns body lines for a `## Title` or `### Title` section, or null if missing.
 * Section ends at the next line-initial `## ` (level-2) heading.
 *
 * @param {string} text - Markdown (ideally with fences stripped)
 * @param {string} sectionTitle - Expected title after `## ` / `### ` (from policy)
 * @returns {string[] | null}
 */
export function extractSectionBodyLines(text, sectionTitle) {
  const lines = text.split(/\r?\n/);
  const target = normalizeTitle(sectionTitle);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#{2,3}\s+(.+)$/);
    if (m && normalizeTitle(m[1]) === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  const body = [];
  for (let j = start; j < lines.length; j++) {
    if (/^##\s+/.test(lines[j])) break;
    body.push(lines[j]);
  }
  return body;
}

/**
 * True if line looks like a markdown bullet or ordered list item.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isBulletLine(line) {
  return /^\s*([-*+]|\d+\.)\s/.test(line);
}

/**
 * True if line is a nested bullet (indent then bullet).
 *
 * @param {string} line
 * @returns {boolean}
 */
function isNestedBulletLine(line) {
  return /^ {2,}([-*+]|\d+\.)\s/.test(line);
}

/**
 * Validates assistant text against one contract entry from `output-policy.yaml` `contracts`.
 *
 * @param {string} text - Full assistant message (markdown)
 * @param {Record<string, unknown>} contractDef - Value of `contracts[contractId]`
 * @param {string} contractId - For messages only
 * @returns {{ ok: boolean, violations: OutputViolation[] }}
 */
export function validateOutputContract(text, contractDef, contractId) {
  /** @type {OutputViolation[]} */
  const violations = [];

  if (typeof text !== "string") {
    violations.push({ code: "invalid_text", message: "text must be a string." });
    return { ok: false, violations };
  }

  if (!contractDef || typeof contractDef !== "object" || Array.isArray(contractDef)) {
    violations.push({
      code: "invalid_contract",
      message: `contract "${contractId}" is missing or not an object in output policy.`,
    });
    return { ok: false, violations };
  }

  const sections = /** @type {unknown} */ (contractDef).sections;
  if (!Array.isArray(sections)) {
    violations.push({ code: "missing_sections", message: `contract "${contractId}" has no sections array.` });
    return { ok: false, violations };
  }

  const fmt = /** @type {Record<string, unknown>} */ (contractDef).formatting ?? {};
  const bulletsRequired = fmt.bullets === true;
  const noNestedBullets = fmt.no_nested_bullets === true;

  const stripped = stripCodeFences(text);

  sections.forEach((sec, idx) => {
    if (sec === null || sec === undefined) {
      violations.push({
        code: "invalid_section_entry",
        message: `contracts.${contractId}.sections[${idx}] is null or undefined (skipped in older versions; now reported).`,
        section_id: `index_${idx}`,
      });
      return;
    }
    if (typeof sec !== "object" || Array.isArray(sec)) {
      violations.push({
        code: "invalid_section_entry",
        message: `contracts.${contractId}.sections[${idx}] must be an object (got ${Array.isArray(sec) ? "array" : typeof sec}).`,
        section_id: `index_${idx}`,
      });
      return;
    }

    const s = /** @type {Record<string, unknown>} */ (sec);
    const id = typeof s.id === "string" ? s.id : "unknown";
    const title = typeof s.title === "string" ? s.title : "";
    const maxLines = typeof s.max_lines === "number" && Number.isFinite(s.max_lines) && s.max_lines >= 0 ? s.max_lines : null;

    if (!title.trim()) {
      violations.push({ code: "bad_section_def", message: "section missing title in policy", section_id: id });
      return;
    }

    if (countMatchingHeadings(stripped, title) > 1) {
      violations.push({
        code: "duplicate_section_heading",
        message: `Multiple ## or ### headings match "${title}"; keep a single section heading for deterministic checks.`,
        section_id: id,
      });
    }

    const bodyLines = extractSectionBodyLines(stripped, title);
    if (bodyLines === null) {
      violations.push({
        code: "missing_section",
        message: `Missing heading ## or ### ${title}`,
        section_id: id,
      });
      return;
    }

    const contentLines = bodyLines.map((l) => l.trimEnd());
    const nonEmpty = contentLines.filter((l) => l.length > 0);
    if (maxLines !== null && nonEmpty.length > maxLines) {
      violations.push({
        code: "section_too_long",
        message: `Section "${title}" has ${nonEmpty.length} non-empty lines (max ${maxLines}).`,
        section_id: id,
      });
    }

    if (bulletsRequired) {
      for (const line of nonEmpty) {
        if (!isBulletLine(line)) {
          violations.push({
            code: "bullet_required",
            message: `Section "${title}" expects bullet lines; got: ${line.slice(0, 80)}${line.length > 80 ? "…" : ""}`,
            section_id: id,
          });
          break;
        }
      }
    }

    if (noNestedBullets) {
      for (const line of nonEmpty) {
        if (isNestedBulletLine(line)) {
          violations.push({
            code: "nested_bullet",
            message: `Section "${title}" disallows nested bullets.`,
            section_id: id,
          });
          break;
        }
      }
    }
  });

  return { ok: violations.length === 0, violations };
}
