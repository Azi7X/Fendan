/**
 * 数据访问层：所有 cloud.database / cloud.auth 调用都收在这里，页面只调用这些方法。
 *
 * 安全说明：身份完全由 cloud.auth 提供，请求会自动带上当前会话；
 * 涉及"这条数据是不是我的"的判断一律交给数据库 RLS，
 * 前端只用来决定"显示什么"，绝不当权限边界。
 */
const { cloud } = require('./cloud');
const periods = require('./periods');
const { PRESETS_BY_KEY } = require('./presets');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const COLOR_POOL = ['#7C5CFF', '#FF7A9C', '#2AC7A5', '#FFA53D', '#4FA8FF', '#B06BFF', '#FF6B6B', '#22B8A0'];

/** 把 SDK / Postgres 的错误翻译成用户能看懂的一句话。 */
function describeError(error) {
  if (!error) return '操作失败，请重试';
  const raw = String(error.message || error.error_description || error);
  const code = String(error.code || '');

  if (raw.indexOf('NOT_SIGNED_IN') >= 0) return '登录状态已失效，请重新登录';
  if (raw.indexOf('INVITE_CODE_NOT_FOUND') >= 0) return '邀请码无效，请确认后重试';
  if (raw.indexOf('NAME_REQUIRED') >= 0) return '请先填写你的名字';

  if (code === '23505') return '已经有一条一模一样的记录了';
  if (code === '42501') return '没有权限操作这条数据';
  if (code === '42P01') return '数据表还没准备好，请联系开发者';
  if (code === 'P0002') return '找不到这条记录';

  if (raw.indexOf('url not in domain list') >= 0) return '网络请求域名未放行，请在真机上重试';
  if (raw.indexOf('request:fail') >= 0 || raw.indexOf('timeout') >= 0) return '网络不太顺畅，请稍后重试';

  return raw.length > 60 ? '操作失败，请稍后重试' : raw;
}

/** 统一拆 { data, error } 信封。 */
function unwrap(result) {
  if (result && result.error) {
    const err = new Error(describeError(result.error));
    err.code = result.error.code;
    throw err;
  }
  return result ? result.data : null;
}

function randomInviteCode() {
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  return code;
}

/* ------------------------------------------------------------ 登录态 */

async function hasSession() {
  const { data } = await cloud.auth.getSession();
  return !!data;
}

/**
 * 微信一键登录：wx.login 拿 code，交给云服务的微信登录接口换取会话。
 * 失败的两种来源（wx.login 本身 / SDK 调用）分别记录 stage + message，不打印 code 或会话。
 */
function signInWithWechat() {
  return new Promise((resolve, reject) => {
    wx.login({
      success({ code }) {
        if (!code) {
          reject(new Error('微信登录失败，请重试'));
          return;
        }
        const appid = wx.getAccountInfoSync().miniProgram.appId;
        cloud.auth
          .signInWithWechat(code, appid)
          .then(({ data, error }) => {
            if (error) {
              reject(new Error(describeError(error)));
              return;
            }
            resolve(data);
          })
          .catch((error) => {
            console.error('[FenDan] login failed', JSON.stringify({
              stage: 'wechat-login-handler',
              message: error && error.message ? error.message : '微信登录失败，请重试',
            }));
            reject(new Error('微信登录失败，请重试'));
          });
      },
      fail(error) {
        console.error('[FenDan] login failed', JSON.stringify({
          stage: 'wx.login',
          message: error && error.errMsg ? error.errMsg : 'wx.login failed',
        }));
        reject(new Error('微信登录失败，请重试'));
      },
    });
  });
}

async function signOut() {
  const { error } = await cloud.auth.signOut();
  if (error) throw new Error(describeError(error));
}

/* ------------------------------------------------------------ 家庭上下文 */

/** 我在哪个家庭、我是哪个成员 —— 由只读函数 my_memberships() 在 RLS 之下取得。 */
async function resolveMembership() {
  const rows = unwrap(await cloud.database.rpc('my_memberships'));
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const mine = rows[0];
  const household = unwrap(
    await cloud.database
      .from('households')
      .select('id,name,invite_code')
      .eq('id', mine.household_id)
      .maybeSingle()
  );

  return {
    householdId: mine.household_id,
    memberId: mine.id,
    householdName: household ? household.name : '',
    inviteCode: household ? household.invite_code : '',
  };
}

/** 创建家庭：先建家庭（邀请码冲突就换一个重试），再把自己登记为第一位成员。 */
async function createHousehold(name, memberName, emoji) {
  const householdName = (name || '').trim().slice(0, 24) || '我们家';
  const myName = (memberName || '').trim().slice(0, 16);
  if (!myName) throw new Error('请先填写你的名字');

  let household = null;
  for (let attempt = 0; attempt < 6 && !household; attempt += 1) {
    const res = await cloud.database
      .from('households')
      .insert({ name: householdName, invite_code: randomInviteCode() })
      .select();

    if (res.error) {
      if (String(res.error.code) === '23505') continue; // 邀请码撞车，换一个
      throw new Error(describeError(res.error));
    }
    household = Array.isArray(res.data) ? res.data[0] : null;
  }
  if (!household) throw new Error('邀请码生成失败，请重试');

  // user_id 交给数据库的 DEFAULT auth.uid() 填，客户端不发。
  const member = unwrap(
    await cloud.database
      .from('members')
      .insert({
        household_id: household.id,
        name: myName,
        emoji: emoji || '🙂',
        color: COLOR_POOL[0],
        is_admin: true,
      })
      .select()
  );

  return {
    householdId: household.id,
    householdName: household.name,
    inviteCode: household.invite_code,
    memberId: Array.isArray(member) && member[0] ? member[0].id : null,
  };
}

/** 用邀请码加入家庭：服务端函数校验邀请码并登记成员，客户端拿不到别人的邀请码清单。 */
async function joinHousehold(code, memberName, emoji) {
  const myName = (memberName || '').trim().slice(0, 16);
  if (!myName) throw new Error('请先填写你的名字');

  const data = unwrap(
    await cloud.database.rpc('join_household', {
      p_code: (code || '').trim().toUpperCase(),
      p_name: myName,
      p_emoji: emoji || '🙂',
    })
  );

  return {
    householdId: data.householdId,
    householdName: data.householdName,
    inviteCode: data.inviteCode,
    memberId: data.memberId,
  };
}

async function renameHousehold(householdId, name) {
  return unwrap(
    await cloud.database
      .from('households')
      .update({ name: (name || '').trim().slice(0, 24) || '我们家' })
      .eq('id', householdId)
      .select()
  );
}

async function updateMyMember(memberId, patch) {
  const payload = {};
  if (typeof patch.name === 'string') payload.name = patch.name.trim().slice(0, 16);
  if (typeof patch.emoji === 'string') payload.emoji = patch.emoji;
  if (!Object.keys(payload).length) return null;

  const affected = unwrap(
    await cloud.database.from('members').update(payload).eq('id', memberId).select()
  );
  if (!affected || affected.length === 0) {
    throw new Error('没有改动到任何数据，这条记录可能不属于你');
  }
  return affected[0];
}

/* ------------------------------------------------------------ 家庭数据 */

/** 一次性把家庭成员、家务、打卡记录取回来，后续计算都在本地做。 */
async function loadFamily(householdId) {
  const [members, chores, completions] = await Promise.all([
    cloud.database.from('members').select('*').eq('household_id', householdId).order('id', { ascending: true }),
    cloud.database.from('chores').select('*').eq('household_id', householdId).order('id', { ascending: true }),
    cloud.database
      .from('completions')
      .select('id,chore_id,member_id,period_key,done_at')
      .eq('household_id', householdId),
  ]);

  return {
    members: unwrap(members) || [],
    chores: unwrap(chores) || [],
    completions: unwrap(completions) || [],
  };
}

async function createChore(householdId, payload) {
  const row = {
    household_id: householdId,
    title: (payload.title || '').trim().slice(0, 40),
    category: payload.category || 'daily',
    freq: payload.freq || 'daily',
    weekday: payload.freq === 'weekly' ? payload.weekday : null,
    monthday: payload.freq === 'monthly' ? payload.monthday : null,
    points: payload.points || 2,
    note: (payload.note || '').slice(0, 120),
    // 提出人：谁想到这件事的；负责人：谁去做。两个可以是不同的人。
    created_by_id: payload.created_by_id || null,
    assignee_id: payload.assignee_id || null,
    is_active: true,
  };
  if (!row.title) throw new Error('请填写任务名称');

  const created = unwrap(await cloud.database.from('chores').insert(row).select());
  return Array.isArray(created) ? created[0] : created;
}

async function updateChore(choreId, patch) {
  const payload = {};
  if (patch.title !== undefined) payload.title = String(patch.title).trim().slice(0, 40);
  if (patch.category !== undefined) payload.category = patch.category;
  if (patch.freq !== undefined) payload.freq = patch.freq;
  if (patch.weekday !== undefined) payload.weekday = patch.weekday;
  if (patch.monthday !== undefined) payload.monthday = patch.monthday;
  if (patch.points !== undefined) payload.points = patch.points;
  if (patch.note !== undefined) payload.note = String(patch.note).slice(0, 120);
  if (patch.created_by_id !== undefined) payload.created_by_id = patch.created_by_id || null;
  if (patch.assignee_id !== undefined) payload.assignee_id = patch.assignee_id || null;
  if (patch.is_active !== undefined) payload.is_active = patch.is_active;

  if (!Object.keys(payload).length) return null;

  const affected = unwrap(
    await cloud.database.from('chores').update(payload).eq('id', choreId).select()
  );
  if (!affected || affected.length === 0) {
    throw new Error('没有改动到任何数据，这项任务可能不属于你所在家庭');
  }
  return affected[0];
}

async function deleteChore(choreId) {
  const removed = unwrap(
    await cloud.database.from('chores').delete().eq('id', choreId).select()
  );
  if (!removed || removed.length === 0) {
    throw new Error('没有删除到任何数据，这项任务可能不属于你所在家庭');
  }
  return true;
}

/** 按模板批量导入，跳过同名任务。 */
async function importPresets(householdId, keys, existingTitles, assigneeId, createdById) {
  const seen = existingTitles || {};
  const rows = [];

  keys.forEach((key) => {
    const preset = PRESETS_BY_KEY[key];
    if (!preset || seen[preset.title]) return;
    seen[preset.title] = true;
    rows.push({
      household_id: householdId,
      title: preset.title,
      category: preset.category,
      freq: preset.freq,
      weekday: preset.weekday === undefined ? null : preset.weekday,
      monthday: preset.monthday === undefined ? null : preset.monthday,
      points: preset.points || 2,
      note: preset.note || '',
      created_by_id: createdById || null,
      assignee_id: assigneeId || null,
      is_active: true,
    });
  });

  if (!rows.length) return [];
  return unwrap(await cloud.database.from('chores').insert(rows).select()) || [];
}

/** 把还没人认领的任务，按积分负载派给当前最轻的成员。 */
async function autoAssign(family) {
  const load = {};
  family.members.forEach((m) => {
    load[m.id] = 0;
  });
  family.chores.forEach((c) => {
    if (c.is_active && c.assignee_id && load[c.assignee_id] !== undefined) {
      load[c.assignee_id] += c.points || 1;
    }
  });

  const targets = Object.keys(load).map(Number);
  if (!targets.length) throw new Error('请先添加家庭成员');

  let assigned = 0;
  for (let i = 0; i < family.chores.length; i += 1) {
    const chore = family.chores[i];
    if (!chore.is_active || chore.assignee_id) continue;

    targets.sort((a, b) => load[a] - load[b] || a - b);
    const target = targets[0];

    const affected = unwrap(
      await cloud.database
        .from('chores')
        .update({ assignee_id: target })
        .eq('id', chore.id)
        .select()
    );
    if (affected && affected.length) {
      load[target] += chore.points || 1;
      assigned += 1;
    }
  }
  return assigned;
}

/* ------------------------------------------------------------ 打卡 */

async function completeChore(chore, memberId, dayIso) {
  const key = periods.periodKey(chore.freq, dayIso);
  const data = unwrap(
    await cloud.database
      .from('completions')
      .upsert(
        {
          household_id: chore.household_id,
          chore_id: chore.id,
          member_id: memberId || null,
          period_key: key,
        },
        { onConflict: 'chore_id,period_key' }
      )
      .select()
  );
  return Array.isArray(data) ? data[0] : data;
}

async function undoComplete(chore, dayIso) {
  const key = periods.periodKey(chore.freq, dayIso);
  unwrap(
    await cloud.database
      .from('completions')
      .delete()
      .eq('chore_id', chore.id)
      .eq('period_key', key)
      .select()
  );
  return true;
}

module.exports = {
  describeError,
  hasSession,
  signInWithWechat,
  signOut,
  resolveMembership,
  createHousehold,
  joinHousehold,
  renameHousehold,
  updateMyMember,
  loadFamily,
  createChore,
  updateChore,
  deleteChore,
  importPresets,
  autoAssign,
  completeChore,
  undoComplete,
};
