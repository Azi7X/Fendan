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

/**
 * 把一条原始 chore 补上展示需要的字段。
 *
 * myId 是「我」的成员 id，用来判断这项任务和我是什么关系：
 *   toMe —— 别人想到、派给我做的（要显眼，否则就等于靠自觉）
 *   byMe —— 我想到、派给别人做的（也让「操心」这件事被看见）
 */
function decorateChore(chore, ctx, dayIso, myId) {
  const key = periods.periodKey(chore.freq, dayIso);
  const record = ctx.byPeriod[`${chore.id}|${key}`];
  const assignee = chore.assignee_id ? ctx.members[chore.assignee_id] : null;
  const proposer = chore.created_by_id ? ctx.members[chore.created_by_id] : null;
  const mine = myId || null;

  const assignedToMe = !!(
    mine && chore.assignee_id === mine && chore.created_by_id && chore.created_by_id !== mine
  );
  const assignedByMe = !!(
    mine && chore.created_by_id === mine && chore.assignee_id && chore.assignee_id !== mine
  );

  let whoType = 'nobody';
  let whoText = '';
  if (assignedToMe) {
    whoType = 'toMe';
    whoText = `${proposer ? proposer.name : '家人'} 派给我的`;
  } else if (assignedByMe) {
    whoType = 'byMe';
    whoText = `我提的 · ${assignee ? assignee.name : '别人'} 负责`;
  } else if (assignee) {
    whoType = 'assignee';
  }

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
    createdById: chore.created_by_id || null,
    proposerName: proposer ? proposer.name : '',
    proposerShort: proposer ? `${proposer.name} 提的` : '',
    assignee_id: chore.assignee_id || null,
    assigneeName: assignee ? assignee.name : '',
    assigneeEmoji: assignee ? assignee.emoji : '',
    assigneeColor: assignee ? assignee.color : '',
    assigneeIsMe: !!(mine && assignee && assignee.id === mine),
    assignedToMe,
    assignedByMe,
    whoType,
    whoText,
    done: !!record,
    doneAt: record ? record.done_at : '',
  };
}

function buildToday(family, dayIso, myId) {
  const ctx = buildContext(family);
  const duties = family.chores
    .filter((chore) => periods.isDue(chore, dayIso))
    .map((chore) => decorateChore(chore, ctx, dayIso, myId));

  // 排序：先排别人派给我的（最需要被看见），再排没人认领的，最后按积分从高到低
  const rank = (item) => {
    if (item.assignedToMe) return 0;
    if (!item.assignee_id) return 1;
    return 2;
  };

  const pending = duties
    .filter((item) => !item.done)
    .sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
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
      assignedToMe: pending.filter((item) => item.assignedToMe).length,
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
      createdCount: 0,
      assignedOut: 0,
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
    createdCount: 0,
    assignedOut: 0,
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

  // 「提出数」—— 谁在负责「想到」。
  // 记着买日用品、约维修、安排行程，这类脑力活过去完全不可见；
  // 按任务的创建时间落在统计区间内来算，和「做完」分开计。
  const scopedChores = family.chores.filter((chore) => {
    if (!start) return true;
    const day = localDayOf(chore.created_at);
    return day && day >= start;
  });
  scopedChores.forEach((chore) => {
    const bucket = buckets[chore.created_by_id];
    if (!bucket) return;
    bucket.createdCount += 1;
    if (chore.assignee_id && chore.assignee_id !== chore.created_by_id) {
      bucket.assignedOut += 1;
    }
  });

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

  // 谁在操心：按提出数单独排一次，和「谁做了多少」是两张榜
  const creators = list
    .filter((item) => item.memberId !== 0)
    .slice()
    .sort((a, b) => b.createdCount - a.createdCount || a.memberId - b.memberId);

  return {
    scope,
    scopeLabel: scopeLabel(scope),
    totalDone: list.reduce((sum, item) => sum + item.doneCount, 0),
    totalPoints,
    invisiblePoints,
    invisibleRatio: totalPoints ? Math.round((invisiblePoints / totalPoints) * 100) : 0,
    totalCreated: scopedChores.length,
    fairness: Math.round(fairness * 100),
    maxPoints: Math.max(1, ...list.map((item) => item.points)),
    maxCreated: Math.max(1, ...creators.map((item) => item.createdCount)),
    members: list,
    creators,
    series,
    seriesMax: Math.max(1, ...series.map((item) => item.points)),
  };
}

module.exports = { buildContext, decorateChore, buildToday, buildWeek, buildStats, localDayOf };
