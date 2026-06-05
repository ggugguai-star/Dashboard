/**
 * local-widgets.js — 로컬 위젯 순수 헬퍼 (DOM 없음)
 */

/**
 * D-Day 계산: 목표일까지 남은 일수 (당일=0, 지남=음수)
 * @param {string} targetDateStr — 'YYYY-MM-DD'
 * @param {Date} [today]
 * @returns {number|null}
 */
export function computeDday(targetDateStr, today = new Date()) {
  if (!targetDateStr || typeof targetDateStr !== 'string') return null;
  const parts = targetDateStr.split('-').map((x) => parseInt(x, 10));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  const [y, m, d] = parts;
  const target = new Date(y, m - 1, d);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const t1 = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((t1 - t0) / 86_400_000);
}

/**
 * @param {number} totalSec
 * @returns {string}
 */
export function formatPomoTime(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
