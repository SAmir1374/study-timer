import { el } from '../elements.js';
import { isDayModalOpen } from '../dayModal/index.js';

export function isAnyModalOpen() {
  return (
    !el.settingsModal.hidden ||
    Boolean(el.analysisModal && !el.analysisModal.hidden) ||
    isDayModalOpen() ||
    Boolean(el.checkinModal && !el.checkinModal.hidden)
  );
}
