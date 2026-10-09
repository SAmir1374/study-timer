/* =============================================================
   ui/utils.js — small pure helpers shared across the UI layer.
   ============================================================= */

import { state } from '../state.js';

export const DAY_MS = 86_400_000;
export const ENGLISH_SUBJECT = 'زبان تخصصی';
export const SPECIAL_KINDS = ['practice', 'test', 'analysis', 'review'];

/* ---------- language ---------- */

export const getLanguage = () => state.doc.settings.language || 'fa';

/** L(faText, enText) → picks the string for `language`. */
export const makeL = (language) => (fa, en) => (language === 'fa' ? fa : en);

export const calendarLocale = (language) => (language === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US');

export const dateLocale = () => calendarLocale(getLanguage());

/* ---------- strings ---------- */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/* ---------- dates (YYYY-MM-DD keys) ---------- */

export function utcMs(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export const toDateKey = (date) => date.toISOString().slice(0, 10);

/** Saturday..Friday range that contains dateKey. */
export function saturdayWeekRange(dateKey) {
  const date = new Date(utcMs(dateKey));
  // JS: Sun=0 … Sat=6  →  Sat=0, Sun=1 … Fri=6
  const daysSinceSaturday = (date.getUTCDay() + 1) % 7;

  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - daysSinceSaturday);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  return { start: toDateKey(start), end: toDateKey(end) };
}

let persianDateFormatter = null;

/** Full Persian-calendar date for a key; falls back to the key itself. */
export function formatPersianDate(dateKey) {
  try {
    persianDateFormatter ??= new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    return persianDateFormatter.format(new Date(utcMs(dateKey)));
  } catch {
    return dateKey;
  }
}

/* ---------- session kinds ---------- */

const TYPE_LABELS = {
  fa: {
    study: 'مطالعه',
    practice: 'تمرین',
    test: 'تست',
    analysis: 'تحلیل',
    review: 'مرور',
    break: 'استراحت',
  },
  en: {
    study: 'Study',
    practice: 'Practice',
    test: 'Test',
    analysis: 'Analysis',
    review: 'Review',
    break: 'Break',
  },
};

/** Session type → fixed FA/EN label (used for plan sessions, independent of tr()). */
export function typeLabel(type, language) {
  return (TYPE_LABELS[language] || TYPE_LABELS.fa)[type] || type;
}

const KIND_LABEL_KEYS = {
  break: 'break',
  practice: 'kindPractice',
  test: 'kindTest',
  analysis: 'kindAnalysis',
  review: 'kindReview',
};

const KIND_SHORT_KEYS = {
  practice: 'practiceShort',
  test: 'testShort',
  analysis: 'analysisShort',
  review: 'reviewShort',
};

/** Long label from translations (falls back to "Study"). */
export const kindLabelOf = (kind, t) => t[KIND_LABEL_KEYS[kind] || 'kindStudy'];

/** Short suffix label, or null for plain study / break. */
export const kindShortLabel = (kind, t) => (KIND_SHORT_KEYS[kind] ? t[KIND_SHORT_KEYS[kind]] : null);
