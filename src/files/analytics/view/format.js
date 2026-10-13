/* Small string helpers. Digits stay plain (no locale numeral conversion). */

/** "18/09" from "YYYY-MM-DD". */
export function dayLabel(dayKey) {
  const [, m, d] = dayKey.split('-');
  return `${d}/${m}`;
}

/** "09/2026" from "YYYY-MM". */
export function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  return `${m}/${y}`;
}

/** Replaces {name} placeholders. */
export function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ''));
}
