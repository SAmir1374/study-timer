/* Clock, status text and the main timer ring. */

import { state, tr } from '../../state.js';
import { TimerEngine, fmtHMS, fmtMS, fmtClock } from '../../timer.js';
import { el } from '../elements.js';
import { dateLocale, kindLabelOf, SPECIAL_KINDS } from '../utils.js';
import { setText } from './textCache.js';

export function clock() {
  const now = Date.now();
  const locale = dateLocale();

  setText(el.liveClock, fmtClock(now));
  setText(
    el.liveDate,
    new Date(now).toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric' })
  );
  setText(
    el.todayDate,
    new Date(now).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
  );
}

export function statusText() {
  const s = state.session;
  const t = tr();

  if (s.state === 'running' || s.state === 'paused') {
    if (s.state === 'paused') return t.paused;
    return { break: t.onBreak, analysis: t.analyzing, review: t.reviewing }[s.type] ?? t.focusing;
  }

  if (s.state === 'complete') {
    return (
      { break: t.breakComplete, analysis: t.analysisComplete, review: t.reviewComplete }[s.type] ??
      t.sessionComplete
    );
  }

  return t.readyToFocus;
}

const MODE_KEYS = { break: 'break', analysis: 'analysisSessionLabel', review: 'reviewSessionLabel' };
const PROGRESS_KEYS = {
  break: 'break',
  analysis: 'kindAnalysis',
  review: 'kindReview',
  test: 'kindTest',
  practice: 'kindPractice',
};

export function timer() {
  const s = state.session;
  const t = tr();

  const remaining = TimerEngine.remainingMs();
  const elapsed = TimerEngine.elapsedMs();
  const fraction = s.durationMs > 0 ? Math.min(1, elapsed / s.durationMs) : 0;
  const pct = Math.round(fraction * 100);

  el.body.setAttribute('data-state', s.state);
  el.body.setAttribute('data-type', s.type);

  setText(el.modeLabel, t[MODE_KEYS[s.type] || 'focusSession']);
  setText(el.statusLabel, statusText());
  setText(el.timeDisplay, fmtHMS(remaining));
  setText(el.timeCaption, s.state === 'complete' ? t.done : t.timeRemaining);
  setText(el.elapsedValue, fmtMS(elapsed));
  setText(el.remainingValue, fmtMS(remaining));

  if (el.ringSubject) {
    const parts = [];
    if (s.type !== 'break') {
      if (s.subject) parts.push(s.subject);
      if (SPECIAL_KINDS.includes(s.type)) parts.push(kindLabelOf(s.type, t));
    }
    el.ringSubject.hidden = parts.length === 0;
    setText(el.ringSubject, parts.join(' · '));
  }

  setText(el.progressLabel, t[PROGRESS_KEYS[s.type] || 'studySession']);
  setText(el.progressPercent, `${pct}%`);
  el.sessionProgressFill.style.width = `${pct}%`;

  setText(
    el.primaryBtnLabel,
    s.state === 'running' ? t.pause : s.state === 'paused' ? t.resume : t.start
  );

  el.finishBtn.disabled = s.state === 'idle' || s.state === 'complete';
  el.resetBtn.disabled = s.state === 'complete';
  el.breakBtn.hidden = s.state === 'running' || s.state === 'paused';
  setText(el.breakBtn, s.type === 'break' ? t.backToStudy : t.startBreak);
}
