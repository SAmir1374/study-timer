/* All-time stats, per-subject totals and streaks. */

import { buildDailySummaries, isCountedSession } from '../../dataLayer.js';
import { addDays, daysBetween, todayKey } from './dateUtils.js';

export function buildOverallStats(sessions) {
  const stats = {
    totalStudySeconds: 0, // regular study + practice tests
    totalPracticeSeconds: 0, // the practice-test part of totalStudySeconds
    totalBreakSeconds: 0,
    totalPausedSeconds: 0,
    totalPauseCount: 0,
    totalSessions: 0, // counted study sessions (completed/abandoned, long enough)
    practiceSessions: 0, // counted practice-test sessions (subset of totalSessions)
    completedSessions: 0,
    abandonedSessions: 0,
    cancelledSessions: 0,
  };

  for (const rec of sessions) {
    if (rec.derived) {
      stats.totalPausedSeconds += rec.derived.totalPausedSeconds || 0;
      stats.totalPauseCount += rec.derived.pauseCount || 0;
    }

    if (rec.type === 'study') {
      if (isCountedSession(rec)) {
        stats.totalStudySeconds += rec.derived.activeDurationSeconds;
        stats.totalSessions += 1;
        if (rec.isPractice) {
          stats.totalPracticeSeconds += rec.derived.activeDurationSeconds;
          stats.practiceSessions += 1;
        }
      }
      if (rec.status === 'completed') stats.completedSessions += 1;
      else if (rec.status === 'abandoned') stats.abandonedSessions += 1;
      else if (rec.status === 'cancelled') stats.cancelledSessions += 1;
    } else if (rec.type === 'break' && isCountedSession(rec)) {
      stats.totalBreakSeconds += rec.derived.activeDurationSeconds;
    }
  }

  return stats;
}

/**
 * Per-subject totals. Every subject in `subjects` is included (even with 0
 * study time); sorted by study time, untouched subjects keep original order.
 *
 * "Practice test" is a per-SESSION flag (rec.isPractice), so each row carries:
 *   studySeconds / sessionCount            → everything
 *   practiceSeconds / practiceSessionCount → only the practice part
 *
 * Accepts `{name}[]` or a plain string array (older/hand-written files).
 */
export function buildSubjectStats(sessions, subjects = []) {
  const map = new Map();

  const blank = (name) => ({
    subject: name,
    studySeconds: 0,
    sessionCount: 0,
    completedSessions: 0,
    abandonedSessions: 0,
    practiceSeconds: 0,
    practiceSessionCount: 0,
  });

  for (const subject of subjects) {
    const name = typeof subject === 'string' ? subject : subject.name;
    map.set(name, blank(name));
  }

  for (const rec of sessions) {
    if (rec.type !== 'study' || !rec.subject || !isCountedSession(rec)) continue;

    if (!map.has(rec.subject)) map.set(rec.subject, blank(rec.subject));
    const item = map.get(rec.subject);
    const seconds = rec.derived.activeDurationSeconds;

    item.studySeconds += seconds;
    item.sessionCount += 1;
    if (rec.status === 'completed') item.completedSessions += 1;
    if (rec.status === 'abandoned') item.abandonedSessions += 1;
    if (rec.isPractice) {
      item.practiceSeconds += seconds;
      item.practiceSessionCount += 1;
    }
  }

  return [...map.values()].sort((a, b) => b.studySeconds - a.studySeconds);
}

export function averageSessionSeconds(stats) {
  return stats.totalSessions > 0 ? Math.round(stats.totalStudySeconds / stats.totalSessions) : 0;
}

/**
 * % of finished sessions (completed vs abandoned) that reached their planned
 * duration. Cancelled sessions are excluded. Null when nothing is finished.
 */
export function completionRatePercent(stats) {
  const finished = stats.completedSessions + stats.abandonedSessions;
  return finished > 0 ? Math.round((stats.completedSessions / finished) * 100) : null;
}

/** { current, longest } consecutive-day streaks of any study time. */
export function buildStreaks(sessions) {
  const summaries = buildDailySummaries(sessions);
  const activeDays = Object.keys(summaries)
    .filter((k) => summaries[k].studySeconds > 0)
    .sort();

  let longest = 0;
  let run = 0;
  let prevKey = null;
  for (const key of activeDays) {
    run = prevKey && daysBetween(prevKey, key) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevKey = key;
  }

  let current = 0;
  let cursor = todayKey();
  while (summaries[cursor] && summaries[cursor].studySeconds > 0) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, longest };
}
