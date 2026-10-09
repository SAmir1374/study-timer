/* Today's totals + daily-goal progress. */

import { state, tr, getTodaySummary } from '../../state.js';
import { TimerEngine, fmtHoursMinutes } from '../../timer.js';
import { el } from '../elements.js';
import { getEffectiveDailyGoalMinutes } from '../planData.js';
import { setText } from './textCache.js';

export function stats() {
  const t = tr();
  const s = state.session;
  const day = getTodaySummary();

  const isLiveStudy = s.record && s.type === 'study' && (s.state === 'running' || s.state === 'paused');
  const live = isLiveStudy ? Math.round(TimerEngine.elapsedMs() / 1000) : 0;
  const totalSeconds = day.studySeconds + live;

  const goalSeconds = getEffectiveDailyGoalMinutes() * 60;
  const remainingGoal = Math.max(0, goalSeconds - totalSeconds);
  const goalPct = goalSeconds > 0 ? Math.round(Math.min(1, totalSeconds / goalSeconds) * 100) : 0;

  setText(el.todayStudyTime, fmtHoursMinutes(totalSeconds));
  setText(el.todaySessions, String(day.sessionCount));
  setText(el.dailyGoalValue, fmtHoursMinutes(goalSeconds));
  setText(el.todayRemainingGoal, remainingGoal === 0 ? t.goalMet : fmtHoursMinutes(remainingGoal));

  el.goalProgressFill.style.width = `${goalPct}%`;
}
