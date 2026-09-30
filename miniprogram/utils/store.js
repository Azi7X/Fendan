/**
 * 登录态与家庭上下文。
 *
 * 唯一的身份来源是 cloud.auth；这里只缓存「我当前在哪个家庭、我是哪个成员」，
 * 用来决定进哪个页面 —— 绝不作为权限判断依据，权限全部由数据库 RLS 负责。
 */
const STORAGE_KEY = 'fendan_context_v1';

const state = {
  signedIn: false,
  householdId: null,
  memberId: null,
  householdName: '',
  inviteCode: '',
  /** 家庭成员 / 家务 / 打卡的内存缓存，切换 Tab 不必重复请求 */
  family: null,
};

function load() {
  try {
    const cached = wx.getStorageSync(STORAGE_KEY);
    if (cached && typeof cached === 'object') {
      state.householdId = cached.householdId || null;
      state.memberId = cached.memberId || null;
      state.householdName = cached.householdName || '';
    }
  } catch (err) {
    console.warn('[FenDan] read local context failed');
  }
}

function save() {
  try {
    wx.setStorageSync(STORAGE_KEY, {
      householdId: state.householdId,
      memberId: state.memberId,
      householdName: state.householdName,
    });
  } catch (err) {
    console.warn('[FenDan] write local context failed');
  }
}

function setHousehold(payload) {
  state.householdId = payload.householdId;
  state.memberId = payload.memberId;
  state.householdName = payload.householdName || '';
  state.inviteCode = payload.inviteCode || '';
  state.family = null;
  save();
}

function clearHousehold() {
  state.householdId = null;
  state.memberId = null;
  state.householdName = '';
  state.inviteCode = '';
  state.family = null;
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (err) {
    console.warn('[FenDan] clear local context failed');
  }
}

function setFamily(family) {
  state.family = family;
}

function invalidateFamily() {
  state.family = null;
}

/** 取家庭数据：有缓存就直接用，改动过后传 force=true 重新拉。 */
async function ensureFamily(force) {
  if (!force && state.family) return state.family;

  const db = require('./db');
  const family = await db.loadFamily(state.householdId);
  state.family = family;
  return family;
}

module.exports = {
  state,
  load,
  save,
  setHousehold,
  clearHousehold,
  setFamily,
  invalidateFamily,
  ensureFamily,
};

