import { el } from './elements.js';

let toastTimer = null;

export function showToast(text, tone = 'info') {
  if (!el.toast) return;

  el.toastText.textContent = text;
  el.toast.dataset.tone = tone;
  el.toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 4500);
}
