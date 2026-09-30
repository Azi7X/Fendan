const db = require('../../utils/db');
const store = require('../../utils/store');
const periods = require('../../utils/periods');

const WEEKDAY_OPTIONS = periods.WEEKDAY_LABELS.map((label, index) => ({ value: index, label }));
const MONTHDAY_OPTIONS = [1, 5, 10, 15, 20, 25, 28];

Page({
  data: {
    ready: false,
    isEdit: false,
    choreId: null,
    busy: false,

    title: '',
    category: 'daily',
    freq: 'daily',
    weekday: 5,
    monthday: 1,
    monthdayCustom: '',
    points: 2,
    assigneeId: 0,
    note: '',
    isActive: true,

    categories: [
      { value: 'daily', label: '🍳 日常家务' },
      { value: 'cycle', label: '🧽 周期性家务' },
      { value: 'invisible', label: '🧠 隐形家务' },
    ],
    freqs: [
      { value: 'daily', label: '每天' },
      { value: 'weekly', label: '每周' },
      { value: 'monthly', label: '每月' },
      { value: 'once', label: '一次性' },
    ],
    pointOptions: [1, 2, 3, 4, 5],
    weekdays: WEEKDAY_OPTIONS,
    monthdays: MONTHDAY_OPTIONS,
    members: [],
  },

  onLoad(options) {
    this.day = options.day || periods.todayISO();

    if (options.id) {
      this.setData({ isEdit: true, choreId: Number(options.id) });
      wx.setNavigationBarTitle({ title: '编辑任务' });
    } else {
      wx.setNavigationBarTitle({ title: '新增家务' });
    }
  },

  onShow() {
    this.fill();
  },

  async fill() {
    if (!store.state.householdId) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }

    let family = store.state.family;
    if (!family) {
      try {
        family = await store.ensureFamily(false);
      } catch (err) {
        wx.showToast({ title: err.message || '加载失败', icon: 'none' });
        return;
      }
    }

    const members = family.members.map((m) => ({
      id: m.id,
      name: m.name,
      emoji: m.emoji,
      label: `${m.emoji} ${m.name}`,
    }));

    if (!this.data.isEdit) {
      this.setData({ members, ready: true });
      return;
    }

    const chore = family.chores.filter((c) => c.id === this.data.choreId)[0];
    if (!chore) {
      wx.showToast({ title: '这项任务已不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }

    const isPresetMonthday =
      chore.monthday === null || chore.monthday === undefined
        ? false
        : MONTHDAY_OPTIONS.indexOf(chore.monthday) >= 0;

    this.setData({
      members,
      ready: true,
      title: chore.title,
      category: chore.category,
      freq: chore.freq,
      weekday: chore.weekday === null || chore.weekday === undefined ? 5 : chore.weekday,
      monthday: isPresetMonthday ? chore.monthday : 1,
      monthdayCustom: isPresetMonthday || !chore.monthday ? '' : String(chore.monthday),
      points: chore.points,
      assigneeId: chore.assignee_id || 0,
      note: chore.note || '',
      isActive: chore.is_active,
    });
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onNote(e) { this.setData({ note: e.detail.value }); },
  onMonthdayCustom(e) { this.setData({ monthdayCustom: e.detail.value, monthday: 0 }); },

  pickCategory(e) { this.setData({ category: e.currentTarget.dataset.value }); },
  pickFreq(e) { this.setData({ freq: e.currentTarget.dataset.value }); },
  pickWeekday(e) { this.setData({ weekday: Number(e.currentTarget.dataset.value) }); },
  pickMonthday(e) { this.setData({ monthday: Number(e.currentTarget.dataset.value), monthdayCustom: '' }); },
  pickPoints(e) { this.setData({ points: Number(e.currentTarget.dataset.value) }); },
  pickAssignee(e) { this.setData({ assigneeId: Number(e.currentTarget.dataset.value) }); },

  async save() {
    const title = (this.data.title || '').trim();
    if (!title) {
      wx.showToast({ title: '请填写任务名称', icon: 'none' });
      return;
    }
    if (this.data.busy) return;
    this.setData({ busy: true });

    let monthday = null;
    if (this.data.freq === 'monthly') {
      const custom = Number(this.data.monthdayCustom);
      monthday = this.data.monthdayCustom && custom >= 1 && custom <= 31 ? custom : this.data.monthday;
      if (!monthday) monthday = 1;
    }

    const payload = {
      title,
      category: this.data.category,
      freq: this.data.freq,
      weekday: this.data.freq === 'weekly' ? this.data.weekday : null,
      monthday,
      points: this.data.points,
      note: this.data.note,
      assignee_id: this.data.assigneeId || null,
    };

    try {
      if (this.data.isEdit) {
        await db.updateChore(this.data.choreId, payload);
      } else {
        await db.createChore(store.state.householdId, payload);
      }
      store.invalidateFamily();
      wx.showToast({ title: this.data.isEdit ? '已保存' : '已加入清单', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  async toggleActive() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await db.updateChore(this.data.choreId, { is_active: !this.data.isActive });
      store.invalidateFamily();
      wx.showToast({ title: this.data.isActive ? '已暂停' : '已恢复', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  remove() {
    wx.showModal({
      title: '删除任务',
      content: '确定删除这项任务？相关的完成记录也会一起清掉。',
      confirmText: '删除',
      confirmColor: '#FF5F6D',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await db.deleteChore(this.data.choreId);
          store.invalidateFamily();
          wx.showToast({ title: '已删除', icon: 'none' });
          setTimeout(() => wx.navigateBack(), 500);
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        }
      },
    });
  },
});
