/* =============================================================
   Post-session modal: topic picker (study/practice) and, for
   review sessions, the full test-analysis metrics.
   ============================================================= */

import { tr } from '../../state.js';
import { getTopicsForSubject, getAllTopics } from '../../topicsData.js';
import { el } from '../elements.js';
import { readOptionalNumber } from '../formUtils.js';

let sessionId = null;
let sessionType = 'study';

/** Fills the topic <datalist> with the subject's topics (or all topics). */
function populateTopicOptions(subject) {
  if (!el.analysisTopicOptions) return;

  const topics = subject ? getTopicsForSubject(subject) : getAllTopics();
  el.analysisTopicOptions.replaceChildren();

  topics.forEach((topic) => {
    const option = document.createElement('option');
    option.value = topic;
    el.analysisTopicOptions.appendChild(option);
  });
}

/** Opens the modal pre-filled from rec (topic, and rec.analysis for review). */
export function openAnalysisModal(rec) {
  if (!el.analysisModal || !rec) return;

  const t = tr();
  const analysis = rec.analysis && typeof rec.analysis === 'object' ? rec.analysis : {};

  sessionId = rec.id ?? null;
  sessionType = rec.type || 'study';
  const showMetrics = sessionType === 'review';

  if (el.analysisSubjectLabel) el.analysisSubjectLabel.textContent = rec.subject || t.noSubject;
  if (el.analysisModalTitleEl) {
    el.analysisModalTitleEl.textContent = showMetrics ? t.analysisModalTitle : t.topicModalTitle;
  }
  if (el.analysisModalSubtitleEl) {
    el.analysisModalSubtitleEl.textContent = showMetrics
      ? t.analysisModalSubtitle
      : t.topicModalSubtitle;
  }
  if (el.analysisMetricsSection) el.analysisMetricsSection.hidden = !showMetrics;

  populateTopicOptions(rec.subject);
  if (el.analysisTopic) el.analysisTopic.value = typeof rec.topic === 'string' ? rec.topic : '';
  if (el.analysisTestCount) el.analysisTestCount.value = analysis.testCount ?? '';
  if (el.analysisCorrectPercent) el.analysisCorrectPercent.value = analysis.correctPercent ?? '';
  if (el.analysisErrorCount) el.analysisErrorCount.value = analysis.analyzedErrorCount ?? '';

  el.analysisModal.hidden = false;
  el.analysisModal.setAttribute('aria-hidden', 'false');
}

export function closeAnalysisModal() {
  if (!el.analysisModal) return;

  sessionId = null;
  sessionType = 'study';
  el.analysisModal.hidden = true;
  el.analysisModal.setAttribute('aria-hidden', 'true');
}

export const getAnalysisModalSessionId = () => sessionId;
export const getAnalysisModalSessionType = () => sessionType;

/** Reads topic + metrics. Returns null when any filled value is invalid. */
export function readAnalysisForm() {
  const testCount = readOptionalNumber(el.analysisTestCount, { max: 10000, integer: true });
  const correctPercent = readOptionalNumber(el.analysisCorrectPercent, { max: 100 });
  const analyzedErrorCount = readOptionalNumber(el.analysisErrorCount, { max: 10000, integer: true });

  let topic = null;
  const trimmed = el.analysisTopic?.value.trim();
  if (trimmed) {
    if (trimmed.length > 80) return null;
    topic = trimmed;
  }

  if (!testCount.ok || !correctPercent.ok || !analyzedErrorCount.ok) return null;

  return {
    topic,
    testCount: testCount.value,
    correctPercent: correctPercent.value,
    analyzedErrorCount: analyzedErrorCount.value,
  };
}
