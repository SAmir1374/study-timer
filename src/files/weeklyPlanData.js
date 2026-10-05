export const WEEKLY_PLAN_DATA_FORMAT = "study-timer-weekly-plans-json";
export const WEEKLY_PLAN_SCHEMA_VERSION = WEEKLY_PLAN_DATA_FORMAT;
export const WEEKLY_PLAN_TYPE = "phased-master-study-plan";
export const DEFAULT_WEEKLY_PLANS_FILE_NAME = "weekly-plans.json";
export const INVALID_WEEKLY_PLANS_MESSAGE = "Invalid weekly plans file";
export const MAX_WEEK_SPAN_DAYS = 14;

/** Session types supported in schema v5. */
export const SESSION_TYPES = Object.freeze(["study", "practice", "test", "analysis", "review"]);

/** Sessions that count as "practice" (isPractice === true). */
export const PRACTICE_SESSION_TYPES = Object.freeze(["practice", "test"]);

/** Day patterns: A = takwondo days, B = workdays, C = free days. */
export const DAY_TYPES = Object.freeze(["A", "B", "C"]);

export const WEEKDAY_NAMES_FA = Object.freeze([
  "یکشنبه",
  "دوشنبه",
  "سه‌شنبه",
  "چهارشنبه",
  "پنج‌شنبه",
  "جمعه",
  "شنبه",
]);

const DAY_MS = 86400000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}
function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}
function toDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function dateKeyToUtcDate(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`);
}
function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = dateKeyToUtcDate(value);
  return !Number.isNaN(date.getTime()) && toDateKey(date) === value;
}
function isTimeKey(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
  const [h, m] = value.split(":").map(Number);
  return h >= 0 && h < 24 && m >= 0 && m < 60;
}
function minutesBetween(startTime, endTime) {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}
function daysBetweenInclusive(startKey, endKey) {
  return Math.round((dateKeyToUtcDate(endKey) - dateKeyToUtcDate(startKey)) / DAY_MS) + 1;
}
function normalizeFa(value) {
  return String(value)
    .replace(/[\u200c\u200d\s]/g, "")
    .replace(/\u064a/g, "\u06cc")
    .replace(/\u0643/g, "\u06a9");
}

export function weekdayForDate(dateKey) {
  if (!isDateKey(dateKey)) throw new Error(`Invalid date key: ${dateKey}`);
  return dateKeyToUtcDate(dateKey).getUTCDay();
}
export function weekdayNameFor(dateKey) {
  return WEEKDAY_NAMES_FA[weekdayForDate(dateKey)];
}
function weekdayLabelMatches(label, dateKey) {
  return normalizeFa(label) === normalizeFa(weekdayNameFor(dateKey));
}

export function getPrioritySubjects(week) {
  const value = week && week.prioritySubjects;
  if (Array.isArray(value)) return value.filter(isNonEmptyString).map((s) => s.trim());
  if (isNonEmptyString(value)) {
    return value
      .split(/[،,]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

/* ------------------------------------------------------------
   Session helpers
   ------------------------------------------------------------ */

export function isPracticeForType(type) {
  return PRACTICE_SESSION_TYPES.includes(type);
}

export function sessionMinutes(session) {
  if (!session || !isTimeKey(session.startTime) || !isTimeKey(session.endTime)) {
    return Number(session?.minutes) || 0;
  }
  return minutesBetween(session.startTime, session.endTime);
}

export function dayTotalMinutes(day) {
  if (!day || !Array.isArray(day.sessions)) return 0;
  return day.sessions.reduce((sum, s) => sum + sessionMinutes(s), 0);
}

export function dayEnglishMinutes(day) {
  if (!day || !Array.isArray(day.sessions)) return 0;
  return day.sessions
    .filter((s) => normalizeFa(s.subject || "") === normalizeFa("زبان تخصصی"))
    .reduce((sum, s) => sum + sessionMinutes(s), 0);
}

export function weekEnglishMinutes(week) {
  if (!week || !Array.isArray(week.days)) return 0;
  return week.days.reduce((sum, day) => sum + dayEnglishMinutes(day), 0);
}
/** Sessions that count toward the session count displayed on day cards. */
export function dayCountedSessionCount(day) {
  if (!day || !Array.isArray(day.sessions)) return 0;
  return day.sessions.filter((s) => s.type !== "break").length;
}

/* ------------------------------------------------------------
   Factories
   ------------------------------------------------------------ */

export function createWeeklyPlanSession({
  subject,
  topic,
  type = "study",
  isPractice,
  minutes,
  startTime,
  endTime,
} = {}) {
  if (!isNonEmptyString(subject)) throw new Error("Session subject is required");
  if (!isNonEmptyString(topic)) throw new Error("Session topic is required");
  if (!SESSION_TYPES.includes(type)) throw new Error(`Invalid session type: ${type}`);
  if (!isTimeKey(startTime)) throw new Error(`Invalid session startTime: ${startTime}`);
  if (!isTimeKey(endTime)) throw new Error(`Invalid session endTime: ${endTime}`);

  const diff = minutesBetween(startTime, endTime);
  if (diff <= 0) throw new Error("Session endTime must be after startTime");

  const resolvedMinutes = isPositiveInteger(minutes) ? minutes : diff;
  const resolvedPractice = typeof isPractice === "boolean" ? isPractice : isPracticeForType(type);

  return {
    subject: subject.trim(),
    topic: topic.trim(),
    type,
    isPractice: resolvedPractice,
    minutes: resolvedMinutes,
    startTime,
    endTime,
  };
}

export function createWeeklyPlanDay({ date, weekday, dayType, sessions = [] } = {}) {
  if (!isDateKey(date)) throw new Error(`Invalid weekly plan day date: ${date}`);
  if (!isNonEmptyString(weekday)) throw new Error("Weekly plan day weekday is required");
  if (!weekdayLabelMatches(weekday, date))
    throw new Error(`Weekday must be ${weekdayNameFor(date)} for ${date}`);
  if (dayType !== undefined && !DAY_TYPES.includes(dayType)) throw new Error(`Invalid dayType: ${dayType}`);
  if (!Array.isArray(sessions)) throw new Error("Weekly plan day sessions must be an array");

  return {
    date,
    weekday: weekday.trim(),
    ...(dayType ? { dayType } : {}),
    sessions: sessions.map((s) => createWeeklyPlanSession(s)),
  };
}

export function createWeeklyPlanWeek({
  id,
  weekNumber,
  startDate,
  endDate,
  title,
  goal = "",
  prioritySubjects = [],
  targetMinutes = 0,
  days = [],
} = {}) {
  if (!isNonEmptyString(id)) throw new Error("Weekly plan week id is required");
  if (!isDateKey(startDate)) throw new Error(`Invalid weekly plan week start date: ${startDate}`);
  if (!isDateKey(endDate)) throw new Error(`Invalid weekly plan week end date: ${endDate}`);
  if (endDate < startDate) throw new Error("Weekly plan week end date must not be before start date");
  if (!isNonEmptyString(title)) throw new Error("Weekly plan week title is required");
  if (!Array.isArray(days)) throw new Error("Weekly plan week days must be an array");

  return {
    id: id.trim(),
    ...(isPositiveInteger(weekNumber) ? { weekNumber } : {}),
    startDate,
    endDate,
    title: title.trim(),
    goal: typeof goal === "string" ? goal.trim() : "",
    prioritySubjects: Array.isArray(prioritySubjects)
      ? prioritySubjects.filter(isNonEmptyString).map((s) => s.trim())
      : [],
    targetMinutes: isNonNegativeInteger(targetMinutes) ? targetMinutes : 0,
    days: days.map((day) => createWeeklyPlanDay(day)),
  };
}

export function createEmptyWeeklyPlansDocument() {
  return {
    schemaVersion: WEEKLY_PLAN_DATA_FORMAT,
    version: 5,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    planType: WEEKLY_PLAN_TYPE,
    title: "",
    phases: [],
  };
}

/* ------------------------------------------------------------
   Validation
   ------------------------------------------------------------ */

function validateOptionalString(errors, path, value) {
  if (value !== undefined && typeof value !== "string") errors.push(`${path} must be a string`);
}

function validateNameList(errors, path, value) {
  if (!Array.isArray(value) || !value.every(isNonEmptyString))
    errors.push(`${path} must be an array of non-empty strings`);
}

function validateExamGoal(errors, goal) {
  if (goal === undefined) return;
  if (!isObject(goal)) {
    errors.push("examGoal must be an object");
    return;
  }
  for (const key of ["program", "targetUniversity", "targetWindow", "strategy"]) {
    validateOptionalString(errors, `examGoal.${key}`, goal[key]);
  }
}

function validateStudyRules(errors, rules) {
  if (rules === undefined) return;
  if (!isObject(rules)) {
    errors.push("studyRules must be an object");
    return;
  }
  if (
    rules.specializedEnglishMinutesPerDay !== undefined &&
    !isNonNegativeInteger(rules.specializedEnglishMinutesPerDay)
  )
    errors.push("studyRules.specializedEnglishMinutesPerDay must be a non-negative integer");
  for (const key of ["mainSubjects", "foundationSubjects", "secondarySubjects"]) {
    if (rules[key] !== undefined) validateNameList(errors, `studyRules.${key}`, rules[key]);
  }
  validateOptionalString(errors, "studyRules.cycle", rules.cycle);
  validateOptionalString(errors, "studyRules.adjustment", rules.adjustment);
}

function validateNotes(errors, notes) {
  if (notes === undefined) return;
  if (!isObject(notes)) {
    errors.push("notes must be an object");
    return;
  }
  for (const [key, value] of Object.entries(notes)) {
    if (typeof value !== "string") errors.push(`notes.${key} must be a string`);
  }
}

function validatePrioritySubjects(errors, path, value) {
  if (value === undefined) return;
  if (isNonEmptyString(value)) return;
  if (Array.isArray(value) && value.every(isNonEmptyString)) return;
  errors.push(`${path} must be a non-empty string or an array of non-empty strings`);
}

function readRange(errors, path, item) {
  const startOk = isDateKey(item.startDate);
  const endOk = isDateKey(item.endDate);
  if (!startOk) errors.push(`${path}.startDate is invalid`);
  if (!endOk) errors.push(`${path}.endDate is invalid`);
  if (!startOk || !endOk) return null;
  if (item.endDate < item.startDate) {
    errors.push(`${path}.endDate must not be before startDate`);
    return null;
  }
  return { start: item.startDate, end: item.endDate };
}

function validateSession(errors, path, session) {
  if (!isObject(session)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(session.subject)) errors.push(`${path}.subject is required`);
  if (!isNonEmptyString(session.topic)) errors.push(`${path}.topic is required`);
  if (!SESSION_TYPES.includes(session.type))
    errors.push(`${path}.type must be one of: ${SESSION_TYPES.join(", ")}`);
  if (typeof session.isPractice !== "boolean") errors.push(`${path}.isPractice must be a boolean`);
  else if (SESSION_TYPES.includes(session.type)) {
    const expected = isPracticeForType(session.type);
    if (session.isPractice !== expected)
      errors.push(`${path}.isPractice must be ${expected} for type "${session.type}"`);
  }
  if (!isPositiveInteger(session.minutes)) errors.push(`${path}.minutes must be a positive integer`);

  const startOk = isTimeKey(session.startTime);
  const endOk = isTimeKey(session.endTime);
  if (!startOk) errors.push(`${path}.startTime must be in HH:mm format`);
  if (!endOk) errors.push(`${path}.endTime must be in HH:mm format`);
  if (startOk && endOk) {
    const diff = minutesBetween(session.startTime, session.endTime);
    if (diff <= 0) errors.push(`${path}.endTime must be after startTime`);
    else if (isPositiveInteger(session.minutes) && session.minutes !== diff) {
      errors.push(
        `${path}.minutes (${session.minutes}) must equal the difference between startTime and endTime (${diff})`,
      );
    }
  }
}

function validateDay(errors, path, day, bounds, usedDates) {
  if (!isObject(day)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isDateKey(day.date)) {
    errors.push(`${path}.date is invalid`);
    return;
  }
  if (bounds && (day.date < bounds.start || day.date > bounds.end))
    errors.push(`${path}.date ${day.date} is outside ${bounds.start} to ${bounds.end}`);
  if (usedDates.has(day.date))
    errors.push(`${path}.date ${day.date} is duplicated (also at ${usedDates.get(day.date)})`);
  else usedDates.set(day.date, path);

  if (!isNonEmptyString(day.weekday)) errors.push(`${path}.weekday must be a Persian weekday name`);
  else if (!weekdayLabelMatches(day.weekday, day.date))
    errors.push(`${path}.weekday must be ${weekdayNameFor(day.date)} for ${day.date}`);

  if (day.dayType !== undefined && !DAY_TYPES.includes(day.dayType))
    errors.push(`${path}.dayType must be one of: ${DAY_TYPES.join(", ")}`);

  if (!Array.isArray(day.sessions)) {
    errors.push(`${path}.sessions must be an array`);
    return;
  }
  day.sessions.forEach((session, i) => validateSession(errors, `${path}.sessions[${i}]`, session));
}

function validateWeek(errors, path, week, phaseRange, ctx) {
  if (!isObject(week)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(week.id)) errors.push(`${path}.id is required`);
  else if (ctx.weekIds.has(week.id)) errors.push(`${path}.id is duplicated: ${week.id}`);
  else ctx.weekIds.add(week.id);

  if (week.weekNumber !== undefined && !isPositiveInteger(week.weekNumber))
    errors.push(`${path}.weekNumber must be a positive integer`);

  if (!isNonEmptyString(week.title)) errors.push(`${path}.title is required`);
  validateOptionalString(errors, `${path}.goal`, week.goal);
  validatePrioritySubjects(errors, `${path}.prioritySubjects`, week.prioritySubjects);
  if (!isNonNegativeInteger(week.targetMinutes))
    errors.push(`${path}.targetMinutes must be a non-negative integer`);

  const range = readRange(errors, path, week);
  if (range) {
    if (daysBetweenInclusive(range.start, range.end) > MAX_WEEK_SPAN_DAYS)
      errors.push(`${path} spans more than ${MAX_WEEK_SPAN_DAYS} days`);
    if (phaseRange && (range.start < phaseRange.start || range.end > phaseRange.end))
      errors.push(
        `${path} (${range.start} to ${range.end}) is outside its phase (${phaseRange.start} to ${phaseRange.end})`,
      );
    ctx.weekRanges.push({ path, ...range });
  }

  if (!Array.isArray(week.days)) {
    errors.push(`${path}.days must be an array`);
    return;
  }
  week.days.forEach((day, i) => validateDay(errors, `${path}.days[${i}]`, day, range, ctx.usedDates));
}

function validatePhase(errors, path, phase, ctx) {
  if (!isObject(phase)) {
    errors.push(`${path} must be an object`);
    return;
  }
  if (!isNonEmptyString(phase.id)) errors.push(`${path}.id is required`);
  else if (ctx.phaseIds.has(phase.id)) errors.push(`${path}.id is duplicated: ${phase.id}`);
  else ctx.phaseIds.add(phase.id);

  if (!isNonEmptyString(phase.name)) errors.push(`${path}.name is required`);
  validateOptionalString(errors, `${path}.goal`, phase.goal);
  validateOptionalString(errors, `${path}.logic`, phase.logic);

  const range = readRange(errors, path, phase);
  if (range) ctx.phaseRanges.push({ path, ...range });

  if (!Array.isArray(phase.weeks)) errors.push(`${path}.weeks must be an array`);
  else phase.weeks.forEach((week, i) => validateWeek(errors, `${path}.weeks[${i}]`, week, range, ctx));

  if (phase.finalDays !== undefined) {
    if (!Array.isArray(phase.finalDays)) errors.push(`${path}.finalDays must be an array`);
    else
      phase.finalDays.forEach((day, i) =>
        validateDay(errors, `${path}.finalDays[${i}]`, day, range, ctx.usedDates),
      );
  }
}

function reportOverlaps(errors, ranges) {
  if (ranges.length < 2) return;
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  let last = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur.start <= last.end)
      errors.push(
        `${cur.path} (${cur.start} to ${cur.end}) overlaps ${last.path} (${last.start} to ${last.end})`,
      );
    if (cur.end > last.end) last = cur;
  }
}

export function getWeeklyPlansValidationErrors(document) {
  const errors = [];
  if (!isObject(document)) return ["Root must be an object"];

  if (document.schemaVersion !== WEEKLY_PLAN_DATA_FORMAT)
    errors.push(`schemaVersion must be "${WEEKLY_PLAN_DATA_FORMAT}"`);
  if (!isPositiveInteger(document.version)) errors.push("version must be a positive integer");
  if (!isNonEmptyString(document.timezone)) errors.push("timezone must be a non-empty string");
  validateOptionalString(errors, "planType", document.planType);
  validateOptionalString(errors, "title", document.title);
  validateExamGoal(errors, document.examGoal);
  validateStudyRules(errors, document.studyRules);
  validateNotes(errors, document.notes);

  if (!Array.isArray(document.phases)) {
    errors.push("phases must be an array");
    return errors;
  }

  const ctx = {
    phaseIds: new Set(),
    weekIds: new Set(),
    usedDates: new Map(),
    phaseRanges: [],
    weekRanges: [],
  };
  document.phases.forEach((phase, i) => validatePhase(errors, `phases[${i}]`, phase, ctx));
  reportOverlaps(errors, ctx.phaseRanges);
  reportOverlaps(errors, ctx.weekRanges);
  return errors;
}

export function validateWeeklyPlansDocument(document) {
  return getWeeklyPlansValidationErrors(document).length === 0;
}

export function migrateWeeklyPlansData(raw) {
  if (!isObject(raw)) throw new Error("root must be an object");
  if (raw.schemaVersion !== WEEKLY_PLAN_DATA_FORMAT) {
    if (raw.schemaVersion === 1 && Array.isArray(raw.plans))
      throw new Error("this is the old sessions-based format; replace it with the phased master plan file");
    throw new Error(`Unsupported weekly plans schemaVersion: ${JSON.stringify(raw.schemaVersion)}`);
  }
  return raw;
}

export function serializeWeeklyPlansDocument(document) {
  const errors = getWeeklyPlansValidationErrors(document);
  if (errors.length > 0) {
    throw new Error(`${INVALID_WEEKLY_PLANS_MESSAGE}: ${errors.join("; ")}`);
  }
  return JSON.stringify(document, null, 2) + "\n";
}

export function parseWeeklyPlansDocument(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${INVALID_WEEKLY_PLANS_MESSAGE}: invalid JSON`);
  }
  let migrated;
  try {
    migrated = migrateWeeklyPlansData(raw);
  } catch (error) {
    throw new Error(`${INVALID_WEEKLY_PLANS_MESSAGE}: ${error.message}`);
  }
  const errors = getWeeklyPlansValidationErrors(migrated);
  if (errors.length > 0) {
    throw new Error(`${INVALID_WEEKLY_PLANS_MESSAGE}: ${errors.join("; ")}`);
  }
  return migrated;
}

/* ------------------------------------------------------------
   Lookups
   ------------------------------------------------------------ */

export function getAllWeeks(document) {
  if (!document || !Array.isArray(document.phases)) return [];
  return document.phases.flatMap((phase) =>
    phase && Array.isArray(phase.weeks) ? phase.weeks.filter(isObject) : [],
  );
}

export function findPhaseById(document, phaseId) {
  if (!document || !Array.isArray(document.phases) || !isNonEmptyString(phaseId)) return null;
  return document.phases.find((phase) => phase && phase.id === phaseId) || null;
}

export function findPhaseForDate(document, dateKey) {
  if (!document || !Array.isArray(document.phases) || !isDateKey(dateKey)) return null;
  return (
    document.phases.find(
      (phase) =>
        phase && isDateKey(phase.startDate) && phase.startDate <= dateKey && dateKey <= phase.endDate,
    ) || null
  );
}

export function findWeekById(document, weekId) {
  if (!isNonEmptyString(weekId)) return null;
  return getAllWeeks(document).find((week) => week.id === weekId) || null;
}

export function findWeekForDate(document, dateKey) {
  if (!isDateKey(dateKey)) return null;
  return (
    getAllWeeks(document).find(
      (week) => isDateKey(week.startDate) && week.startDate <= dateKey && dateKey <= week.endDate,
    ) || null
  );
}

export function getPlanDay(document, dateKey) {
  if (!document || !isDateKey(dateKey)) return null;
  const week = findWeekForDate(document, dateKey);
  const fromWeek =
    week && Array.isArray(week.days) ? week.days.find((day) => day && day.date === dateKey) : null;
  if (fromWeek) return fromWeek;
  const phase = findPhaseForDate(document, dateKey);
  if (phase && Array.isArray(phase.finalDays)) {
    return phase.finalDays.find((day) => day && day.date === dateKey) || null;
  }
  return null;
}

export function hasPlanDay(document, dateKey) {
  return Boolean(getPlanDay(document, dateKey));
}

export function getSortedWeekDays(week) {
  if (!week || !Array.isArray(week.days)) return [];
  return [...week.days].sort((a, b) => a.date.localeCompare(b.date));
}

export const getSortedPlanDays = getSortedWeekDays;

export function plannedEnglishMinutes(week) {
  return weekEnglishMinutes(week);
}
