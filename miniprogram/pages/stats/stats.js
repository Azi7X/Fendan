const store = require('../../utils/store');
const views = require('../../utils/views');

Page({
  data: {
    loading: true,
    error: '',
    scope: 'week',
    scopes: [
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'all', label: '全部' },
    ],
    scopeLabel: '',
    totalDone: 0,
    totalPoints: 0,
    fairness: 100,
    verdict: '',
    invisiblePoints: 0,
    invisibleRatio: 0,
    members: [],
    series: [],
    trendMax: 1,
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load(true).then(() => wx.stopPullDownRefresh());
  },

  async load(force) {
    if (!store.state.householdId) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    try {
      const family = await store.ensureFamily(!!force);
      const stats = views.buildStats(family, this.data.scope);

      const members = stats.members.map((item) => ({
        memberId: item.memberId,
        name: item.name,
        emoji: item.emoji,
        color: item.color,
        points: item.points,
        doneCount: item.doneCount,
        invisibleDone: item.invisibleDone,
        percent: Math.round((item.points / stats.maxPoints) * 100),
        tag: item.invisibleDone ? `其中隐形家务 ${item.invisibleDone} 项` : '暂无隐形家务记录',
      }));

      const series = stats.series.map((point) => ({
        label: point.label,
        weekdayShort: point.weekdayShort,
        points: point.points,
        height: Math.max(8, Math.round((point.points / stats.seriesMax) * 148)),
        zero: point.points === 0,
      }));

      this.setData({
        loading: false,
        error: '',
        scopeLabel: stats.scopeLabel,
        totalDone: stats.totalDone,
        totalPoints: stats.totalPoints,
        fairness: stats.fairness,
        verdict: this.verdictOf(stats.fairness),
        invisiblePoints: stats.invisiblePoints,
        invisibleRatio: stats.invisibleRatio,
        members,
        series,
        trendMax: stats.seriesMax,
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败，请下拉重试' });
    }
  },

  verdictOf(fairness) {
    if (fairness >= 80) return '分工相当均衡，这个家运转得很健康 👏';
    if (fairness >= 55) return '整体还算平衡，但有个别成员明显更重，可以聊聊怎么调一调。';
    return '差距比较明显了 —— 建议把最重的几项任务重新指派，或者用「自动均衡分配」重来一次。';
  },

  setScope(e) {
    const scope = e.currentTarget.dataset.key;
    if (scope === this.data.scope) return;
    this.setData({ scope }, () => this.load(false));
  },
});
