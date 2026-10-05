/* =============================================================
   planAnalytics.js  (v5)
   Analytics for Schema v5: phased-master-study-plan
   Now computes from day.sessions[] instead of day.focus/englishMinutes
   ============================================================= */

const MASTER_SCHEMA = "study-timer-weekly-plans-json";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}
function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function round1(value) {
  return Math.round(value * 10) / 10;
}
function monthKeyOf(dateKey) {
  if (typeof dateKey !== "string" || dateKey.length < 7) return "";
  return dateKey.slice(0, 7);
}
function sortByDate(a, b) {
  return String(a).localeCompare(String(b));
}

function normalizePrioritySubjects(value) {
  if (Array.isArray(value)) return value.filter((x) => typeof x === "string" && x.trim());
  if (typeof value === "string") {
    return value
      .split(/[،,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

function isMasterPlan(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    value.schemaVersion === MASTER_SCHEMA &&
    Array.isArray(value.phases),
  );
}

/* ------------------------------------------------------------
   Session aggregation
   ------------------------------------------------------------ */

const SESSION_TYPE_KEYS = ["study", "practice", "test", "analysis", "review"];

function aggregateSessions(sessions) {
  const totals = { total: 0, english: 0 };
  SESSION_TYPE_KEYS.forEach((k) => (totals[k] = 0));

  const bySubject = new Map();

  for (const s of sessions) {
    if (!s || typeof s !== "object") continue;
    const m = asNumber(s.minutes);
    totals.total += m;
    if (s.subject === "زبان تخصصی") totals.english += m;
    if (SESSION_TYPE_KEYS.includes(s.type)) totals[s.type] += m;

    if (typeof s.subject === "string" && s.subject.trim()) {
      bySubject.set(s.subject, (bySubject.get(s.subject) || 0) + m);
    }
  }

  const subjects = [...bySubject.entries()]
    .map(([name, minutes]) => ({ name, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  return { ...totals, subjects };
}

function buildDayStats(day, phaseId, weekId) {
  const sessions = asArray(day?.sessions);
  const agg = aggregateSessions(sessions);

  // Representative focus = first session's subject/topic, else empty
  const first = sessions.find((s) => s && s.subject && s.topic);
  const focus = first ? `${first.subject}: ${first.topic}` : "";

  return {
    date: asString(day?.date),
    weekday: asString(day?.weekday),
    dayType: asString(day?.dayType),
    focus,
    englishMinutes: agg.english,
    totalMinutes: agg.total,
    byType: {
      study: agg.study,
      practice: agg.practice,
      test: agg.test,
      analysis: agg.analysis,
      review: agg.review,
    },
    sessionCount: sessions.length,
    subjects: agg.subjects,
    phaseId,
    weekId,
    monthKey: monthKeyOf(day?.date),
  };
}

/* ------------------------------------------------------------
   Week stats
   ------------------------------------------------------------ */

function buildWeekStats(week, phase, phaseIndex, weekIndex) {
  const days = asArray(week?.days);
  const dayStats = days
    .map((day) => buildDayStats(day, phase?.id, week?.id))
    .sort((a, b) => sortByDate(a.date, b.date));

  const targetMinutes = asNumber(week?.targetMinutes);
  const englishMinutes = dayStats.reduce((sum, d) => sum + d.englishMinutes, 0);
  const totalMinutes = dayStats.reduce((sum, d) => sum + d.totalMinutes, 0);
  const prioritySubjects = normalizePrioritySubjects(week?.prioritySubjects);

  return {
    id: asString(week?.id),
    weekNumber: asNumber(week?.weekNumber, weekIndex + 1),
    index: weekIndex,
    displayIndex: weekIndex + 1,
    phaseId: asString(phase?.id),
    phaseIndex,
    phaseDisplayIndex: phaseIndex + 1,
    startDate: asString(week?.startDate),
    endDate: asString(week?.endDate),
    title: asString(week?.title),
    goal: asString(week?.goal),
    prioritySubjects,
    targetMinutes,
    targetHours: round1(targetMinutes / 60),
    totalMinutes,
    totalHours: round1(totalMinutes / 60),
    englishMinutes,
    englishHours: round1(englishMinutes / 60),
    days: dayStats,
    dayCount: dayStats.length,
    sessionCount: dayStats.reduce((sum, d) => sum + d.sessionCount, 0),
    activeDayCount: dayStats.filter((d) => d.sessionCount > 0).length,
    englishDaysCount: dayStats.filter((d) => d.englishMinutes > 0).length,
  };
}

/* ------------------------------------------------------------
   Phase stats
   ------------------------------------------------------------ */

function buildPhaseStats(phase, phaseIndex) {
  const weeks = asArray(phase?.weeks);
  const weekStats = weeks.map((w, i) => buildWeekStats(w, phase, phaseIndex, i));

  const targetMinutes = weekStats.reduce((sum, w) => sum + w.targetMinutes, 0);
  const totalMinutes = weekStats.reduce((sum, w) => sum + w.totalMinutes, 0);
  const englishMinutes = weekStats.reduce((sum, w) => sum + w.englishMinutes, 0);
  const allDays = weekStats.flatMap((w) => w.days);

  const subjects = new Set();
  weekStats.forEach((w) => w.prioritySubjects.forEach((s) => subjects.add(s)));

  const startDate = asString(phase?.startDate) || weekStats[0]?.startDate || "";
  const endDate = asString(phase?.endDate) || weekStats.at(-1)?.endDate || "";

  return {
    id: asString(phase?.id),
    index: phaseIndex,
    displayIndex: phaseIndex + 1,
    name: asString(phase?.name),
    startDate,
    endDate,
    goal: asString(phase?.goal),
    logic: asString(phase?.logic),
    weeks: weekStats,
    weekCount: weekStats.length,
    dayCount: allDays.length,
    sessionCount: allDays.reduce((sum, d) => sum + d.sessionCount, 0),
    targetMinutes,
    targetHours: round1(targetMinutes / 60),
    totalMinutes,
    totalHours: round1(totalMinutes / 60),
    averageWeeklyMinutes: weekStats.length > 0 ? targetMinutes / weekStats.length : 0,
    englishMinutes,
    englishHours: round1(englishMinutes / 60),
    subjectCount: subjects.size,
    subjects: [...subjects],
  };
}

/* ------------------------------------------------------------
   Final days
   ------------------------------------------------------------ */

function buildFinalDaysStats(phases, masterPlan) {
  const finalPhase = phases.at(-1);
  if (!finalPhase) return [];

  const originalPhase = asArray(masterPlan?.phases).at(-1);
  const finalDays = asArray(originalPhase?.finalDays);

  return finalDays
    .map((day) => buildDayStats(day, finalPhase.id, null))
    .sort((a, b) => sortByDate(a.date, b.date));
}

/* ------------------------------------------------------------
   Monthly aggregation
   ------------------------------------------------------------ */

function buildMonthlyStats(phases) {
  const byMonth = new Map();

  phases.forEach((phase) => {
    phase.weeks.forEach((week) => {
      week.days.forEach((day) => {
        if (!day.monthKey) return;
        const entry = byMonth.get(day.monthKey) || {
          monthKey: day.monthKey,
          targetMinutes: 0,
          englishMinutes: 0,
          totalMinutes: 0,
          weeks: new Set(),
          phases: new Set(),
          days: 0,
        };
        entry.days += 1;
        entry.weeks.add(week.id);
        entry.phases.add(phase.id);
        entry.englishMinutes += day.englishMinutes;
        entry.totalMinutes += day.totalMinutes;
        byMonth.set(day.monthKey, entry);
      });

      const weekMonth = monthKeyOf(week.startDate);
      if (weekMonth) {
        const entry = byMonth.get(weekMonth) || {
          monthKey: weekMonth,
          targetMinutes: 0,
          englishMinutes: 0,
          totalMinutes: 0,
          weeks: new Set(),
          phases: new Set(),
          days: 0,
        };
        entry.targetMinutes += week.targetMinutes;
        entry.weeks.add(week.id);
        entry.phases.add(phase.id);
        byMonth.set(weekMonth, entry);
      }
    });
  });

  return [...byMonth.values()]
    .map((m) => ({
      monthKey: m.monthKey,
      targetMinutes: m.targetMinutes,
      targetHours: round1(m.targetMinutes / 60),
      totalMinutes: m.totalMinutes,
      totalHours: round1(m.totalMinutes / 60),
      englishMinutes: m.englishMinutes,
      englishHours: round1(m.englishMinutes / 60),
      weekCount: m.weeks.size,
      phaseCount: m.phases.size,
      dayCount: m.days,
    }))
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}

/* ------------------------------------------------------------
   Subject presence
   ------------------------------------------------------------ */

function buildSubjectStats(phases) {
  const bySubject = new Map();

  phases.forEach((phase) => {
    phase.weeks.forEach((week) => {
      week.prioritySubjects.forEach((subject) => {
        const entry = bySubject.get(subject) || {
          name: subject,
          weeks: new Set(),
          phases: new Set(),
        };
        entry.weeks.add(week.id);
        entry.phases.add(phase.id);
        bySubject.set(subject, entry);
      });
    });
  });

  return [...bySubject.values()]
    .map((s) => ({
      name: s.name,
      weekCount: s.weeks.size,
      phaseCount: s.phases.size,
      phases: [...s.phases],
    }))
    .sort((a, b) => b.weekCount - a.weekCount);
}

/* ------------------------------------------------------------
   Global
   ------------------------------------------------------------ */

function buildGlobalStats(phases, finalDays) {
  const weeks = phases.flatMap((p) => p.weeks);
  const days = weeks.flatMap((w) => w.days);

  const totalTargetMinutes = weeks.reduce((sum, w) => sum + w.targetMinutes, 0);
  const totalMinutes = weeks.reduce((sum, w) => sum + w.totalMinutes, 0);
  const totalEnglishMinutes = days.reduce((sum, d) => sum + d.englishMinutes, 0);
  const finalEnglishMinutes = finalDays.reduce((sum, d) => sum + d.englishMinutes, 0);

  return {
    totalPhases: phases.length,
    totalWeeks: weeks.length,
    totalDays: days.length,
    totalSessions: days.reduce((sum, d) => sum + d.sessionCount, 0),
    totalTargetMinutes,
    totalTargetHours: round1(totalTargetMinutes / 60),
    totalMinutes,
    totalHours: round1(totalMinutes / 60),
    averageWeeklyMinutes: weeks.length > 0 ? totalTargetMinutes / weeks.length : 0,
    averageWeeklyHours: weeks.length > 0 ? round1(totalTargetMinutes / weeks.length / 60) : 0,
    totalEnglishMinutes: totalEnglishMinutes + finalEnglishMinutes,
    totalEnglishHours: round1((totalEnglishMinutes + finalEnglishMinutes) / 60),
    averageDailyEnglishMinutes: days.length > 0 ? totalEnglishMinutes / days.length : 0,
    finalDaysCount: finalDays.length,
    finalDaysEnglishMinutes: finalEnglishMinutes,
  };
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

export function buildPlanAnalytics(masterPlan) {
  if (!isMasterPlan(masterPlan)) return null;

  const phases = asArray(masterPlan.phases).map((p, i) => buildPhaseStats(p, i));
  const finalDays = buildFinalDaysStats(phases, masterPlan);
  const weeks = phases.flatMap((p) => p.weeks);
  const subjects = buildSubjectStats(phases);
  const months = buildMonthlyStats(phases);
  const global = buildGlobalStats(phases, finalDays);

  // ✅ جدید: مجموع دقیقه‌ها به تفکیک نوع جلسه در کل برنامه
  const sessionTypeTotals = { study: 0, practice: 0, test: 0, analysis: 0, review: 0 };
  weeks.forEach((w) => {
    w.days.forEach((d) => {
      if (d.byType) {
        sessionTypeTotals.study += d.byType.study || 0;
        sessionTypeTotals.practice += d.byType.practice || 0;
        sessionTypeTotals.test += d.byType.test || 0;
        sessionTypeTotals.analysis += d.byType.analysis || 0;
        sessionTypeTotals.review += d.byType.review || 0;
      }
    });
  });

  // ✅ جدید: شمارش روزهای با فعالیت به تفکیک نوع
  const activityDaysCount = {
    study: 0,
    practice: 0,
    test: 0,
    analysis: 0,
    review: 0,
  };
  weeks.forEach((w) => {
    w.days.forEach((d) => {
      if (!d.byType) return;
      if (d.byType.study > 0) activityDaysCount.study += 1;
      if (d.byType.practice > 0) activityDaysCount.practice += 1;
      if (d.byType.test > 0) activityDaysCount.test += 1;
      if (d.byType.analysis > 0) activityDaysCount.analysis += 1;
      if (d.byType.review > 0) activityDaysCount.review += 1;
    });
  });

  return {
    schemaVersion: masterPlan.schemaVersion,
    version: asNumber(masterPlan.version),
    planType: asString(masterPlan.planType),
    title: asString(masterPlan.title),
    timezone: asString(masterPlan.timezone),
    examGoal: masterPlan.examGoal || null,
    studyRules: masterPlan.studyRules || null,
    notes: masterPlan.notes || null,
    phases,
    weeks,
    finalDays,
    subjects,
    months,
    global,
    sessionTypeTotals,
    activityDaysCount,
  };
}
