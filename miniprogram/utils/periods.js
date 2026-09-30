/**
 * 周期计算：把「每天 / 每周 / 每月 / 一次性」翻译成可比较的 periodKey。
 * 与 Python 后端 app/periods.py 保持同一套规则。
 */

const FREQ_LABELS = { daily: '每天', weekly: '每周', monthly: '每月', once: '一次性' };

const CATEGORY_LABELS = { daily: '日常家务', cycle: '周期性家务', invisible: '隐形家务' };

const CATEGORY_ICONS = { daily: '🍳', cycle: '🧽', invisible: '🧠' };

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function pad(n) {
  return String(n).padStart(2, '0');
}

function toISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 安全解析 YYYY-MM-DD，避免各端 Date 解析差异。 */
function parseDay(iso) {
  const parts = String(iso).split('-').map(Number);
  return new Date(parts[0], (parts[1] || 1) - 1, parts[2] || 1);
}

function todayISO() {
  return toISO(new Date());
}

function addDays(iso, days) {
  const d = parseDay(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

function mondayOf(iso) {
  const d = parseDay(iso);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

function lastDayOfMonth(iso) {
  const d = parseDay(iso);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** ISO 周序号（与 Python isocalendar 一致）。 */
function isoWeek(iso) {
  const d = parseDay(iso);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNum = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNum + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNum = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNum + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return { year: target.getFullYear(), week };
}

function periodKey(freq, iso) {
  if (freq === 'daily') return iso;
  if (freq === 'weekly') {
    const { year, week } = isoWeek(iso);
    return `${year}-W${pad(week)}`;
  }
  if (freq === 'monthly') return iso.slice(0, 7);
  return 'once';
}

/** JS 的 getDay() 里 0 是周日；统一换算成 0=周一 ~ 6=周日。 */
function weekdayOf(iso) {
  return (parseDay(iso).getDay() + 6) % 7;
}

/** 某条任务在指定日期是否需要做。 */
function isDue(chore, iso) {
  if (!chore.is_active) return false;
  const d = parseDay(iso);

  if (chore.freq === 'daily') return true;

  if (chore.freq === 'weekly') {
    if (chore.weekday === null || chore.weekday === undefined) return true;
    return weekdayOf(iso) === chore.weekday;
  }

  if (chore.freq === 'monthly') {
    if (chore.monthday === null || chore.monthday === undefined) return true;
    const last = lastDayOfMonth(iso);
    return d.getDate() === Math.min(chore.monthday, last);
  }

  return true;
}

function freqText(chore) {
  if (chore.freq === 'weekly' && chore.weekday !== null && chore.weekday !== undefined) {
    return `每周 · ${WEEKDAY_LABELS[chore.weekday]}`;
  }
  if (chore.freq === 'monthly' && chore.monthday) {
    return `每月 · ${chore.monthday} 号`;
  }
  return FREQ_LABELS[chore.freq] || chore.freq;
}

module.exports = {
  FREQ_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  WEEKDAY_LABELS,
  toISO,
  parseDay,
  todayISO,
  addDays,
  mondayOf,
  weekdayOf,
  periodKey,
  isDue,
  freqText,
};
