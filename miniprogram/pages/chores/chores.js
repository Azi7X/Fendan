const db = require('../../utils/db');
const store = require('../../utils/store');
const views = require('../../utils/views');
const periods = require('../../utils/periods');
const { CHORE_PRESETS, PRESET_GROUPS } = require('../../utils/presets');

Page({
  data: {
    loading: true,
    error: '',
    filter: 'all',
    filters: [
      { key: 'all', label: '全部' },
      { key: 'daily', label: '日常' },
      { key: 'cycle', label: '周期' },
      { key: 'invisible', label: '隐形' },
    ],
    groups: [],
    totalCount: 0,
    totalPoints: 0,

    showImport: false,
    importGroups: [],
    importCount: 0,
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
      const ctx = views.buildContext(family);
      const today = periods.todayISO();
      const rows = family.chores
        .map((chore) => views.decorateChore(chore, ctx, today))
        .sort((a, b) => (a.is_active === b.is_active ? a.id - b.id : a.is_active ? -1 : 1));

      this.family = family;
      this.setData({
        loading: false,
        error: '',
        groups: this.buildGroups(rows),
        totalCount: rows.length,
        totalPoints: rows.reduce((sum, item) => sum + (item.points || 0), 0),
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败，请下拉重试' });
    }
  },

  buildGroups(rows) {
    const filter = this.data.filter;
    const keys = filter === 'all' ? ['daily', 'cycle', 'invisible'] : [filter];

    return keys
      .map((key) => {
        const items = rows.filter((item) => item.category === key);
        return {
          key,
          label: periods.CATEGORY_LABELS[key],
          icon: periods.CATEGORY_ICONS[key],
          items,
          count: items.length,
          points: items.reduce((sum, item) => sum + (item.points || 0), 0),
        };
      })
      .filter((group) => group.items.length);
  },

  setFilter(e) {
    const filter = e.currentTarget.dataset.key;
    if (filter === this.data.filter) return;
    this.setData({ filter }, () => this.load(false));
  },

  async toggleDone(e) {
    const id = Number(e.currentTarget.dataset.id);
    const wasDone = e.currentTarget.dataset.done === true || e.currentTarget.dataset.done === 'true';
    const chore = this.findChore(id);
    if (!chore) return;

    const target = { id: chore.id, freq: chore.freq, household_id: store.state.householdId };
    const today = periods.todayISO();

    try {
      if (wasDone) {
        await db.undoComplete(target, today);
      } else {
        await db.completeChore(target, store.state.memberId, today);
        wx.showToast({ title: `完成 +${chore.points} 分`, icon: 'none' });
      }
      store.invalidateFamily();
      await this.load(true);
    } catch (err) {
      wx.showToast({ title: err.message || '操作失败', icon: 'none' });
    }
  },

  findChore(id) {
    const groups = this.data.groups;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = 0; j < groups[i].items.length; j += 1) {
        if (groups[i].items[j].id === id) return groups[i].items[j];
      }
    }
    return null;
  },

  editChore(e) {
    wx.navigateTo({ url: `/pages/chore-edit/chore-edit?id=${e.currentTarget.dataset.id}` });
  },

  addChore() {
    wx.navigateTo({ url: '/pages/chore-edit/chore-edit' });
  },

  /* ---------------- 模板导入 ---------------- */
  openImport() {
    const existing = {};
    (this.family ? this.family.chores : []).forEach((chore) => {
      existing[chore.title] = true;
    });

    const importGroups = PRESET_GROUPS.map((group) => {
      const items = CHORE_PRESETS.filter((preset) => preset.category === group.category).map((preset) => ({
        key: preset.key,
        title: preset.title,
        freqText: periods.freqText(preset),
        points: preset.points || 2,
        disabled: !!existing[preset.title],
        checked: false,
      }));
      return { category: group.category, label: group.label, desc: group.desc, items };
    });

    this.setData({ showImport: true, importGroups, importCount: 0 });
  },

  closeImport() {
    this.setData({ showImport: false });
  },

  /** 弹层内部点击不冒泡到遮罩 */
  noop() {},

  togglePreset(e) {
    const groupIndex = Number(e.currentTarget.dataset.gi);
    const itemIndex = Number(e.currentTarget.dataset.ii);
    const groups = this.data.importGroups;
    const item = groups[groupIndex].items[itemIndex];
    if (item.disabled) return;

    item.checked = !item.checked;
    this.setData({ importGroups: groups, importCount: this.countChecked(groups) });
  },

  selectAllGroup(e) {
    const groupIndex = Number(e.currentTarget.dataset.gi);
    const groups = this.data.importGroups;
    const items = groups[groupIndex].items.filter((item) => !item.disabled);
    const allChecked = items.length > 0 && items.every((item) => item.checked);

    groups[groupIndex].items.forEach((item) => {
      if (!item.disabled) item.checked = !allChecked;
    });
    this.setData({ importGroups: groups, importCount: this.countChecked(groups) });
  },

  countChecked(groups) {
    let count = 0;
    groups.forEach((group) => {
      group.items.forEach((item) => {
        if (item.checked) count += 1;
      });
    });
    return count;
  },

  async doImport() {
    const keys = [];
    this.data.importGroups.forEach((group) => {
      group.items.forEach((item) => {
        if (item.checked) keys.push(item.key);
      });
    });

    if (!keys.length) {
      wx.showToast({ title: '还没有选择任何模板', icon: 'none' });
      return;
    }

    const existing = {};
    (this.family ? this.family.chores : []).forEach((chore) => {
      existing[chore.title] = true;
    });

    try {
      const added = await db.importPresets(store.state.householdId, keys, existing, null);
      this.setData({ showImport: false });
      store.invalidateFamily();
      await this.load(true);
      wx.showToast({
        title: added.length ? `导入了 ${added.length} 项家务` : '选中项都已存在',
        icon: 'none',
      });
    } catch (err) {
      wx.showToast({ title: err.message || '导入失败', icon: 'none' });
    }
  },
});
