/* Top hero card: total time, sessions, streaks + exam ring. */

import { el } from '../elements.js';

const RING_RADIUS = 52;

function ringHtml(examStatus) {
  const circ = 2 * Math.PI * RING_RADIUS;
  const offset = circ - (examStatus.progressPct / 100) * circ;

  return `
    <div class="analytics-hero__ring">
      <svg viewBox="0 0 120 120" class="hero-ring-svg">
        <circle class="hero-ring-bg" cx="60" cy="60" r="${RING_RADIUS}" fill="none" stroke-width="7"/>
        <circle class="hero-ring-fg" cx="60" cy="60" r="${RING_RADIUS}" fill="none" stroke-width="7"
          stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
          transform="rotate(-90 60 60)" stroke-linecap="round"/>
      </svg>
      <div class="analytics-hero__ring-inner">
        <strong>${examStatus.daysLeft}</strong>
        <span>روز مانده</span>
      </div>
    </div>`;
}

export function renderHero(stats, streaks, examStatus) {
  if (!el.analyticsHero) return;

  const totalHours = Math.floor(stats.totalStudySeconds / 3600);
  const totalMins = Math.floor((stats.totalStudySeconds % 3600) / 60);
  const examLine = examStatus ? `${examStatus.daysLeft} روز مانده به کنکور` : 'تاریخ کنکور ثبت نشده';

  el.analyticsHero.innerHTML = `
    <div>
      <div class="analytics-hero__eyebrow">
        <span class="analytics-hero__eyebrow-dot"></span>
        خلاصه‌ی عملکرد
      </div>
      <h1 class="analytics-hero__title">مجموع ${totalHours} ساعت و ${totalMins} دقیقه مطالعه</h1>
      <p class="analytics-hero__subtitle">${stats.totalSessions} جلسه‌ی مطالعه · ${examLine}</p>
      <div class="analytics-hero__stats">
        <div class="analytics-hero__stat">
          <span class="analytics-hero__stat-label">Streak فعلی</span>
          <span class="analytics-hero__stat-value analytics-hero__stat-value--accent">${streaks.current} روز</span>
        </div>
        <div class="analytics-hero__stat">
          <span class="analytics-hero__stat-label">بلندترین Streak</span>
          <span class="analytics-hero__stat-label" style="color:var(--text-2);font-size:16px;font-family:var(--font-mono);font-weight:800;">${streaks.longest} روز</span>
        </div>
        <div class="analytics-hero__stat">
          <span class="analytics-hero__stat-label">کل جلسات</span>
          <span class="analytics-hero__stat-value">${stats.totalSessions}</span>
        </div>
      </div>
    </div>
    ${examStatus ? ringHtml(examStatus) : ''}
  `;
}
