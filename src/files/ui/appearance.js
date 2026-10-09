import { state } from '../state.js';
import { el } from './elements.js';

export function applyTheme() {
  el.body.setAttribute('data-theme', state.doc.settings.theme);
}

export function applyReducedMotion() {
  el.body.setAttribute('data-reduced-motion', String(state.doc.settings.reducedMotion));
}

export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}
