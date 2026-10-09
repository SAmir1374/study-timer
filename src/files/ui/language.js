/* =============================================================
   ui/language.js
   Language changes never modify stored data:
   FA = Jalali + Persian labels + RTL, EN = Gregorian + English + LTR.
   ============================================================= */

import { state, tr, updateSettings } from '../state.js';
import { el } from './elements.js';
import { Render } from './render/index.js';
import { resetTextCache } from './render/textCache.js';
import { populateSettingsForm } from './modals/settings.js';
import { refreshDayModal } from './dayModal/index.js';

export function renderTranslations() {
  const t = tr();

  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const text = t[node.dataset.i18n];
    if (text) node.textContent = text;
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const text = t[node.dataset.i18nPlaceholder];
    if (text) node.placeholder = text;
  });

  resetTextCache();
}

export function applyLanguageAttributes() {
  const lang = state.doc.settings.language;

  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.body.dataset.lang = lang;

  el.langFaBtn.classList.toggle('is-active', lang === 'fa');
  el.langEnBtn.classList.toggle('is-active', lang === 'en');
}

export function setLanguage(lang) {
  if (lang !== 'fa' && lang !== 'en') return;

  updateSettings({ language: lang });
  applyLanguageAttributes();
  renderTranslations();
  populateSettingsForm();
  Render.all();
  refreshDayModal();
}
