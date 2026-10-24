/* =============================================================
   insights.js — تحلیل یکپارچه‌ی سه منبع داده (v6)
     ۱) study-data.json      → جلسه‌های مطالعه‌ی واقعی
     ۲) weekly-plans.json    → برنامه (هدف)
     ۳) daily-checkins.json  → چک‌این صبح/شب (اسکیمای v6)
   هر سه فقط خوانده می‌شوند؛ این صفحه چیزی در فایل‌ها یا بکاپ‌ها نمی‌نویسد.
   ============================================================= */

import { parseDocument, sessionDayKey, isCountedSession, fromIso } from "./dataLayer.js";
import { parseWeeklyPlansDocument, sessionMinutes, WEEKDAY_NAMES_FA } from "./weeklyPlanData.js";
import { parseCheckinDocument } from "./daliycheck/dailyCheckinData.js";
import { foodTags } from "./daliycheck/foodCatalog.js";
import { FileStorage, WEEKLY_PLANS_HANDLE_KEY } from "./fileStorage.js";

/* ---------- تنظیمات ---------- */
const DAY_MS = 86400000;
const MIN_GROUP_N = 5;
const SIG_T = 2.5;
const SIG_MIN_N = 8;
const MIN_CORR_N = 20;
const CORR_SIG_K = 2.5;
const LATE_FROM = 22;
const CAPACITY_DAYS = 28;

const SRC = {
  study: {
    label: "داده‌های مطالعه (study-data.json)",
    backupKey: "study-timer:local-backup",
    handleKey: undefined,
  },
  plan: {
    label: "برنامه‌ی هفتگی (weekly-plans.json)",
    backupKey: "study-timer:weekly-plans-backup",
    handleKey: WEEKLY_PLANS_HANDLE_KEY,
  },
  checkin: {
    label: "چک‌این روزانه (daily-checkins.json)",
    backupKey: "study-timer:daily-checkins-backup",
    handleKey: "study-timer:daily-checkins-handle",
  },
};
const KINDS = ["study", "plan", "checkin"];
const PARSE = { study: parseDocument, plan: parseWeeklyPlansDocument, checkin: parseCheckinDocument };

const DAYTYPE_NAMES = { A: "تکواندو", B: "کاری", C: "آزاد" };
const TYPE_NAMES = { study: "مطالعه", practice: "تمرین", test: "تست", analysis: "تحلیل تست", review: "مرور" };
const TYPE_KEYS = Object.keys(TYPE_NAMES);
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
const DAYPARTS = [
  { id: "morning", label: "صبح (۰۵–۱۲)" },
  { id: "afternoon", label: "بعدازظهر (۱۲–۱۷)" },
  { id: "evening", label: "عصر (۱۷–۲۲)" },
  { id: "night", label: "شب (۲۲–۰۵)" },
];

/* ---------- state ---------- */
const data = { study: null, plan: null, checkin: null };
const meta = { study: { state: "none" }, plan: { state: "none" }, checkin: { state: "none" } };
const pending = {};
let view = null;

const $ = (id) => document.getElementById(id);

/* ============================================================
   Helpers
   ============================================================ */

const pad2 = (n) => String(n).padStart(2, "0");
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v) => (isNum(v) ? v : null);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => sum(a) / a.length;
const l5to10 = (v) => (v == null ? null : Math.round((1 + ((v - 1) * 9) / 4) * 10) / 10);
const num10 = (v) => (v == null ? null : Math.round((v / 10) * 10) / 10);

function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / (a.length - 1));
}
function quantile(arr, q) {
  const a = [...arr].sort((x, y) => x - y);
  if (!a.length) return null;
  const p = (a.length - 1) * q;
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  return a[lo] + (a[hi] - a[lo]) * (p - lo);
}
const median = (a) => quantile(a, 0.5);
const avgOf = (arr, key) => {
  const v = arr.map((d) => d[key]).filter(isNum);
  return v.length ? mean(v) : null;
};

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
  const mx = mean(xs);
  const my = mean(ys);
  let nu = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    nu += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den ? nu / den : null;
}
function spearman(pairs) {
  const n = pairs.length;
  if (n < MIN_CORR_N) return { r: null, n };
  const r = pearsonRaw(rank(pairs.map((p) => p[0])), rank(pairs.map((p) => p[1])));
  return { r: r == null ? null : Math.round(r * 100) / 100, n };
}
function welch(a, b) {
  const sa = sd(a);
  const sb = sd(b);
  if (sa == null || sb == null) return null;
  const se = Math.sqrt((sa * sa) / a.length + (sb * sb) / b.length);
  return se ? (mean(a) - mean(b)) / se : null;
}

/* ---------- تاریخ ---------- */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function keyToNum(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}
function numToKey(n) {
  const t = new Date(n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}
const wdOf = (n) => (n + 4) % 7;
const shortDate = (n) => numToKey(n).slice(5);

function hourToNum(t) {
  if (!t || typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  return Number.isFinite(h) ? h + (m || 0) / 60 : null;
}
function fmtHour(h) {
  const t = Math.round(h * 60);
  return `${pad2(Math.floor(t / 60) % 24)}:${pad2(t % 60)}`;
}
const fmtH = (min) => (min / 60).toFixed(1);

/* ---------- نام درس ---------- */
const normFa = (s) =>
  String(s).replace(/[\u200c\u200d\s]/g, "").replace(/\u064a/g, "\u06cc").replace(/\u0643/g, "\u06a9");
const SUBJ_NAME = new Map();
function subjKey(name) {
  const k = normFa(name);
  if (!SUBJ_NAME.has(k)) SUBJ_NAME.set(k, String(name).trim());
  return k;
}
const subjLabel = (k) => esc(SUBJ_NAME.get(k) || k);

/* ---------- قالب‌بندی ---------- */
function fmtVal(kind, v) {
  switch (kind) {
    case "min": return `${Math.round(v)} دق`;
    case "pct":
    case "share": return `${Math.round(v * 100)}٪`;
    case "hr": return `${v.toFixed(1)} س`;
    case "clock": return fmtHour(v);
    default: return v.toFixed(1);
  }
}
function fmtDiff(kind, diff) {
  const s = diff > 0 ? "+" : diff < 0 ? "−" : "";
  const a = Math.abs(diff);
  switch (kind) {
    case "min": return `${s}${Math.round(a)} دقیقه`;
    case "pct":
    case "share": return `${s}${Math.round(a * 100)}٪`;
    case "hr": return `${s}${a.toFixed(1)} ساعت`;
    case "clock": return `${s}${Math.round(a * 60)} دقیقه`;
    default: return `${s}${a.toFixed(1)}`;
  }
}

/* ============================================================
   Load
   ============================================================ */

const stampOf = {
  study: (d) => Date.parse(d?.app?.updatedAt) || 0,
  plan: () => 0,
  checkin: (d) => Date.parse(d?.updatedAt) || 0,
};

function readBackup(kind) {
  try {
    const raw = localStorage.getItem(SRC[kind].backupKey);
    return raw ? { doc: PARSE[kind](raw), from: "backup" } : null;
  } catch (err) {
    console.warn(`Backup (${kind}) invalid:`, err);
    return null;
  }
}

async function readRemembered(kind) {
  try {
    const h = await FileStorage.loadHandle(SRC[kind].handleKey);
    if (!h) return null;
    if (!(await FileStorage.ensurePermission(h, false))) {
      pending[kind] = h;
      return null;
    }
    const text = await FileStorage.readText(h);
    if (!text.trim()) return null;
    return { doc: PARSE[kind](text), from: "file", name: h.name };
  } catch (err) {
    console.warn(`Remembered file (${kind}) failed:`, err);
    return null;
  }
}

function setSource(kind, res) {
  if (!res) {
    data[kind] = null;
    meta[kind] = { state: pending[kind] ? "permission" : "none" };
    return;
  }
  data[kind] = res.doc;
  meta[kind] = { state: res.from, name: res.name || null };
}

async function loadSource(kind) {
  delete pending[kind];
  const backup = readBackup(kind);
  const file = await readRemembered(kind);
  let best = backup;
  if (file && (!backup || stampOf[kind](file.doc) >= stampOf[kind](backup.doc))) best = file;
  setSource(kind, best);
}

const errText = (err) => (err?.details?.[0] ? `${err.message}: ${err.details[0]}` : err?.message || String(err));

async function openSource(kind) {
  try {
    let h = pending[kind];
    if (h) {
      if (!(await FileStorage.ensurePermission(h, true))) {
        alert("دسترسی به فایل داده نشد.");
        return;
      }
    } else {
      h = await FileStorage.pickOpenFile();
    }
    const text = await FileStorage.readText(h);
    if (!text.trim()) throw new Error("فایل خالی است");
    data[kind] = PARSE[kind](text);
    meta[kind] = { state: "file", name: h.name };
    delete pending[kind];
    renderAll();
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.error(err);
      alert("خطا در باز کردن فایل: " + errText(err));
    }
  }
}

async function importSource(kind, file) {
  try {
    data[kind] = PARSE[kind](await file.text());
    meta[kind] = { state: "import", name: file.name };
    renderAll();
  } catch (err) {
    console.error(err);
    alert("فایل نامعتبر است: " + errText(err));
  }
}

function summaryOf(kind) {
  if (kind === "study") {
    const n = data.study.sessions.filter((r) => r.type !== "break" && isCountedSession(r)).length;
    return `${n} جلسه‌ی ثبت‌شده`;
  }
  if (kind === "plan") {
    const weeks = data.plan.phases.reduce((a, p) => a + (p.weeks?.length || 0), 0);
    return `${data.plan.phases.length} فاز، ${weeks} هفته`;
  }
  return `${data.checkin.entries.length} روز چک‌این`;
}

function renderSources() {
  const stateText = {
    file: "از فایل",
    backup: "از بکاپ مرورگر",
    import: "واردشده (موقت)",
    permission: "نیاز به اجازه‌ی دسترسی",
    none: "متصل نیست",
  };
  const cards = KINDS.map((kind) => {
    const m = meta[kind];
    const ok = !!data[kind];
    return `
    <div class="ins-source ${ok ? "ins-source--ok" : ""}">
      <div class="ins-source__title">${SRC[kind].label}</div>
      <div class="ins-source__state">${stateText[m.state]}${m.name ? ` — ${esc(m.name)}` : ""}</div>
      <div class="ins-source__info">${ok ? summaryOf(kind) : "—"}</div>
      <div class="ins-source__actions">
        <button type="button" class="ca-btn ca-btn--ghost" data-open="${kind}">${m.state === "permission" ? "اجازه‌ی دسترسی" : "باز کردن فایل"}</button>
        <label class="ca-btn ca-btn--ghost">ورود JSON
          <input type="file" accept=".json,application/json" data-import="${kind}" hidden />
        </label>
      </div>
    </div>`;
  }).join("");
  $("insSources").innerHTML = `<h2 class="ca-panel__title">منابع داده</h2><div class="ins-sources">${cards}</div>`;
}

/* ============================================================
   Study + Plan indexes
   ============================================================ */

const zeroTypes = () => ({ study: 0, practice: 0, test: 0, analysis: 0, review: 0 });

function buildStudyIndex(doc) {
  const map = new Map();
  let first = Infinity;
  for (const rec of doc.sessions) {
    if (rec.type === "break" || !isCountedSession(rec) || !rec.actual.endedAt) continue;
    const dayNum = keyToNum(sessionDayKey(rec));
    if (dayNum < first) first = dayNum;

    const off = (rec.actual.utcOffsetMinutes || 0) * 60000;
    const sLocal = fromIso(rec.actual.startedAt) + off;
    const eLocal = fromIso(rec.actual.endedAt) + off;
    const start = (((sLocal % DAY_MS) + DAY_MS) % DAY_MS) / 3600000;
    const wall = Math.max(0, (eLocal - sLocal) / 3600000);
    const end = start + wall;
    const active = rec.derived.activeDurationSeconds / 60;

    let d = map.get(dayNum);
    if (!d) {
      d = {
        min: 0, sessions: 0, done: 0, aband: 0, longest: 0,
        first: null, last: null, late: 0,
        byType: zeroTypes(), bySubj: new Map(), list: [],
      };
      map.set(dayNum, d);
    }
    d.min += active;
    d.sessions++;
    if (rec.status === "completed") d.done++;
    else d.aband++;
    d.longest = Math.max(d.longest, active);
    d.first = d.first == null ? start : Math.min(d.first, start);
    d.last = d.last == null ? end : Math.max(d.last, end);
    if (wall > 0) d.late += active * (Math.max(0, Math.min(end, 28) - Math.max(start, LATE_FROM)) / wall);
    if (rec.type in d.byType) d.byType[rec.type] += active;
    if (rec.subject) {
      const k = subjKey(rec.subject);
      d.bySubj.set(k, (d.bySubj.get(k) || 0) + active);
    }
    d.list.push({
      start, end, active,
      done: rec.status === "completed",
      paused: (rec.derived.totalPausedSeconds || 0) / 60,
    });
  }
  return { map, first };
}

function buildPlanIndex(doc) {
  const byDate = new Map();
  const weeks = [];
  let last = -Infinity;
  for (const phase of doc.phases || []) {
    for (const week of phase.weeks || []) {
      weeks.push(week);
      for (const day of week.days || []) byDate.set(day.date, { day, week });
    }
    for (const day of phase.finalDays || []) if (!byDate.has(day.date)) byDate.set(day.date, { day, week: null });
    if (phase.endDate) last = Math.max(last, keyToNum(phase.endDate));
  }
  return { byDate, weeks, last };
}

function planInfo(day) {
  const byType = zeroTypes();
  const bySubj = new Map();
  let total = 0;
  let first = null;
  for (const s of day.sessions || []) {
    const m = sessionMinutes(s);
    total += m;
    if (s.type in byType) byType[s.type] += m;
    if (s.subject) {
      const k = subjKey(s.subject);
      bySubj.set(k, (bySubj.get(k) || 0) + m);
    }
    const h = hourToNum(s.startTime);
    if (h != null && (first == null || h < first)) first = h;
  }
  return { total, byType, bySubj, first };
}

/* ============================================================
   Checkin — score + normalize v6
   ============================================================ */

function computeMentalScore(d) {
  if (!d.eve) return null;
  const parts = [];
  let evParts = 0;
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
  if (parts.length < 3 || evParts < 2) return null;
  const tw = sum(parts.map((p) => p.w));
  return Math.round((sum(parts.map((p) => p.w * p.v)) / tw) * 10) / 10;
}

function normalizeCheckin(e) {
  const mor = !!e.slots?.morning;
  const eve = !!e.slots?.evening;
  const bedH = hourToNum(e.sleep?.bedTime);

  const med = e.medication || {};
  const am = med.morning || {};
  const pm = med.afternoon || {};
  const medKnown = !!med.recorded;

  const x = e.explicit || {};
  const food = e.food || {};
  const foodLogged = eve && !!food.logged;
  const log = food.log || {};
  const ids = foodLogged ? ["breakfast", "lunch", "dinner", "snack"].flatMap((m) => log[m] || []) : [];
  const cnt = (tags) => ids.filter((id) => foodTags(id).some((t) => tags.includes(t))).length;
  const exRec = !!e.exercise?.recorded;
  const exDone = exRec ? !!e.exercise?.done : null;

  const items = e.items || {};
  const phys = e.physical || {};
  const soc = e.social || {};
  const evt = e.events || {};
  const circ = e.circadian || {};
  const sc = e.scores || {};

  const exType = exRec && exDone ? (e.exercise?.type ?? null) : null;
  const exIntensity = exRec && exDone ? (e.exercise?.intensity ?? null) : null;
  const isType = (t) => (exRec ? (exDone && exType === t ? 1 : 0) : null);

  const o = {
    mor, eve,
    travel: e.travel === true ? true : e.travel === false ? false : null,

    bedNum: bedH == null ? null : bedH < 12 ? bedH + 24 : bedH,
    sleepHours: num(e.sleep?.hours),
    sleepQuality: num(e.sleep?.quality),
    sleepLatency: num(e.sleep?.latencyMin),
    awakenings: num(e.sleep?.awakenings),
    restedness: num(e.sleep?.restedness),
    napsMin: num(e.sleep?.napsMin),
    screenBeforeBedMin: num(e.sleep?.screenBeforeBedMin),

    morningMood: num(e.morningState?.mood),
    morningEnergy: num(e.morningState?.energy),
    morningTension: num(e.morningState?.tension),

    mood: num(e.mood?.rating),
    stress: num(e.mood?.stress),
    energy: num(e.mood?.energy),
    focus: num(e.mood?.focus),
    anxiety: num(e.mood?.anxiety),
    dayRating: num(e.dayRating),

    medAm: medKnown ? !!am.taken : null,
    medPm: medKnown && eve ? !!pm.taken : null,
    medDay: medKnown && eve ? !!am.taken || !!pm.taken : null,
    medAmEffect: medKnown && am.taken ? num(am.effect) : null,
    medPmEffect: medKnown && pm.taken ? num(pm.effect) : null,
    medAmSideCount: medKnown && am.taken && Array.isArray(am.sideEffects) ? am.sideEffects.length : null,
    medPmSideCount: medKnown && pm.taken && Array.isArray(pm.sideEffects) ? pm.sideEffects.length : null,

    explicitViewed: eve && !!x.recorded ? !!x.viewed : null,
    explicitMin: eve && x.viewed ? num(x.minutes) : null,
    explicitRegret: eve && x.viewed ? num(x.regret) : null,

    mastDone: eve && e.masturbation?.recorded ? !!e.masturbation?.done : null,
    mastUrge: eve && e.masturbation?.done ? num(e.masturbation?.urgeIntensity) : null,
    mastGuilt: eve && e.masturbation?.done ? num(e.masturbation?.guilt) : null,

    exerciseDone: exDone,
    exerciseMinutes: exRec && exDone ? num(e.exercise?.minutes) : null,
    exerciseType: exType,
    exerciseIntensity: exIntensity,
    exerciseTime: exRec && exDone ? (e.exercise?.timeOfDay ?? null) : null,
    exerciseTaekwondo: isType("taekwondo"),
    exerciseBJJ: isType("bjj"),
    exerciseWalking: isType("walking"),
    exerciseIntensityVigorous: exRec ? (exDone && exIntensity === "vigorous" ? 1 : 0) : null,

    caffeine: eve ? num(food.caffeine) : null,
    caffeineCups: eve ? num(food.caffeineCups) : null,
    caffeineLastTime: eve ? hourToNum(food.caffeineLastTime) : null,
    waterGlasses: eve ? num(food.waterGlasses) : null,
    sugarEpisodes: eve ? num(food.sugarEpisodes) : null,
    firstMealTime: eve ? hourToNum(food.firstMealTime) : null,
    lastMealTime: eve ? hourToNum(food.lastMealTime) : null,
    foodQuality: num(food.quality),
    fruitCount: foodLogged ? cnt(["fruit"]) : null,
    vegCount: foodLogged ? cnt(["veg"]) : null,
    unhealthyCount: foodLogged ? cnt(["fried", "fastfood", "junk", "sweet"]) : null,

    irritability: l5to10(num(items.irritability)),
    anhedonia: l5to10(num(items.anhedonia)),
    rumination: l5to10(num(items.rumination)),
    meaningfulness: l5to10(num(items.meaningfulness)),
    focusQuality: l5to10(num(items.focusQuality)),
    taskProcrastination: l5to10(num(items.taskProcrastination)),
    emotionalDysregulation: l5to10(num(items.emotionalDysregulation)),

    headache: num(phys.headache),
    bodyPain: num(phys.bodyPain),
    fatigueBeyond: num(phys.fatigueBeyond),
    digestive: num(phys.digestive),

    socialContact: eve ? (soc.meaningfulContact === true ? true : soc.meaningfulContact === false ? false : null) : null,
    loneliness: l5to10(num(soc.loneliness)),

    stressorCount: num(evt.stressorCount),
    eventTags: Array.isArray(evt.tags) ? evt.tags : [],

    morningLightMin: num(circ.morningOutdoorLight),
    eveningBrightLight: eve ? (circ.eveningBrightLight === true ? true : circ.eveningBrightLight === false ? false : null) : null,

    focusIndex: num10(num(sc.focusIndex)),
    adhdIndex: num10(num(sc.adhdIndex)),
    recoveryScore: num10(num(sc.recoveryScore)),
    sleepHealth: num10(num(sc.sleepHealth)),
    nutritionScore: num10(num(sc.nutritionScore)),

    eveDurationMs: e.responseMeta?.evening?.durationMs ?? null,
  };
  o.score = computeMentalScore(o);
  return o;
}

/* ============================================================
   Join
   ============================================================ */

function joinDays() {
  const sIdx = data.study ? buildStudyIndex(data.study) : null;
  const pIdx = data.plan ? buildPlanIndex(data.plan) : null;
  const cMap = new Map();
  if (data.checkin) for (const e of data.checkin.entries) cMap.set(keyToNum(e.date), normalizeCheckin(e));

  const todayNum = keyToNum(todayKey());
  let start = sIdx && Number.isFinite(sIdx.first) ? sIdx.first : Infinity;
  for (const n of cMap.keys()) start = Math.min(start, n);
  if (!Number.isFinite(start)) return { days: [], pIdx };
  start = Math.min(start, todayNum);

  const days = [];
  for (let n = start; n <= todayNum; n++) {
    const key = numToKey(n);
    const c = cMap.get(n);
    const s = sIdx?.map.get(n);
    const hasStudy = !!sIdx && Number.isFinite(sIdx.first) && n >= sIdx.first;
    const pe = pIdx?.byDate.get(key);
    const pi = pe ? planInfo(pe.day) : null;

    const d = {
      ...(c || {}),
      dayNum: n,
      date: key,
      wd: wdOf(n),
      hasCheckin: !!c,
      hasStudy,
      sMin: hasStudy ? s?.min ?? 0 : null,
      sSess: s?.sessions ?? 0,
      sDone: s?.done ?? 0,
      sAband: s?.aband ?? 0,
      sLongest: s?.longest ?? 0,
      sFirst: s?.first ?? null,
      sLast: s?.last ?? null,
      sLate: s ? s.late : hasStudy ? 0 : null,
      sByType: s?.byType ?? zeroTypes(),
      sBySubj: s?.bySubj ?? new Map(),
      sList: s?.list ?? [],
      pMin: pi ? pi.total : null,
      pByType: pi?.byType ?? zeroTypes(),
      pBySubj: pi?.bySubj ?? new Map(),
      pFirst: pi?.first ?? null,
      dayType: pe?.day?.dayType ?? null,
    };
    d.adh = d.pMin > 0 && d.sMin != null && n < todayNum ? d.sMin / d.pMin : null;
    days.push(d);
  }

  for (let i = 0; i < days.length; i++) {
    const vals = [];
    for (let j = Math.max(0, i - 6); j <= i; j++) if (isNum(days[j].score)) vals.push(days[j].score);
    days[i].scoreMA = vals.length >= 3 ? Math.round(mean(vals) * 10) / 10 : null;
  }
  return { days, pIdx };
}

/* ============================================================
   Metrics
   ============================================================ */

function makeMetrics(byNum, todayNum) {
  const nx = (d) => byNum.get(d.dayNum + 1);
  const nxFull = (d) => {
    const n = nx(d);
    return n && n.dayNum < todayNum ? n : null;
  };
  const pv = (d) => byNum.get(d.dayNum - 1);

  const same = (key, label, kind = "score", up = null) => ({ label, get: (d) => num(d[key]), kind, up });
  const next = (key, label, kind = "score", up = null) => ({ label, get: (d) => num(nx(d)?.[key]), kind, up });
  const share = (key, label) => ({
    label,
    get: (d) => (d[key] == null ? null : d[key] ? 1 : 0),
    kind: "share",
    up: null,
  });

  return {
    /* ==== مطالعه ==== */
    sMin: same("sMin", "مطالعه‌ی همان روز", "min", true),
    sMinNx: { label: "مطالعه‌ی فردا", get: (d) => num(nxFull(d)?.sMin), kind: "min", up: true },
    adh: same("adh", "پایبندی به برنامه‌ی همان روز", "pct", true),
    adhNx: next("adh", "پایبندی به برنامه‌ی فردا", "pct", true),
    sessLen: { label: "میانگین طول جلسه", get: (d) => (d.sSess > 0 ? d.sMin / d.sSess : null), kind: "min", up: true },
    sSess: { label: "تعداد جلسه", get: (d) => (d.hasStudy ? d.sSess : null), kind: "num", up: null },
    sFirst: same("sFirst", "ساعت شروع اولین جلسه", "clock", null),
    sLast: same("sLast", "ساعت پایان آخرین جلسه", "clock", null),
    sLate: { label: "مطالعه‌ی بعد از ۲۲:۰۰", get: (d) => (d.hasStudy ? num(d.sLate) : null), kind: "min", up: false },
    testMin: {
      label: "دقایق تمرین و تست",
      get: (d) => (d.hasStudy ? d.sByType.practice + d.sByType.test : null),
      kind: "min",
      up: null,
    },
    prevStudy: { label: "مطالعه‌ی روز قبل", get: (d) => num(pv(d)?.sMin), kind: "min", up: null },

    /* ==== خواب ==== */
    sleepHours: same("sleepHours", "ساعت خواب دیشب", "hr", true),
    sleepQuality: same("sleepQuality", "کیفیت خواب دیشب", "score", true),
    sleepLatency: same("sleepLatency", "زمان به خواب رفتن دیشب", "min", false),
    awakenings: same("awakenings", "بیداری شبانه‌ی دیشب", "num", false),
    restedness: same("restedness", "احساس استراحت صبح", "score", true),
    bedNum: same("bedNum", "ساعت رفتن به رختخواب دیشب", "clock", null),
    napsMin: same("napsMin", "چرت روزانه (دقیقه)", "min", false),
    screenBeforeBedMin: same("screenBeforeBedMin", "صفحه‌نمایش قبل خواب", "min", false),

    /* ==== morning ==== */
    morningMood: same("morningMood", "حال صبح", "score", true),
    morningEnergy: same("morningEnergy", "انرژی صبح", "score", true),
    morningTension: same("morningTension", "تنش صبح", "score", false),

    /* ==== شرایط روز قبل ==== */
    medDayShare: share("medDay", "روز با قرص ADHD"),
    travelShare: share("travel", "روز سفر"),
    prevExercise: {
      label: "ورزش روز قبل",
      get: (d) => {
        const p = pv(d);
        return p && p.exerciseDone != null ? (p.exerciseDone ? 1 : 0) : null;
      },
      kind: "share",
      up: null,
    },
    prevScore: { label: "امتیاز روانی روز قبل", get: (d) => num(pv(d)?.score), kind: "score", up: true },
    caffeine: same("caffeine", "کافئین (تعداد)", "num", null),

    /* ==== حال همان روز ==== */
    mood: same("mood", "خلق", "score", true),
    stress: same("stress", "استرس", "score", false),
    anxiety: same("anxiety", "اضطراب", "score", false),
    focus: same("focus", "تمرکز", "score", true),
    energy: same("energy", "انرژی", "score", true),
    score: same("score", "امتیاز روانی", "score", true),

    /* ==== شب بعد / فردا ==== */
    sleepHoursNx: next("sleepHours", "ساعت خواب شب بعد", "hr", true),
    sleepQualityNx: next("sleepQuality", "کیفیت خواب شب بعد", "score", true),
    sleepLatencyNx: next("sleepLatency", "زمان به خواب رفتن شب بعد", "min", false),
    bedNx: next("bedNum", "ساعت رفتن به رختخواب شب بعد", "clock", null),
    moodNx: next("mood", "خلق فردا", "score", true),
    stressNx: next("stress", "استرس فردا", "score", false),
    energyNx: next("energy", "انرژی فردا", "score", true),
    scoreNx: next("score", "امتیاز روانی فردا", "score", true),

    /* ==== v6: ADHD ==== */
    focusQuality: same("focusQuality", "کیفیت تمرکز (ADHD)", "score", true),
    taskProcrastination: same("taskProcrastination", "به تعویق انداختن کارها", "score", false),
    emotionalDysregulation: same("emotionalDysregulation", "بی‌نظمی هیجانی", "score", false),
    focusIndex: same("focusIndex", "شاخص تمرکز (composite)", "score", true),
    adhdIndex: same("adhdIndex", "شاخص ADHD (composite)", "score", true),
    recoveryScore: same("recoveryScore", "امتیاز بازیابی (composite)", "score", true),
    sleepHealth: same("sleepHealth", "امتیاز سلامت خواب (composite)", "score", true),
    nutritionScore: same("nutritionScore", "امتیاز تغذیه (composite)", "score", true),

    /* ==== v6: wellbeing ==== */
    irritability: same("irritability", "تحریک‌پذیری", "score", false),
    anhedonia: same("anhedonia", "بی‌لذتی", "score", false),
    rumination: same("rumination", "نشخوار فکری", "score", false),
    meaningfulness: same("meaningfulness", "معناداری", "score", true),

    /* ==== v6: physical ==== */
    headache: same("headache", "سردرد (۰–۳)", "num", false),
    bodyPain: same("bodyPain", "درد بدن (۰–۳)", "num", false),
    fatigueBeyond: same("fatigueBeyond", "خستگی غیرمعمول (۰–۳)", "num", false),
    digestive: same("digestive", "مشکل گوارشی (۰–۳)", "num", false),

    /* ==== v6: social ==== */
    loneliness: same("loneliness", "تنهایی", "score", false),
    socialContactShare: share("socialContact", "روز با ارتباط معنادار"),

    /* ==== v6: events ==== */
    stressorCount: same("stressorCount", "تعداد رویداد استرس‌زا", "num", false),

    /* ==== v6: circadian ==== */
    morningLightMin: same("morningLightMin", "نور صبح (دقیقه)", "min", true),
    eveningBrightLightShare: share("eveningBrightLight", "نور شدید شب"),

    /* ==== v6: meds effect + side effects ==== */
    medAmEffect: same("medAmEffect", "اثر قرص صبح (۰–۱۰)", "score", true),
    medPmEffect: same("medPmEffect", "اثر قرص عصر (۰–۱۰)", "score", true),
    medAmSideCount: same("medAmSideCount", "تعداد عوارض صبح", "num", false),
    medPmSideCount: same("medPmSideCount", "تعداد عوارض عصر", "num", false),

    /* ==== v6: exercise types ==== */
    exerciseTaekwondo: share("exerciseTaekwondo", "روز تکواندو"),
    exerciseBJJ: share("exerciseBJJ", "روز بندسازی"),
    exerciseWalking: share("exerciseWalking", "روز پیاده‌روی"),
    exerciseIntensityVigorous: share("exerciseIntensityVigorous", "ورزش شدید"),
    exerciseMin: same("exerciseMinutes", "دقایق ورزش", "min", true),

    /* ==== v6: caffeine timing + nutrition ==== */
    caffeineCups: same("caffeineCups", "لیوان کافئین", "num", null),
    caffeineLastTime: same("caffeineLastTime", "ساعت آخرین کافئین", "clock", null),
    waterGlasses: same("waterGlasses", "لیوان آب", "num", true),
    sugarEpisodes: same("sugarEpisodes", "دفعات قند/شیرینی", "num", false),
    firstMealTime: same("firstMealTime", "ساعت اولین وعده", "clock", null),
    lastMealTime: same("lastMealTime", "ساعت آخرین وعده", "clock", null),

    /* ==== v6: masturbation ==== */
    mastUrge: same("mastUrge", "شدت میل خودارضایی", "num", false),
    mastGuilt: same("mastGuilt", "احساس گناه خودارضایی", "num", false),

    /* ==== v6: explicit ==== */
    explicitRegret: same("explicitRegret", "پشیمانی از محتوا", "num", false),
  };
}

function compare(pool, inA, inB, metrics) {
  const A = pool.filter((d) => inA(d) === true);
  const B = pool.filter((d) => inB(d) === true);
  const rows = [];
  for (const m of metrics) {
    const a = A.map(m.get).filter(isNum);
    const b = B.map(m.get).filter(isNum);
    if (a.length < MIN_GROUP_N || b.length < MIN_GROUP_N) continue;
    const diff = mean(a) - mean(b);
    const t = welch(a, b);
    rows.push({
      m, ma: mean(a), mb: mean(b), na: a.length, nb: b.length, diff, t,
      sig: t != null && Math.abs(t) >= SIG_T && a.length >= SIG_MIN_N && b.length >= SIG_MIN_N,
      better: m.up == null ? null : diff > 0 === m.up,
    });
  }
  return { rows, na: A.length, nb: B.length };
}

/* ============================================================
   Factors (v6)
   ============================================================ */

function computeFactors() {
  const { hist, MET } = view;
  const sVals = hist.filter((d) => d.sMin != null).map((d) => d.sMin);
  const q75 = sVals.length >= 8 ? quantile(sVals, 0.75) : null;
  const q25 = sVals.length >= 8 ? quantile(sVals, 0.25) : null;
  const testsOf = (d) => d.sByType.practice + d.sByType.test;

  const F = [
    /* ---------- خواب ---------- */
    {
      id: "sleepShort",
      title: "خواب دیشب: کمتر از ۶ ساعت در برابر ۷ ساعت یا بیشتر",
      la: "خواب کم", lb: "خواب کافی",
      inA: (d) => d.sleepHours != null && d.sleepHours < 6,
      inB: (d) => d.sleepHours != null && d.sleepHours >= 7,
      outs: ["sMin", "adh", "sessLen", "focusQuality", "focus", "anxiety", "mood"],
    },
    {
      id: "lateBed",
      title: "رفتن به رختخواب دیروقت دیشب (بعد از ۰۱:۳۰) در برابر زودتر (تا نیمه‌شب)",
      la: "خواب دیروقت", lb: "خواب زودتر",
      inA: (d) => d.bedNum != null && d.bedNum >= 25.5,
      inB: (d) => d.bedNum != null && d.bedNum <= 24,
      outs: ["sMin", "adh", "sFirst", "morningEnergy", "focus"],
    },

    /* ---------- حال روانی ---------- */
    {
      id: "stressHigh",
      title: "استرس بالای امروز (۷+) در برابر پایین (۴ یا کمتر)",
      la: "استرس بالا", lb: "استرس پایین",
      inA: (d) => d.stress != null && d.stress >= 7,
      inB: (d) => d.stress != null && d.stress <= 4,
      outs: ["sMinNx", "adhNx", "sleepLatencyNx", "sleepQualityNx", "moodNx", "focusQuality"],
    },
    {
      id: "anxietyHigh",
      title: "اضطراب بالای امروز (۷+) در برابر پایین (۴ یا کمتر)",
      la: "اضطراب بالا", lb: "اضطراب پایین",
      inA: (d) => d.anxiety != null && d.anxiety >= 7,
      inB: (d) => d.anxiety != null && d.anxiety <= 4,
      outs: ["sleepLatencyNx", "sleepQualityNx", "sleepHoursNx", "sMinNx"],
    },

    /* ---------- قرص ADHD (v6) ---------- */
    {
      id: "med",
      title: "روز با قرص ADHD در برابر روز بدون قرص",
      la: "با قرص", lb: "بدون قرص",
      inA: (d) => d.medDay === true,
      inB: (d) => d.medDay === false,
      outs: ["sMin", "adh", "sessLen", "focusQuality", "focus", "anxiety", "mood", "sleepLatencyNx", "sleepHoursNx"],
    },
    {
      id: "medPm",
      title: "قرص عصر (بعدازظهر) در برابر فقط قرص صبح",
      la: "با قرص عصر", lb: "فقط صبح",
      inA: (d) => d.medPm === true,
      inB: (d) => d.medAm === true && d.medPm === false,
      outs: ["sLate", "sleepLatencyNx", "sleepQualityNx", "sleepHoursNx", "bedNx"],
    },
    {
      id: "medEffectHigh",
      title: "اثر قرص صبح بالا (۷+) در برابر پایین (۴ یا کمتر)",
      la: "اثر بالا", lb: "اثر پایین",
      inA: (d) => d.medAmEffect != null && d.medAmEffect >= 7,
      inB: (d) => d.medAmEffect != null && d.medAmEffect <= 4,
      outs: ["sMin", "focusQuality", "adh", "sessLen", "mood"],
    },
    {
      id: "medSideEffects",
      title: "روز با عوارض قرص در برابر بدون عوارض",
      la: "با عوارض", lb: "بدون عوارض",
      inA: (d) => (d.medAmSideCount ?? 0) + (d.medPmSideCount ?? 0) >= 1,
      inB: (d) => d.medAmSideCount === 0 && d.medPmSideCount === 0,
      outs: ["sMin", "focusQuality", "sleepQualityNx", "sleepLatencyNx", "stress"],
    },

    /* ---------- ورزش (v6: نوع + شدت) ---------- */
    {
      id: "taekwondo",
      title: "روز تکواندو در برابر روز بدون ورزش (اثر همان روز و فردا)",
      la: "تکواندو", lb: "بدون ورزش",
      inA: (d) => d.exerciseTaekwondo === 1,
      inB: (d) => d.exerciseDone === false,
      outs: ["sMin", "focusQuality", "mood", "stress", "sleepQualityNx", "sleepLatencyNx", "sMinNx"],
    },
    {
      id: "walking",
      title: "روز پیاده‌روی در برابر روز بدون ورزش",
      la: "پیاده‌روی", lb: "بدون ورزش",
      inA: (d) => d.exerciseWalking === 1,
      inB: (d) => d.exerciseDone === false,
      outs: ["sMin", "focusQuality", "mood", "stress", "sleepQualityNx", "sMinNx"],
    },
    {
      id: "bjj",
      title: "روز بندسازی در برابر روز بدون ورزش",
      la: "بندسازی", lb: "بدون ورزش",
      inA: (d) => d.exerciseBJJ === 1,
      inB: (d) => d.exerciseDone === false,
      outs: ["sMin", "focusQuality", "mood", "stress", "sleepQualityNx", "sMinNx"],
    },
    {
      id: "vigorous",
      title: "ورزش شدید در برابر ورزش سبک",
      la: "شدید", lb: "سبک",
      inA: (d) => d.exerciseIntensityVigorous === 1,
      inB: (d) => d.exerciseIntensity === "light",
      outs: ["sleepQualityNx", "sleepLatencyNx", "mood", "focusQuality", "sMinNx"],
    },

    /* ---------- تمرکز ADHD (v6) ---------- */
    {
      id: "focusHigh",
      title: "روز با تمرکز بالا (ADHD ≥ ۷) در برابر روز با تمرکز پایین (≤ ۴)",
      la: "تمرکز بالا", lb: "تمرکز پایین",
      inA: (d) => d.focusQuality != null && d.focusQuality >= 7,
      inB: (d) => d.focusQuality != null && d.focusQuality <= 4,
      outs: ["sMin", "adh", "sessLen", "sMinNx", "anxiety", "stress"],
    },

    /* ---------- شرایط دیگر ---------- */
    {
      id: "travel",
      title: "روز سفر در برابر روز عادی",
      la: "سفر", lb: "عادی",
      inA: (d) => d.travel === true,
      inB: (d) => d.travel === false,
      outs: ["sMin", "adh", "sleepHours", "mood", "score"],
    },
    {
      id: "explicit",
      title: "محتوای تحریک‌آمیز امروز در برابر بدون آن",
      la: "دیدم", lb: "ندیدم",
      inA: (d) => d.explicitViewed === true,
      inB: (d) => d.explicitViewed === false,
      outs: ["sMin", "sMinNx", "moodNx", "sleepQualityNx", "sleepLatencyNx"],
    },
    {
      id: "caffeine",
      title: "کافئین زیاد (۳+ لیوان) در برابر کم (۰ تا ۱)",
      la: "کافئین زیاد", lb: "کافئین کم",
      inA: (d) => d.caffeineCups != null && d.caffeineCups >= 3,
      inB: (d) => d.caffeineCups != null && d.caffeineCups <= 1,
      outs: ["sleepLatencyNx", "sleepQualityNx", "anxiety", "focusQuality"],
    },
    {
      id: "lateCaffeine",
      title: "کافئین بعد از ۱۴:۰۰ در برابر کافئین فقط قبل از ۱۲:۰۰",
      la: "کافئین دیر", lb: "کافئین زود",
      inA: (d) => d.caffeineLastTime != null && d.caffeineLastTime >= 14,
      inB: (d) => d.caffeineCups != null && d.caffeineCups > 0 && (d.caffeineLastTime == null || d.caffeineLastTime < 12),
      outs: ["sleepLatencyNx", "sleepQualityNx", "sleepHoursNx", "focus", "sMinNx"],
    },
    {
      id: "lateStudy",
      title: "مطالعه تا بعد از ۲۳:۰۰ در برابر پایان مطالعه تا ۲۱:۳۰",
      la: "مطالعه‌ی دیروقت", lb: "پایان زودتر",
      inA: (d) => d.sMin > 0 && d.sLast != null && d.sLast >= 23,
      inB: (d) => d.sMin > 0 && d.sLast != null && d.sLast <= 21.5,
      outs: ["sleepLatencyNx", "sleepHoursNx", "sleepQualityNx", "bedNx", "sMinNx", "moodNx"],
    },
    {
      id: "heavy",
      title: "روز پرمطالعه (۲۵٪ بالا) در برابر کم‌مطالعه (۲۵٪ پایین)",
      la: "پرمطالعه", lb: "کم‌مطالعه",
      inA: (d) => q75 != null && d.sMin != null && d.sMin >= q75,
      inB: (d) => q25 != null && d.sMin != null && d.sMin <= q25 && d.sMin < q75,
      outs: ["moodNx", "stressNx", "energyNx", "scoreNx", "sleepQualityNx", "sMinNx"],
    },
    {
      id: "tests",
      title: "روز تمرین/تست سنگین (۶۰+ دقیقه) در برابر روز مطالعه‌ی بدون تست",
      la: "تست سنگین", lb: "بدون تست",
      inA: (d) => d.hasStudy && testsOf(d) >= 60,
      inB: (d) => d.hasStudy && d.sMin > 0 && testsOf(d) === 0,
      outs: ["anxiety", "stress", "mood", "sleepLatencyNx", "sleepQualityNx"],
    },

    /* ---------- v6: رویداد استرس‌زا ---------- */
    {
      id: "stressEvent",
      title: "روز با رویداد استرس‌زا در برابر بدون رویداد",
      la: "با رویداد", lb: "بدون",
      inA: (d) => d.stressorCount != null && d.stressorCount >= 1,
      inB: (d) => d.stressorCount === 0,
      outs: ["sMin", "adh", "anxiety", "stress", "mood", "sleepLatencyNx", "sMinNx"],
    },

    /* ---------- v6: نور صبح ---------- */
    {
      id: "morningLight",
      title: "نور صبح ≥ ۳۰ دقیقه در برابر کمتر از ۱۵ دقیقه",
      la: "نور کافی", lb: "نور کم",
      inA: (d) => d.morningLightMin != null && d.morningLightMin >= 30,
      inB: (d) => d.morningLightMin != null && d.morningLightMin < 15,
      outs: ["focusQuality", "sMin", "sleepQualityNx", "sleepLatencyNx", "mood"],
    },

    /* ---------- v6: علائم جسمی ---------- */
    {
      id: "headache",
      title: "روز با سردرد متوسط+ در برابر روز بدون سردرد",
      la: "با سردرد", lb: "بدون",
      inA: (d) => d.headache != null && d.headache >= 2,
      inB: (d) => d.headache === 0,
      outs: ["sMin", "focusQuality", "stress", "mood"],
    },
    {
      id: "fatigue",
      title: "روز با خستگی غیرمعمول در برابر روز بدون خستگی",
      la: "خسته", lb: "سرحال",
      inA: (d) => d.fatigueBeyond != null && d.fatigueBeyond >= 2,
      inB: (d) => d.fatigueBeyond === 0,
      outs: ["sMin", "focusQuality", "mood", "sleepQualityNx", "sMinNx"],
    },

    /* ---------- v6: تنهایی ---------- */
    {
      id: "loneliness",
      title: "روز با تنهایی بالا (≥ ۷) در برابر پایین (≤ ۴)",
      la: "تنها", lb: "متصل",
      inA: (d) => d.loneliness != null && d.loneliness >= 7,
      inB: (d) => d.loneliness != null && d.loneliness <= 4,
      outs: ["sMin", "mood", "stress", "anxiety", "sMinNx"],
    },
  ];
  return F.map((f) => ({ ...f, comp: compare(hist, f.inA, f.inB, f.outs.map((id) => MET[id])) }));
}

function computeStatInsights(factors) {
  const all = [];
  for (const f of factors) {
    const rows = f.comp.rows
      .filter((r) => r.sig)
      .sort((a, b) => Math.abs(b.t) - Math.abs(a.t))
      .slice(0, 2);
    for (const r of rows) all.push({ f, r });
  }
  return all.sort((a, b) => Math.abs(b.r.t) - Math.abs(a.r.t)).slice(0, 10);
}

/* ============================================================
   Aggregations
   ============================================================ */

function weekdayRows(pool) {
  const rows = Array.from({ length: 7 }, (_, wd) => ({
    wd, sMin: [], adh: [], score: [], sleep: [], mood: [],
  }));
  for (const d of pool) {
    const r = rows[d.wd];
    if (d.sMin != null) r.sMin.push(d.sMin);
    if (d.adh != null) r.adh.push(d.adh);
    if (isNum(d.score)) r.score.push(d.score);
    if (isNum(d.sleepHours)) r.sleep.push(d.sleepHours);
    if (isNum(d.mood)) r.mood.push(d.mood);
  }
  return rows;
}

const daypartOf = (h) => (h >= 5 && h < 12 ? 0 : h >= 12 && h < 17 ? 1 : h >= 17 && h < 22 ? 2 : 3);

function daypartStats(pool) {
  const rows = DAYPARTS.map((p) => ({ ...p, min: 0, n: 0, done: 0, paused: 0 }));
  for (const d of pool) {
    for (const s of d.sList) {
      const r = rows[daypartOf(s.start)];
      r.min += s.active;
      r.n++;
      if (s.done) r.done++;
      r.paused += s.paused;
    }
  }
  return rows;
}

function heatMatrix(pool) {
  const mat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  for (const d of pool) {
    for (const s of d.sList) {
      const wall = s.end - s.start;
      const h0 = Math.floor(s.start);
      const h1 = Math.max(h0 + 1, Math.ceil(s.end));
      for (let h = h0; h < h1; h++) {
        const ov = wall > 0 ? Math.max(0, Math.min(s.end, h + 1) - Math.max(s.start, h)) : h === h0 ? 1 : 0;
        const share = wall > 0 ? ov / wall : h === h0 ? 1 : 0;
        if (share > 0) mat[d.wd][h % 24] += s.active * share;
      }
    }
  }
  return mat;
}

function punctuality(pool) {
  const deltas = pool.filter((d) => d.pFirst != null && d.sFirst != null).map((d) => (d.sFirst - d.pFirst) * 60);
  if (deltas.length < 5) return null;
  return {
    n: deltas.length,
    mean: mean(deltas),
    median: median(deltas),
    within: deltas.filter((x) => Math.abs(x) <= 30).length / deltas.length,
  };
}

function computeDebt() {
  if (!data.plan || !data.study || !view.pIdx) return null;
  const { hist, pIdx, todayNum, byNum } = view;

  const plan = new Map();
  const act = new Map();
  for (const d of hist) {
    if (d.pMin == null || !d.hasStudy) continue;
    for (const [k, m] of d.pBySubj) plan.set(k, (plan.get(k) || 0) + m);
    for (const [k, m] of d.sBySubj) act.set(k, (act.get(k) || 0) + m);
  }
  const subs = [...plan.keys()]
    .map((k) => ({ key: k, planned: plan.get(k), actual: act.get(k) || 0, debt: Math.max(0, plan.get(k) - (act.get(k) || 0)) }))
    .sort((a, b) => b.debt - a.debt);
  const debt = sum(subs.map((s) => s.debt));

  let remaining = 0;
  for (const [date, e] of pIdx.byDate) if (keyToNum(date) > todayNum) remaining += planInfo(e.day).total;

  const capDays = [];
  for (let n = todayNum - CAPACITY_DAYS; n < todayNum; n++) {
    const d = byNum.get(n);
    if (d && d.sMin != null) capDays.push(d.sMin);
  }
  const weeklyCap = capDays.length >= 14 ? (sum(capDays) / capDays.length) * 7 : null;
  const weeksLeft = pIdx.last > todayNum ? (pIdx.last - todayNum) / 7 : 0;
  const projected = weeklyCap != null ? weeklyCap * weeksLeft : null;
  const need = remaining + debt;
  const examDate = data.study.studyPlan?.examDate || null;

  return {
    subs, debt, remaining, weeklyCap, weeksLeft, projected, need,
    coverage: projected != null && need > 0 ? projected / need : null,
    daysToExam: examDate ? keyToNum(examDate) - todayNum : null,
    planEnded: pIdx.last <= todayNum,
  };
}

/* ============================================================
   HTML helpers
   ============================================================ */

const panel = (id, title, body) => `<section class="ca-panel" id="${id}"><h2 class="ca-panel__title">${title}</h2>${body}</section>`;
const hintP = (t) => `<p class="ca-hint">${t}</p>`;
const subT = (t) => `<div class="ins-sub">${t}</div>`;
const needHint = (t) => hintP(`برای این بخش به ${t} نیاز است.`);

const card = (label, value, unit = "", sub = "", tone = "") => `
  <div class="ca-card">
    <div class="ca-card__label">${label}</div>
    <div class="ca-card__value" style="${tone === "bad" ? "color:var(--ca-bad)" : tone === "good" ? "color:var(--ca-good)" : ""}">
      ${value}${value !== "—" && unit ? `<small>${unit}</small>` : ""}
    </div>
    ${sub ? `<div class="ca-card__sub">${sub}</div>` : ""}
  </div>`;

function table(head, rows) {
  const cell = (c) => (c && typeof c === "object" ? `<td class="${c.cls || ""}">${c.v}</td>` : `<td>${c}</td>`);
  return `<div class="ca-table-wrap"><table class="ca-table ins-table">
    <thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map(cell).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

const barCell = (pct, tone = "") =>
  `${Math.round(pct)}٪<span class="ins-bar ${tone ? `ins-bar--${tone}` : ""}" style="width:${Math.min(100, Math.max(2, pct)) * 0.6}px"></span>`;
const adhTone = (a) => (a == null ? "" : a >= 0.8 ? "good" : a < 0.5 ? "bad" : "");
const dash = { v: "—", cls: "muted" };
const fx = (v, d = 1) => (isNum(v) ? v.toFixed(d) : dash);

const COMPARE_HINT = hintP(
  "Δ = گروه اول منهای گروه دوم؛ سبز یعنی به نفع وضعیت بهتر. ردیف‌های کم‌رنگ هنوز قابل‌اتکا نیستند (آزمون تقریبی و محافظه‌کارانه). حال «همان روز» از چک‌این شب است و خودِ مطالعه روی آن اثر دارد. این‌ها رابطه‌اند، نه علت."
);

function compareRows(comp, la, lb) {
  if (!comp.rows.length) {
    return hintP(`داده‌ی کافی نیست: ${la} ${comp.na} روز، ${lb} ${comp.nb} روز (حداقل ${MIN_GROUP_N} روز با داده‌ی همان معیار در هر گروه لازم است).`);
  }
  return (
    `<div class="ca-corr">` +
    comp.rows
      .map((r) => {
        const col = r.better == null ? "var(--ca-text)" : r.better ? "var(--ca-good)" : "var(--ca-bad)";
        const k = r.m.kind;
        return `
      <div class="ca-corr-row" style="${r.sig ? "" : "opacity:0.55"}">
        <div class="ca-corr-row__label">${r.m.label}</div>
        <div class="ins-cmp">
          <span>${la} ${fmtVal(k, r.ma)} <small>(n=${r.na})</small></span>
          <span>${lb} ${fmtVal(k, r.mb)} <small>(n=${r.nb})</small></span>
          <b style="color:${col}">${fmtDiff(k, r.diff)}</b>
        </div>
      </div>`;
      })
      .join("") +
    `</div>`
  );
}

/* ============================================================
   Charts
   ============================================================ */

const NICE = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100];
const niceMax = (v) => NICE.find((n) => n >= v) ?? Math.ceil(v / 10) * 10;

function renderLegend(chartEl, items) {
  let lg = chartEl.nextElementSibling;
  if (!lg || !lg.classList.contains("ca-legend")) {
    lg = document.createElement("div");
    lg.className = "ca-legend";
    chartEl.after(lg);
  }
  lg.innerHTML = items
    .map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.label}</span>`)
    .join("");
}

function buildBarChart(el, items, { bars, line = null, ref = null, div = 60 }) {
  if (!items.length) return "";
  const W = Math.max(320, el.clientWidth || 800);
  const H = 240;
  const padL = 34, padR = line ? 30 : 12, padT = 14, padB = 28;
  const iw = W - padL - padR;
  const ih = H - padT - padB;

  const maxRaw = Math.max(1, ...items.flatMap((it) => bars.map((b) => it[b.key] ?? 0)), ref ? ref.value : 0);
  const yMax = niceMax(maxRaw / div);
  const yAt = (v) => padT + ih - (v / div / yMax) * ih;

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const val = (yMax * i) / 4;
    const y = padT + ih - (i / 4) * ih;
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--ca-border)" stroke-width="1" opacity="0.5" />`;
    grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--ca-muted)">${Number.isInteger(val) ? val : val.toFixed(1)}</text>`;
  }

  const band = iw / items.length;
  const bw = Math.max(1.5, Math.min(18, (band * 0.8) / bars.length));
  let rects = "";
  items.forEach((it, i) => {
    bars.forEach((b, j) => {
      const v = it[b.key];
      if (!isNum(v) || v <= 0) return;
      const x = padL + band * i + (band - bw * bars.length) / 2 + bw * j;
      const y = yAt(v);
      rects += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${(padT + ih - y).toFixed(1)}" rx="1.5" fill="${b.color}" opacity="${b.opacity ?? 1}"><title>${it.label} — ${b.label}: ${(v / div).toFixed(1)}</title></rect>`;
    });
  });

  let lineSvg = "";
  let rightTicks = "";
  if (line) {
    const yL = (v) => padT + ih - ((v - line.min) / (line.max - line.min)) * ih;
    const segs = [];
    let seg = [];
    items.forEach((it, i) => {
      const v = it[line.key];
      if (!isNum(v)) {
        if (seg.length) segs.push(seg);
        seg = [];
        return;
      }
      seg.push([padL + band * i + band / 2, yL(Math.max(line.min, Math.min(line.max, v)))]);
    });
    if (seg.length) segs.push(seg);
    for (const sg of segs) {
      if (sg.length > 1) {
        lineSvg += `<polyline points="${sg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="none" stroke="${line.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />`;
      }
    }
    for (const v of [line.min, (line.min + line.max) / 2, line.max]) {
      rightTicks += `<text x="${W - padR + 4}" y="${yL(v) + 3}" font-size="9" fill="${line.color}">${Math.round(v)}</text>`;
    }
  }

  let refSvg = "";
  if (ref) {
    const y = yAt(ref.value);
    refSvg = `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--ca-warn)" stroke-width="1.4" stroke-dasharray="5 4" />`;
  }

  let xl = "";
  const ticks = Math.min(6, items.length);
  for (let t = 0; t < ticks; t++) {
    const i = ticks === 1 ? 0 : Math.round(((items.length - 1) * t) / (ticks - 1));
    xl += `<text x="${padL + band * i + band / 2}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--ca-muted)">${items[i].label}</text>`;
  }

  return `<svg viewBox="0 0 ${W} ${H}">${grid}${refSvg}${rects}${lineSvg}${rightTicks}${xl}</svg>`;
}

function drawCharts() {
  if (!view) return;
  const { visible, blocks } = view;

  const a = $("insChartPlan");
  if (a) {
    const items = visible.map((d) => ({ label: shortDate(d.dayNum), planned: d.pMin, actual: d.sMin }));
    const bars = [];
    if (data.plan) bars.push({ key: "planned", color: "#6ea8ff", opacity: 0.5, label: "برنامه (ساعت)" });
    if (data.study) bars.push({ key: "actual", color: "#34d399", label: "انجام‌شده (ساعت)" });
    const goal = data.study?.studyPlan?.dailyGoalMinutes;
    a.innerHTML = buildBarChart(a, items, { bars, ref: goal ? { value: goal } : null });
    renderLegend(a, [...bars, ...(goal ? [{ color: "var(--ca-warn)", label: "هدف روزانه" }] : [])]);
  }

  const b = $("insChartLoad");
  if (b) {
    const items = visible.map((d) => ({ label: shortDate(d.dayNum), actual: d.sMin, scoreMA: d.scoreMA }));
    b.innerHTML = buildBarChart(b, items, {
      bars: [{ key: "actual", color: "#34d399", opacity: 0.75, label: "مطالعه (ساعت)" }],
      line: { key: "scoreMA", color: "#a78bfa", min: 1, max: 10 },
    });
    renderLegend(b, [
      { color: "#34d399", label: "مطالعه (ساعت — محور چپ)" },
      { color: "#a78bfa", label: "میانگین ۷روزه‌ی امتیاز روانی (محور راست)" },
    ]);
  }

  const c = $("insChartWeeks");
  if (c && blocks) {
    const items = [...blocks].reverse().map((w) => ({ label: shortDate(w.start), hours: w.hours, planned: w.planned }));
    const bars = [{ key: "hours", color: "#34d399", label: "مطالعه (ساعت)" }];
    if (data.plan) bars.unshift({ key: "planned", color: "#6ea8ff", opacity: 0.5, label: "برنامه (ساعت)" });
    c.innerHTML = buildBarChart(c, items, { bars, div: 1 });
    renderLegend(c, bars);
  }
}

/* ============================================================
   Panels
   ============================================================ */

function kpiPanel() {
  const { visible, complete, days, byNum, todayNum } = view;
  const cards = [];

  if (data.study) {
    const total = sum(visible.map((d) => d.sMin ?? 0));
    const cd = complete.filter((d) => d.sMin != null);
    const avgDay = cd.length ? sum(cd.map((d) => d.sMin)) / cd.length : null;
    const active = cd.filter((d) => d.sMin > 0).length;

    let n = todayNum;
    if (!(byNum.get(n)?.sMin > 0)) n--;
    let streak = 0;
    while (byNum.get(n)?.sMin > 0) { streak++; n--; }

    cards.push(card("مطالعه‌ی کل", fmtH(total), "ساعت", avgDay != null ? `میانگین روزانه ${fmtH(avgDay)} ساعت` : ""));
    cards.push(card("روزهای فعال", cd.length ? Math.round((active / cd.length) * 100) : "—", "٪", `${active} از ${cd.length} روز`));
    cards.push(card("رشته‌ی پیاپی", streak, "روز", "روزهای متوالی با مطالعه"));
  }

  if (data.study && data.plan) {
    const pd = complete.filter((d) => d.adh != null);
    if (pd.length) {
      const wa = sum(pd.map((d) => d.sMin)) / sum(pd.map((d) => d.pMin));
      const ok = pd.filter((d) => d.adh >= 0.8).length;
      cards.push(card("پایبندی به برنامه", Math.round(wa * 100), "٪", `${ok} از ${pd.length} روز بالای ۸۰٪`, wa >= 0.8 ? "good" : wa < 0.5 ? "bad" : ""));
    } else {
      cards.push(card("پایبندی به برنامه", "—", "", "روزی با برنامه در این بازه نیست"));
    }
    const debt = view.debt;
    if (debt) cards.push(card("بدهی مطالعه", fmtH(debt.debt), "ساعت", "برنامه منهای انجام‌شده (تا امروز)", debt.debt > 0 ? "bad" : "good"));
  }

  if (data.checkin) {
    const sc = visible.filter((d) => isNum(d.score));
    const seg = (from, to) => days.filter((d) => d.dayNum >= from && d.dayNum <= to && isNum(d.score)).map((d) => d.score);
    const cur = seg(todayNum - 6, todayNum);
    const prev = seg(todayNum - 13, todayNum - 7);
    let sub = "";
    if (cur.length >= 3 && prev.length >= 3) {
      const diff = mean(cur) - mean(prev);
      sub = `${diff > 0.3 ? "▲" : diff < -0.3 ? "▼" : "◀▶"} نسبت به هفته‌ی قبل (${diff > 0 ? "+" : ""}${diff.toFixed(1)})`;
    }
    cards.push(card("امتیاز روانی (میانگین)", sc.length ? avgOf(sc, "score").toFixed(1) : "—", "/۱۰", sub));
    const sl = avgOf(visible, "sleepHours");
    cards.push(card("میانگین خواب", sl != null ? sl.toFixed(1) : "—", "ساعت"));
    cards.push(card("پوشش چک‌این", visible.filter((d) => d.hasCheckin).length, `/ ${visible.length}`, "روزِ دارای چک‌این"));
  }

  return panel("insKpi", "شاخص‌های کلیدی", `<div class="ca-summary">${cards.join("")}</div>`);
}

function computeDescInsights() {
  const out = [];
  const push = (tone, text) => out.push({ tone, text });
  const { complete, MET } = view;

  if (data.study) {
    const rows = weekdayRows(complete).filter((r) => r.sMin.length >= 3);
    if (rows.length >= 4) {
      const av = (r) => mean(r.sMin);
      const best = rows.reduce((a, b) => (av(b) > av(a) ? b : a));
      const worst = rows.reduce((a, b) => (av(b) < av(a) ? b : a));
      if (av(best) > av(worst)) {
        push("info", `بهترین روز مطالعه‌ات <b>${WEEKDAY_NAMES_FA[best.wd]}</b> است (میانگین ${fmtH(av(best))} ساعت) و ضعیف‌ترین <b>${WEEKDAY_NAMES_FA[worst.wd]}</b> (${fmtH(av(worst))} ساعت).`);
      }
    }

    const tot = sum(complete.map((d) => d.sMin ?? 0));
    const late = sum(complete.map((d) => d.sLate ?? 0));
    if (tot > 300 && late / tot >= 0.15) {
      push("warn", `${Math.round((late / tot) * 100)}٪ از مطالعه‌ات بعد از ۲۲:۰۰ انجام شده — اگر خواب را به‌هم می‌زند، بخش «عوامل» را ببین.`);
    }

    const dp = daypartStats(view.visible).filter((r) => r.n >= 5);
    if (dp.length >= 2) {
      const rate = (r) => r.done / r.n;
      const best = dp.reduce((a, b) => (rate(b) > rate(a) ? b : a));
      const worst = dp.reduce((a, b) => (rate(b) < rate(a) ? b : a));
      if (rate(best) - rate(worst) >= 0.15) {
        push("info", `بیشترین نرخ تکمیل جلسه در «${best.label}» است (${Math.round(rate(best) * 100)}٪) و کمترین در «${worst.label}» (${Math.round(rate(worst) * 100)}٪).`);
      }
    }
  }

  if (data.study && data.plan) {
    const pd = complete.filter((d) => d.adh != null);
    if (pd.length >= 7) {
      const med = median(pd.map((d) => d.adh));
      if (med < 0.85) {
        push("warn", `نصف روزهایت کمتر از ${Math.round(med * 100)}٪ برنامه را انجام داده‌ای؛ برنامه به‌طور معمول بیشتر از ظرفیت واقعی‌ات است.`);
      }
      const last = pd.slice(-14);
      const prev = pd.slice(-28, -14);
      if (last.length >= 5 && prev.length >= 5) {
        const w = (a) => sum(a.map((d) => d.sMin)) / sum(a.map((d) => d.pMin));
        const diff = w(last) - w(prev);
        if (Math.abs(diff) >= 0.08) {
          push(diff > 0 ? "good" : "bad", `پایبندی ۱۴ روز اخیر ${Math.round(w(last) * 100)}٪ است؛ ${diff > 0 ? "بهتر" : "ضعیف‌تر"} از ۱۴ روز قبل از آن (${Math.round(w(prev) * 100)}٪).`);
        }
      }
    }
    const missed = complete.filter((d) => d.pMin > 0 && d.sMin === 0).length;
    if (missed >= 3) push("bad", `${missed} روز برنامه داشتی ولی هیچ جلسه‌ای ثبت نشده.`);

    const debt = view.debt;
    if (debt?.subs.length && debt.subs[0].debt >= 120) {
      push("warn", `بیشترین بدهی مطالعه مربوط به «${subjLabel(debt.subs[0].key)}» است (${fmtH(debt.subs[0].debt)} ساعت کمتر از برنامه).`);
    }
    const pu = punctuality(complete);
    if (pu && Math.abs(pu.median) >= 30) {
      push("info", `معمولاً ${Math.round(Math.abs(pu.median))} دقیقه ${pu.median > 0 ? "دیرتر" : "زودتر"} از ساعت برنامه‌ریزی‌شده شروع می‌کنی.`);
    }
  }

  void MET;
  return out;
}

function insightsPanel() {
  const stat = view.statInsights;
  const desc = view.descInsights;
  let html = "";

  html += subT("الگوهای رفتاری");
  html += desc.length
    ? `<div class="ins-list">${desc.map((x) => `<div class="ins-item ins-item--${x.tone}">${x.text}</div>`).join("")}</div>`
    : hintP("هنوز الگوی توصیفیِ قابل‌گفتن نیست؛ با ثبت چند هفته‌ی دیگر پر می‌شود.");

  html += subT("یافته‌های آماری (رابطه، نه علت)");
  if (stat.length) {
    html += `<div class="ins-list">${stat
      .map(({ f, r }) => {
        const tone = r.better == null ? "info" : r.better ? "good" : "bad";
        const k = r.m.kind;
        return `<div class="ins-item ins-item--${tone}">
          <b>«${f.la}»</b> در برابر <b>«${f.lb}»</b> — ${r.m.label}: ${fmtVal(k, r.ma)} در برابر ${fmtVal(k, r.mb)}
          (${fmtDiff(k, r.diff)})
          <small>— ${r.na} و ${r.nb} روز</small>
        </div>`;
      })
      .join("")}</div>${hintP("فقط تفاوت‌هایی که از آستانه‌ی محافظه‌کارانه گذشته‌اند آمده‌اند (حداقل ۸ روز در هر گروه). جزئیات و بقیه‌ی عامل‌ها در بخش «عوامل مؤثر» است.")}`;
  } else {
    html += hintP(
      data.study && data.checkin
        ? "هنوز تفاوت معناداری پیدا نشده یا داده کافی نیست (حداقل ۸ روز در هر گروه لازم است). با ثبت بیشتر، این بخش پر می‌شود."
        : "برای یافته‌های آماری هر دو فایل «مطالعه» و «چک‌این» لازم است."
    );
  }
  return panel("insInsights", "یافته‌های خودکار", html);
}

function chartsPanel() {
  if (!data.study && !data.plan) return "";
  let html = subT("ساعت برنامه‌ریزی‌شده در برابر انجام‌شده (روزانه)") + `<div class="ca-chart" id="insChartPlan"></div>`;
  if (data.study && data.checkin) {
    html +=
      subT("بار مطالعه در برابر وضعیت روانی") +
      `<div class="ca-chart" id="insChartLoad"></div>` +
      hintP("اگر خط بنفش (امتیاز روانی) پس از دوره‌های پرمطالعه پایین می‌آید، ممکن است بار زیاد باشد؛ برعکس، اگر در روزهای کم‌مطالعه هم پایین است، علت چیز دیگری است.");
  }
  return panel("insCharts", "نمودارها", html);
}

function planWeekRows() {
  const { pIdx, byNum, todayNum, visible } = view;
  const rangeStart = visible.length ? visible[0].dayNum : -Infinity;
  const rows = [];
  for (const w of pIdx.weeks) {
    const s = keyToNum(w.startDate);
    const e = keyToNum(w.endDate);
    if (s >= todayNum || e < rangeStart) continue;
    let planned = 0, plannedTD = 0, actualTD = 0;
    for (const day of w.days || []) {
      const n = keyToNum(day.date);
      const m = planInfo(day).total;
      planned += m;
      if (n < todayNum) {
        plannedTD += m;
        const d = byNum.get(n);
        if (d && d.sMin != null) actualTD += d.sMin;
      }
    }
    rows.push({ w, s, e, planned, plannedTD, actualTD, current: e >= todayNum });
  }
  return rows.slice(-16);
}

function adherencePanel() {
  if (!data.plan || !data.study) return panel("insAdh", "پایبندی به برنامه", needHint("هر دو فایل «برنامه‌ی هفتگی» و «مطالعه»"));
  const pool = view.complete.filter((d) => d.pMin != null && d.hasStudy);
  if (!pool.length) return panel("insAdh", "پایبندی به برنامه", hintP("در بازه‌ی انتخابی روزی با برنامه‌ی ثبت‌شده نیست."));

  let html = "";

  const wk = planWeekRows();
  if (wk.length) {
    html += subT("هفته‌های برنامه");
    html += table(
      ["هفته", "بازه", "هدف (س)", "برنامه (س)", "انجام‌شده (س)", "پایبندی"],
      wk.map((r) => {
        const a = r.plannedTD > 0 ? r.actualTD / r.plannedTD : null;
        return [
          `${esc(r.w.title)}${r.current ? ' <small class="muted">(جاری)</small>' : ""}`,
          `${shortDate(r.s)} → ${shortDate(r.e)}`,
          fmtH(r.w.targetMinutes || 0),
          fmtH(r.planned),
          fmtH(r.actualTD),
          a == null ? dash : barCell(a * 100, adhTone(a)),
        ];
      })
    );
  }

  const P = new Map();
  const A = new Map();
  for (const d of pool) {
    for (const [k, m] of d.pBySubj) P.set(k, (P.get(k) || 0) + m);
    for (const [k, m] of d.sBySubj) A.set(k, (A.get(k) || 0) + m);
  }
  const keys = [...new Set([...P.keys(), ...A.keys()])].sort(
    (a, b) => Math.max(P.get(b) || 0, A.get(b) || 0) - Math.max(P.get(a) || 0, A.get(a) || 0)
  );
  html += subT("به تفکیک درس");
  html += table(
    ["درس", "برنامه (س)", "انجام‌شده (س)", "اختلاف (س)", "پایبندی"],
    keys.slice(0, 20).map((k) => {
      const p = P.get(k) || 0;
      const a = A.get(k) || 0;
      const ratio = p > 0 ? a / p : null;
      const diff = a - p;
      return [
        subjLabel(k),
        p ? fmtH(p) : dash,
        a ? fmtH(a) : dash,
        { v: `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${fmtH(Math.abs(diff))}`, cls: diff < -60 ? "ca-cell-bad" : diff > 60 ? "ca-cell-good" : "" },
        ratio == null ? { v: "خارج از برنامه", cls: "muted" } : barCell(ratio * 100, adhTone(ratio)),
      ];
    })
  );

  const dtRows = ["A", "B", "C"]
    .map((t) => {
      const g = pool.filter((d) => d.dayType === t);
      if (!g.length) return null;
      const ratio = sum(g.map((d) => d.sMin)) / Math.max(1, sum(g.map((d) => d.pMin)));
      return [
        `${DAYTYPE_NAMES[t]} <small class="muted">(${t})</small>`,
        g.length,
        fmtH(sum(g.map((d) => d.pMin)) / g.length),
        fmtH(sum(g.map((d) => d.sMin)) / g.length),
        barCell(ratio * 100, adhTone(ratio)),
        fx(avgOf(g, "score")),
        fx(avgOf(g, "sleepHours")),
        fx(avgOf(g, "stress")),
      ];
    })
    .filter(Boolean);
  const typeRows = TYPE_KEYS.map((t) => {
    const p = sum(pool.map((d) => d.pByType[t]));
    const a = sum(pool.map((d) => d.sByType[t]));
    if (!p && !a) return null;
    return [TYPE_NAMES[t], p ? fmtH(p) : dash, a ? fmtH(a) : dash, p > 0 ? barCell((a / p) * 100, adhTone(a / p)) : { v: "خارج از برنامه", cls: "muted" }];
  }).filter(Boolean);

  html +=
    `<div class="ins-split"><div>` +
    subT("به تفکیک نوع روز") +
    (dtRows.length ? table(["نوع روز", "روز", "برنامه/روز (س)", "انجام/روز (س)", "پایبندی", "امتیاز", "خواب", "استرس"], dtRows) : hintP("نوع روز (dayType) در برنامه ثبت نشده."))
    + `</div><div>` +
    subT("به تفکیک نوع جلسه") +
    table(["نوع", "برنامه (س)", "انجام‌شده (س)", "پایبندی"], typeRows) +
    `</div></div>`;

  const unplanned = sum(view.complete.filter((d) => d.pMin == null && d.sMin).map((d) => d.sMin));
  if (unplanned > 0) html += hintP(`مطالعه در روزهای بدون برنامه (${fmtH(unplanned)} ساعت) در این جدول‌ها نیامده است.`);

  return panel("insAdh", "پایبندی به برنامه", html);
}

function debtPanel() {
  if (!data.plan || !data.study) return panel("insDebt", "بدهی مطالعه و پیش‌بینی سرعت", needHint("هر دو فایل «برنامه‌ی هفتگی» و «مطالعه»"));
  const x = view.debt;
  if (!x) return "";

  let html = `<div class="ca-summary">
    ${card("بدهی مطالعه", fmtH(x.debt), "ساعت", "جمع کمبودِ هر درس تا امروز", x.debt > 0 ? "bad" : "good")}
    ${card("برنامه‌ی باقی‌مانده", fmtH(x.remaining), "ساعت", x.planEnded ? "برنامه به پایان رسیده" : `${Math.round(x.weeksLeft)} هفته مانده`)}
    ${card("ظرفیت اخیر", x.weeklyCap != null ? fmtH(x.weeklyCap) : "—", "ساعت در هفته", `میانگین ${CAPACITY_DAYS} روز اخیر`)}
    ${x.daysToExam != null ? card("تا امتحان", x.daysToExam, "روز") : ""}
  </div>`;

  if (x.coverage != null) {
    const pct = Math.round(x.coverage * 100);
    html += `<div class="ins-list" style="margin-top:12px"><div class="ins-item ins-item--${pct >= 90 ? "good" : pct >= 65 ? "warn" : "bad"}">
      با همین سرعتِ اخیر تا پایان برنامه حدود <b>${fmtH(x.projected)} ساعت</b> مطالعه می‌کنی؛ برنامه‌ی باقی‌مانده به‌علاوه‌ی بدهی <b>${fmtH(x.need)} ساعت</b> است
      — یعنی حدود <b>${pct}٪</b> پوشش.
    </div></div>`;
  } else if (!x.planEnded) {
    html += hintP("برای پیش‌بینی سرعت، حداقل ۱۴ روز مطالعه‌ی ثبت‌شده در ۴ هفته‌ی اخیر لازم است.");
  }

  const top = x.subs.filter((s) => s.debt > 0).slice(0, 8);
  if (top.length) {
    html += subT("بیشترین بدهی به تفکیک درس");
    html += table(
      ["درس", "برنامه (س)", "انجام‌شده (س)", "بدهی (س)"],
      top.map((s) => [subjLabel(s.key), fmtH(s.planned), fmtH(s.actual), { v: fmtH(s.debt), cls: "ca-cell-bad" }])
    );
  }
  html += hintP("پیش‌بینی خطی است و فرض می‌کند ظرفیت اخیرت ثابت می‌ماند؛ روزهای تعطیل یا سفر و اوج امتحان را در نظر نمی‌گیرد. بدهی هم خالص است: روزی که بیشتر خوانده‌ای کمبود روز دیگر را پر می‌کند.");
  return panel("insDebt", "بدهی مطالعه و پیش‌بینی سرعت", html);
}

function heatHtml(mat) {
  const max = Math.max(1, ...mat.flat());
  let h = `<div class="ins-heat"><div></div>`;
  for (let i = 0; i < 24; i++) h += `<div class="ins-heat__hr">${i % 3 === 0 ? pad2(i) : ""}</div>`;
  for (const wd of WEEK_ORDER) {
    h += `<div class="ins-heat__lbl" dir="rtl">${WEEKDAY_NAMES_FA[wd]}</div>`;
    for (let i = 0; i < 24; i++) {
      const v = mat[wd][i];
      const bg = v <= 0 ? "" : `background:hsl(210 80% 58% / ${(0.12 + 0.88 * Math.pow(v / max, 0.7)).toFixed(2)})`;
      h += `<div class="ins-heat__cell" style="${bg}" title="${WEEKDAY_NAMES_FA[wd]} ${pad2(i)}:00 — ${Math.round(v)} دقیقه"></div>`;
    }
  }
  return h + `</div>`;
}

function timePanel() {
  if (!data.study) return panel("insTime", "الگوهای زمانی", needHint("فایل «مطالعه»"));
  const { visible, complete } = view;
  if (!visible.some((d) => d.sList.length)) return panel("insTime", "الگوهای زمانی", hintP("در این بازه جلسه‌ای ثبت نشده."));

  let html = subT("نقشه‌ی گرمایی: جمع دقیقه‌های مطالعه (روز هفته × ساعت)") + heatHtml(heatMatrix(visible));
  html += hintP("جلسه‌هایی که از نیمه‌شب می‌گذرند به روزِ شروع‌شان نسبت داده شده‌اند.");

  const dp = daypartStats(visible);
  const totalMin = sum(dp.map((r) => r.min)) || 1;
  const wd = weekdayRows(complete);

  html +=
    `<div class="ins-split"><div>` +
    subT("بازه‌های روز") +
    table(
      ["بازه", "سهم مطالعه", "جلسه", "میانگین طول", "نرخ تکمیل"],
      dp.map((r) => [
        r.label,
        barCell((r.min / totalMin) * 100),
        r.n,
        r.n ? `${Math.round(r.min / r.n)} دق` : dash,
        r.n >= 3 ? barCell((r.done / r.n) * 100, r.done / r.n >= 0.8 ? "good" : r.done / r.n < 0.6 ? "bad" : "") : dash,
      ])
    ) +
    `</div><div>` +
    subT("روزهای هفته") +
    table(
      ["روز", "مطالعه (س)", "پایبندی", "امتیاز", "خواب"],
      WEEK_ORDER.map((i) => {
        const r = wd[i];
        return [
          WEEKDAY_NAMES_FA[i],
          r.sMin.length ? fmtH(mean(r.sMin)) : dash,
          r.adh.length ? `${Math.round(mean(r.adh) * 100)}٪` : dash,
          r.score.length ? mean(r.score).toFixed(1) : dash,
          r.sleep.length ? mean(r.sleep).toFixed(1) : dash,
        ];
      })
    ) +
    `</div></div>`;
  html += hintP("«نرخ تکمیل» = سهم جلساتی که تا پایانِ زمان برنامه‌ریزی‌شده رفته‌اند (نه نیمه‌کاره رها شده‌اند).");
  return panel("insTime", "الگوهای زمانی", html);
}

function qualityPanel() {
  if (!data.study) return "";
  const { visible, complete } = view;
  const sess = visible.flatMap((d) => d.sList);
  if (!sess.length) return "";

  const done = sess.filter((s) => s.done).length;
  const avgLen = mean(sess.map((s) => s.active));
  const avgPause = mean(sess.map((s) => s.paused));
  const longest = Math.max(...sess.map((s) => s.active));
  const pu = data.plan ? punctuality(complete) : null;

  const cards = [
    card("جلسه", sess.length, "", `${(sess.length / Math.max(1, visible.filter((d) => d.sMin > 0).length)).toFixed(1)} جلسه در روزِ فعال`),
    card("میانگین طول جلسه", Math.round(avgLen), "دقیقه", `بلندترین ${Math.round(longest)} دقیقه`),
    card("نرخ تکمیل", Math.round((done / sess.length) * 100), "٪", `${done} از ${sess.length} جلسه تا آخر رفته`, done / sess.length >= 0.8 ? "good" : done / sess.length < 0.6 ? "bad" : ""),
    card("مکث در هر جلسه", avgPause.toFixed(1), "دقیقه"),
  ];
  if (pu) {
    cards.push(card("وقت‌شناسی", `${pu.median > 0 ? "+" : pu.median < 0 ? "−" : ""}${Math.round(Math.abs(pu.median))}`, "دقیقه", `میانه‌ی اختلاف شروع؛ ${Math.round(pu.within * 100)}٪ روزها در ±۳۰ دقیقه`));
  }
  return panel("insQuality", "کیفیت جلسه‌ها", `<div class="ca-summary">${cards.join("")}</div>`);
}

/* ---------- v6: Exercise breakdown ---------- */

function exercisePanel() {
  if (!data.checkin) return "";
  const pool = view.visible.filter((d) => d.exerciseType);
  if (!pool.length) {
    return panel("insExercise", "ورزش — تفکیک", hintP("هنوز ورزشی با نوع (تکواندو/بندسازی/پیاده‌روی/…) ثبت نشده."));
  }

  const TYPES = [
    ["taekwondo", "تکواندو"],
    ["bjj", "بندسازی"],
    ["walking", "پیاده‌روی"],
    ["cardio", "هوازی"],
    ["strength", "قدرتی"],
    ["yoga", "یوگا/کشش"],
    ["sports", "ورزش تیمی"],
    ["other", "سایر"],
  ];

  const rows = TYPES.map(([key, label]) => {
    const days = pool.filter((d) => d.exerciseType === key);
    if (!days.length) return null;
    const minDays = days.map((d) => d.exerciseMinutes).filter(isNum);
    return [
      label,
      days.length,
      minDays.length ? `${Math.round(mean(minDays))} دق` : "—",
      fx(avgOf(days, "focusQuality")),
      fx(avgOf(days, "mood")),
      fx(avgOf(days, "sMin")),
      fx(avgOf(days, "sleepQuality")),
    ];
  }).filter(Boolean);

  return panel(
    "insExercise",
    "ورزش — تفکیک",
    table(
      ["نوع", "روز", "میانگین مدت", "تمرکز (ADHD)", "خلق", "مطالعه (دق)", "کیفیت خواب"],
      rows
    ) +
    hintP("فقط روزهایی که ورزش با نوع مشخص ثبت شده‌اند. تمرکز/خلق/خواب همان روزِ ورزش هستند؛ مقایسه‌ی دقیق در بخش «عوامل مؤثر» است.")
  );
}

/* ---------- Correlations ---------- */

const CORRS = [
  ["ساعت خواب دیشب × مطالعه‌ی امروز", "sleepHours", "sMin"],
  ["کیفیت خواب دیشب × مطالعه‌ی امروز", "sleepQuality", "sMin"],
  ["زمان به خواب رفتن دیشب × مطالعه‌ی امروز", "sleepLatency", "sMin"],
  ["حال صبح × مطالعه‌ی امروز", "morningMood", "sMin"],
  ["انرژی صبح × مطالعه‌ی امروز", "morningEnergy", "sMin"],
  ["ساعت خواب دیشب × پایبندی به برنامه", "sleepHours", "adh"],
  ["مطالعه‌ی روز قبل × مطالعه‌ی امروز", "prevStudy", "sMin"],
  ["استرس امروز × مطالعه‌ی فردا", "stress", "sMinNx"],
  ["اضطراب امروز × مطالعه‌ی فردا", "anxiety", "sMinNx"],
  ["مطالعه‌ی امروز × کیفیت خواب شب بعد", "sMin", "sleepQualityNx"],
  ["مطالعه‌ی امروز × زمان به خواب رفتن شب بعد", "sMin", "sleepLatencyNx"],
  ["مطالعه‌ی بعد از ۲۲:۰۰ × زمان به خواب رفتن شب بعد", "sLate", "sleepLatencyNx"],
  ["مطالعه‌ی امروز × خلق فردا", "sMin", "moodNx"],
  ["مطالعه‌ی امروز × استرس فردا", "sMin", "stressNx"],
  ["پایبندی به برنامه × خلق همان روز", "adh", "mood"],
  ["پایبندی به برنامه × استرس همان روز", "adh", "stress"],
  ["دقایق تمرین و تست × اضطراب همان روز", "testMin", "anxiety"],
  ["کافئین × مطالعه‌ی همان روز", "caffeine", "sMin"],
  ["میانگین طول جلسه × تمرکز همان روز", "sessLen", "focus"],

  /* v6: ADHD ↔ study */
  ["کیفیت تمرکز (ADHD) × مطالعه‌ی همان روز", "focusQuality", "sMin"],
  ["شاخص ADHD (composite) × مطالعه‌ی همان روز", "adhdIndex", "sMin"],
  ["به تعویق انداختن کارها × مطالعه‌ی همان روز", "taskProcrastination", "sMin"],
  ["امتیاز بازیابی (composite) × مطالعه‌ی همان روز", "recoveryScore", "sMin"],
  ["امتیاز سلامت خواب (composite) × مطالعه‌ی همان روز", "sleepHealth", "sMin"],

  /* v6: exercise types ↔ study/focus */
  ["روز تکواندو × خلق همان روز", "exerciseTaekwondo", "mood"],
  ["روز تکواندو × کیفیت تمرکز همان روز", "exerciseTaekwondo", "focusQuality"],
  ["روز تکواندو × کیفیت خواب شب بعد", "exerciseTaekwondo", "sleepQualityNx"],
  ["روز پیاده‌روی × خلق همان روز", "exerciseWalking", "mood"],
  ["روز بندسازی × خلق همان روز", "exerciseBJJ", "mood"],
  ["دقایق ورزش × مطالعه‌ی فردا", "exerciseMin", "sMinNx"],
  ["ورزش شدید × خواب شب بعد", "exerciseIntensityVigorous", "sleepQualityNx"],

  /* v6: circadian */
  ["نور صبح × کیفیت تمرکز (ADHD)", "morningLightMin", "focusQuality"],
  ["نور صبح × مطالعه‌ی همان روز", "morningLightMin", "sMin"],
  ["نور شدید شب × کیفیت خواب شب بعد", "eveningBrightLightShare", "sleepQualityNx"],

  /* v6: meds */
  ["اثر قرص صبح × کیفیت تمرکز همان روز", "medAmEffect", "focusQuality"],
  ["اثر قرص صبح × مطالعه‌ی همان روز", "medAmEffect", "sMin"],
  ["اثر قرص عصر × خلق همان روز", "medPmEffect", "mood"],
  ["عوارض قرص صبح × استرس همان روز", "medAmSideCount", "stress"],
  ["عوارض قرص عصر × خواب شب بعد", "medPmSideCount", "sleepQualityNx"],

  /* v6: physical */
  ["سردرد × مطالعه‌ی همان روز", "headache", "sMin"],
  ["خستگی غیرمعمول × مطالعه‌ی همان روز", "fatigueBeyond", "sMin"],
  ["خستگی غیرمعمول × کیفیت تمرکز همان روز", "fatigueBeyond", "focusQuality"],

  /* v6: events */
  ["رویداد استرس‌زا × مطالعه‌ی همان روز", "stressorCount", "sMin"],
  ["رویداد استرس‌زا × مطالعه‌ی فردا", "stressorCount", "sMinNx"],
  ["رویداد استرس‌زا × زمان به خواب شب بعد", "stressorCount", "sleepLatencyNx"],

  /* v6: social */
  ["تنهایی × خلق همان روز", "loneliness", "mood"],
  ["روز با ارتباط معنادار × خلق همان روز", "socialContactShare", "mood"],
  ["روز با ارتباط معنادار × مطالعه‌ی همان روز", "socialContactShare", "sMin"],

  /* v6: wellbeing */
  ["تحریک‌پذیری × استرس همان روز", "irritability", "stress"],
  ["نشخوار فکری × زمان به خواب شب بعد", "rumination", "sleepLatencyNx"],
  ["معناداری × مطالعه‌ی همان روز", "meaningfulness", "sMin"],

  /* v6: caffeine timing */
  ["ساعت آخرین کافئین × زمان به خواب شب بعد", "caffeineLastTime", "sleepLatencyNx"],
  ["لیوان کافئین × زمان به خواب شب بعد", "caffeineCups", "sleepLatencyNx"],
  ["دفعات قند/شیرینی × انرژی همان روز", "sugarEpisodes", "energy"],
  ["لیوان آب × کیفیت تمرکز همان روز", "waterGlasses", "focusQuality"],
  ["ساعت اولین وعده × انرژی همان روز", "firstMealTime", "energy"],

  /* v6: masturbation */
  ["شدت میل خودارضایی × استرس همان روز", "mastUrge", "stress"],
  ["احساس گناه خودارضایی × خلق فردا", "mastGuilt", "moodNx"],
];

function corrHtml(pool) {
  const out = [];
  for (const [label, kx, ky] of CORRS) {
    const mx = view.MET[kx];
    const my = view.MET[ky];
    if (!mx || !my) continue;
    const pairs = [];
    for (const d of pool) {
      const x = mx.get(d);
      const y = my.get(d);
      if (isNum(x) && isNum(y)) pairs.push([x, y]);
    }
    const { r, n } = spearman(pairs);
    if (r == null) continue;
    out.push({ label, v: r, n, sig: Math.abs(r) >= CORR_SIG_K / Math.sqrt(n) });
  }
  if (!out.length) return hintP(`داده‌ی کافی برای همبستگی نیست (حداقل ${MIN_CORR_N} روز داده‌ی جفت‌شده لازم است).`);
  out.sort((a, b) => b.sig - a.sig || Math.abs(b.v) - Math.abs(a.v));
  return (
    `<div class="ca-corr">` +
    out
      .slice(0, 20)
      .map((r) => {
        const pct = Math.abs(r.v) * 50;
        const fill = r.v >= 0 ? `left:50%; width:${pct}%; background:var(--ca-good)` : `right:50%; width:${pct}%; background:var(--ca-bad)`;
        return `
      <div class="ca-corr-row" style="${r.sig ? "" : "opacity:0.5"}">
        <div class="ca-corr-row__label">${r.label} <small style="color:var(--ca-muted)">(n=${r.n})</small></div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="ca-corr-row__bar"><div class="ca-corr-row__fill" style="${fill}"></div></div>
          <div class="ca-corr-row__val">${r.v > 0 ? "+" : ""}${r.v.toFixed(2)}</div>
        </div>
      </div>`;
      })
      .join("") +
    `</div>` +
    hintP("ضریب اسپیرمن؛ فقط بهترین ۲۰ مورد نمایش داده شده. «شب بعد / فردا» یعنی ورودی چک‌ینِ روز بعد (خوابِ ثبت‌شده در چک‌این هر روز مربوط به شبِ قبل از آن است).")
  );
}

function crossPanel() {
  if (!data.study || !data.checkin) return panel("insCross", "مطالعه × وضعیت روانی و خواب", needHint("هر دو فایل «مطالعه» و «چک‌این»"));
  const { hist, MET } = view;
  let html = subT("همبستگی‌ها") + corrHtml(hist);

  const poolS = hist.filter((d) => d.sMin != null && d.hasCheckin);
  html += subT("روزهای پرمطالعه چه فرقی با روزهای کم‌مطالعه دارند؟");
  if (poolS.length < 18) {
    html += hintP(`برای این تحلیل حداقل ۱۸ روز با مطالعه و چک‌این لازم است (فعلاً ${poolS.length}).`);
  } else {
    const vals = poolS.map((d) => d.sMin);
    const lo = quantile(vals, 1 / 3);
    const hi = quantile(vals, 2 / 3);
    const inA = (d) => d.sMin >= hi && d.sMin > lo;
    const inB = (d) => d.sMin <= lo;
    const pre = ["sleepHours", "sleepQuality", "restedness", "sleepLatency", "awakenings", "bedNum", "morningMood", "morningEnergy", "morningTension", "medDayShare", "prevExercise", "prevScore", "travelShare"].map((k) => MET[k]);
    const co = ["mood", "stress", "anxiety", "focus", "focusQuality", "energy", "score"].map((k) => MET[k]);
    html += hintP(`گروه «پرمطالعه»: ${fmtH(hi)} ساعت یا بیشتر در روز؛ «کم‌مطالعه»: ${fmtH(lo)} ساعت یا کمتر.`);
    html += subT("شرایط قبل از شروع روز") + compareRows(compare(poolS, inA, inB, pre), "پرمطالعه", "کم‌مطالعه");
    html += subT("حال و هوای همان روز (همزمان؛ مطالعه خودش هم اثر دارد)") + compareRows(compare(poolS, inA, inB, co), "پرمطالعه", "کم‌مطالعه");
  }

  const poolM = hist.filter((d) => isNum(d.score) && d.hasStudy);
  html += subT("رفتار مطالعه در روزهای ذهنیِ خوب در برابر بد");
  if (poolM.length < 18) {
    html += hintP(`برای این تحلیل حداقل ۱۸ روز با امتیاز روانی و مطالعه لازم است (فعلاً ${poolM.length}).`);
  } else {
    const vals = poolM.map((d) => d.score);
    const lo = quantile(vals, 1 / 3);
    const hi = quantile(vals, 2 / 3);
    const beh = ["sMin", "adh", "sessLen", "sSess", "sFirst", "sLast", "sLate", "testMin", "prevStudy"].map((k) => MET[k]);
    html += compareRows(compare(poolM, (d) => d.score >= hi && d.score > lo, (d) => d.score <= lo, beh), "روز خوب", "روز بد");
  }
  html += COMPARE_HINT;
  return panel("insCross", "مطالعه × وضعیت روانی و خواب", html);
}

function factorsPanel() {
  if (!data.checkin && !data.study) return "";
  const withRows = view.factors.filter((f) => f.comp.rows.length);
  if (!withRows.length) {
    return panel(
      "insFactors",
      "عوامل مؤثر",
      hintP("هنوز برای هیچ عاملی در هر دو گروه حداقل ۵ روز داده‌ی قابل‌مقایسه نیست. با ثبت بیشتر چک‌این و مطالعه، این بخش پر می‌شود.")
    );
  }
  const html = view.factors
    .map((f) => {
      const sig = f.comp.rows.filter((r) => r.sig).length;
      return `<details class="ins-details" ${sig ? "open" : ""}>
        <summary>${f.title}<span class="ins-count">${sig ? `${sig} مورد معنادار · ` : ""}${f.comp.na} / ${f.comp.nb} روز</span></summary>
        ${compareRows(f.comp, f.la, f.lb)}
      </details>`;
    })
    .join("");
  return panel("insFactors", "عوامل مؤثر (قرص، خواب، ورزش، سفر، کافئین، رویداد، …)", html + COMPARE_HINT);
}

function weeklyBlocks() {
  const { byNum, todayNum, days } = view;
  const firstNum = days[0].dayNum;
  const out = [];
  for (let k = 0; k < 12; k++) {
    const end = todayNum - 1 - 7 * k;
    const start = end - 6;
    if (end < firstNum) break;
    const ds = [];
    for (let n = Math.max(start, firstNum); n <= end; n++) {
      const d = byNum.get(n);
      if (d) ds.push(d);
    }
    const st = ds.filter((d) => d.sMin != null);
    const onPlan = ds.filter((d) => d.pMin > 0 && d.sMin != null);
    out.push({
      k, start, end,
      hours: st.length ? sum(st.map((d) => d.sMin)) / 60 : null,
      planned: onPlan.length ? sum(onPlan.map((d) => d.pMin)) / 60 : null,
      adh: onPlan.length ? sum(onPlan.map((d) => d.sMin)) / sum(onPlan.map((d) => d.pMin)) : null,
      score: avgOf(ds, "score"),
      stress: avgOf(ds, "stress"),
      anxiety: avgOf(ds, "anxiety"),
      sleep: avgOf(ds, "sleepHours"),
      focusQuality: avgOf(ds, "focusQuality"),
      med: ds.filter((d) => d.medDay === true).length,
      travel: ds.filter((d) => d.travel === true).length,
    });
  }
  return out;
}

function weeklyPanel() {
  const blocks = view.blocks;
  if (!blocks.length) return "";
  const rows = blocks.map((w, i) => {
    const older = blocks[i + 1];
    const delta = isNum(w.score) && older && isNum(older.score) ? w.score - older.score : null;
    return [
      `${shortDate(w.start)} → ${shortDate(w.end)}`,
      w.hours != null ? w.hours.toFixed(1) : dash,
      w.adh != null ? barCell(w.adh * 100, adhTone(w.adh)) : dash,
      fx(w.score),
      fx(w.stress),
      fx(w.anxiety),
      fx(w.sleep),
      fx(w.focusQuality),
      w.med || dash,
      w.travel ? `✈ ${w.travel}` : dash,
      delta == null ? dash : { v: `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`, cls: delta >= 0.5 ? "ca-cell-good" : delta <= -0.5 ? "ca-cell-bad" : "" },
    ];
  });
  const html =
    `<div class="ca-chart" id="insChartWeeks"></div>` +
    table(["هفته (تا دیروز)", "مطالعه (س)", "پایبندی", "امتیاز", "استرس", "اضطراب", "خواب", "تمرکز", "روز قرص", "سفر", "Δ امتیاز"], rows) +
    hintP("هفته‌ها ۷ روزه‌ی غلتان‌اند و به دیروز ختم می‌شوند. ببین کدام هفته‌های پرمطالعه با افت امتیاز یا خوابِ کم همراه بوده‌اند.");
  return panel("insWeekly", "مرور هفتگی", html);
}

function coveragePanel() {
  const { days } = view;
  const s = days.filter((d) => d.sMin > 0).length;
  const c = days.filter((d) => d.hasCheckin).length;
  const p = days.filter((d) => d.pMin != null).length;
  const all = days.filter((d) => d.sMin > 0 && d.hasCheckin && d.pMin != null).length;
  return `<p class="ca-hint">پوشش داده در کل بازه (${days.length} روز): روز مطالعه ${s} · روز چک‌این ${c} · روز دارای برنامه ${p} · هر سه همزمان ${all}.
    دقت تحلیل‌های ترکیبی به تعداد روزهایی بستگی دارد که هر دو منبع را دارند.</p>`;
}

/* ============================================================
   Render
   ============================================================ */

function applyTheme() {
  document.body.dataset.theme = data.study?.settings?.theme || localStorage.getItem("study-timer:theme") || "dark";
}

function renderAll() {
  renderSources();
  const root = $("insContent");
  applyTheme();

  if (!data.study && !data.plan && !data.checkin) {
    root.innerHTML = panel("insEmpty", "شروع", hintP("حداقل یکی از سه فایل را بالا متصل کن (بهتر است هر سه)."));
    $("insCount").textContent = "—";
    view = null;
    return;
  }

  const { days, pIdx } = joinDays();
  if (!days.length) {
    root.innerHTML = panel("insEmpty", "داده‌ی کافی نیست", hintP("برای تحلیل یکپارچه حداقل فایل «مطالعه» یا «چک‌این» لازم است؛ برنامه به‌تنهایی کافی نیست."));
    $("insCount").textContent = "—";
    view = null;
    return;
  }

  const todayNum = keyToNum(todayKey());
  const range = Number($("insRange").value) || 0;
  const visible = range > 0 ? days.filter((d) => d.dayNum > todayNum - range) : days;
  const byNum = new Map(days.map((d) => [d.dayNum, d]));

  view = {
    days, visible, pIdx, byNum, todayNum,
    complete: visible.filter((d) => d.dayNum < todayNum),
    hist: days.filter((d) => d.dayNum < todayNum),
    MET: makeMetrics(byNum, todayNum),
  };
  view.debt = computeDebt();
  view.factors = computeFactors();
  view.statInsights = computeStatInsights(view.factors);
  view.descInsights = computeDescInsights();
  view.blocks = weeklyBlocks();

  $("insCount").textContent = `${days.length} روز بازه‌ی داده — نمایش ${visible.length} روز`;

  root.innerHTML = [
    kpiPanel(),
    insightsPanel(),
    chartsPanel(),
    adherencePanel(),
    debtPanel(),
    timePanel(),
    qualityPanel(),
    exercisePanel(),
    crossPanel(),
    factorsPanel(),
    weeklyPanel(),
    coveragePanel(),
  ].join("");

  drawCharts();
}

/* ============================================================
   Events + init
   ============================================================ */

function bind() {
  $("insRange").addEventListener("change", renderAll);

  $("insReload").addEventListener("click", async () => {
    await Promise.all(KINDS.map(loadSource));
    renderAll();
  });

  $("insSources").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-open]");
    if (b) openSource(b.dataset.open);
  });

  $("insSources").addEventListener("change", async (ev) => {
    const inp = ev.target.closest("[data-import]");
    if (!inp) return;
    const f = inp.files?.[0];
    if (f) await importSource(inp.dataset.import, f);
    inp.value = "";
  });

  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(drawCharts, 150);
  });
}

async function init() {
  bind();
  await Promise.all(KINDS.map(loadSource));
  renderAll();
}

init();