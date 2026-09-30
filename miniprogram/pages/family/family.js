const db = require('../../utils/db');
const store = require('../../utils/store');

const EMOJIS = ['🙂', '😎', '👩', '👨', '👧', '👦', '🧑', '👵', '👴', '🐱', '🐶', '🐼', '🦊', '🐻', '🌟', '🍀'];

Page({
  data: {
    loading: true,
    error: '',
    busy: false,
    householdName: '',
    inviteCode: '',
    members: [],
    unassignedCount: 0,

    emojis: EMOJIS,
    sheet: '', // '' | 'household' | 'me'
    renameValue: '',
    renameEmoji: '🙂',
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
      const me = family.members.filter((m) => m.id === store.state.memberId)[0];

      this.setData({
        loading: false,
        error: '',
        householdName: store.state.householdName || '我们家',
        inviteCode: store.state.inviteCode || '',
        unassignedCount: family.chores.filter((c) => c.is_active && !c.assignee_id).length,
        members: family.members.map((m) => ({
          id: m.id,
          name: m.name,
          emoji: m.emoji,
          color: m.color,
          isMe: m.id === store.state.memberId,
          role: m.is_admin ? '家庭创建者' : '家庭成员',
        })),
        renameEmoji: me ? me.emoji : '🙂',
      });
    } catch (err) {
      this.setData({ loading: false, error: err.message || '加载失败，请下拉重试' });
    }
  },

  copyCode() {
    if (!this.data.inviteCode) return;
    wx.setClipboardData({
      data: this.data.inviteCode,
      success() {
        wx.showToast({ title: '邀请码已复制', icon: 'none' });
      },
    });
  },

  openRenameHousehold() {
    this.setData({ sheet: 'household', renameValue: this.data.householdName });
  },

  openRenameMe() {
    const me = this.data.members.filter((m) => m.isMe)[0];
    this.setData({ sheet: 'me', renameValue: me ? me.name : '', renameEmoji: me ? me.emoji : '🙂' });
  },

  closeSheet() {
    this.setData({ sheet: '' });
  },

  noop() {},

  onRenameInput(e) {
    this.setData({ renameValue: e.detail.value });
  },

  pickEmoji(e) {
    this.setData({ renameEmoji: e.currentTarget.dataset.emoji });
  },

  async saveRename() {
    const value = (this.data.renameValue || '').trim();
    if (!value) {
      wx.showToast({ title: '名字不能为空', icon: 'none' });
      return;
    }
    if (this.data.busy) return;
    this.setData({ busy: true });

    try {
      if (this.data.sheet === 'household') {
        await db.renameHousehold(store.state.householdId, value);
        store.state.householdName = value;
        store.save();
      } else {
        await db.updateMyMember(store.state.memberId, {
          name: value,
          emoji: this.data.renameEmoji,
        });
      }
      store.invalidateFamily();
      this.setData({ busy: false, sheet: '' });
      await this.load(true);
      wx.showToast({ title: '已更新', icon: 'none' });
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  },

  async autoAssign() {
    if (this.data.busy) return;
    if (!store.state.family) {
      wx.showToast({ title: '数据还没加载好', icon: 'none' });
      return;
    }
    this.setData({ busy: true });
    try {
      const assigned = await db.autoAssign(store.state.family);
      store.invalidateFamily();
      await this.load(true);
      this.setData({ busy: false });
      wx.showToast({
        title: assigned ? `已自动分配 ${assigned} 项任务` : '没有需要分配的任务',
        icon: 'none',
      });
    } catch (err) {
      this.setData({ busy: false });
      wx.showToast({ title: err.message || '分配失败', icon: 'none' });
    }
  },

  goChores() {
    wx.switchTab({ url: '/pages/chores/chores' });
  },

  handleSignOut() {
    wx.showModal({
      title: '退出家庭',
      content: '退出后会清除本机记录，需要重新用邀请码加入。',
      confirmText: '退出',
      confirmColor: '#FF5F6D',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await db.signOut();
        } catch (err) {
          // 登出没成功就不要清本地 —— 否则下次进来会被自动拉回同一个家庭
          wx.showToast({ title: err.message || '退出失败，请稍后重试', icon: 'none' });
          return;
        }
        store.clearHousehold();
        wx.reLaunch({ url: '/pages/login/login' });
      },
    });
  },
});
