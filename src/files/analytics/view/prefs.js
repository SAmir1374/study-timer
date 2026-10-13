/* =============================================================
   analytics/view/prefs.js — language/theme.

   Stored in localStorage under its own key and never written into
   the study-data file, so this page can't race with the timer's
   save pipeline.
   ============================================================= */

import { el } from './elements.js';
import { I18N } from './i18n.js';

const LOCAL_PREFS_KEY = 'study-timer:analytics-prefs';

function readLocalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* best-effort only */
  }
}

const prefs = { language: 'en', theme: 'dark', ...readLocalPrefs() };

/** Translation dictionary for the current language. */
export const tr = () => I18N[prefs.language] || I18N.en;

/** 'fa' | 'en' */
export const lang = () => (prefs.language === 'fa' ? 'fa' : 'en');

export function setLanguagePref(language) {
  prefs.language = language;
  persist();
}

export function toggleThemePref() {
  prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
  persist();
}

export function applyLanguage() {
  document.documentElement.lang = prefs.language;
  document.documentElement.dir = prefs.language === 'fa' ? 'rtl' : 'ltr';
  document.body.dataset.lang = prefs.language;
  el.langFaBtn.classList.toggle('is-active', prefs.language === 'fa');
  el.langEnBtn.classList.toggle('is-active', prefs.language === 'en');
}

export function applyTheme() {
  document.body.setAttribute('data-theme', prefs.theme);
}

export function renderTranslations() {
  const t = tr();
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const text = t[node.dataset.i18n];
    if (text) node.textContent = text;
  });
}
