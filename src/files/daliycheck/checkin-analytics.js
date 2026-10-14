/* =============================================================
   checkin-analytics.js — صفحه‌ی تحلیل چک‌این روزانه
   ============================================================= */

import { parseCheckinDocument, CheckinDataError } from './dailyCheckinData.js';
import { FileStorage } from '../fileStorage.js';

const LOCAL_BACKUP_KEY = 'study-timer:daily-checkins-backup';
const HANDLE_KEY = 'study-timer:daily-checkins-handle';

/* ---------- تنظیمات الگوریتم ---------- */
const DAY_MS = 86400000;
const RECENT_DAYS = 7; // پنجره‌ی «وضعیت فعلی»
const BASELINE_DAYS = 35; // پنجره‌ی خط پایه‌ی شخصی (قبل از پنجره‌ی فعلی)
const BASELINE_MIN_RECENT = 4;
const BASELINE_MIN_BASE = 14;
const SD_FLOOR = 0.7; // جلوگیری از حساسیت بیش‌ازحد وقتی نوسان قبلی خیلی کم بوده
const DEV_WARN = 0.8; // انحراف (به واحد SD روزانه) برای هشدار زرد
const DEV_DANGER = 1.3; // انحراف برای هشدار قرمز
const MIN_COVERAGE_7 = 5; // حداقل روزِ ثبت‌شده از ۷ روز برای قاعده‌های هفتگی
const MIN_CORR_N = 20; // حداقل جفت‌داده برای همبستگی
const CORR_SIG_K = 2.5; // آستانه‌ی محافظه‌کارانه: |r| ≥ K/√n

const BASELINE_METRICS = [
  { key: 'score', label: 'امتیاز روانی کلی', bad: 'low' },
  { key: 'mood', label: 'خلق', bad: 'low' },
  { key: 'stress', label: 'استرس', bad: 'high' },
  { key: 'energy', label: 'انرژی', bad: 'low' },
  { key: 'sleepHours', label: 'ساعت خواب', bad: 'low' },
  { key: 'sleepQuality', label: 'کیفیت خواب', bad: 'low' },
];

let doc = null;
let allEntries = []; // مرتب‌شده صعودی بر اساس تاریخ
let visibleEntries = []; // بعد از فیلتر بازه

const $ = (id) => document.getElementById(id);

/* ============================================================
   Date helpers (همه محلی؛ بدون toISOString)
   ============================================================ */

const pad2 = (n) => String(n).padStart(2, '0');

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// "YYYY-MM-DD" → شماره‌ی روز (مستقل از منطقه‌ی زمانی)
function keyToNum(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function numToKey(n) {
  const t = new Date(n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/* آخرین روزی که تحلیل‌ها تا آن حساب می‌شوند: اگر آخرین ثبت امروز/دیروز بود همان،
   وگرنه امروز (تا شکاف داده در تحلیل دیده شود) */
function getAnchor() {
  const todayNum = keyToNum(todayKey());
  const lastNum = allEntries[allEntries.length - 1].dayNum;
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
    console.warn('Backup load failed:', err);
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
    console.warn('Auto-connect failed:', err);
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
    if (err?.name !== 'AbortError') {
      console.error(err);
      alert('خطا در باز کردن فایل: ' + errorDetail(err));
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
    alert('فایل نامعتبر است: ' + errorDetail(err));
  }
}

/* ============================================================
   Normalize
   ============================================================ */

function numOr(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function hourToNum(t) {
  if (!t || typeof t !== 'string') return null;
  const [h, m] = t.split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  return h + (m || 0) / 60;
}

function normalizeEntries(raw) {
  const list = raw
    .map((e) => {
      const routineDone = !!e.relaxationRoutine?.done;
      const exerciseDone = !!e.exercise?.done;
      const mastPos = !!e.masturbation?.positive?.done;
      const mastNeg = !!e.masturbation?.negative?.done;
      const bedHour = hourToNum(e.sleep?.bedTime);

      const o = {
        date: e.date,
        dayNum: keyToNum(e.date),
        bedTime: e.sleep?.bedTime ?? null,
        wakeTime: e.sleep?.wakeTime ?? null,
        // ساعت خواب بعد از نیمه‌شب (مثلاً ۰۱:۰۰) = ۲۵ تا نوسان درست حساب شود
        bedNum: bedHour == null ? null : bedHour < 12 ? bedHour + 24 : bedHour,
        wakeNum: hourToNum(e.sleep?.wakeTime),
        sleepHours: numOr(e.sleep?.hours),
        sleepQuality: numOr(e.sleep?.quality),
        routineDone,
        // اثر روتین فقط وقتی انجام شده معنا دارد
        routineEff: routineDone ? numOr(e.relaxationRoutine?.effectiveness) : null,
        routineSteps: routineDone ? numOr(e.relaxationRoutine?.steps) : null,
        mood: numOr(e.mood?.rating),
        stress: numOr(e.mood?.stress),
        energy: numOr(e.mood?.energy),
        activity1: e.activity1,
        operation1: e.operation1,
        exerciseDone,
        // روز بدون ورزش = ۰ دقیقه (نه «نامشخص»)
        exerciseMin: exerciseDone ? numOr(e.exercise?.minutes) : 0,
        mastPos,
        mastPosCount: mastPos ? (numOr(e.masturbation?.positive?.count) ?? 1) : 0,
        mastNeg,
        mastNegCount: mastNeg ? (numOr(e.masturbation?.negative?.count) ?? 1) : 0,
        meals: numOr(e.food?.meals),
        foodQuality: numOr(e.food?.quality),
        water: !!e.food?.water,
        yesterdayQuality: numOr(e.yesterdayQuality),
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
  const vals = arr.map((e) => e[field]).filter((v) => typeof v === 'number');
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
  const mx = mean(xs),
    my = mean(ys);
  let num = 0,
    dx = 0,
    dy = 0;
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

/* ============================================================
   Analytics core
   ============================================================ */

function computeMentalScore(d) {
  const parts = [];
  if (d.sleepHours != null) {
    let s;
    if (d.sleepHours >= 7 && d.sleepHours <= 9) s = 10;
    else if (d.sleepHours < 7) s = Math.max(1, 10 - (7 - d.sleepHours) * 2);
    else s = Math.max(1, 10 - (d.sleepHours - 9) * 1.5);
    parts.push({ w: 0.2, v: s });
  }
  if (d.sleepQuality != null) parts.push({ w: 0.15, v: d.sleepQuality });
  if (d.mood != null) parts.push({ w: 0.25, v: d.mood });
  if (d.stress != null) parts.push({ w: 0.25, v: 11 - d.stress });
  if (d.energy != null) parts.push({ w: 0.15, v: d.energy });

  // با کمتر از ۳ مؤلفه امتیاز قابل‌اتکا نیست
  if (parts.length < 3) return null;
  const tw = parts.reduce((a, p) => a + p.w, 0);
  const s = parts.reduce((a, p) => a + p.w * p.v, 0) / tw;
  return Math.round(s * 10) / 10;
}

function stateLabel(score) {
  if (score == null) return { text: '—', tone: 'muted' };
  if (score >= 8.5) return { text: 'پایدار و پرانرژی', tone: 'good' };
  if (score >= 7) return { text: 'خوب', tone: 'good' };
  if (score >= 5.5) return { text: 'متوسط', tone: 'mid' };
  if (score >= 4) return { text: 'ضعیف — نیاز به توجه', tone: 'warn' };
  return { text: 'هشدار — نیاز به استراحت', tone: 'bad' };
}

function stateHint(score) {
  if (score == null) return 'داده‌ی کافی برای تحلیل نیست.';
  if (score >= 8.5) return 'خواب، خلق و استرس در محدوده‌ی سالم است. روند فعلی را حفظ کن.';
  if (score >= 7) return 'وضعیت خوب است، ولی جا برای بهبود وجود دارد (کیفیت خواب یا کاهش استرس).';
  if (score >= 5.5) return 'روزها متوسط‌اند. به خواب و روتین آرام‌سازی بیشتر توجه کن.';
  if (score >= 4)
    return 'چند سیگنال ضعیف با هم جمع شده‌اند. یک روز سبک‌تر و خواب بیشتر می‌تواند کمک کند.';
  return 'سیستم روانی زیر فشار است. یک روز استراحت واقعی، خواب کافی، و قطع فشارهای غیرضروری توصیه می‌شود.';
}

/* ---------- مقایسه با خط پایه‌ی شخصی ---------- */

function computeDeviations(entries, anchor) {
  const recent = inWindow(entries, anchor, RECENT_DAYS);
  const base = entries.filter(
    (d) => d.dayNum <= anchor - RECENT_DAYS && d.dayNum > anchor - RECENT_DAYS - BASELINE_DAYS
  );
  const out = [];
  for (const m of BASELINE_METRICS) {
    const r = recent.map((d) => d[m.key]).filter((v) => typeof v === 'number');
    const b = base.map((d) => d[m.key]).filter((v) => typeof v === 'number');
    if (r.length < BASELINE_MIN_RECENT || b.length < BASELINE_MIN_BASE) continue;
    const mr = mean(r);
    const mb = mean(b);
    const sb = Math.max(sd(b) ?? 0, SD_FLOOR);
    const d = (mr - mb) / sb;
    out.push({ ...m, mr, mb, sb, d, worse: m.bad === 'high' ? d : -d });
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
  const lastNum = entries[entries.length - 1].dayNum;
  const byNum = new Map(entries.map((d) => [d.dayNum, d]));
  const w7 = inWindow(entries, anchor, 7);
  const w14 = inWindow(entries, anchor, 14);

  // همه‌ی n روز آخر ثبت شده و شرط برقرار است
  const streak = (n, pred) => {
    for (let i = 0; i < n; i++) {
      const d = byNum.get(anchor - i);
      if (!d || !pred(d)) return false;
    }
    return true;
  };

  /* --- کیفیت داده --- */
  const gap = todayNum - lastNum;
  if (gap >= 3) push(`${gap} روز است چک‌این ثبت نشده؛ تحلیل‌ها بر اساس داده‌ی قدیمی‌اند.`, 'warn');
  else if (w14.length < 9)
    push(`فقط ${w14.length} روز از ۱۴ روز اخیر ثبت شده؛ دقت تحلیل پایین است.`, 'warn');

  /* --- الگوهای پیاپی (روزهای متوالیِ واقعی) --- */
  if (streak(3, (d) => d.stress != null && d.stress >= 7))
    push('۳ روز پیوسته استرس بالا (۷+) — نشانه‌ی فشار انباشته.', 'danger');
  if (streak(3, (d) => d.sleepHours != null && d.sleepHours < 6))
    push('۳ روز پیوسته کمتر از ۶ ساعت خواب.', 'danger');
  if (streak(3, (d) => d.mood != null && d.mood <= 4))
    push('۳ روز پیوسته خلق پایین (۴ یا کمتر).', 'danger');

  /* --- خلق پایینِ پایدار --- */
  if (w14.length >= 10) {
    const low = w14.filter((d) => d.mood != null && d.mood <= 4).length;
    if (low >= 7) {
      push(
        `خلق پایین در ${low} روز از ۱۴ روز اخیر. اگر این وضعیت ادامه دارد، صحبت با مشاور یا روان‌شناس منطقی است (این ابزار تشخیص نیست).`,
        'danger'
      );
    }
  }

  /* --- قاعده‌های هفتگی (فقط با پوشش کافی) --- */
  if (w7.length >= MIN_COVERAGE_7) {
    const negDays = w7.filter((d) => d.mastNeg).length;
    if (negDays >= 3)
      push(
        `خودارضایی منفی در ${negDays} روز از ${w7.length} روز ثبت‌شده‌ی هفته‌ی اخیر — نشانه‌ی فشار روانی.`,
        'danger'
      );

    const exDays = w7.filter((d) => d.exerciseDone).length;
    if (exDays <= 1)
      push(`ورزش فقط ${exDays} بار در ${w7.length} روز ثبت‌شده‌ی هفته‌ی اخیر.`, 'warn');

    const routineDays = w7.filter((d) => d.routineDone).length;
    if (routineDays <= 2) push('روتین آرام‌سازی در بیشتر روزهای اخیر انجام نشده.', 'warn');

    const foodAvg = average(w7, 'foodQuality');
    if (foodAvg != null && foodAvg < 5)
      push(`میانگین کیفیت تغذیه در هفته‌ی اخیر ${foodAvg}/۱۰ — پایین.`, 'warn');

    const waterDays = w7.filter((d) => d.water).length;
    if (waterDays <= 2) push('آب کافی در بیشتر روزهای هفته‌ی اخیر مصرف نشده.', 'warn');
  }

  /* --- نظم خواب --- */
  const beds = w7.map((d) => d.bedNum).filter((v) => v != null);
  if (beds.length >= 4) {
    const spread = Math.round(sd(beds) * 60);
    if (spread > 90) push(`ساعت خواب بین شب‌ها نامنظم است (نوسان حدود ${spread} دقیقه).`, 'warn');
  }

  /* --- انحراف از الگوی شخصی خودت --- */
  for (const x of computeDeviations(entries, anchor)) {
    if (x.worse < DEV_WARN) continue;
    push(
      `${x.label} نسبت به الگوی معمول خودت بدتر شده: میانگین ۷ روز اخیر ${x.mr.toFixed(1)} در برابر معمول ${x.mb.toFixed(1)}.`,
      x.worse >= DEV_DANGER ? 'danger' : 'warn'
    );
  }

  return out.sort((a, b) => (a.level === 'danger' ? 0 : 1) - (b.level === 'danger' ? 0 : 1));
}

/* ---------- همبستگی‌ها ---------- */

const CORR_DEFS = [
  { label: 'ساعت خواب × خلق همان روز', x: 'sleepHours', y: 'mood', lag: 0 },
  { label: 'ساعت خواب × استرس همان روز', x: 'sleepHours', y: 'stress', lag: 0 },
  { label: 'کیفیت خواب × خلق همان روز', x: 'sleepQuality', y: 'mood', lag: 0 },
  { label: 'اثر روتین × کیفیت خوابِ همان شب', x: 'routineEff', y: 'sleepQuality', lag: 0 },
  { label: 'اثر روتین × خلق', x: 'routineEff', y: 'mood', lag: 0 },
  { label: 'ورزش × خلق همان روز', x: 'exerciseMin', y: 'mood', lag: 0 },
  { label: 'ورزش امروز × کیفیت خواب شب بعد', x: 'exerciseMin', y: 'sleepQuality', lag: 1 },
  { label: 'کیفیت غذا × خلق همان روز', x: 'foodQuality', y: 'mood', lag: 0 },
  { label: 'استرس امروز × کیفیت خواب شب بعد', x: 'stress', y: 'sleepQuality', lag: 1 },
  { label: 'استرس امروز × ساعت خواب شب بعد', x: 'stress', y: 'sleepHours', lag: 1 },
  { label: 'خودارضایی منفی × استرس همان روز', x: 'mastNegCount', y: 'stress', lag: 0 },
  { label: 'خودارضایی منفی × خلق همان روز', x: 'mastNegCount', y: 'mood', lag: 0 },
  { label: 'خودارضایی منفی امروز × خلق فردا', x: 'mastNegCount', y: 'mood', lag: 1 },
  { label: 'کیفیت دیروز × خلق امروز', x: 'yesterdayQuality', y: 'mood', lag: 0 },
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
      if (typeof x === 'number' && typeof y === 'number') pairs.push([x, y]);
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
    $('caEmpty').hidden = false;
    $('caContent').hidden = true;
    $('caCount').textContent = '—';
    return;
  }

  const anchor = getAnchor();
  const range = Number($('caRangeSelect').value) || 0;
  visibleEntries = range > 0 ? allEntries.filter((d) => d.dayNum > anchor - range) : allEntries;

  $('caEmpty').hidden = true;
  $('caContent').hidden = false;
  const cov14 = inWindow(allEntries, anchor, 14).length;
  $('caCount').textContent =
    `${allEntries.length} روز ثبت‌شده — نمایش ${visibleEntries.length} روز — پوشش ۱۴ روز اخیر: ${cov14}/۱۴`;

  renderSummary();
  renderState();
  renderWarnings();
  renderSleepChart();
  renderMoodChart();
  renderBehaviors();
  renderCorrelations();
  renderHeatmap();
  renderTable();
}

/* ---------- summary cards ---------- */

function renderSummary() {
  const e = visibleEntries;
  const avgSleep = average(e, 'sleepHours');
  const avgMood = average(e, 'mood');
  const avgStress = average(e, 'stress');
  const avgEnergy = average(e, 'energy');
  const avgQuality = average(e, 'sleepQuality');

  const beds = e.map((d) => d.bedNum).filter((v) => v != null);
  const bedSpread = beds.length >= 4 ? Math.round(sd(beds) * 60) : null;

  const cards = [
    { label: 'میانگین خواب', value: avgSleep, unit: 'ساعت', sub: `کیفیت ${avgQuality ?? '—'}/۱۰` },
    { label: 'میانگین خلق', value: avgMood, unit: '/۱۰' },
    {
      label: 'میانگین استرس',
      value: avgStress,
      unit: '/۱۰',
      tone: avgStress == null ? null : avgStress >= 6 ? 'bad' : avgStress <= 4 ? 'good' : null,
    },
    { label: 'میانگین انرژی', value: avgEnergy, unit: '/۱۰' },
    {
      label: 'نوسان ساعت خواب',
      value: bedSpread,
      unit: 'دقیقه',
      tone: bedSpread == null ? null : bedSpread > 75 ? 'bad' : bedSpread < 45 ? 'good' : null,
    },
  ];

  $('caSummary').innerHTML = cards
    .map(
      (c) => `
    <div class="ca-card">
      <div class="ca-card__label">${c.label}</div>
      <div class="ca-card__value" style="${c.tone === 'bad' ? 'color:var(--ca-bad)' : c.tone === 'good' ? 'color:var(--ca-good)' : ''}">
        ${c.value ?? '—'}${c.value != null ? `<small>${c.unit}</small>` : ''}
      </div>
      ${c.sub ? `<div class="ca-card__sub">${c.sub}</div>` : ''}
    </div>`
    )
    .join('');
}

/* ---------- mental state gauge ---------- */

function renderState() {
  const anchor = getAnchor();
  const recent = inWindow(allEntries, anchor, 7).filter((d) => d.score != null);
  const prev = allEntries.filter(
    (d) => d.score != null && d.dayNum <= anchor - 7 && d.dayNum > anchor - 14
  );

  if (recent.length < 3) {
    $('caGauge').innerHTML = '';
    $('caStateLabel').textContent = '—';
    $('caStateLabel').style.color = 'var(--ca-text)';
    $('caStateTrend').textContent = 'داده‌ی کافی نیست (حداقل ۳ روز ثبت در ۷ روز اخیر لازم است).';
    $('caStateHint').textContent = '';
    return;
  }

  const cur = mean(recent.map((d) => d.score));
  const prevAvg = prev.length >= 3 ? mean(prev.map((d) => d.score)) : null;

  const label = stateLabel(cur);
  $('caStateLabel').textContent = label.text;
  $('caStateLabel').style.color =
    label.tone === 'good'
      ? 'var(--ca-good)'
      : label.tone === 'bad' || label.tone === 'warn'
        ? 'var(--ca-bad)'
        : label.tone === 'mid'
          ? 'var(--ca-warn)'
          : 'var(--ca-text)';

  let trendText = 'داده‌ی مقایسه‌ای کافی نیست.';
  if (prevAvg != null) {
    const diff = Math.round((cur - prevAvg) * 10) / 10;
    const arrow = diff > 0.3 ? '▲' : diff < -0.3 ? '▼' : '◀▶';
    const word = diff > 0.3 ? 'بهبود' : diff < -0.3 ? 'افت' : 'پایدار';
    trendText = `${arrow} ${word} نسبت به هفته‌ی قبل (${diff > 0 ? '+' : ''}${diff})`;
  }
  const dev = computeDeviations(allEntries, anchor).find((x) => x.key === 'score');
  if (dev) {
    const delta = Math.round((dev.mr - dev.mb) * 10) / 10;
    trendText += ` — نسبت به سطح معمول خودت (${dev.mb.toFixed(1)}): ${delta > 0 ? '+' : ''}${delta}`;
  }
  $('caStateTrend').textContent = trendText;

  let hint = stateHint(cur);
  if (recent.length < MIN_COVERAGE_7)
    hint += ` (اعتبار پایین: فقط ${recent.length} از ۷ روز ثبت شده)`;
  $('caStateHint').textContent = hint;

  // gauge svg
  const pct = Math.max(0, Math.min(1, (cur - 1) / 9)); // 1..10 → 0..1
  const angle = -90 + pct * 180; // -90 (چپ) تا +90 (راست)

  const color = cur >= 7 ? 'var(--ca-good)' : cur >= 5.5 ? 'var(--ca-warn)' : 'var(--ca-bad)';

  const cx = 110,
    cy = 100,
    r = 80;

  $('caGauge').innerHTML = `
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
    $('caWarningsPanel').hidden = true;
    return;
  }
  $('caWarningsPanel').hidden = false;
  $('caWarnings').innerHTML = w
    .map(
      (x) =>
        `<div class="ca-warn-item ${x.level === 'danger' ? 'ca-warn-item--danger' : ''}">${x.text}</div>`
    )
    .join('');
}

/* ---------- charts ---------- */

function renderSleepChart() {
  const series = [
    { key: 'sleepHours', color: '#6ea8ff', label: 'خواب (ساعت)' },
    { key: 'sleepQuality', color: '#a78bfa', label: 'کیفیت خواب (۱–۱۰)' },
  ];
  const el = $('caSleepChart');
  el.innerHTML = buildLineChart(el, visibleEntries, series, {
    yMin: 0,
    yMax: 12,
    bands: [{ from: 7, to: 9, color: 'var(--ca-good)' }], // بازه‌ی سالم خواب
  });
  renderLegend(el, [...series, { color: 'var(--ca-good)', label: 'بازه‌ی سالم خواب (۷–۹ ساعت)' }]);
}

function renderMoodChart() {
  const series = [
    { key: 'mood', color: '#34d399', label: 'خلق' },
    { key: 'stress', color: '#f87171', label: 'استرس' },
    { key: 'energy', color: '#fbbf24', label: 'انرژی' },
    {
      key: 'scoreMA',
      color: '#a78bfa',
      label: 'میانگین ۷روزه‌ی امتیاز روانی',
      dash: '6 4',
      noDots: true,
    },
  ];
  const el = $('caMoodChart');
  el.innerHTML = buildLineChart(el, visibleEntries, series, { yMin: 1, yMax: 10 });
  renderLegend(el, series);
}

function renderLegend(chartEl, series) {
  let lg = chartEl.nextElementSibling;
  if (!lg || !lg.classList.contains('ca-legend')) {
    lg = document.createElement('div');
    lg.className = 'ca-legend';
    chartEl.after(lg);
  }
  lg.innerHTML = series
    .map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.label}</span>`)
    .join('');
}

/* محور X بر اساس تاریخ واقعی؛ در روزهای بدون ثبت خط قطع می‌شود */
function buildLineChart(el, data, series, { yMin = 0, yMax = 10, bands = [] } = {}) {
  if (!data.length) return '';

  const W = Math.max(320, el.clientWidth || 800);
  const H = 220;
  const padL = 34,
    padR = 12,
    padT = 14,
    padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const minNum = data[0].dayNum;
  const maxNum = data[data.length - 1].dayNum;
  const span = maxNum - minNum;

  const xAt = (num) => (span === 0 ? padL + innerW / 2 : padL + ((num - minNum) / span) * innerW);
  const clamp = (v) => Math.max(yMin, Math.min(yMax, v));
  const yAt = (v) => padT + innerH - ((clamp(v) - yMin) / (yMax - yMin)) * innerH;

  // bands
  let bandSvg = '';
  for (const b of bands) {
    const y1 = yAt(b.to),
      y2 = yAt(b.from);
    bandSvg += `<rect x="${padL}" y="${y1}" width="${innerW}" height="${y2 - y1}" fill="${b.color}" opacity="0.1" />`;
  }

  // grid
  const yTicks = 5;
  let grid = '';
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yAt(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--ca-border)" stroke-width="1" opacity="0.5" />`;
    grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--ca-muted)">${Math.round(v)}</text>`;
  }

  // x labels
  let xLabels = '';
  const tickCount = Math.min(6, span + 1);
  for (let i = 0; i < tickCount; i++) {
    const num = minNum + Math.round((span * i) / (tickCount - 1 || 1));
    xLabels += `<text x="${xAt(num)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--ca-muted)">${numToKey(num).slice(5)}</text>`;
  }

  // series
  let lines = '';
  let dots = '';
  for (const s of series) {
    const segs = [];
    let seg = [];
    let prevNum = null;
    for (const d of data) {
      const v = d[s.key];
      if (typeof v !== 'number') continue;
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
        const poly = sg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
        lines += `<polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''} />`;
      }
      if (!s.noDots) {
        for (const [x, y] of sg)
          dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${s.color}" />`;
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

/* ---------- behaviors ---------- */

function renderBehaviors() {
  const e = visibleEntries;
  const n = e.length;
  if (!n) {
    $('caBehaviors').innerHTML = '';
    return;
  }

  const pct = (count) => Math.round((count / n) * 100);

  const routineCount = e.filter((d) => d.routineDone).length;
  const exerciseCount = e.filter((d) => d.exerciseDone).length;
  const exerciseMinutes = e.reduce((a, d) => a + (d.exerciseMin || 0), 0);
  const mastPosDays = e.filter((d) => d.mastPos).length;
  const mastNegDays = e.filter((d) => d.mastNeg).length;
  const act1Count = e.filter((d) => d.activity1 === true).length;
  const op1Count = e.filter((d) => d.operation1 === true).length;
  const waterCount = e.filter((d) => d.water).length;
  const avgMeals = average(e, 'meals');

  const items = [
    { label: 'روتین آرام‌سازی', value: routineCount, unit: `/ ${n} روز`, pct: pct(routineCount) },
    { label: 'ورزش', value: exerciseCount, unit: `/ ${n} روز`, pct: pct(exerciseCount) },
    { label: 'دقایق ورزش (کل)', value: exerciseMinutes, unit: 'دقیقه', pct: null },
    { label: 'خودارضایی مثبت', value: mastPosDays, unit: `/ ${n} روز`, pct: pct(mastPosDays) },
    {
      label: 'خودارضایی منفی',
      value: mastNegDays,
      unit: `/ ${n} روز`,
      pct: pct(mastNegDays),
      danger: mastNegDays / n > 0.3,
    },
    { label: 'فعالیت ۱', value: act1Count, unit: `/ ${n} روز`, pct: pct(act1Count) },
    { label: 'عملیات د۱', value: op1Count, unit: `/ ${n} روز`, pct: pct(op1Count) },
    { label: 'آب کافی', value: waterCount, unit: `/ ${n} روز`, pct: pct(waterCount) },
    { label: 'میانگین وعده‌های غذا', value: avgMeals ?? '—', unit: 'وعده', pct: null },
  ];

  $('caBehaviors').innerHTML = items
    .map(
      (x) => `
    <div class="ca-behavior">
      <div class="ca-behavior__label">${x.label}</div>
      <div class="ca-behavior__value" ${x.danger ? 'style="color:var(--ca-bad)"' : ''}>
        ${x.value}<small> ${x.unit}</small>
      </div>
      ${
        x.pct != null
          ? `<div class="ca-behavior__bar"><span style="width:${x.pct}%; background:${x.danger ? 'var(--ca-bad)' : 'var(--ca-accent)'}"></span></div>`
          : ''
      }
    </div>`
    )
    .join('');
}

/* ---------- correlations ---------- */

function renderCorrelations() {
  // همبستگی روی کل تاریخچه حساب می‌شود (نه بازه‌ی انتخابی) تا n بیشتر باشد
  const corr = computeCorrelations(allEntries);
  if (!corr.length) {
    $('caCorr').innerHTML =
      `<p class="ca-hint">داده‌ی کافی برای محاسبه‌ی همبستگی وجود ندارد (حداقل ${MIN_CORR_N} روز داده‌ی جفت‌شده لازم است).</p>`;
    return;
  }

  // ابتدا معنادارها، سپس قدرمطلق نزولی
  corr.sort((a, b) => b.sig - a.sig || Math.abs(b.v) - Math.abs(a.v));

  $('caCorr').innerHTML =
    corr
      .map((r) => {
        const v = r.v;
        const pct = Math.abs(v) * 50; // 0..50
        const fillStyle =
          v >= 0
            ? `left:50%; width:${pct}%; background:var(--ca-good)`
            : `right:50%; width:${pct}%; background:var(--ca-bad)`;
        return `
      <div class="ca-corr-row" style="${r.sig ? '' : 'opacity:0.5'}">
        <div class="ca-corr-row__label">${r.label} <small style="color:var(--ca-muted)">(n=${r.n})</small></div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="ca-corr-row__bar">
            <div class="ca-corr-row__fill" style="${fillStyle}"></div>
          </div>
          <div class="ca-corr-row__val">${v > 0 ? '+' : ''}${v.toFixed(2)}</div>
        </div>
      </div>`;
      })
      .join('') +
    `<p class="ca-hint">ضریب اسپیرمن. همبستگی به معنی علت نیست. ردیف‌های کم‌رنگ هنوز از نوسان تصادفی قابل‌تشخیص نیستند؛ با بیشتر شدن داده، آستانه‌ی معناداری پایین‌تر می‌آید.</p>`;
}

/* ---------- heatmap ---------- */

function renderHeatmap() {
  if (!visibleEntries.length) {
    $('caHeatmap').innerHTML = '';
    return;
  }

  const scoreByNum = new Map();
  for (const d of visibleEntries) if (d.score != null) scoreByNum.set(d.dayNum, d.score);

  const first = visibleEntries[0].dayNum;
  const last = visibleEntries[visibleEntries.length - 1].dayNum;

  let html = '';
  for (let n = first; n <= last; n++) {
    const key = numToKey(n);
    const s = scoreByNum.get(n);
    const color = s == null ? 'var(--ca-panel-2)' : scoreToColor(s);
    const tip = s == null ? `${key} — بدون داده` : `${key} — ${s.toFixed(1)}/۱۰`;
    html += `<div class="ca-heat-cell" style="background:${color}" data-tip="${tip}"></div>`;
  }
  $('caHeatmap').innerHTML = html;
}

function scoreToColor(s) {
  // 1..10 → hue 0..120
  const t = Math.max(0, Math.min(1, (s - 1) / 9));
  const hue = t * 120;
  return `hsl(${hue}, 65%, 45%)`;
}

/* ---------- table ---------- */

const TABLE_COLS = [
  { key: 'date', label: 'تاریخ' },
  { key: 'score', label: 'امتیاز روانی' },
  { key: 'sleepHours', label: 'خواب (س)' },
  { key: 'sleepQuality', label: 'کیفیت خواب' },
  { key: 'routineDone', label: 'روتین' },
  { key: 'mood', label: 'خلق' },
  { key: 'stress', label: 'استرس' },
  { key: 'energy', label: 'انرژی' },
  { key: 'exerciseMin', label: 'ورزش (دق)' },
  { key: 'mastNegCount', label: 'خودارضایی منفی' },
  { key: 'mastPosCount', label: 'خودارضایی مثبت' },
  { key: 'foodQuality', label: 'کیفیت غذا' },
  { key: 'water', label: 'آب' },
  { key: 'yesterdayQuality', label: 'دیروز' },
];

const ZERO_AS_DASH = new Set(['exerciseMin', 'mastNegCount', 'mastPosCount']);

function cellFor(c, d) {
  const dash = { v: '—', cls: 'muted' };
  const raw = d[c.key];

  if (c.key === 'date') return { v: formatDate(raw), cls: 'date' };
  if (c.key === 'routineDone' || c.key === 'water')
    return raw ? { v: '✓', cls: 'ca-cell-good' } : dash;
  if (raw === null || raw === undefined || raw === '') return dash;
  if (c.key === 'score') {
    return { v: raw.toFixed(1), cls: raw >= 7 ? 'ca-cell-good' : raw <= 4 ? 'ca-cell-bad' : '' };
  }
  if (ZERO_AS_DASH.has(c.key) && raw === 0) return dash;

  let cls = '';
  if ((c.key === 'stress' || c.key === 'mastNegCount') && raw >= 6) cls = 'ca-cell-bad';
  if (c.key === 'mood' || c.key === 'energy') {
    if (raw >= 7) cls = 'ca-cell-good';
    if (raw <= 3) cls = 'ca-cell-bad';
  }
  return { v: raw, cls };
}

function renderTable() {
  const rows = [...visibleEntries].reverse(); // جدیدترین بالا

  let html = '<thead><tr>';
  for (const c of TABLE_COLS) html += `<th>${c.label}</th>`;
  html += '</tr></thead><tbody>';

  for (const d of rows) {
    html += '<tr>';
    for (const c of TABLE_COLS) {
      const { v, cls } = cellFor(c, d);
      html += `<td class="${cls}">${v}</td>`;
    }
    html += '</tr>';
  }

  html += '</tbody>';
  $('caTable').innerHTML = html;
}

function formatDate(key) {
  const d = new Date(key + 'T00:00:00');
  const fa = new Intl.DateTimeFormat('fa-IR', { month: 'short', day: '2-digit' });
  const en = key.slice(5);
  return `${fa.format(d)} (${en})`;
}

/* ============================================================
   Events
   ============================================================ */

function bindEvents() {
  $('caConnectBtn').addEventListener('click', connectFile);

  $('caImportInput').addEventListener('change', async (ev) => {
    const f = ev.target.files?.[0];
    if (f) await importFile(f);
    ev.target.value = '';
  });

  $('caRangeSelect').addEventListener('change', render);

  // نمودارها با عرض واقعی کانتینر ساخته می‌شوند؛ با تغییر اندازه دوباره رسم شوند
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (doc && allEntries.length) {
        renderSleepChart();
        renderMoodChart();
      }
    }, 150);
  });

  // theme: هماهنگ با main app
  const savedTheme = localStorage.getItem('study-timer:theme') || 'dark';
  document.body.dataset.theme = savedTheme;
}

init();
