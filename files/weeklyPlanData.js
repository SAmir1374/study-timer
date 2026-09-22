export const WEEKLY_PLAN_SCHEMA_VERSION = 1;
export const WEEKLY_PLAN_DATA_FORMAT = 'study-timer-weekly-plans-json';
export const DEFAULT_WEEKLY_PLANS_FILE_NAME = 'weekly-plans.json';
export const INVALID_WEEKLY_PLANS_MESSAGE = 'Invalid weekly plans file';
export const WEEKLY_PLAN_ACTIVITY_TYPES = Object.freeze(['study', 'practice', 'review', 'test']);
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}
function isDateKey(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  );
}
function isIsoTimestamp(value) {
  if (typeof value !== 'string') return false;
  return !Number.isNaN(Date.parse(value));
}
function toDateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function dateKeyToUtcDate(dateKey) {
  return new Date(`${dateKey}T00:00:00Z`);
}
function nowIso() {
  return new Date().toISOString();
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
export function isoWeekOf(dateKey) {
  if (!isDateKey(dateKey)) throw new Error(`Invalid date key: ${dateKey}`);
  const date = dateKeyToUtcDate(dateKey);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const diff = date.getTime() - yearStart.getTime();
  const isoWeek = Math.ceil((diff / 86400000 + 1) / 7);
  return { isoYear, isoWeek };
}
export function weeklyPlanIdFor(dateKey) {
  const { isoYear, isoWeek } = isoWeekOf(dateKey);
  return `${isoYear}-W${String(isoWeek).padStart(2, '0')}`;
}
export function isoWeekRange(dateKey) {
  if (!isDateKey(dateKey)) throw new Error(`Invalid date key: ${dateKey}`);
  const date = dateKeyToUtcDate(dateKey);
  const day = date.getUTCDay() || 7;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - day + 1);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { startDate: toDateKey(monday), endDate: toDateKey(sunday) };
}
export function weekdayForDate(dateKey) {
  if (!isDateKey(dateKey)) throw new Error(`Invalid date key: ${dateKey}`);
  return dateKeyToUtcDate(dateKey).getUTCDay();
}
export function createWeeklyPlanSession({
  subject,
  minutes = 0,
  type = 'study',
  practice = false,
} = {}) {
  if (!isNonEmptyString(subject)) throw new Error('Weekly plan session subject is required');
  if (!isNonNegativeInteger(minutes))
    throw new Error('Weekly plan session minutes must be a non-negative integer');
  if (!WEEKLY_PLAN_ACTIVITY_TYPES.includes(type))
    throw new Error(`Invalid weekly plan activity type: ${type}`);
  return {
    subject: subject.trim(),
    minutes,
    type,
    practice: Boolean(practice),
  };
}
export function createWeeklyPlanDay({ date, title = null, sessions = [], note = '' } = {}) {
  if (!isDateKey(date)) throw new Error(`Invalid weekly plan day date: ${date}`);
  if (!Array.isArray(sessions)) throw new Error('Weekly plan day sessions must be an array');
  return {
    weekday: weekdayForDate(date),
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    sessions: sessions.map((session) => createWeeklyPlanSession(session)),
    note: typeof note === 'string' ? note : '',
  };
}
export function createWeeklyPlan({
  startDate,
  title = '',
  phase = '',
  targetMinutes = 0,
  days = {},
} = {}) {
  if (!isDateKey(startDate)) throw new Error(`Invalid weekly plan start date: ${startDate}`);
  const range = isoWeekRange(startDate);
  const normalizedDays = {};
  if (Array.isArray(days)) {
    for (const day of days) {
      if (!day || !isDateKey(day.date)) throw new Error('Invalid day in weekly plan');
      normalizedDays[day.date] = createWeeklyPlanDay({
        date: day.date,
        title: day.title,
        sessions: day.sessions,
        note: day.note,
      });
    }
  } else if (isObject(days)) {
    for (const [date, day] of Object.entries(days)) {
      normalizedDays[date] = createWeeklyPlanDay({
        date,
        title: day?.title,
        sessions: day?.sessions,
        note: day?.note,
      });
    }
  } else {
    throw new Error('Weekly plan days must be an object or array');
  }
  return {
    id: weeklyPlanIdFor(startDate),
    weekStart: range.startDate,
    weekEnd: range.endDate,
    title: typeof title === 'string' ? title.trim() : '',
    phase: typeof phase === 'string' ? phase.trim() : '',
    targetMinutes: isNonNegativeInteger(targetMinutes) ? targetMinutes : 0,
    days: normalizedDays,
  };
}
export function createEmptyWeeklyPlansDocument({ nowMs = Date.now() } = {}) {
  const timestamp = new Date(nowMs).toISOString();
  return {
    schemaVersion: WEEKLY_PLAN_SCHEMA_VERSION,
    app: {
      name: 'Study Timer',
      dataFormat: WEEKLY_PLAN_DATA_FORMAT,
      createdAt: timestamp,
      updatedAt: timestamp,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
    plans: [],
  };
}
function validateSession(session) {
  if (!isObject(session)) return false;
  if (!isNonEmptyString(session.subject)) return false;
  if (!isNonNegativeInteger(session.minutes)) return false;
  if (!WEEKLY_PLAN_ACTIVITY_TYPES.includes(session.type)) return false;
  if (typeof session.practice !== 'boolean') return false;
  return true;
}
function validateDay(dateKey, day) {
  if (!isDateKey(dateKey)) return false;
  if (!isObject(day)) return false;
  if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) return false;
  if (typeof day.title !== 'string' && day.title !== null) return false;
  if (!Array.isArray(day.sessions)) return false;
  if (typeof day.note !== 'string') return false;
  return day.sessions.every(validateSession);
}
function validateWeeklyPlan(plan) {
  if (!isObject(plan)) return false;
  if (!isNonEmptyString(plan.id)) return false;
  if (!isDateKey(plan.weekStart)) return false;
  if (!isDateKey(plan.weekEnd)) return false;
  if (typeof plan.title !== 'string') return false;
  if (typeof plan.phase !== 'string') return false;
  if (!isNonNegativeInteger(plan.targetMinutes)) return false;
  if (!isObject(plan.days)) return false;
  if (plan.id !== weeklyPlanIdFor(plan.weekStart)) return false;
  const range = isoWeekRange(plan.weekStart);
  if (plan.weekStart !== range.startDate || plan.weekEnd !== range.endDate) return false;
  for (const [dateKey, day] of Object.entries(plan.days)) {
    if (!validateDay(dateKey, day)) return false;
    if (day.weekday !== weekdayForDate(dateKey)) return false;
  }
  return true;
}
export function validateWeeklyPlansDocument(document) {
  if (!isObject(document)) return false;
  if (document.schemaVersion !== WEEKLY_PLAN_SCHEMA_VERSION) return false;
  if (!isObject(document.app)) return false;
  if (document.app.name !== 'Study Timer') return false;
  if (document.app.dataFormat !== WEEKLY_PLAN_DATA_FORMAT) return false;
  if (!isIsoTimestamp(document.app.createdAt)) return false;
  if (!isIsoTimestamp(document.app.updatedAt)) return false;
  if (typeof document.app.timeZone !== 'string') return false;
  if (!Array.isArray(document.plans)) return false;
  const ids = new Set();
  for (const plan of document.plans) {
    if (!validateWeeklyPlan(plan)) return false;
    if (ids.has(plan.id)) return false;
    ids.add(plan.id);
  }
  return true;
}
export function getWeeklyPlansValidationErrors(document) {
  const errors = [];
  if (!isObject(document)) return ['Root must be an object'];
  if (document.schemaVersion !== WEEKLY_PLAN_SCHEMA_VERSION)
    errors.push(`schemaVersion must be ${WEEKLY_PLAN_SCHEMA_VERSION}`);
  if (!isObject(document.app)) {
    errors.push('app must be an object');
  } else {
    if (document.app.name !== 'Study Timer') errors.push('app.name must be "Study Timer"');
    if (document.app.dataFormat !== WEEKLY_PLAN_DATA_FORMAT)
      errors.push(`app.dataFormat must be "${WEEKLY_PLAN_DATA_FORMAT}"`);
    if (!isIsoTimestamp(document.app.createdAt))
      errors.push('app.createdAt must be a valid ISO timestamp');
    if (!isIsoTimestamp(document.app.updatedAt))
      errors.push('app.updatedAt must be a valid ISO timestamp');
  }
  if (!Array.isArray(document.plans)) {
    errors.push('plans must be an array');
    return errors;
  }
  const ids = new Set();
  document.plans.forEach((plan, planIndex) => {
    const prefix = `plans[${planIndex}]`;
    if (!isObject(plan)) {
      errors.push(`${prefix} must be an object`);
      return;
    }
    if (!isNonEmptyString(plan.id)) {
      errors.push(`${prefix}.id is required`);
    } else if (ids.has(plan.id)) {
      errors.push(`${prefix}.id is duplicated: ${plan.id}`);
    } else {
      ids.add(plan.id);
    }
    if (!isDateKey(plan.weekStart)) errors.push(`${prefix}.weekStart is invalid`);
    if (!isDateKey(plan.weekEnd)) errors.push(`${prefix}.weekEnd is invalid`);
    if (typeof plan.title !== 'string') errors.push(`${prefix}.title must be a string`);
    if (typeof plan.phase !== 'string') errors.push(`${prefix}.phase must be a string`);
    if (!isNonNegativeInteger(plan.targetMinutes))
      errors.push(`${prefix}.targetMinutes must be a non-negative integer`);
    if (!isObject(plan.days)) {
      errors.push(`${prefix}.days must be an object`);
      return;
    }
    for (const [dateKey, day] of Object.entries(plan.days)) {
      const dayPrefix = `${prefix}.days.${dateKey}`;
      if (!isDateKey(dateKey)) {
        errors.push(`${dayPrefix}: invalid date key`);
        continue;
      }
      if (!isObject(day)) {
        errors.push(`${dayPrefix} must be an object`);
        continue;
      }
      if (day.weekday !== weekdayForDate(dateKey))
        errors.push(`${dayPrefix}.weekday must be ${weekdayForDate(dateKey)}`);
      if (typeof day.title !== 'string' && day.title !== null)
        errors.push(`${dayPrefix}.title must be a string or null`);
      if (!Array.isArray(day.sessions)) {
        errors.push(`${dayPrefix}.sessions must be an array`);
      } else {
        day.sessions.forEach((session, sessionIndex) => {
          const sessionPrefix = `${dayPrefix}.sessions[${sessionIndex}]`;
          if (!isObject(session)) {
            errors.push(`${sessionPrefix} must be an object`);
            return;
          }
          if (!isNonEmptyString(session.subject))
            errors.push(`${sessionPrefix}.subject is required`);
          if (!isNonNegativeInteger(session.minutes))
            errors.push(`${sessionPrefix}.minutes must be a non-negative integer`);
          if (!WEEKLY_PLAN_ACTIVITY_TYPES.includes(session.type))
            errors.push(`${sessionPrefix}.type is invalid`);
          if (typeof session.practice !== 'boolean')
            errors.push(`${sessionPrefix}.practice must be boolean`);
        });
      }
      if (typeof day.note !== 'string') errors.push(`${dayPrefix}.note must be a string`);
    }
  });
  return errors;
}
export function migrateWeeklyPlansData(raw) {
  if (!isObject(raw)) throw new Error(INVALID_WEEKLY_PLANS_MESSAGE);
  if (raw.schemaVersion === WEEKLY_PLAN_SCHEMA_VERSION) return raw;
  throw new Error(`Unsupported weekly plans schema version: ${raw.schemaVersion}`);
}
export function serializeWeeklyPlansDocument(document) {
  if (!validateWeeklyPlansDocument(document)) {
    const errors = getWeeklyPlansValidationErrors(document);
    throw new Error(`${INVALID_WEEKLY_PLANS_MESSAGE}: ${errors.join('; ')}`);
  }
  const output = clone(document);
  output.app.updatedAt = nowIso();
  output.app.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return JSON.stringify(output, null, 2) + '\n';
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
  if (!validateWeeklyPlansDocument(migrated)) {
    const errors = getWeeklyPlansValidationErrors(migrated);
    throw new Error(`${INVALID_WEEKLY_PLANS_MESSAGE}: ${errors.join('; ')}`);
  }
  return migrated;
}
export function plannedTotalMinutes(plan) {
  if (!plan || !isObject(plan.days)) return 0;
  let total = 0;
  for (const day of Object.values(plan.days)) {
    if (!Array.isArray(day.sessions)) continue;
    for (const session of day.sessions) total += Number(session.minutes) || 0;
  }
  return total;
}
export function plannedTotalsByActivity(plan) {
  const totals = { study: 0, practice: 0, review: 0, test: 0 };
  if (!plan || !isObject(plan.days)) return totals;
  for (const day of Object.values(plan.days)) {
    if (!Array.isArray(day.sessions)) continue;
    for (const session of day.sessions) {
      if (Object.prototype.hasOwnProperty.call(totals, session.type)) {
        totals[session.type] += Number(session.minutes) || 0;
      }
    }
  }
  return totals;
}
export function findPlanForDate(plans, dateKey) {
  if (!Array.isArray(plans) || !isDateKey(dateKey)) return null;
  return plans.find((plan) => plan && plan.weekStart <= dateKey && plan.weekEnd >= dateKey) || null;
}
export function findPlanById(plans, planId) {
  if (!Array.isArray(plans) || !isNonEmptyString(planId)) return null;
  return plans.find((plan) => plan && plan.id === planId) || null;
}
export function getSessionsForDate(plan, dateKey) {
  if (!plan || !isObject(plan.days) || !isDateKey(dateKey)) return [];
  const day = plan.days[dateKey];
  return day && Array.isArray(day.sessions) ? day.sessions : [];
}
export function getPlanDay(plan, dateKey) {
  if (!plan || !isObject(plan.days) || !isDateKey(dateKey)) return null;
  return plan.days[dateKey] || null;
}
export function hasPlanDay(plan, dateKey) {
  return Boolean(getPlanDay(plan, dateKey));
}
export function getSortedPlanDays(plan) {
  if (!plan || !isObject(plan.days)) return [];
  return Object.entries(plan.days)
    .map(([date, day]) => ({ date, ...day }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
