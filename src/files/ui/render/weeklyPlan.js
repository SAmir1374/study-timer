/* =============================================================
   Weekly plan view — Saturday → Friday display weeks built from
   the master plan (phases → weeks → days).
   ============================================================= */

import { todayKey, getDaySessions } from "../../state.js";
import { fmtHoursMinutes } from "../../timer.js";
import { WeeklyPlanStore } from "../../weeklyPlanStore.js";
import { el } from "../elements.js";
import {
  activeMinutes,
  buildWeeklyPlanDisplayWeeks,
  computeSubjectCompletion,
  getActualMinutesForDate,
  getDayStatus,
  getUniqueSourceWeeks,
  sortPlanDays,
  sumPlannedMinutes,
} from "../planData.js";
import { ENGLISH_SUBJECT, calendarLocale, escapeHtml, getLanguage, makeL, typeLabel } from "../utils.js";
import { openDayModal } from "../dayModal/index.js";

const MAX_VISIBLE_SESSIONS = 5;
const STATUS_ICONS = { future: "○", today: "●", partial: "◐", missed: "○" };

/* ---------- day card ---------- */

function sessionRowHtml(session, completion, language) {
  const pct = completion.get(session.subject)?.pct ?? null;
  const pctClass = pct === 100 ? "is-complete" : pct > 0 ? "is-partial" : "is-empty";

  return `
    <div class="day-session-row" title="${escapeHtml(session.subject)}: ${escapeHtml(session.topic)}">
      <span class="day-session-row__time">${escapeHtml(session.startTime)}</span>
      <span class="day-session-row__subject">${escapeHtml(session.subject)}</span>
      <span class="day-session-row__type kc-${escapeHtml(session.type)}">${typeLabel(session.type, language)}</span>
      <span class="day-session-row__pct ${pct !== null ? pctClass : "is-empty"}">${pct !== null ? `${pct}%` : "—"}</span>
    </div>`;
}

function buildDayElement(day, actualMinutes, language, daySessions) {
  const L = makeL(language);
  const today = todayKey();
  const status = getDayStatus(day.date, actualMinutes, today);

  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
  const completion = computeSubjectCompletion(day, daySessions);

  const dailyTarget = sumPlannedMinutes(day);
  const dayPercent = dailyTarget > 0 ? Math.min(100, Math.round((actualMinutes / dailyTarget) * 100)) : 0;
  const englishMinutes = sessions
    .filter((s) => s.subject === ENGLISH_SUBJECT)
    .reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
  const recordedCount = daySessions.filter((s) => s.type !== "break").length;

  const dateLabel = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(calendarLocale(language), {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  const hiddenCount = sessions.length - MAX_VISIBLE_SESSIONS;
  const sessionsHtml = sessions
    .slice(0, MAX_VISIBLE_SESSIONS)
    .map((s) => sessionRowHtml(s, completion, language))
    .join("");
  const moreHtml =
    hiddenCount > 0
      ? `<div class="day-session-row day-session-row--more">+${hiddenCount} ${L("جلسه دیگر", "more")}</div>`
      : "";
  const emptyHtml = sessions.length
    ? ""
    : `<div class="day-session-row day-session-row--empty">${L("بدون جلسه", "No sessions")}</div>`;

  const card = document.createElement("div");
  card.className = `weekly-plan-day is-${status}`;
  card.dataset.date = day.date;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${dateLabel} — ${L("مشاهده جزئیات", "View details")}`);

  card.innerHTML = `
    <div class="weekly-plan-day__header">
      <div class="weekly-plan-day__identity">
        <div class="weekly-plan-day__title">
          <span class="weekly-plan-day__status-icon">${STATUS_ICONS[status]}</span>
          ${escapeHtml(dateLabel)}
        </div>
        <div class="weekly-plan-day__date">${escapeHtml(day.date)}</div>
      </div>
      <div class="weekly-plan-day__target">
        <strong>${dailyTarget > 0 ? fmtHoursMinutes(dailyTarget * 60) : "—"}</strong>
        <span>${L("هدف روز", "Daily goal")}</span>
      </div>
    </div>

    <div class="weekly-plan-day__progress">
      <div class="weekly-plan-day__progress-bar"><span style="width: ${dayPercent}%"></span></div>
      <span class="weekly-plan-day__progress-label">
        ${dayPercent}% ${L("از هدف", "of goal")} · ${fmtHoursMinutes(Math.round(actualMinutes * 60))}
      </span>
    </div>

    <div class="weekly-plan-day__sessions-list">
      ${sessionsHtml}${moreHtml}${emptyHtml}
    </div>

    <div class="weekly-plan-day__footer">
      <span class="weekly-plan-day__english">🇬🇧 ${englishMinutes}${L("د", "m")}</span>
      <span class="weekly-plan-day__sessions">${recordedCount} ${L("جلسه ثبت‌شده", "recorded")}</span>
    </div>
  `;

  return card;
}

/* ---------- week section ---------- */

const getWeekState = (week, today) =>
  week.end < today ? "past" : week.start > today ? "upcoming" : "current";

const sourceWeekLabel = (sourceWeeks) =>
  sourceWeeks
    .map((w) => w?.id)
    .filter(Boolean)
    .join(" · ");

/** Only compare against targetMinutes when exactly one master-plan week is represented. */
function planTargetText(sourceWeeks, L) {
  if (sourceWeeks.length === 1) {
    const target = Number(sourceWeeks[0]?.targetMinutes) || 0;
    return target > 0 ? L(`هدف برنامه: ${target} دقیقه`, `Plan target: ${target} min`) : "";
  }

  const targets = sourceWeeks
    .map((src) => {
      const target = Number(src?.targetMinutes) || 0;
      if (!target) return null;
      return src?.id ? `${escapeHtml(src.id)}: ${target}` : String(target);
    })
    .filter(Boolean);

  return targets.length
    ? L(`اهداف برنامه: ${targets.join(" · ")} دقیقه`, `Plan targets: ${targets.join(" · ")} min`)
    : "";
}

function buildWeekSection(week, index, today, language) {
  const L = makeL(language);
  const weekState = getWeekState(week, today);
  const entries = sortPlanDays(week.entries);
  const sourceWeeks = getUniqueSourceWeeks(entries);

  const actualMinutes = entries.reduce((sum, { day }) => sum + getActualMinutesForDate(day.date), 0);
  const targetMinutes = sourceWeeks.length === 1 ? Number(sourceWeeks[0]?.targetMinutes) || 0 : null;
  const weekPercent =
    targetMinutes > 0 ? Math.min(100, Math.round((actualMinutes / targetMinutes) * 100)) : null;
    
  const badgeText = {
    past: L("تمام شده", "Finished"),
    current: L("هفته جاری", "Current week"),
    upcoming: L("پیش‌رو", "Upcoming"),
  }[weekState];

  const sourceText = escapeHtml(sourceWeekLabel(sourceWeeks));
  const targetText = planTargetText(sourceWeeks, L);
  const progressText =
    weekState !== "upcoming" && targetMinutes ? L(`${weekPercent}٪ از هدف`, `${weekPercent}% of target`) : "";

  const header = document.createElement("div");
  header.className = "weekly-plan-week__header";
  header.innerHTML = `
    <div class="weekly-plan-week__identity">
      <span class="weekly-plan-week__name">
        ${L("هفته", "Week")} ${index + 1}${sourceText ? ` • ${sourceText}` : ""}
      </span>
      <span class="weekly-plan-week__range">
        ${escapeHtml(week.start)} ${L("تا", "–")} ${escapeHtml(week.end)}
      </span>
      ${targetText ? `<span class="weekly-plan-week__target">${targetText}</span>` : ""}
    </div>

    <div class="weekly-plan-week__summary">
      <span class="weekly-plan-week__goal">
        ${L(`مطالعه واقعی: ${Math.round(actualMinutes)} دقیقه`, `Actual: ${Math.round(actualMinutes)} min`)}
      </span>
      ${progressText ? `<span class="weekly-plan-week__progress">${progressText}</span>` : ""}
      <span class="weekly-plan-week__badge">${badgeText}</span>
    </div>

    <div class="weekly-plan-week__progress-bar">
      <div class="weekly-plan-week__progress-bar-fill" style="width: ${weekPercent || 0}%"></div>
    </div>
  `;

  const grid = document.createElement("div");
  grid.className = "weekly-plan-week__days";
  entries.forEach(({ day }) => {
    const daySessions = getDaySessions(day.date);
    grid.appendChild(buildDayElement(day, activeMinutes(daySessions), language, daySessions));
  });

  const section = document.createElement("div");
  section.className = "weekly-plan-week";
  section.dataset.weekState = weekState;
  section.append(header, grid);
  return section;
}

/* ---------- top metadata ---------- */

function currentWeekGoalText(sourceWeeks, actual, L) {
  const rounded = Math.round(actual);

  if (sourceWeeks.length === 1) {
    const target = Number(sourceWeeks[0]?.targetMinutes) || 0;
    if (target > 0) {
      const pct = Math.min(100, Math.round((actual / target) * 100));
      return L(
        `هدف ${target} دقیقه • ${rounded} دقیقه انجام شده • ${pct}٪`,
        `${target} min goal • ${rounded} min actual • ${pct}%`,
      );
    }
  } else if (sourceWeeks.length > 1) {
    return L(
      `${sourceWeeks.length} هفته برنامه‌ای • ${rounded} دقیقه مطالعه واقعی`,
      `${sourceWeeks.length} plan weeks • ${rounded} min actual study`,
    );
  }

  return L(`${rounded} دقیقه مطالعه واقعی`, `${rounded} min actual study`);
}

function renderPlanMeta(weeks, today, language) {
  const { weeklyPlanMeta: meta, weeklyPlanWeekLabel: weekLabel, weeklyPlanGoal: goal } = el;
  const L = makeL(language);

  if (meta) meta.hidden = false;

  const currentWeek = weeks.find((w) => getWeekState(w, today) === "current");

  // No current week: all plan dates are before or after today.
  if (!currentWeek) {
    if (weekLabel) weekLabel.textContent = L(`${weeks.length} هفته برنامه`, `${weeks.length} planned weeks`);
    if (goal) goal.textContent = L("هفته جاری در بازه برنامه نیست", "Current week is outside the plan");
    return;
  }

  const sourceWeeks = getUniqueSourceWeeks(currentWeek.entries);
  const actual = currentWeek.entries.reduce((sum, { day }) => sum + getActualMinutesForDate(day.date), 0);
  const label = sourceWeekLabel(sourceWeeks);

  if (weekLabel) {
    weekLabel.textContent = L(
      `${label || "برنامه هفتگی"} • ${currentWeek.start} تا ${currentWeek.end}`,
      `${label || "Weekly Plan"} • ${currentWeek.start} – ${currentWeek.end}`,
    );
  }
  if (goal) goal.textContent = currentWeekGoalText(sourceWeeks, actual, L);
}

/* ---------- main render ---------- */

function showEmpty(text) {
  if (el.weeklyPlanMeta) el.weeklyPlanMeta.hidden = true;
  if (el.weeklyPlanEmpty) {
    el.weeklyPlanEmpty.hidden = false;
    el.weeklyPlanEmpty.textContent = text;
  }
}

export function weeklyPlan() {
  const container = el.weeklyPlanDays;
  if (!container) return;

  const language = getLanguage();
  const L = makeL(language);

  container.innerHTML = "";

  if (!WeeklyPlanStore.hasData()) {
    showEmpty(
      L(
        "برای مشاهده برنامه هفتگی، فایل برنامه هفتگی را از تنظیمات متصل کنید.",
        "Connect a weekly plan file in Settings to see your weekly plan.",
      ),
    );
    return;
  }

  // Plan is in memory but the file handle may need re-permission.
  if (el.weeklyPlanMeta) {
    if (!WeeklyPlanStore.isConnected()) {
      el.weeklyPlanMeta.dataset.needsReconnect =
        WeeklyPlanStore.status.state === "permission" ? "true" : "false";
    } else {
      delete el.weeklyPlanMeta.dataset.needsReconnect;
    }
  }

  const weeks = buildWeeklyPlanDisplayWeeks();
  if (!weeks.length) {
    showEmpty(
      L("در فایل برنامه، روزی برای نمایش وجود ندارد.", "No planned days were found in the weekly plan."),
    );
    return;
  }

  if (el.weeklyPlanEmpty) el.weeklyPlanEmpty.hidden = true;

  const today = todayKey();
  weeks.forEach((week, index) => {
    container.appendChild(buildWeekSection(week, index, today, language));
  });

  renderPlanMeta(weeks, today, language);
}

/* ---------- events (delegated: cards are re-created on every render) ---------- */

function dateFromEvent(event) {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest(".weekly-plan-day[data-date]")?.dataset.date || null;
}

export function bindWeeklyPlanEvents() {
  const container = el.weeklyPlanDays;
  if (!container) return;

  container.addEventListener("click", (event) => {
    const dateKey = dateFromEvent(event);
    if (dateKey) openDayModal(dateKey);
  });

  container.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const dateKey = dateFromEvent(event);
    if (!dateKey) return;
    event.preventDefault();
    openDayModal(dateKey);
  });
}
