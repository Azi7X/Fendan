/**
 * 小程序计算层自测（utils/views.js + utils/periods.js）。
 *
 * 这两个模块是纯计算、不碰 wx API，所以可以直接在 Node 里跑 ——
 * 小程序侧没法做编译验证，这层测试就是「排序和统计到底算对没有」的保障。
 *
 * 用法：
 *     node scripts/test_views.js
 */

const path = require('path');

const utilsDir = path.join(__dirname, '..', 'miniprogram', 'utils');
const views = require(path.join(utilsDir, 'views'));
const periods = require(path.join(utilsDir, 'periods'));

const now = new Date().toISOString();

/* 一个最小家庭：爸爸(1) 妈妈(2)
 *   洗碗   爸爸提 → 派给妈妈
 *   拖地   妈妈提 → 妈妈自己做
 *   倒垃圾 妈妈提 → 派给爸爸
 *   买手纸 没人提 → 没人认领
 */
const family = {
  members: [
    { id: 1, name: '爸爸', emoji: '👨', color: '#7C5CFF' },
    { id: 2, name: '妈妈', emoji: '👩', color: '#FF7A9C' },
  ],
  chores: [
    { id: 1, title: '洗碗', category: 'daily', freq: 'daily', points: 2, is_active: true, created_by_id: 1, assignee_id: 2, created_at: now },
    { id: 2, title: '拖地', category: 'daily', freq: 'daily', points: 5, is_active: true, created_by_id: 2, assignee_id: 2, created_at: now },
    { id: 3, title: '倒垃圾', category: 'daily', freq: 'daily', points: 1, is_active: true, created_by_id: 2, assignee_id: 1, created_at: now },
    { id: 4, title: '买手纸', category: 'invisible', freq: 'daily', points: 2, is_active: true, created_by_id: null, assignee_id: null, created_at: now },
  ],
  completions: [],
};

let failed = 0;
function check(label, actual, expected) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  if (!same) failed += 1;
  const tail = same ? '' : ` ≠ ${JSON.stringify(expected)}`;
  console.log(`${same ? '✓' : '✗'} ${label}: ${JSON.stringify(actual)}${tail}`);
}

const byTitle = (day, title) => day.pending.filter((item) => item.title === title)[0];

/* ---------------- 今日视图 ---------------- */
const today = periods.todayISO();

const momView = views.buildToday(family, today, 2);
check('排序：派给我的排最前', momView.pending.map((i) => i.title), ['洗碗', '买手纸', '拖地', '倒垃圾']);
check('派给我的件数', momView.summary.assignedToMe, 1);
check('洗碗：爸爸派给我的', [byTitle(momView, '洗碗').whoType, byTitle(momView, '洗碗').whoText], ['toMe', '爸爸 派给我的']);
check('买手纸：待认领', byTitle(momView, '买手纸').whoType, 'nobody');
check('拖地：自己提自己做，不算派给我', byTitle(momView, '拖地').whoType, 'assignee');

const dadView = views.buildToday(family, today, 1);
check('爸爸视角：倒垃圾是派给我的', dadView.summary.assignedToMe, 1);
check('爸爸视角：倒垃圾的关系', byTitle(dadView, '倒垃圾').whoType, 'toMe');
check('爸爸视角：洗碗是我提的', byTitle(dadView, '洗碗').whoType, 'byMe');
check('爸爸视角：洗碗的文案', byTitle(dadView, '洗碗').whoText, '我提的 · 妈妈 负责');
check('爸爸视角：拖地与他无关', byTitle(dadView, '拖地').whoType, 'assignee');

/* ---------------- 统计 ---------------- */
const stats = views.buildStats(family, 'all');
const byId = {};
stats.members.forEach((m) => { byId[m.memberId] = m; });

check('爸爸提出数', byId[1].createdCount, 1);
check('爸爸派出去', byId[1].assignedOut, 1);
check('妈妈提出数', byId[2].createdCount, 2);
check('妈妈派出去', byId[2].assignedOut, 1);
check('总提出数', stats.totalCreated, 4);
check('操心榜第一名', stats.creators[0].name, '妈妈');
check('没人认领的不进操心榜', stats.creators.length, 2);

console.log(failed ? `\n${failed} 项不通过` : '\n逻辑校验全部通过 ✅');
process.exit(failed ? 1 : 0);
