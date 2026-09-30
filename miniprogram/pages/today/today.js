const db = require('../../utils/db');
const store = require('../../utils/store');
const views = require('../../utils/views');
const periods = require('../../utils/periods');

Page({
  data: {
    loading: true,
    selectedDay: '',
    isToday: true,
    weekdayLabel: '',
    weekDays: [],
    summary: { total: 0, done: 0, pointsTotal: 0, pointsDone: 0, unassigned: 0 },
    percent: 0,
    pending: [],
    done: [],
    myName: '',
    myId: null,
    error: '',
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

    const selectedDay = this.data.selectedDay || periods.todayISO();
    try {
      const family = await store.ensureFamily(!!force);
      const week = views.buildWeek(family, selectedDay);
      const today = views.buildToday(family, selectedDay);
      const mine = family.members.filter((m) => m.id === store.state.memberId)[0];

      this.setData({
        loading: false,
        error: '',
        selectedDay,
        isToday: today.isToday,
        weekdayLabel: today.weekdayLabel,
        summary: today.summary,
        percent: today.summary.total
          ? Math.round((today.summary.done / today.summary.total) * 100)
          : 0,
        pending: today.pending,
        done: today.done,
        weekDays: week.days.map((d) => ({
          day: d.day,
          dayNum: d.dayNum,
          weekdayShort: d.weekdayShort,
          isToday: d.isToday,
          active: d.day === selectedDay,
          hasTask: d.total > 0,
        })),
        myName: mine ? mine.name : '',
        myId: store.state.memberId,
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败，请下拉重试' });
    }
  },

  pickDay(e) {
    const day = e.currentTarget.dataset.day;
    if (day === this.data.selectedDay) return;
    this.setData({ selectedDay: day }, () => this.load(false));
  },

  async toggleDone(e) {
    const id = Number(e.currentTarget.dataset.id);
    const wasDone = e.currentTarget.dataset.done === true || e.currentTarget.dataset.done === 'true';
    const chore = this.findChore(id);
    if (!chore) return;

    const target = { id: chore.id, freq: chore.freq, household_id: store.state.householdId };

    try {
      if (wasDone) {
        await db.undoComplete(target, this.data.selectedDay);
      } else {
        await db.completeChore(target, store.state.memberId, this.data.selectedDay);
        wx.showToast({ title: `完成 +${chore.points} 分`, icon: 'none' });
      }
      store.invalidateFamily();
      await this.load(true);
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  findChore(id) {
    const all = this.data.pending.concat(this.data.done);
    for (let i = 0; i < all.length; i += 1) {
      if (all[i].id === id) return all[i];
    }
    return null;
  },

  editChore(e) {
    wx.navigateTo({ url: `/pages/chore-edit/chore-edit?id=${e.currentTarget.dataset.id}` });
  },

  addChore() {
    wx.navigateTo({ url: `/pages/chore-edit/chore-edit?day=${this.data.selectedDay}` });
  },

  goChores() {
    wx.switchTab({ url: '/pages/chores/chores' });
  },
});
