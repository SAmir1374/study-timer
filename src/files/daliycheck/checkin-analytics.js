/* =============================================================
   checkin-analytics.js — صفحه‌ی تحلیل چک‌این روزانه (اسکیمای v4)
   ============================================================= */

import { parseCheckinDocument, CheckinDataError } from "./dailyCheckinData.js";
import { MEALS, foodTags, foodLabel } from "./foodCatalog.js";
import { FileStorage } from "../fileStorage.js";

const LOCAL_BACKUP_KEY = "study-timer:daily-checkins-backup";
const HANDLE_KEY = "study-timer:daily-checkins-handle";

/* ---------- تنظیمات الگوریتم ---------- */
const DAY_MS = 86400000;
const RECENT_DAYS = 7;        // پنجره‌ی «وضعیت فعلی»
const BASELINE_DAYS = 35;     // پنجره‌ی خط پایه‌ی شخصی (قبل از پنجره‌ی فعلی)
const BASELINE_MIN_RECENT = 4;
const BASELINE_MIN_BASE = 14;
const SD_FLOOR = 0.7;         // حداقل نوسان مبنا (مقیاس ۱–۱۰)
const DEV_WARN = 0.8;         // انحراف (به واحد SD روزانه) برای هشدار زرد
const DEV_DANGER = 1.3;       // انحراف برای هشدار قرمز
const MIN_COVERAGE_7 = 5;     // حداقل روزِ کامل از ۷ روز برای قاعده‌های هفتگی
const MIN_CORR_N = 20;        // حداقل جفت‌داده برای همبستگی
const CORR_SIG_K = 2.5;       // آستانه‌ی محافظه‌کارانه: |r| ≥ K/√n
const CORR_SHOW = 14;         // حداکثر ردیف همبستگی نمایش‌داده‌شده
const MIN_GROUP_N = 5;        // حداقل روز در هر گروه برای مقایسه
const SIG_T = 2.5;            // آستانه‌ی |t| (Welch) برای «قابل‌اتکا»
const SIG_MIN_N = 8;          // حداقل نمونه در هر گروه برای «قابل‌اتکا»

const BASELINE_METRICS = [
  { key: "score",        label: "امتیاز روانی کلی", bad: "low" },
  { key: "mood",         label: "خلق",              bad: "low" },
  { key: "stress",       label: "استرس",            bad: "high" },
  { key: "anxiety",      label: "اضطراب",           bad: "high" },
  { key: "focus",        label: "تمرکز",            bad: "low" },
  { key: "energy",       label: "انرژی",            bad: "low" },
  { key: "sleepHours",   label: "ساعت خواب",        bad: "low" },
  { key: "sleepQuality", label: "کیفیت خواب",       bad: "low" },
  { key: "sleepLatency", label: "زمان به خواب رفتن", bad: "high", floor: 8, unit: " دقیقه" },
];

/* معیارهای مقایسه‌ی گروه‌ها (lag:1 = ورودی روز بعد، یعنی «شب بعد / فردا») */
const M_DAY = [
  { key: "mood",      label: "خلق",           higherBetter: true },
  { key: "focus",     label: "تمرکز",         higherBetter: true },
  { key: "anxiety",   label: "اضطراب",        higherBetter: false },
  { key: "stress",    label: "استرس",         higherBetter: false },
  { key: "energy",    label: "انرژی",         higherBetter: true },
  { key: "dayRating", label: "امتیاز روز",    higherBetter: true },
];
const M_NIGHT = [
  { key: "sleepLatency", label: "زمان به خواب رفتن شب بعد (دقیقه)", higherBetter: false, lag: 1 },
  { key: "awakenings",   label: "بیداری شبانه‌ی شب بعد",            higherBetter: false, lag: 1 },
  { key: "sleepQuality", label: "کیفیت خواب شب بعد",                higherBetter: true,  lag: 1 },
  { key: "restedness",   label: "احساس استراحت صبح بعد",            higherBetter: true,  lag: 1 },
  { key: "sleepHours",   label: "ساعت خواب شب بعد",                 higherBetter: true,  lag: 1 },
];
const pickMetrics = (list, keys) => list.filter((m) => keys.includes(m.key));

let doc = null;
let allEntries = [];      // مرتب‌شده صعودی بر اساس تاریخ
let visibleEntries = [];  // بعد از فیلتر بازه

const $ = (id) => document.getElementById(id);

/* ============================================================
   Date helpers (همه محلی؛ بدون toISOString)
   ============================================================ */

const pad2 = (n) => String(n).padStart(2, "0");

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "YYYY-MM-DD" → شماره‌ی روز (مستقل از منطقه‌ی زمانی)
function keyToNum(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function numToKey(n) {
  const t = new Date(n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function fmtHour(h) {
  const total = Math.round(h * 60);
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

/* آخرین روزی که چک‌این شبِ آن ثبت شده (روز «کامل») */
function lastFullNum() {
  for (let i = allEntries.length - 1; i >= 0; i--) if (allEntries[i].eve) return allEntries[i].dayNum;
  return allEntries[allEntries.length - 1].dayNum;
}

/* آخرین روزی که تحلیل‌ها تا آن حساب می‌شوند: اگر آخرین روز کامل امروز/دیروز بود همان،
   وگرنه امروز (تا شکاف داده در تحلیل دیده شود) */
function getAnchor() {
  const todayNum = keyToNum(todayKey());
  const lastNum = lastFullNum();
  return todayNum - lastNum <= 1 ? lastNum : todayNum;
}

function inWindow(entries, anchor, days) {
  return entries.filter((d) => d.dayNum > anchor - days && d.dayNum <= anchor);
}

/* ============================================================
   Load
   ============================================================ */

function setDoc(d) {
  doc = d;
  allEntries = normalizeEntries(d.entries);
}

function readBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return null;
    return { doc: parseCheckinDocument(raw), text: raw };
  } catch (err) {
    console.warn("Backup load failed:", err);
    return null;
  }
}

async function readRemembered() {
  try {
    const h = await FileStorage.loadHandle(HANDLE_KEY);
    if (!h) return null;
    if (!(await FileStorage.ensurePermission(h, false))) return null;
    const text = await FileStorage.readText(h);
    if (!text.trim()) return null;
    return { doc: parseCheckinDocument(text), text };
  } catch (err) {
    console.warn("Auto-connect failed:", err);
    return null;
  }
}

const updatedMs = (src) => (src ? Date.parse(src.doc.updatedAt) || 0 : -1);

/* فقط وقتی فایل جدیدتر یا مساوی است، بکاپ برنامه‌ی اصلی را به‌روز می‌کنیم */
function maybeUpdateBackup(src, backup) {
  if (updatedMs(src) < updatedMs(backup)) return;
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, src.text);
  } catch {}
}

async function init() {
  bindEvents();

  const backup = readBackup();
  const file = await readRemembered();

  // هر کدام جدیدتر بود
  let best = null;
  if (backup && file) best = updatedMs(file) > updatedMs(backup) ? file : backup;
  else best = file || backup;

  if (best) {
    if (best === file) maybeUpdateBackup(file, backup);
    setDoc(best.doc);
  }
  render();
}

function errorDetail(err) {
  if (err instanceof CheckinDataError) return err.details?.[0] || err.message;
  return err?.message || String(err);
}

async function connectFile() {
  try {
    const h = await FileStorage.pickOpenFile();
    await FileStorage.saveHandle(h, HANDLE_KEY);
    const text = await FileStorage.readText(h);
    if (!text.trim()) return;
    const src = { doc: parseCheckinDocument(text), text };
    maybeUpdateBackup(src, readBackup());
    setDoc(src.doc);
    render();
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.error(err);
      alert("خطا در باز کردن فایل: " + errorDetail(err));
    }
  }
}

/* ایمپورت فقط برای نمایش است و بکاپ برنامه‌ی اصلی را تغییر نمی‌دهد */
async function importFile(file) {
  try {
    const text = await file.text();
    setDoc(parseCheckinDocument(text));
    render();
  } catch (err) {
    console.error(err);
    alert("فایل نامعتبر است: " + errorDetail(err));
  }
}

/* ============================================================
   Normalize
   مقدار فیلدهای «شب» وقتی چک‌این شب ثبت نشده، null (نامشخص) است،
   نه false/۰.
   ============================================================ */

function numOr(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hourToNum(t) {
  if (!t || typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return h + (m || 0) / 60;
}

function normalizeEntries(raw) {
  const list = raw
    .map((e) => {
      const mor = !!e.slots?.morning;
      const eve = !!e.slots?.evening;

      const bedTime = e.sleep?.bedTime ?? null;
      const bedHour = hourToNum(bedTime);

      const routineDone = mor ? !!e.relaxationRoutine?.done : null;

      // قرص
      const med = e.medication || {};
      const am = med.morning || {};
      const pm = med.afternoon || {};
      const medKnown = !!med.recorded;
      const medAm = medKnown ? !!am.taken : null;
      const medPm = medKnown && eve ? !!pm.taken : null;
      const medDay = medKnown && eve ? !!am.taken || !!pm.taken : null;

      // محتوای تحریک‌آمیز
      const x = e.explicit || {};
      const xKnown = eve && !!x.recorded;

      // غذا
      const food = e.food || {};
      const foodLogged = eve && !!food.logged;
      const log = food.log || {};
      const foodIds = foodLogged ? MEALS.flatMap((m) => log[m.id] || []) : [];
      const countTags = (tags) => foodIds.filter((id) => foodTags(id).some((t) => tags.includes(t))).length;

      const exerciseDone = eve ? !!e.exercise?.done : null;
      const mastPos = eve ? !!e.masturbation?.positive?.done : null;
      const mastNeg = eve ? !!e.masturbation?.negative?.done : null;

      const o = {
        date: e.date,
        dayNum: keyToNum(e.date),
        mor,
        eve,

        // خواب
        bedTime,
        wakeTime: e.sleep?.wakeTime ?? null,
        // ساعت خواب بعد از نیمه‌شب (مثلاً ۰۱:۰۰) = ۲۵ تا نوسان درست حساب شود
        bedNum: bedHour == null ? null : bedHour < 12 ? bedHour + 24 : bedHour,
        wakeNum: hourToNum(e.sleep?.wakeTime),
        sleepHours: numOr(e.sleep?.hours),
        sleepQuality: numOr(e.sleep?.quality),
        sleepLatency: numOr(e.sleep?.latencyMin),
        awakenings: numOr(e.sleep?.awakenings),
        restedness: numOr(e.sleep?.restedness),

        // روتین (اثر فقط وقتی انجام شده معنا دارد)
        routineDone,
        routineEff: routineDone ? numOr(e.relaxationRoutine?.effectiveness) : null,
        routineSteps: routineDone ? numOr(e.relaxationRoutine?.steps) : null,

        // قرص
        medKnown,
        medAm,
        medPm,
        medDay,
        medAmTime: medAm ? hourToNum(am.time) : null,
        medPmTime: medPm ? hourToNum(pm.time) : null,
        medText: medKnown ? (medAm ? "ص" : "") + (medAm && medPm ? " + " : "") + (medPm ? "ع" : "") : null,

        // حال صبح (یک جمله‌ای)
        morningMood: numOr(e.morningState?.mood),
        morningEnergy: numOr(e.morningState?.energy),
        morningTension: numOr(e.morningState?.tension),

        // شب (ترکیب چند جمله)
        mood: numOr(e.mood?.rating),
        stress: numOr(e.mood?.stress),
        energy: numOr(e.mood?.energy),
        focus: numOr(e.mood?.focus),
        anxiety: numOr(e.mood?.anxiety),
        dayRating: numOr(e.dayRating),

        activity1: eve ? e.activity1 : null,
        operation1: eve ? e.operation1 : null,

        // روز بدون ورزش/خودارضایی = ۰ (نه «نامشخص»)، به شرط ثبت شب
        exerciseDone,
        exerciseMin: eve ? (exerciseDone ? numOr(e.exercise?.minutes) : 0) : null,
        mastPos,
        mastPosCount: eve ? (mastPos ? numOr(e.masturbation?.positive?.count) ?? 1 : 0) : null,
        mastNeg,
        mastNegCount: eve ? (mastNeg ? numOr(e.masturbation?.negative?.count) ?? 1 : 0) : null,

        explicitViewed: xKnown ? !!x.viewed : null,
        explicitMin: xKnown ? (x.viewed ? numOr(x.minutes) : 0) : null,
        explicitUrge: xKnown ? !!x.viewed && x.driver === "urge" : null,

        // تغذیه
        meals: eve ? numOr(food.meals) : null,
        foodQuality: numOr(food.quality),
        water: eve ? !!food.water : null,
        caffeine: eve ? numOr(food.caffeine) : null,
        foodLogged,
        foodIds,
        fruitCount: foodLogged ? countTags(["fruit"]) : null,
        vegCount: foodLogged ? countTags(["veg"]) : null,
        unhealthyCount: foodLogged ? countTags(["fried", "fastfood", "junk", "sweet"]) : null,
        breakfastLogged: foodLogged ? (log.breakfast || []).length > 0 : null,

        notes: e.notes,
      };
      o.score = computeMentalScore(o);
      return o;
    })
    .sort((a, b) => a.dayNum - b.dayNum);

  // میانگین متحرک ۷ روزه‌ی امتیاز (حداقل ۳ روز داده)
  for (const d of list) {
    const vals = list
      .filter((x) => x.dayNum > d.dayNum - 7 && x.dayNum <= d.dayNum && x.score != null)
      .map((x) => x.score);
    d.scoreMA = vals.length >= 3 ? Math.round(mean(vals) * 10) / 10 : null;
  }
  return list;
}

/* ============================================================
   Stats helpers
   ============================================================ */

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function average(arr, field) {
  const vals = arr.map((e) => e[field]).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return Math.round(mean(vals) * 10) / 10;
}

function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearsonRaw(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den ? num / den : null;
}

function spearman(pairs) {
  const n = pairs.length;
  if (n < MIN_CORR_N) return { r: null, n };
  const r = pearsonRaw(rank(pairs.map((p) => p[0])), rank(pairs.map((p) => p[1])));
  return { r: r == null ? null : Math.round(r * 100) / 100, n };
}

function welch(a, b) {
  const sa = sd(a), sb = sd(b);
  if (sa == null || sb == null) return null;
  const se = Math.sqrt((sa * sa) / a.length + (sb * sb) / b.length);
  return se ? (mean(a) - mean(b)) / se : null;
}

/* مقایسه‌ی دو گروه از روزها روی چند معیار؛ inA/inB باید دقیقاً true برگردانند */
function compareGroups(entries, inA, inB, metrics) {
  const byNum = new Map(entries.map((d) => [d.dayNum, d]));
  const A = entries.filter((d) => inA(d) === true);
  const B = entries.filter((d) => inB(d) === true);
  const rows = [];
  for (const m of metrics) {
    const pick = (grp) =>
      grp
        .map((d) => (m.lag ? byNum.get(d.dayNum + m.lag) : d)?.[m.key])
        .filter((v) => typeof v === "number");
    const a = pick(A);
    const b = pick(B);
    if (a.length < MIN_GROUP_N || b.length < MIN_GROUP_N) continue;
    const diff = mean(a) - mean(b);
    const t = welch(a, b);
    rows.push({
      label: m.label,
      ma: mean(a),
      mb: mean(b),
      na: a.length,
      nb: b.length,
      diff,
      sig: t != null && Math.abs(t) >= SIG_T && a.length >= SIG_MIN_N && b.length >= SIG_MIN_N,
      better: diff > 0 === m.higherBetter,
    });
  }
  return { rows, na: A.length, nb: B.length };
}

/* ============================================================
   Analytics core
   ============================================================ */

function computeMentalScore(d) {
  if (!d.eve) return null; // بدون چک‌این شب، امتیاز روز ساخته نمی‌شود

  const parts = [];
  let evParts = 0; // مؤلفه‌های شب
  if (d.sleepHours != null) {
    let s;
    if (d.sleepHours >= 7 && d.sleepHours <= 9) s = 10;
    else if (d.sleepHours < 7) s = Math.max(1, 10 - (7 - d.sleepHours) * 2);
    else s = Math.max(1, 10 - (d.sleepHours - 9) * 1.5);
    parts.push({ w: 0.12, v: s });
  }
  if (d.sleepQuality != null) parts.push({ w: 0.1, v: d.sleepQuality });
  if (d.restedness != null) parts.push({ w: 0.05, v: d.restedness });
  if (d.mood != null) { parts.push({ w: 0.22, v: d.mood }); evParts++; }
  if (d.stress != null) { parts.push({ w: 0.2, v: 11 - d.stress }); evParts++; }
  if (d.energy != null) { parts.push({ w: 0.12, v: d.energy }); evParts++; }
  if (d.anxiety != null) { parts.push({ w: 0.12, v: 11 - d.anxiety }); evParts++; }
  if (d.focus != null) { parts.push({ w: 0.07, v: d.focus }); evParts++; }

  // با کمتر از ۳ مؤلفه (یا کمتر از ۲ مؤلفه‌ی شب) امتیاز قابل‌اتکا نیست
  if (parts.length < 3 || evParts < 2) return null;
  const tw = parts.reduce((a, p) => a + p.w, 0);
  const s = parts.reduce((a, p) => a + p.w * p.v, 0) / tw;
  return Math.round(s * 10) / 10;
}

function stateLabel(score) {
  if (score == null) return { text: "—", tone: "muted" };
  if (score >= 8.5) return { text: "پایدار و پرانرژی", tone: "good" };
  if (score >= 7)   return { text: "خوب", tone: "good" };
  if (score >= 5.5) return { text: "متوسط", tone: "mid" };
  if (score >= 4)   return { text: "ضعیف — نیاز به توجه", tone: "warn" };
  return { text: "هشدار — نیاز به استراحت", tone: "bad" };
}

function stateHint(score) {
  if (score == null) return "داده‌ی کافی برای تحلیل نیست.";
  if (score >= 8.5) return "خواب، خلق و استرس در محدوده‌ی سالم است. روند فعلی را حفظ کن.";
  if (score >= 7)   return "وضعیت خوب است، ولی جا برای بهبود وجود دارد (کیفیت خواب یا کاهش استرس).";
  if (score >= 5.5) return "روزها متوسط‌اند. به خواب و روتین آرام‌سازی بیشتر توجه کن.";
  if (score >= 4)   return "چند سیگنال ضعیف با هم جمع شده‌اند. یک روز سبک‌تر و خواب بیشتر می‌تواند کمک کند.";
  return "سیستم روانی زیر فشار است. یک روز استراحت واقعی، خواب کافی، و قطع فشارهای غیرضروری توصیه می‌شود.";
}

/* ---------- مقایسه با خط پایه‌ی شخصی ---------- */

function computeDeviations(entries, anchor) {
  const recent = inWindow(entries, anchor, RECENT_DAYS);
  const base = entries.filter(
    (d) => d.dayNum <= anchor - RECENT_DAYS && d.dayNum > anchor - RECENT_DAYS - BASELINE_DAYS
  );
  const out = [];
  for (const m of BASELINE_METRICS) {
    const r = recent.map((d) => d[m.key]).filter((v) => typeof v === "number");
    const b = base.map((d) => d[m.key]).filter((v) => typeof v === "number");
    if (r.length < BASELINE_MIN_RECENT || b.length < BASELINE_MIN_BASE) continue;
    const mr = mean(r);
    const mb = mean(b);
    const sb = Math.max(sd(b) ?? 0, m.floor ?? SD_FLOOR);
    const d = (mr - mb) / sb;
    out.push({ ...m, mr, mb, sb, d, worse: m.bad === "high" ? d : -d });
  }
  return out;
}

/* ---------- هشدارها (بر اساس روز تقویمی) ---------- */

function detectWarnings(entries) {
  const out = [];
  if (!entries.length) return out;
  const push = (text, level) => out.push({ text, level });

  const anchor = getAnchor();
  const todayNum = keyToNum(todayKey());
  const byNum = new Map(entries.map((d) => [d.dayNum, d]));
  const w7 = inWindow(entries, anchor, 7);
  const w7e = w7.filter((d) => d.eve);
  const w7m = w7.filter((d) => d.mor);
  const w14e = inWindow(entries, anchor, 14).filter((d) => d.eve);

  // همه‌ی n روز آخر ثبت شده و شرط برقرار است
  const streak = (n, pred) => {
    for (let i = 0; i < n; i++) {
      const d = byNum.get(anchor - i);
      if (!d || !pred(d)) return false;
    }
    return true;
  };

  /* --- کیفیت داده --- */
  const gap = todayNum - lastFullNum();
  if (gap >= 3) push(`${gap} روز است چک‌این کامل (شب) ثبت نشده؛ تحلیل‌ها بر اساس داده‌ی قدیمی‌اند.`, "warn");
  else if (w14e.length < 9) push(`فقط ${w14e.length} روز از ۱۴ روز اخیر کامل ثبت شده؛ دقت تحلیل پایین است.`, "warn");

  /* --- الگوهای پیاپی (روزهای متوالیِ واقعی) --- */
  if (streak(3, (d) => d.stress != null && d.stress >= 7))
    push("۳ روز پیوسته استرس بالا (۷+) — نشانه‌ی فشار انباشته.", "danger");
  if (streak(3, (d) => d.sleepHours != null && d.sleepHours < 6))
    push("۳ روز پیوسته کمتر از ۶ ساعت خواب.", "danger");
  if (streak(3, (d) => d.mood != null && d.mood <= 4))
    push("۳ روز پیوسته خلق پایین (۴ یا کمتر).", "danger");
  if (streak(3, (d) => d.anxiety != null && d.anxiety >= 7))
    push("۳ روز پیوسته اضطراب بالا (۷+).", "danger");

  /* --- خلق پایینِ پایدار --- */
  if (w14e.length >= 10) {
    const low = w14e.filter((d) => d.mood != null && d.mood <= 4).length;
    if (low >= 7) {
      push(
        `خلق پایین در ${low} روز از ۱۴ روز اخیر. اگر این وضعیت ادامه دارد، صحبت با مشاور یا روان‌شناس منطقی است (این ابزار تشخیص نیست).`,
        "danger"
      );
    }
  }

  /* --- قاعده‌های هفتگی (فقط با پوشش کافی) --- */
  if (w7e.length >= MIN_COVERAGE_7) {
    const urge = w7e.filter((d) => d.mastNeg || d.explicitUrge).length;
    if (urge >= 3) {
      push(
        `رفتارهای فشار-محور (خودارضایی منفی یا محتوای تحریک‌آمیز از روی اجبار) در ${urge} روز از ${w7e.length} روز کامل هفته‌ی اخیر — نشانه‌ی فشار روانی.`,
        "danger"
      );
    }

    const exDays = w7e.filter((d) => d.exerciseDone).length;
    if (exDays <= 1) push(`ورزش فقط ${exDays} بار در ${w7e.length} روز ثبت‌شده‌ی هفته‌ی اخیر.`, "warn");

    const foodDays = w7e.filter((d) => d.foodQuality != null);
    const foodAvg = average(foodDays, "foodQuality");
    if (foodAvg != null && foodDays.length >= 4 && foodAvg < 5) {
      push(`میانگین کیفیت تغذیه در هفته‌ی اخیر ${foodAvg}/۱۰ — پایین.`, "warn");
    }

    const waterDays = w7e.filter((d) => d.water).length;
    if (waterDays <= 2) push("آب کافی در بیشتر روزهای هفته‌ی اخیر مصرف نشده.", "warn");
  }

  if (w7m.length >= MIN_COVERAGE_7) {
    const routineDays = w7m.filter((d) => d.routineDone).length;
    if (routineDays <= 2) push("روتین آرام‌سازی در بیشتر روزهای اخیر انجام نشده.", "warn");
  }

  /* --- نظم خواب --- */
  const beds = w7.map((d) => d.bedNum).filter((v) => v != null);
  if (beds.length >= 4) {
    const spread = Math.round(sd(beds) * 60);
    if (spread > 90) push(`ساعت خواب بین شب‌ها نامنظم است (نوسان حدود ${spread} دقیقه).`, "warn");
  }

  /* --- انحراف از الگوی شخصی خودت --- */
  for (const x of computeDeviations(entries, anchor)) {
    if (x.worse < DEV_WARN) continue;
    const u = x.unit || "";
    push(
      `${x.label} نسبت به الگوی معمول خودت بدتر شده: میانگین ۷ روز اخیر ${x.mr.toFixed(1)}${u} در برابر معمول ${x.mb.toFixed(1)}${u}.`,
      x.worse >= DEV_DANGER ? "danger" : "warn"
    );
  }

  return out.sort((a, b) => (a.level === "danger" ? 0 : 1) - (b.level === "danger" ? 0 : 1));
}

/* ---------- همبستگی‌ها ---------- */

const CORR_DEFS = [
  // خواب → همان روز
  { label: "ساعت خواب × خلق همان روز",               x: "sleepHours",     y: "mood",         lag: 0 },
  { label: "ساعت خواب × استرس همان روز",             x: "sleepHours",     y: "stress",       lag: 0 },
  { label: "کیفیت خواب × خلق همان روز",               x: "sleepQuality",   y: "mood",         lag: 0 },
  { label: "ساعت خواب × تمرکز همان روز",             x: "sleepHours",     y: "focus",        lag: 0 },
  { label: "احساس استراحت صبح × تمرکز همان روز",     x: "restedness",     y: "focus",        lag: 0 },
  { label: "اثر روتین × کیفیت خوابِ همان شب",        x: "routineEff",     y: "sleepQuality", lag: 0 },
  { label: "اثر روتین × خلق",                         x: "routineEff",     y: "mood",         lag: 0 },
  // روز → شب بعد
  { label: "استرس امروز × کیفیت خواب شب بعد",         x: "stress",         y: "sleepQuality", lag: 1 },
  { label: "استرس امروز × ساعت خواب شب بعد",          x: "stress",         y: "sleepHours",   lag: 1 },
  { label: "اضطراب امروز × زمان به خواب رفتن شب بعد", x: "anxiety",        y: "sleepLatency", lag: 1 },
  { label: "اضطراب امروز × کیفیت خواب شب بعد",        x: "anxiety",        y: "sleepQuality", lag: 1 },
  { label: "کافئین امروز × زمان به خواب رفتن شب بعد", x: "caffeine",       y: "sleepLatency", lag: 1 },
  { label: "کافئین × اضطراب همان روز",                x: "caffeine",       y: "anxiety",      lag: 0 },
  { label: "ورزش × خلق همان روز",                     x: "exerciseMin",    y: "mood",         lag: 0 },
  { label: "ورزش امروز × کیفیت خواب شب بعد",          x: "exerciseMin",    y: "sleepQuality", lag: 1 },
  { label: "ساعت قرص عصر × زمان به خواب رفتن شب بعد", x: "medPmTime",      y: "sleepLatency", lag: 1 },
  { label: "ساعت قرص عصر × کیفیت خواب شب بعد",        x: "medPmTime",      y: "sleepQuality", lag: 1 },
  // رفتارها
  { label: "خودارضایی منفی × استرس همان روز",         x: "mastNegCount",   y: "stress",       lag: 0 },
  { label: "خودارضایی منفی × خلق همان روز",           x: "mastNegCount",   y: "mood",         lag: 0 },
  { label: "خودارضایی منفی امروز × خلق فردا",         x: "mastNegCount",   y: "mood",         lag: 1 },
  { label: "دقایق محتوای تحریک‌آمیز × استرس همان روز", x: "explicitMin",    y: "stress",       lag: 0 },
  { label: "دقایق محتوای تحریک‌آمیز × کیفیت خواب شب بعد", x: "explicitMin", y: "sleepQuality", lag: 1 },
  { label: "دقایق محتوای تحریک‌آمیز × خلق فردا",      x: "explicitMin",    y: "mood",         lag: 1 },
  // تغذیه
  { label: "کیفیت تغذیه × خلق همان روز",              x: "foodQuality",    y: "mood",         lag: 0 },
  { label: "تعداد میوه × خلق همان روز",               x: "fruitCount",     y: "mood",         lag: 0 },
  { label: "تعداد سبزی/سالاد × انرژی همان روز",       x: "vegCount",       y: "energy",       lag: 0 },
  { label: "خوراکی ناسالم × انرژی همان روز",          x: "unhealthyCount", y: "energy",       lag: 0 },
  { label: "امتیاز روز × خلق فردا",                    x: "dayRating",      y: "mood",         lag: 1 },
];

function computeCorrelations(entries) {
  const byNum = new Map(entries.map((d) => [d.dayNum, d]));
  const out = [];
  for (const def of CORR_DEFS) {
    const pairs = [];
    for (const d of entries) {
      const o = def.lag === 0 ? d : byNum.get(d.dayNum + def.lag);
      const x = d[def.x];
      const y = o?.[def.y];
      if (typeof x === "number" && typeof y === "number") pairs.push([x, y]);
    }
    const { r, n } = spearman(pairs);
    if (r == null) continue;
    out.push({ label: def.label, v: r, n, sig: Math.abs(r) >= CORR_SIG_K / Math.sqrt(n) });
  }
  return out;
}

/* ============================================================
   Render
   ============================================================ */

function render() {
  if (!doc || !allEntries.length) {
    $("caEmpty").hidden = false;
    $("caContent").hidden = true;
    $("caCount").textContent = "—";
    return;
  }

  const anchor = getAnchor();
  const range = Number($("caRangeSelect").value) || 0;
  visibleEntries = range > 0 ? allEntries.filter((d) => d.dayNum > anchor - range) : allEntries;

  $("caEmpty").hidden = true;
  $("caContent").hidden = false;
  const cov14 = inWindow(allEntries, anchor, 14).filter((d) => d.eve).length;
  $("caCount").textContent =
    `${allEntries.length} روز ثبت‌شده — نمایش ${visibleEntries.length} روز — چک‌این کامل ۱۴ روز اخیر: ${cov14}/۱۴`;

  renderSummary();
  renderState();
  renderWarnings();
  renderSleepChart();
  renderMoodChart();
  renderSwing();
  renderMedication();
  renderExplicit();
  renderFood();
  renderBehaviors();
  renderCorrelations();
  renderHeatmap();
  renderTable();
}

/* ---------- پنل‌های داینامیک (بالای پنل همبستگی‌ها) ---------- */

function setPanel(id, title, html) {
  let p = $(id);
  if (!p) {
    p = document.createElement("section");
    p.className = "ca-panel";
    p.id = id;
    p.innerHTML = `<h2 class="ca-panel__title">${title}</h2><div class="ca-panel__body"></div>`;
    const anchor = $("caCorr")?.closest(".ca-panel");
    if (anchor) anchor.before(p);
    else $("caContent").appendChild(p);
  }
  p.querySelector(".ca-panel__body").innerHTML = html;
  return p;
}

const behaviorCard = (label, value, unit = "", extra = "") => `
  <div class="ca-behavior">
    <div class="ca-behavior__label">${label}</div>
    <div class="ca-behavior__value">${value}${unit ? `<small> ${unit}</small>` : ""}</div>
    ${extra}
  </div>`;

const cardsGrid = (cards) => `<div class="ca-behaviors">${cards.join("")}</div>`;
const subTitle = (t) =>
  `<div class="ca-card__label" style="margin:16px 0 8px;font-weight:600;color:var(--ca-text)">${t}</div>`;

/* ---------- جدول مقایسه‌ی دو گروه ---------- */

function renderCompare(title, comp, la, lb) {
  let html = subTitle(title);
  if (!comp.rows.length) {
    return (
      html +
      `<p class="ca-hint">داده‌ی کافی نیست: ${la} ${comp.na} روز، ${lb} ${comp.nb} روز (حداقل ${MIN_GROUP_N} روز با داده‌ی همان معیار در هر گروه لازم است).</p>`
    );
  }
  html += `<div class="ca-corr">`;
  html += comp.rows
    .map((r) => {
      const col = r.better ? "var(--ca-good)" : "var(--ca-bad)";
      return `
      <div class="ca-corr-row" style="${r.sig ? "" : "opacity:0.55"}">
        <div class="ca-corr-row__label">${r.label}</div>
        <div style="display:flex;gap:12px;align-items:center;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap">
          <span>${la} ${r.ma.toFixed(1)} <small style="color:var(--ca-muted)">(n=${r.na})</small></span>
          <span>${lb} ${r.mb.toFixed(1)} <small style="color:var(--ca-muted)">(n=${r.nb})</small></span>
          <b style="color:${col};min-width:44px;text-align:center">${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}</b>
        </div>
      </div>`;
    })
    .join("");
  return html + `</div>`;
}

const COMPARE_HINT = `<p class="ca-hint">Δ = گروه اول منهای گروه دوم؛ سبز یعنی به نفع وضعیت بهتر. ردیف‌های کم‌رنگ هنوز قابل‌اتکا نیستند (آزمون تقریبی و محافظه‌کارانه). مقایسه‌ها روی کل تاریخچه است. این‌ها رابطه‌اند، نه علت.</p>`;

/* ---------- summary cards ---------- */

function renderSummary() {
  const e = visibleEntries;
  const avgSleep = average(e, "sleepHours");
  const avgMood = average(e, "mood");
  const avgStress = average(e, "stress");
  const avgAnxiety = average(e, "anxiety");
  const avgFocus = average(e, "focus");
  const avgEnergy = average(e, "energy");
  const avgQuality = average(e, "sleepQuality");
  const avgLatency = average(e, "sleepLatency");

  const beds = e.map((d) => d.bedNum).filter((v) => v != null);
  const bedSpread = beds.length >= 4 ? Math.round(sd(beds) * 60) : null;

  const hiBad = (v) => (v == null ? null : v >= 6 ? "bad" : v <= 4 ? "good" : null);

  const cards = [
    { label: "میانگین خواب", value: avgSleep, unit: "ساعت", sub: `کیفیت ${avgQuality ?? "—"}/۱۰` },
    { label: "میانگین خلق", value: avgMood, unit: "/۱۰" },
    { label: "میانگین استرس", value: avgStress, unit: "/۱۰", tone: hiBad(avgStress) },
    { label: "میانگین اضطراب", value: avgAnxiety, unit: "/۱۰", tone: hiBad(avgAnxiety) },
    { label: "میانگین تمرکز", value: avgFocus, unit: "/۱۰" },
    { label: "میانگین انرژی", value: avgEnergy, unit: "/۱۰" },
    { label: "زمان به خواب رفتن", value: avgLatency, unit: "دقیقه" },
    {
      label: "نوسان ساعت خواب", value: bedSpread, unit: "دقیقه",
      tone: bedSpread == null ? null : bedSpread > 75 ? "bad" : bedSpread < 45 ? "good" : null,
    },
  ];

  $("caSummary").innerHTML = cards
    .map(
      (c) => `
    <div class="ca-card">
      <div class="ca-card__label">${c.label}</div>
      <div class="ca-card__value" style="${c.tone === "bad" ? "color:var(--ca-bad)" : c.tone === "good" ? "color:var(--ca-good)" : ""}">
        ${c.value ?? "—"}${c.value != null ? `<small>${c.unit}</small>` : ""}
      </div>
      ${c.sub ? `<div class="ca-card__sub">${c.sub}</div>` : ""}
    </div>`
    )
    .join("");
}

/* ---------- mental state gauge ---------- */

function renderState() {
  const anchor = getAnchor();
  const recent = inWindow(allEntries, anchor, 7).filter((d) => d.score != null);
  const prev = allEntries.filter((d) => d.score != null && d.dayNum <= anchor - 7 && d.dayNum > anchor - 14);

  if (recent.length < 3) {
    $("caGauge").innerHTML = "";
    $("caStateLabel").textContent = "—";
    $("caStateLabel").style.color = "var(--ca-text)";
    $("caStateTrend").textContent = "داده‌ی کافی نیست (حداقل ۳ روز چک‌این کامل در ۷ روز اخیر لازم است).";
    $("caStateHint").textContent = "";
    return;
  }

  const cur = mean(recent.map((d) => d.score));
  const prevAvg = prev.length >= 3 ? mean(prev.map((d) => d.score)) : null;

  const label = stateLabel(cur);
  $("caStateLabel").textContent = label.text;
  $("caStateLabel").style.color =
    label.tone === "good" ? "var(--ca-good)"
    : label.tone === "bad" || label.tone === "warn" ? "var(--ca-bad)"
    : label.tone === "mid" ? "var(--ca-warn)"
    : "var(--ca-text)";

  let trendText = "داده‌ی مقایسه‌ای کافی نیست.";
  if (prevAvg != null) {
    const diff = Math.round((cur - prevAvg) * 10) / 10;
    const arrow = diff > 0.3 ? "▲" : diff < -0.3 ? "▼" : "◀▶";
    const word = diff > 0.3 ? "بهبود" : diff < -0.3 ? "افت" : "پایدار";
    trendText = `${arrow} ${word} نسبت به هفته‌ی قبل (${diff > 0 ? "+" : ""}${diff})`;
  }
  const dev = computeDeviations(allEntries, anchor).find((x) => x.key === "score");
  if (dev) {
    const delta = Math.round((dev.mr - dev.mb) * 10) / 10;
    trendText += ` — نسبت به سطح معمول خودت (${dev.mb.toFixed(1)}): ${delta > 0 ? "+" : ""}${delta}`;
  }
  $("caStateTrend").textContent = trendText;

  let hint = stateHint(cur);
  if (recent.length < MIN_COVERAGE_7) hint += ` (اعتبار پایین: فقط ${recent.length} از ۷ روز کامل ثبت شده)`;
  $("caStateHint").textContent = hint;

  // gauge svg
  const pct = Math.max(0, Math.min(1, (cur - 1) / 9)); // 1..10 → 0..1
  const angle = -90 + pct * 180; // -90 (چپ) تا +90 (راست)

  const color =
    cur >= 7 ? "var(--ca-good)"
    : cur >= 5.5 ? "var(--ca-warn)"
    : "var(--ca-bad)";

  const cx = 110, cy = 100, r = 80;

  $("caGauge").innerHTML = `
    <svg viewBox="0 0 220 130">
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="hsl(0,70%,50%)" />
          <stop offset="50%"  stop-color="hsl(45,80%,55%)" />
          <stop offset="100%" stop-color="hsl(120,55%,48%)" />
        </linearGradient>
      </defs>
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="url(#gaugeGrad)" stroke-width="14"
            stroke-linecap="round" opacity="0.35" />
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="url(#gaugeGrad)" stroke-width="14"
            stroke-linecap="round"
            stroke-dasharray="${(pct * Math.PI * r).toFixed(1)} ${(Math.PI * r).toFixed(1)}" />
      <g transform="translate(${cx} ${cy}) rotate(${angle})">
        <line x1="0" y1="0" x2="0" y2="${-(r - 12)}" stroke="${color}" stroke-width="3" stroke-linecap="round" />
        <circle r="5" fill="${color}" />
      </g>
      <text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="26" font-weight="700" fill="${color}">
        ${cur.toFixed(1)}
      </text>
      <text x="${cx - r}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="var(--ca-muted)">۱</text>
      <text x="${cx + r}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="var(--ca-muted)">۱۰</text>
    </svg>
  `;
}

/* ---------- warnings ---------- */

function renderWarnings() {
  const w = detectWarnings(allEntries);
  if (!w.length) {
    $("caWarningsPanel").hidden = true;
    return;
  }
  $("caWarningsPanel").hidden = false;
  $("caWarnings").innerHTML = w
    .map((x) => `<div class="ca-warn-item ${x.level === "danger" ? "ca-warn-item--danger" : ""}">${x.text}</div>`)
    .join("");
}

/* ---------- charts ---------- */

function renderSleepChart() {
  const series = [
    { key: "sleepHours",   color: "#6ea8ff", label: "خواب (ساعت)" },
    { key: "sleepQuality", color: "#a78bfa", label: "کیفیت خواب (۱–۱۰)" },
    { key: "restedness",   color: "#22d3ee", label: "احساس استراحت (۱–۱۰)" },
  ];
  const el = $("caSleepChart");
  el.innerHTML = buildLineChart(el, visibleEntries, series, {
    yMin: 0,
    yMax: 12,
    bands: [{ from: 7, to: 9, color: "var(--ca-good)" }], // بازه‌ی سالم خواب
  });
  renderLegend(el, [...series, { color: "var(--ca-good)", label: "بازه‌ی سالم خواب (۷–۹ ساعت)" }]);
}

function renderMoodChart() {
  const series = [
    { key: "mood",    color: "#34d399", label: "خلق" },
    { key: "stress",  color: "#f87171", label: "استرس" },
    { key: "anxiety", color: "#fb923c", label: "اضطراب" },
    { key: "energy",  color: "#fbbf24", label: "انرژی" },
    { key: "scoreMA", color: "#a78bfa", label: "میانگین ۷روزه‌ی امتیاز روانی", dash: "6 4", noDots: true },
  ];
  const el = $("caMoodChart");
  el.innerHTML = buildLineChart(el, visibleEntries, series, { yMin: 1, yMax: 10 });
  renderLegend(el, series);
}

function renderLegend(chartEl, series) {
  let lg = chartEl.nextElementSibling;
  if (!lg || !lg.classList.contains("ca-legend")) {
    lg = document.createElement("div");
    lg.className = "ca-legend";
    chartEl.after(lg);
  }
  lg.innerHTML = series
    .map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.label}</span>`)
    .join("");
}

/* محور X بر اساس تاریخ واقعی؛ در روزهای بدون ثبت خط قطع می‌شود */
function buildLineChart(el, data, series, { yMin = 0, yMax = 10, bands = [] } = {}) {
  if (!data.length) return "";

  const W = Math.max(320, el.clientWidth || 800);
  const H = 220;
  const padL = 34, padR = 12, padT = 14, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const minNum = data[0].dayNum;
  const maxNum = data[data.length - 1].dayNum;
  const span = maxNum - minNum;

  const xAt = (num) => (span === 0 ? padL + innerW / 2 : padL + ((num - minNum) / span) * innerW);
  const clamp = (v) => Math.max(yMin, Math.min(yMax, v));
  const yAt = (v) => padT + innerH - ((clamp(v) - yMin) / (yMax - yMin)) * innerH;

  // bands
  let bandSvg = "";
  for (const b of bands) {
    const y1 = yAt(b.to), y2 = yAt(b.from);
    bandSvg += `<rect x="${padL}" y="${y1}" width="${innerW}" height="${y2 - y1}" fill="${b.color}" opacity="0.1" />`;
  }

  // grid
  const yTicks = 5;
  let grid = "";
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yAt(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--ca-border)" stroke-width="1" opacity="0.5" />`;
    grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--ca-muted)">${Math.round(v)}</text>`;
  }

  // x labels
  let xLabels = "";
  const tickCount = Math.min(6, span + 1);
  for (let i = 0; i < tickCount; i++) {
    const num = minNum + Math.round((span * i) / (tickCount - 1 || 1));
    xLabels += `<text x="${xAt(num)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--ca-muted)">${numToKey(num).slice(5)}</text>`;
  }

  // series
  let lines = "";
  let dots = "";
  for (const s of series) {
    const segs = [];
    let seg = [];
    let prevNum = null;
    for (const d of data) {
      const v = d[s.key];
      if (typeof v !== "number") continue;
      if (prevNum != null && d.dayNum - prevNum > 1) {
        segs.push(seg);
        seg = [];
      }
      seg.push([xAt(d.dayNum), yAt(v)]);
      prevNum = d.dayNum;
    }
    if (seg.length) segs.push(seg);

    for (const sg of segs) {
      if (sg.length > 1) {
        const poly = sg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        lines += `<polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} />`;
      }
      if (!s.noDots) {
        for (const [x, y] of sg) dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${s.color}" />`;
      }
    }
  }

  return `
    <svg viewBox="0 0 ${W} ${H}">
      ${bandSvg}
      ${grid}
      ${xLabels}
      ${lines}
      ${dots}
    </svg>
  `;
}

/* ---------- حال صبح در برابر شب ---------- */

function renderSwing() {
  const e = visibleEntries;
  const has = e.some((d) => d.morningMood != null || d.morningEnergy != null);
  if (!has) {
    setPanel(
      "caSwingPanel",
      "حال صبح در برابر شب",
      `<p class="ca-hint">هنوز داده‌ی «حال صبح» نیست — از چک‌این صبح شروع می‌شود.</p>`
    );
    return;
  }

  const f = (k) => average(e, k) ?? "—";
  const html =
    cardsGrid([
      behaviorCard("حال صبح", f("morningMood"), "/۱۰"),
      behaviorCard("خلق شب", f("mood"), "/۱۰"),
      behaviorCard("انرژی صبح", f("morningEnergy"), "/۱۰"),
      behaviorCard("انرژی شب", f("energy"), "/۱۰"),
      behaviorCard("تنش صبح", f("morningTension"), "/۱۰"),
    ]) +
    `<div class="ca-chart" id="caSwingChart" style="margin-top:14px"></div>` +
    `<p class="ca-hint">حال صبح با یک جمله و خلق/انرژی شب با چند جمله سنجیده می‌شود؛ پس عددها دقیقاً هم‌مقیاس نیستند. روند و فاصله‌ی دو خط را ببین، نه تفاوت دقیق عددها.</p>`;
  setPanel("caSwingPanel", "حال صبح در برابر شب", html);

  const series = [
    { key: "morningMood",   color: "#34d399", dash: "5 4", label: "حال صبح" },
    { key: "mood",          color: "#34d399", label: "خلق شب" },
    { key: "morningEnergy", color: "#fbbf24", dash: "5 4", label: "انرژی صبح" },
    { key: "energy",        color: "#fbbf24", label: "انرژی شب" },
  ];
  const el = $("caSwingChart");
  el.innerHTML = buildLineChart(el, e, series, { yMin: 1, yMax: 10 });
  renderLegend(el, series);
}

/* ---------- قرص ADHD ---------- */

function renderMedication() {
  const e = visibleEntries;
  const rec = e.filter((d) => d.medKnown);
  if (!rec.length) {
    setPanel("caMedPanel", "قرص ADHD", `<p class="ca-hint">هنوز قرصی ثبت نشده — از چک‌این بعدی شروع می‌شود.</p>`);
    return;
  }

  const am = rec.filter((d) => d.medAm).length;
  const pmKnown = e.filter((d) => d.medPm !== null);
  const pm = pmKnown.filter((d) => d.medPm).length;
  const amT = rec.map((d) => d.medAmTime).filter((v) => v != null);
  const pmT = e.map((d) => d.medPmTime).filter((v) => v != null);

  const cards = cardsGrid([
    behaviorCard("روز ثبت‌شده", rec.length, "روز"),
    behaviorCard("قرص صبح", am, `/ ${rec.length} روز`),
    behaviorCard("قرص عصر", pm, `/ ${pmKnown.length} روز`),
    behaviorCard("میانگین ساعت صبح", amT.length ? fmtHour(mean(amT)) : "—"),
    behaviorCard("میانگین ساعت عصر", pmT.length ? fmtHour(mean(pmT)) : "—"),
  ]);

  const day = compareGroups(allEntries, (d) => d.medDay === true, (d) => d.medDay === false, M_DAY);
  const night = compareGroups(allEntries, (d) => d.medPm === true, (d) => d.medPm === false, M_NIGHT);

  setPanel(
    "caMedPanel",
    "قرص ADHD",
    cards +
      renderCompare("همان روز: با قرص در برابر بدون قرص", day, "با قرص", "بدون قرص") +
      renderCompare("خواب شب بعد: بعد از قرص عصر در برابر بدون قرص عصر", night, "با قرص عصر", "بدون") +
      COMPARE_HINT +
      `<p class="ca-hint">ممکن است روزهای سخت‌تر را با قرص بگذرانی، پس تفاوت‌ها الزاماً اثر قرص نیستند. اگر بین قرص عصر و خواب شب بعد الگویی دیدی، با پزشکت در میان بگذار؛ دوز و زمان را خودت تغییر نده.</p>`
  );
}

/* ---------- محتوای تحریک‌آمیز ---------- */

function renderExplicit() {
  const e = visibleEntries;
  const rec = e.filter((d) => d.explicitViewed !== null);
  if (!rec.length) {
    setPanel("caExplicitPanel", "محتوای تحریک‌آمیز", `<p class="ca-hint">هنوز داده‌ای ثبت نشده — از چک‌این شب بعدی شروع می‌شود.</p>`);
    return;
  }

  const viewed = rec.filter((d) => d.explicitViewed);
  const mins = viewed.map((d) => d.explicitMin).filter((v) => v != null);
  const urge = viewed.filter((d) => d.explicitUrge).length;

  const cards = cardsGrid([
    behaviorCard("روزهای دیده‌شده", viewed.length, `/ ${rec.length} روز`),
    behaviorCard("مجموع دقیقه", mins.reduce((a, b) => a + b, 0), "دقیقه"),
    behaviorCard("میانگین در روزهای دیده‌شده", mins.length ? Math.round(mean(mins)) : "—", "دقیقه"),
    behaviorCard(
      "از روی فشار / اجبار",
      urge,
      `/ ${viewed.length} روز`,
      viewed.length
        ? `<div class="ca-behavior__bar"><span style="width:${Math.round((urge / viewed.length) * 100)}%; background:var(--ca-bad)"></span></div>`
        : ""
    ),
  ]);

  const metrics = [
    ...pickMetrics(M_DAY, ["stress", "anxiety", "mood", "focus"]),
    { key: "mood", label: "خلق فردا", higherBetter: true, lag: 1 },
    ...pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"]),
  ];
  const cmp = compareGroups(allEntries, (d) => d.explicitViewed === true, (d) => d.explicitViewed === false, metrics);

  setPanel(
    "caExplicitPanel",
    "محتوای تحریک‌آمیز",
    cards + renderCompare("روز دیدن در برابر روز نبودن", cmp, "دیدم", "ندیدم") + COMPARE_HINT
  );
}

/* ---------- تغذیه ---------- */

function renderFood() {
  const e = visibleEntries.filter((d) => d.foodLogged);
  if (!e.length) {
    setPanel("caFoodPanel", "تغذیه", `<p class="ca-hint">هنوز غذایی ثبت نشده — از چک‌این شب بعدی شروع می‌شود.</p>`);
    return;
  }

  const n = e.length;
  const bfPct = Math.round((e.filter((d) => d.breakfastLogged).length / n) * 100);

  const cards = cardsGrid([
    behaviorCard("روز ثبت‌شده", n, "روز"),
    behaviorCard("وعده‌ی اصلی (میانگین)", average(e, "meals") ?? "—", "در روز"),
    behaviorCard("میوه", average(e, "fruitCount") ?? "—", "بار در روز"),
    behaviorCard("سبزی / سالاد", average(e, "vegCount") ?? "—", "بار در روز"),
    behaviorCard("سرخ‌کرده / شیرینی / فست‌فود", average(e, "unhealthyCount") ?? "—", "بار در روز"),
    behaviorCard(
      "صبحانه ثبت شده",
      bfPct,
      "٪ روزها",
      `<div class="ca-behavior__bar"><span style="width:${bfPct}%; background:var(--ca-accent)"></span></div>`
    ),
    behaviorCard("کافئین (میانگین)", average(visibleEntries, "caffeine") ?? "—", "عدد در روز"),
  ]);

  const counts = new Map();
  for (const d of e) for (const id of d.foodIds) counts.set(id, (counts.get(id) || 0) + 1);
  const top = [...counts]
    .filter(([id]) => foodLabel(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);
  const chips = top.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${top
        .map(
          ([id, c]) =>
            `<span style="padding:3px 10px;border-radius:999px;background:var(--ca-panel-2);font-size:12px">${foodLabel(id)} <b>${c}</b></span>`
        )
        .join("")}</div>`
    : "";

  const dayCore = pickMetrics(M_DAY, ["mood", "energy", "anxiety", "focus"]);
  const fruit = compareGroups(
    allEntries,
    (d) => d.fruitCount != null && d.fruitCount >= 1,
    (d) => d.fruitCount === 0,
    dayCore
  );
  const unhealthy = compareGroups(
    allEntries,
    (d) => d.unhealthyCount != null && d.unhealthyCount >= 1,
    (d) => d.unhealthyCount === 0,
    [...dayCore, ...pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])]
  );
  const breakfast = compareGroups(
    allEntries,
    (d) => d.breakfastLogged === true,
    (d) => d.breakfastLogged === false,
    pickMetrics(M_DAY, ["focus", "energy", "mood"])
  );

  setPanel(
    "caFoodPanel",
    "تغذیه",
    cards +
      (chips ? subTitle("پرتکرارترین‌ها") + chips : "") +
      renderCompare("روز با میوه در برابر بدون میوه", fruit, "با میوه", "بدون") +
      renderCompare("روز با سرخ‌کرده/شیرینی/فست‌فود در برابر بدون آن", unhealthy, "با", "بدون") +
      renderCompare("صبحانه‌ی ثبت‌شده در برابر ثبت‌نشده", breakfast, "با صبحانه", "بدون صبحانه") +
      COMPARE_HINT
  );
}

/* ---------- behaviors ---------- */

function renderBehaviors() {
  const eves = visibleEntries.filter((d) => d.eve);
  const mors = visibleEntries.filter((d) => d.mor);
  if (!eves.length && !mors.length) { $("caBehaviors").innerHTML = ""; return; }

  const nE = eves.length;
  const nM = mors.length;
  const pct = (count, n) => (n ? Math.round((count / n) * 100) : 0);

  const routineCount = mors.filter((d) => d.routineDone).length;
  const exerciseCount = eves.filter((d) => d.exerciseDone).length;
  const exerciseMinutes = eves.reduce((a, d) => a + (d.exerciseMin || 0), 0);
  const mastPosDays = eves.filter((d) => d.mastPos).length;
  const mastNegDays = eves.filter((d) => d.mastNeg).length;
  const act1Count = eves.filter((d) => d.activity1 === true).length;
  const op1Count = eves.filter((d) => d.operation1 === true).length;
  const waterCount = eves.filter((d) => d.water).length;

  const items = [
    { label: "روتین آرام‌سازی", value: routineCount, unit: `/ ${nM} روز`, pct: pct(routineCount, nM) },
    { label: "ورزش", value: exerciseCount, unit: `/ ${nE} روز`, pct: pct(exerciseCount, nE) },
    { label: "دقایق ورزش (کل)", value: exerciseMinutes, unit: "دقیقه", pct: null },
    { label: "خودارضایی مثبت", value: mastPosDays, unit: `/ ${nE} روز`, pct: pct(mastPosDays, nE) },
    { label: "خودارضایی منفی", value: mastNegDays, unit: `/ ${nE} روز`, pct: pct(mastNegDays, nE), danger: nE > 0 && mastNegDays / nE > 0.3 },
    { label: "فعالیت ۱", value: act1Count, unit: `/ ${nE} روز`, pct: pct(act1Count, nE) },
    { label: "عملیات د۱", value: op1Count, unit: `/ ${nE} روز`, pct: pct(op1Count, nE) },
    { label: "آب کافی", value: waterCount, unit: `/ ${nE} روز`, pct: pct(waterCount, nE) },
  ];

  $("caBehaviors").innerHTML = items
    .map(
      (x) => `
    <div class="ca-behavior">
      <div class="ca-behavior__label">${x.label}</div>
      <div class="ca-behavior__value" ${x.danger ? 'style="color:var(--ca-bad)"' : ""}>
        ${x.value}<small> ${x.unit}</small>
      </div>
      ${
        x.pct != null
          ? `<div class="ca-behavior__bar"><span style="width:${x.pct}%; background:${x.danger ? "var(--ca-bad)" : "var(--ca-accent)"}"></span></div>`
          : ""
      }
    </div>`
    )
    .join("");
}

/* ---------- correlations ---------- */

function renderCorrelations() {
  // همبستگی روی کل تاریخچه حساب می‌شود (نه بازه‌ی انتخابی) تا n بیشتر باشد
  const corr = computeCorrelations(allEntries);
  if (!corr.length) {
    $("caCorr").innerHTML = `<p class="ca-hint">داده‌ی کافی برای محاسبه‌ی همبستگی وجود ندارد (حداقل ${MIN_CORR_N} روز داده‌ی جفت‌شده لازم است).</p>`;
    return;
  }

  // ابتدا معنادارها، سپس قدرمطلق نزولی
  corr.sort((a, b) => (b.sig - a.sig) || (Math.abs(b.v) - Math.abs(a.v)));
  const shown = corr.slice(0, CORR_SHOW);

  $("caCorr").innerHTML =
    shown
      .map((r) => {
        const v = r.v;
        const pct = Math.abs(v) * 50; // 0..50
        const fillStyle = v >= 0
          ? `left:50%; width:${pct}%; background:var(--ca-good)`
          : `right:50%; width:${pct}%; background:var(--ca-bad)`;
        return `
      <div class="ca-corr-row" style="${r.sig ? "" : "opacity:0.5"}">
        <div class="ca-corr-row__label">${r.label} <small style="color:var(--ca-muted)">(n=${r.n})</small></div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="ca-corr-row__bar">
            <div class="ca-corr-row__fill" style="${fillStyle}"></div>
          </div>
          <div class="ca-corr-row__val">${v > 0 ? "+" : ""}${v.toFixed(2)}</div>
        </div>
      </div>`;
      })
      .join("") +
    `<p class="ca-hint">ضریب اسپیرمن؛ ${shown.length} مورد برتر از ${corr.length} جفتِ دارای داده‌ی کافی. همبستگی به معنی علت نیست. ردیف‌های کم‌رنگ هنوز از نوسان تصادفی قابل‌تشخیص نیستند؛ با بیشتر شدن داده، آستانه‌ی معناداری پایین‌تر می‌آید.</p>`;
}

/* ---------- heatmap ---------- */

function renderHeatmap() {
  if (!visibleEntries.length) { $("caHeatmap").innerHTML = ""; return; }

  const scoreByNum = new Map();
  for (const d of visibleEntries) if (d.score != null) scoreByNum.set(d.dayNum, d.score);

  const first = visibleEntries[0].dayNum;
  const last = visibleEntries[visibleEntries.length - 1].dayNum;

  let html = "";
  for (let n = first; n <= last; n++) {
    const key = numToKey(n);
    const s = scoreByNum.get(n);
    const color = s == null ? "var(--ca-panel-2)" : scoreToColor(s);
    const tip = s == null ? `${key} — بدون داده` : `${key} — ${s.toFixed(1)}/۱۰`;
    html += `<div class="ca-heat-cell" style="background:${color}" data-tip="${tip}"></div>`;
  }
  $("caHeatmap").innerHTML = html;
}

function scoreToColor(s) {
  // 1..10 → hue 0..120
  const t = Math.max(0, Math.min(1, (s - 1) / 9));
  const hue = t * 120;
  return `hsl(${hue}, 65%, 45%)`;
}

/* ---------- table ---------- */

const TABLE_COLS = [
  { key: "date",         label: "تاریخ" },
  { key: "score",        label: "امتیاز روانی" },
  { key: "sleepHours",   label: "خواب (س)" },
  { key: "sleepQuality", label: "کیفیت خواب" },
  { key: "sleepLatency", label: "تا خواب (دق)" },
  { key: "routineDone",  label: "روتین" },
  { key: "medText",      label: "قرص" },
  { key: "mood",         label: "خلق" },
  { key: "stress",       label: "استرس" },
  { key: "anxiety",      label: "اضطراب" },
  { key: "focus",        label: "تمرکز" },
  { key: "energy",       label: "انرژی" },
  { key: "exerciseMin",  label: "ورزش (دق)" },
  { key: "mastNegCount", label: "خودارضایی منفی" },
  { key: "mastPosCount", label: "خودارضایی مثبت" },
  { key: "explicitMin",  label: "محتوا (دق)" },
  { key: "foodQuality",  label: "کیفیت غذا" },
  { key: "water",        label: "آب" },
  { key: "dayRating",    label: "امتیاز روز" },
];

const ZERO_AS_DASH = new Set(["exerciseMin", "mastNegCount", "mastPosCount", "explicitMin"]);

function cellFor(c, d) {
  const dash = { v: "—", cls: "muted" };
  const raw = d[c.key];

  if (c.key === "date") return { v: formatDate(raw), cls: "date" };
  if (c.key === "routineDone" || c.key === "water") return raw ? { v: "✓", cls: "ca-cell-good" } : dash;
  if (raw === null || raw === undefined || raw === "") return dash;
  if (c.key === "medText") return { v: raw, cls: "ca-cell-good" };
  if (c.key === "score") {
    return { v: raw.toFixed(1), cls: raw >= 7 ? "ca-cell-good" : raw <= 4 ? "ca-cell-bad" : "" };
  }
  if (ZERO_AS_DASH.has(c.key) && raw === 0) return dash;

  let cls = "";
  if ((c.key === "stress" || c.key === "anxiety" || c.key === "mastNegCount") && raw >= 6) cls = "ca-cell-bad";
  if (c.key === "mood" || c.key === "energy" || c.key === "focus") {
    if (raw >= 7) cls = "ca-cell-good";
    if (raw <= 3) cls = "ca-cell-bad";
  }
  return { v: raw, cls };
}

function renderTable() {
  const rows = [...visibleEntries].reverse(); // جدیدترین بالا

  let html = "<thead><tr>";
  for (const c of TABLE_COLS) html += `<th>${c.label}</th>`;
  html += "</tr></thead><tbody>";

  for (const d of rows) {
    html += "<tr>";
    for (const c of TABLE_COLS) {
      const { v, cls } = cellFor(c, d);
      html += `<td class="${cls}">${v}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody>";
  $("caTable").innerHTML = html;
}

function formatDate(key) {
  const d = new Date(key + "T00:00:00");
  const fa = new Intl.DateTimeFormat("fa-IR", { month: "short", day: "2-digit" });
  const en = key.slice(5);
  return `${fa.format(d)} (${en})`;
}

/* ============================================================
   Events
   ============================================================ */

function bindEvents() {
  $("caConnectBtn").addEventListener("click", connectFile);

  $("caImportInput").addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (f) await importFile(f);
    ev.target.value = "";
  });

  $("caRangeSelect").addEventListener("change", render);

  // نمودارها با عرض واقعی کانتینر ساخته می‌شوند؛ با تغییر اندازه دوباره رسم شوند
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (doc && allEntries.length) {
        renderSleepChart();
        renderMoodChart();
        renderSwing();
      }
    }, 150);
  });

  // theme: هماهنگ با main app
  const savedTheme = localStorage.getItem("study-timer:theme") || "dark";
  document.body.dataset.theme = savedTheme;
}

init();