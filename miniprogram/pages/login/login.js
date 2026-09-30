const db = require('../../utils/db');
const store = require('../../utils/store');

const EMOJIS = ['🙂', '😎', '👩', '👨', '👧', '👦', '🧑', '👵', '👴', '🐱', '🐶', '🐼', '🦊', '🐻', '🌟', '🍀'];

Page({
  data: {
    stage: 'checking', // checking | login | choice | create | join
    busy: false,
    emojis: EMOJIS,
    householdName: '我们家',
    myName: '',
    emoji: '🙂',
    inviteCode: '',
    error: '',
  },

  onShow() {
    if (this.entered) return;
    this.check();
  },

  async check() {
    store.load();
    let signedIn = false;
    try {
      signedIn = await db.hasSession();
    } catch (err) {
      signedIn = false;
    }

    if (!signedIn) {
      this.setData({ stage: 'login', error: '' });
      return;
    }
    await this.resolve();
  },

  /** 已登录：能定位到家庭就直接进主界面，否则让用户选择创建还是加入。 */
  async resolve() {
    this.entered = true;
    try {
      const membership = await db.resolveMembership();
      if (membership) {
        store.setHousehold(membership);
        wx.switchTab({ url: '/pages/today/today' });
        return;
      }
    } catch (err) {
      // 读不到就当没有家庭，继续走创建/加入
    }
    this.entered = false;
    this.setData({ stage: 'choice', error: '' });
  },

  async handleLogin() {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try {
      await db.signInWithWechat();
      this.setData({ busy: false });
      await this.resolve();
    } catch (err) {
      this.setData({ busy: false, error: err.message || '微信登录失败，请重试' });
    }
  },

  toggleStage(e) {
    this.setData({ stage: e.currentTarget.dataset.stage, error: '' });
  },

  onHouseholdName(e) {
    this.setData({ householdName: e.detail.value });
  },

  onMyName(e) {
    this.setData({ myName: e.detail.value });
  },

  onInviteCode(e) {
    this.setData({ inviteCode: e.detail.value.toUpperCase() });
  },

  pickEmoji(e) {
    this.setData({ emoji: e.currentTarget.dataset.emoji });
  },

  async handleCreate() {
    if (this.data.busy) return;
    if (!this.data.myName.trim()) {
      this.setData({ error: '请先写下你的名字' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const result = await db.createHousehold(
        this.data.householdName,
        this.data.myName,
        this.data.emoji
      );
      store.setHousehold(result);
      wx.showToast({ title: `邀请码 ${result.inviteCode}`, icon: 'none', duration: 2200 });
      setTimeout(() => wx.switchTab({ url: '/pages/today/today' }), 600);
    } catch (err) {
      this.setData({ busy: false, error: err.message || '创建失败，请重试' });
    }
  },

  async handleJoin() {
    if (this.data.busy) return;
    const code = this.data.inviteCode.trim();
    if (!code) {
      this.setData({ error: '请输入家人给你的邀请码' });
      return;
    }
    if (!this.data.myName.trim()) {
      this.setData({ error: '请先写下你的名字' });
      return;
    }
    this.setData({ busy: true, error: '' });
    try {
      const result = await db.joinHousehold(code, this.data.myName, this.data.emoji);
      store.setHousehold(result);
      wx.showToast({ title: `已加入「${result.householdName}」`, icon: 'none' });
      setTimeout(() => wx.switchTab({ url: '/pages/today/today' }), 600);
    } catch (err) {
      this.setData({ busy: false, error: err.message || '加入失败，请检查邀请码' });
    }
  },
});
