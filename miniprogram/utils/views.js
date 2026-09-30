/**
 * 视图计算：把「成员 + 家务 + 打卡」三份原始数据算成页面直接能用的形状。
 * 纯计算，不碰网络。
 */
const periods = require('./periods');

function localDayOf(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildContext(family) {
  const members = {};
  family.members.forEach((m) => {
    members[m.id] = m;
  });

  const byPeriod = {};
  family.completions.forEach((c) => {
    byPeriod[`${c.chore_id}|${c.period_key}`] = c;
  });

  return { members, byPeriod };
}

function decorateChore(chore, ctx, dayIso) {
  const key = periods.periodKey(chore.freq, dayIso);
  const record = ctx.byPeriod[`${chore.id}|${key}`];
  const assignee = chore.assignee_id ? ctx.members[chore.assignee_id] : null;

  return {
    id: chore.id,
    title: chore.title,
    category: chore.category,
    catIcon: periods.CATEGORY_ICONS[chore.category] || '🍳',
    catLabel: periods.CATEGORY_LABELS[chore.category] || '日常家务',
    freq: chore.freq,
    freqText: periods.freqText(chore),
    points: chore.points,
    note: chore.note || '',
    is_active: chore.is_active,
    assignee_id: chore.assignee_id || null,
    assigneeName: assignee ? assignee.name : '',
    assigneeEmoji: assignee ? assignee.emoji : '',
    assigneeColor: assignee ? assignee.color : '',
    done: !!record,
    doneAt: record ? record.done_at : '',
  };
}

function buildToday(family, dayIso) {
  const ctx = buildContext(family);
  const duties = family.chores
    .filter((chore) => periods.isDue(chore, dayIso))
    .map((chore) => decorateChore(chore, ctx, dayIso));

  const pending = duties
    .filter((item) => !item.done)
    .sort((a, b) => {
      const aUnassigned = a.assignee_id ? 1 : 0;
      const bUnassigned = b.assignee_id ? 1 : 0;
      if (aUnassigned !== bUnassigned) return aUnassigned - bUnassigned;
      if (a.points !== b.points) return b.points - a.points;
      return a.id - b.id;
    });
  const done = duties.filter((item) => item.done);

  const all = pending.concat(done);
  return {
    day: dayIso,
    weekdayLabel: periods.WEEKDAY_LABELS[periods.weekdayOf(dayIso)],
    dayNum: Number(dayIso.slice(8, 10)),
    isToday: dayIso === periods.todayISO(),
    pending,
    done,
    summary: {
      total: all.length,
      done: done.length,
      pointsTotal: all.reduce((sum, item) => sum + (item.points || 0), 0),
      pointsDone: done.reduce((sum, item) => sum + (item.points || 0), 0),
      unassigned: all.filter((item) => !item.assignee_id).length,
    },
  };
}

function buildWeek(family, startIso) {
  const monday = periods.mondayOf(startIso);
  const today = periods.todayISO();
  const ctx = buildContext(family);

  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const day = periods.addDays(monday, i);
    const due = family.chores.filter((chore) => periods.isDue(chore, day));
    const doneCount = due.filter(
      (chore) => ctx.byPeriod[`${chore.id}|${periods.periodKey(chore.freq, day)}`]
    ).length;

    days.push({
      day,
      dayNum: Number(day.slice(8, 10)),
      weekdayShort: periods.WEEKDAY_LABELS[i].replace('周', ''),
      isToday: day === today,
      total: due.length,
      done: doneCount,
      points: due.reduce((sum, chore) => sum + (chore.points || 0), 0),
    });
  }

  return { start: monday, days };
}

function gini(values) {
  const data = values.filter((v) => v >= 0).sort((a, b) => a - b);
  const n = data.length;
  const total = data.reduce((sum, v) => sum + v, 0);
  if (!n || !total) return 0;
  let weighted = 0;
  data.forEach((v, i) => {
    weighted += (i + 1) * v;
  });
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

function scopeStart(scope) {
  const today = periods.todayISO();
  if (scope === 'week') return periods.mondayOf(today);
  if (scope === 'month') return `${today.slice(0, 7)}-01`;
  return null;
}

function scopeLabel(scope) {
  const today = periods.todayISO();
  if (scope === 'week') {
    const monday = periods.mondayOf(today);
    const sunday = periods.addDays(monday, 6);
    return `本周 ${Number(monday.slice(5, 7))}/${Number(monday.slice(8, 10))} - ${Number(sunday.slice(5, 7))}/${Number(sunday.slice(8, 10))}`;
  }
  if (scope === 'month') return `本月 ${Number(today.slice(5, 7))} 月`;
  return '全部时间';
}

function buildStats(family, scope) {
  const start = scopeStart(scope);
  const choreMap = {};
  family.chores.forEach((chore) => {
    choreMap[chore.id] = chore;
  });

  const scoped = family.completions.filter((record) => {
    if (!start) return true;
    const day = localDayOf(record.done_at);
    return day && day >= start;
  });

  const buckets = {};
  family.members.forEach((m) => {
    buckets[m.id] = {
      memberId: m.id,
      name: m.name,
      emoji: m.emoji,
      color: m.color,
      doneCount: 0,
      points: 0,
      invisibleDone: 0,
    };
  });
  const orphan = {
    memberId: 0,
    name: '未分配',
    emoji: '❓',
    color: '#B9B4CC',
    doneCount: 0,
    points: 0,
    invisibleDone: 0,
  };

  let totalPoints = 0;
  let invisiblePoints = 0;

  scoped.forEach((record) => {
    const chore = choreMap[record.chore_id];
    if (!chore) return;
    const bucket = buckets[record.member_id] || buckets[chore.assignee_id] || orphan;
    const weight = chore.points || 1;
    bucket.doneCount += 1;
    bucket.points += weight;
    totalPoints += weight;
    if (chore.category === 'invisible') {
      bucket.invisibleDone += 1;
      invisiblePoints += weight;
    }
  });

  const list = Object.keys(buckets).map((key) => buckets[key]);
  if (orphan.doneCount) list.push(orphan);
  list.sort((a, b) => b.points - a.points || a.memberId - b.memberId);

  const today = periods.todayISO();
  const series = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = periods.addDays(today, -offset);
    const sameDay = scoped.filter((record) => localDayOf(record.done_at) === day);
    series.push({
      day,
      label: `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`,
      weekdayShort: periods.WEEKDAY_LABELS[periods.weekdayOf(day)].replace('周', ''),
      count: sameDay.length,
      points: sameDay.reduce((sum, record) => {
        const chore = choreMap[record.chore_id];
        return sum + (chore ? chore.points || 1 : 0);
      }, 0),
    });
  }

  const realMembers = list.filter((item) => item.memberId !== 0).map((item) => item.points);
  const fairness = Math.max(0, 1 - gini(realMembers.length ? realMembers : [0]));

  return {
    scope,
    scopeLabel: scopeLabel(scope),
    totalDone: list.reduce((sum, item) => sum + item.doneCount, 0),
    totalPoints,
    invisiblePoints,
    invisibleRatio: totalPoints ? Math.round((invisiblePoints / totalPoints) * 100) : 0,
    fairness: Math.round(fairness * 100),
    maxPoints: Math.max(1, ...list.map((item) => item.points)),
    members: list,
    series,
    seriesMax: Math.max(1, ...series.map((item) => item.points)),
  };
}

module.exports = { buildContext, decorateChore, buildToday, buildWeek, buildStats, localDayOf };
