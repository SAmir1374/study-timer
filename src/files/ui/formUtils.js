/* =============================================================
   ui/formUtils.js — form-reading helpers.
   ============================================================= */

/**
 * Reads an optional numeric input.
 * Empty → { value: null, ok: true }. Invalid → { value: null, ok: false }.
 */
export function readOptionalNumber(input, { min = 0, max = Infinity, integer = false } = {}) {
  const raw = input?.value?.trim();
  if (!raw) return { value: null, ok: true };

  const n = Number(raw);
  const valid = Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n));
  return valid ? { value: n, ok: true } : { value: null, ok: false };
}
