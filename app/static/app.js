/* ============================================================
   分担 FenDan · 前端逻辑（原生 JS，无构建步骤）
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const appEl = $("#app");
const tabEl = $("#tabbar");
const sheetEl = $("#sheet");
const sheetPanel = $("#sheetPanel");

const STORAGE_KEY = "fendan.session.v1";

const CATS = {
  daily: { label: "日常", full: "日常家务", icon: "🍳", color: "#f5a623" },
  cycle: { label: "周期", full: "周期性家务", icon: "🧽", color: "#2fa8e0" },
  invisible: { label: "隐形", full: "隐形家务", icon: "🧠", color: "#a96bff" },
};
const FREQS = { daily: "每天", weekly: "每周", monthly: "每月", once: "一次性" };
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const EMOJIS = ["🙂", "😎", "👩", "👨", "👧", "👦", "🧑", "👵", "👴", "🐱", "🐶", "🐼", "🦊", "🐻", "🌟", "🍀"];

/* ---------------------------------------------------------- 工具 */
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => toISO(new Date());

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1900);
}

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function request(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || `请求失败 (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

/* ---------------------------------------------------------- 状态 */
const S = {
  session: null,      // { code, memberId }
  household: null,
  screen: "today",
  selectedDay: todayISO(),
  today: null,
  week: null,
  chores: [],
  catFilter: "all",
  statsScope: "week",
  stats: null,
  meta: null,
  presets: null,
  loading: false,
};

const me = () => (S.household?.members || []).find((m) => m.id === S.session?.memberId) || null;
const memberById = (id) => (S.household?.members || []).find((m) => m.id === id) || null;

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(S.session));
}
function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
  S.session = null;
  S.household = null;
  S.today = S.week = S.chores = S.stats = null;
}

/* ---------------------------------------------------------- 数据加载 */
async function loadHousehold() {
  S.household = await request(`/api/households/${S.session.code}`);
  if (!memberById(S.session.memberId)) {
    S.session.memberId = S.household.members[0]?.id ?? null;
    saveSession();
  }
}

async function loadToday() {
  const q = `?day=${S.selectedDay}`;
  [S.today, S.week] = await Promise.all([
    request(`/api/households/${S.session.code}/today${q}`),
    request(`/api/households/${S.session.code}/week?start=${mondayOf(S.selectedDay)}`),
  ]);
}

async function loadChores() {
  S.chores = await request(`/api/households/${S.session.code}/chores?day=${S.selectedDay}`);
}

async function loadStats() {
  S.stats = await request(`/api/households/${S.session.code}/stats?scope=${S.statsScope}`);
}

async function loadMeta() {
  if (S.meta) return;
  const [meta, presets] = await Promise.all([
    request("/api/meta/options"),
    request("/api/presets"),
  ]);
  S.meta = meta;
  S.presets = presets;
}

function mondayOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toISO(d);
}

/* ---------------------------------------------------------- 欢迎页 */
function viewWelcome() {
  return `
  <div class="welcome">
    <div class="brand-mark">🧺</div>
    <h1>让家务<em>看得见</em><br />让分担<em>有据可依</em></h1>
    <p class="lead">
      家务分工最大的敌人不是偷懒，而是「谁在记着这件事」。
      分担把家里所有活写清楚、把每件事的责任整卡交给一个人 —— 从此不需要唠叨。
    </p>
    <div class="facts">
      <div class="fact">
        <span class="ic">📝</span>
        <div><b>三类清单，一个不漏</b><span>日常家务 / 周期性家务 / 隐形家务，把脑力活也显性化</span></div>
      </div>
      <div class="fact">
        <span class="ic">🤝</span>
        <div><b>责任整卡制</b><span>一项任务从「想到」到「做完」全归一个人，另一方不当监工</span></div>
      </div>
      <div class="fact">
        <span class="ic">📊</span>
        <div><b>公平度看得见</b><span>谁做了多少自动统计，包括那些不被看见的隐形付出</span></div>
      </div>
    </div>
    <div class="actions">
      <button class="btn" data-action="open-create">创建我的家庭</button>
      <button class="btn ghost" data-action="open-join">我有邀请码，加入家庭</button>
    </div>
  </div>`;
}

/* ---------------------------------------------------------- 今日 */
function viewToday() {
  const t = S.today;
  if (!t) return `<div class="empty"><span class="em">⏳</span><p>加载中…</p></div>`;

  const pct = t.summary.total ? Math.round((t.summary.done / t.summary.total) * 100) : 0;
  const isToday = t.day === todayISO();

  const dayChips = (S.week?.days || [])
    .map((d) => {
      const cls = [
        "day-chip",
        d.day === S.selectedDay ? "active" : "",
        d.is_today ? "today" : "",
      ].join(" ");
      return `<button class="${cls}" data-action="pick-day" data-day="${d.day}">
        <span class="wd">${d.weekday.replace("周", "")}</span>
        <span class="dn">${d.day_num}</span>
        <span class="dot ${d.total ? "" : "off"}"></span>
      </button>`;
    })
    .join("");

  return `
  <div class="screen">
    <div class="topbar">
      <h1>${isToday ? "今天" : `${t.day.slice(5).replace("-", " / ")}`}</h1>
      <div class="sub">${t.weekday}${me() ? ` · ${esc(me().name)}，这是你今天的活` : ""}</div>
    </div>

    <div class="weekstrip">${dayChips}</div>

    <div class="progress-card">
      <div class="ptop">
        <div>
          <small>今日完成度</small>
          <strong>${pct >= 100 ? "全部搞定，辛苦了 🎉" : pct >= 60 ? "快收尾了，加油" : "还有活没干完哦"}</strong>
        </div>
        <div class="ratio">${t.summary.done}<span>/${t.summary.total}</span></div>
      </div>
      <div class="bar"><i style="width:${pct}%"></i></div>
      <div class="meta">
        <span>✅ 已完成 ${t.summary.done}</span>
        <span>⭐ 已得 ${t.summary.points_done} / ${t.summary.points_total} 分</span>
        ${t.summary.unassigned ? `<span>⚠️ ${t.summary.unassigned} 项无人认领</span>` : ""}
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>待完成</h2>
        <span class="count">${t.pending.length} 项</span>
      </div>
      ${t.pending.length
        ? `<div class="task-list">${t.pending.map(taskCard).join("")}</div>`
        : `<div class="empty"><span class="em">🎉</span><p>这一天的活都干完了</p><p style="font-size:12.5px">给自己倒杯水吧</p></div>`}
    </div>

    ${t.done.length ? `
    <div class="section">
      <div class="section-head">
        <h2>已完成</h2>
        <span class="count">${t.done.length} 项</span>
      </div>
      <div class="task-list">${t.done.map(taskCard).join("")}</div>
    </div>` : ""}
  </div>
  ${quickAddBar()}`;
}

function taskCard(chore) {
  const who = memberById(chore.assignee_id);
  const cat = CATS[chore.category] || CATS.daily;
  const isMine = who && S.session?.memberId === who.id;
  return `
  <div class="task cat-${chore.category} ${chore.done ? "done" : ""}" data-id="${chore.id}">
    <div class="check" data-action="toggle" data-id="${chore.id}" data-done="${chore.done}">✓</div>
    <div class="body" data-action="edit-chore" data-id="${chore.id}">
      <div class="title">${esc(chore.title)}</div>
      <div class="sub">
        ${who
          ? `<span class="who"><i class="avatar" style="background:${who.color}22">${who.emoji}</i>${esc(who.name)}${isMine ? " · 我" : ""}</span>`
          : `<span class="badge-nobody">待认领</span>`}
        <span class="dot-sep">·</span>
        <span>${esc(chore.freq_text)}</span>
        ${chore.note ? `<span class="dot-sep">·</span><span>${esc(chore.note)}</span>` : ""}
      </div>
    </div>
    <div class="pts" title="${cat.full}">${cat.icon} ${chore.points}</div>
  </div>`;
}

function quickAddBar() {
  return `<button class="quick-add" data-action="add-chore">
    <span>＋ 添加一件家务</span><span style="flex:0 0 auto">📝</span>
  </button>`;
}

/* ---------------------------------------------------------- 清单 */
function viewChores() {
  const filter = S.catFilter;
  const list = S.chores.filter((c) => filter === "all" || c.category === filter);
  const grouped = filter === "all"
    ? Object.keys(CATS).map((key) => ({ key, items: list.filter((c) => c.category === key) }))
    : [{ key: filter, items: list }];

  const tabs = [["all", "全部"], ...Object.entries(CATS).map(([k, v]) => [k, v.label])]
    .map(([k, label]) =>
      `<button class="${filter === k ? "active" : ""}" data-action="cat-tab" data-cat="${k}">${label}</button>`)
    .join("");

  const body = grouped
    .filter((g) => g.items.length)
    .map((g) => {
      const cat = CATS[g.key];
      return `
      <div class="section">
        <div class="section-head">
          <h2>${cat.icon} ${cat.full}</h2>
          <span class="count">${g.items.length} 项 · 共 ${g.items.reduce((a, c) => a + c.points, 0)} 分</span>
        </div>
        <div class="task-list">${g.items.map(choreRow).join("")}</div>
      </div>`;
    })
    .join("");

  return `
  <div class="screen">
    <div class="topbar">
      <h1>家务清单</h1>
      <div class="sub">把「应该知道」变成「写清楚了」—— ${S.chores.length} 项任务</div>
    </div>

    <div class="segmented">${tabs}</div>

    ${S.chores.length === 0
      ? `<div class="empty" style="padding-top:34px">
           <span class="em">📝</span>
           <p>清单还是空的</p>
           <p style="font-size:12.5px">先一键导入一套家务模板，再按家里的情况改</p>
         </div>
         <div class="section">
           <button class="btn" data-action="import-presets">一键导入家务模板</button>
         </div>`
      : `${body}
         <div class="section" style="display:grid;gap:10px;grid-template-columns:1fr 1fr">
           <button class="btn ghost small" style="width:100%;padding:13px" data-action="import-presets">导入模板</button>
           <button class="btn small" style="width:100%;padding:13px" data-action="add-chore">新增家务</button>
         </div>`}
  </div>
  ${quickAddBar()}`;
}

function choreRow(chore) {
  const who = memberById(chore.assignee_id);
  const cat = CATS[chore.category] || CATS.daily;
  return `
  <div class="task cat-${chore.category} ${chore.done ? "done" : ""}">
    <div class="check" data-action="toggle" data-id="${chore.id}" data-done="${chore.done}">✓</div>
    <div class="body" data-action="edit-chore" data-id="${chore.id}">
      <div class="title">${esc(chore.title)}</div>
      <div class="sub">
        ${who
          ? `<span class="who"><i class="avatar" style="background:${who.color}22">${who.emoji}</i>${esc(who.name)}</span>`
          : `<span class="badge-nobody">待认领</span>`}
        <span class="dot-sep">·</span><span>${esc(chore.freq_text)}</span>
        ${!chore.is_active ? `<span class="dot-sep">·</span><span>已暂停</span>` : ""}
      </div>
    </div>
    <div class="pts">${cat.icon} ${chore.points}</div>
  </div>`;
}

/* ---------------------------------------------------------- 统计 */
function viewStats() {
  const st = S.stats;
  if (!st) return `<div class="empty"><span class="em">⏳</span><p>加载中…</p></div>`;

  const tabs = [["week", "本周"], ["month", "本月"], ["all", "全部"]]
    .map(([k, l]) =>
      `<button class="${S.statsScope === k ? "active" : ""}" data-action="scope" data-scope="${k}">${l}</button>`)
    .join("");

  const max = Math.max(1, ...st.members.map((m) => m.points));
  const rows = st.members
    .map((m) => `
    <div class="rank-row">
      <i class="avatar lg" style="background:${m.member_id ? m.color + "22" : "#eee"}">${m.emoji}</i>
      <div class="info">
        <div class="nm">
          <span>${esc(m.name)}</span>
          <span>${m.points} 分 · ${m.done_count} 项</span>
        </div>
        <div class="rank-track"><i style="width:${(m.points / max) * 100}%;background:${m.color}"></i></div>
        <div class="tag">${m.invisible_done ? `其中隐形家务 ${m.invisible_done} 项` : "暂无隐形家务记录"}</div>
      </div>
    </div>`)
    .join("");

  const trendMax = Math.max(1, ...st.daily_series.map((d) => d.points));
  const trend = st.daily_series
    .map((d) => `
    <div class="col ${d.points ? "" : "zero"}">
      <i style="height:${Math.max(4, (d.points / trendMax) * 74)}px"></i>
      <small>${d.weekday}</small>
    </div>`)
    .join("");

  const fair = Math.round(st.fairness * 100);
  const verdict = fair >= 80
    ? "分工相当均衡，这个家运转得很健康 👏"
    : fair >= 55
      ? "整体还算平衡，但有个别成员明显更重，可以聊聊怎么调一调。"
      : "差距比较明显了 —— 建议把最重的几项任务重新指派，或者用「自动均衡分配」重来一次。";

  const invisibleRatio = st.total_points
    ? Math.round((st.invisible_points / st.total_points) * 100) : 0;

  return `
  <div class="screen">
    <div class="topbar">
      <h1>付出统计</h1>
      <div class="sub">${esc(st.period_key)} · 让看不见的付出被看见</div>
    </div>

    <div class="segmented">${tabs}</div>

    <div class="section">
      <div class="stat-grid">
        <div class="stat-box"><b>${st.total_done}</b><small>完成项数</small></div>
        <div class="stat-box"><b>${st.total_points}</b><small>获得积分</small></div>
        <div class="stat-box"><b>${fair}%</b><small>公平度</small></div>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>谁做了多少</h2><span class="count">按积分排序</span></div>
      <div class="card">${rows || '<p style="color:#8a85a3;font-size:13px;margin:0">还没有成员</p>'}</div>
      <div class="fairness-note">
        <b>公平度 ${fair}%</b> —— ${verdict}
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>隐形家务占比</h2>
        <span class="count">${invisibleRatio}%</span>
      </div>
      <div class="card">
        <div class="bar" style="background:#f0eef8;margin-top:0">
          <i style="width:${invisibleRatio}%;background:linear-gradient(90deg,#a96bff,#7c5cff)"></i>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:10px;font-size:12.5px;color:#6b6688">
          <span>🧠 隐形家务 ${st.invisible_points} 分</span>
          <span>合计 ${st.total_points} 分</span>
        </div>
        <p style="font-size:12px;color:#8a85a3;line-height:1.65;margin:10px 0 0">
          记着买日用品、安排孩子行程、约维修……这些脑力活同样消耗精力，却最容易被当成「顺手就做了」。
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>近 7 天完成趋势</h2><span class="count">单位：积分</span></div>
      <div class="card"><div class="trend">${trend}</div></div>
    </div>
  </div>`;
}

/* ---------------------------------------------------------- 家庭 */
function viewFamily() {
  const h = S.household;
  const rows = h.members
    .map((m) => `
    <div class="member-row">
      <i class="avatar lg" style="background:${m.color}22">${m.emoji}</i>
      <div class="info">
        <div class="nm">${esc(m.name)}${m.id === S.session.memberId ? " · 我" : ""}</div>
        <div class="rl">${m.is_admin ? "家庭创建者" : "家庭成员"}</div>
      </div>
      ${m.id === S.session.memberId ? `<button class="chip" data-action="rename-me" data-id="${m.id}">改名</button>` : ""}
      ${h.members.length > 1 && m.id !== S.session.memberId
        ? `<button class="chip" data-action="del-member" data-id="${m.id}">移除</button>` : ""}
    </div>`)
    .join("");

  return `
  <div class="screen">
    <div class="topbar">
      <h1>${esc(h.name)}</h1>
      <div class="sub">${h.members.length} 位成员 · 让每个人清楚自己的责任</div>
    </div>

    <div class="section">
      <div class="invite-box">
        <small>把这个邀请码发给家人，一起进来分工</small>
        <div class="code">${h.invite_code}</div>
        <div class="hint">对方打开同一个网址 → 输入邀请码即可加入</div>
        <button class="btn" data-action="copy-code">复制邀请码</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head">
        <h2>家庭成员</h2>
        <span class="count">${h.members.length} 人</span>
      </div>
      <div class="card">${rows}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        <button class="btn ghost" style="padding:13px" data-action="add-member">＋ 添加成员</button>
        <button class="btn" style="padding:13px" data-action="rename-household">改家庭名</button>
      </div>
    </div>

    <div class="section">
      <div class="section-head"><h2>分工工具</h2></div>
      <div class="card" style="display:grid;gap:10px">
        <button class="btn ghost" data-action="auto-assign">⚖️ 自动均衡分配未认领任务</button>
        <button class="btn ghost" data-action="import-presets">📋 从模板补充家务</button>
      </div>
      <p style="font-size:12px;color:#8a85a3;line-height:1.7;margin:12px 4px 0">
        自动分配会按每位成员当前的积分负载，把还没人认领的任务派给最轻的那个人 —— 不是按性别，也不是按谁有空。
      </p>
    </div>

    <div class="section">
      <button class="btn line" data-action="logout">退出这个家庭（本机）</button>
      <p style="text-align:center;font-size:11.5px;color:#a49fbb;margin:16px 0 0">
        分担 FenDan v0.1 · 把模糊的家务变成清晰的任务
      </p>
    </div>
  </div>`;
}

/* ---------------------------------------------------------- 底部导航 */
const TABS = [
  ["today", "今日", "M12 3l9 8h-2.5v9h-5v-5.5h-3V20h-5v-9H3l9-8z"],
  ["chores", "清单", "M4 6h2v2H4V6zm0 5h2v2H4v-2zm0 5h2v2H4v-2zM9 7h11v1.6H9V7zm0 5h11v1.6H9V12zm0 5h11v1.6H9V17z"],
  ["stats", "统计", "M5 20V10h3v10H5zm5.5 0V4h3v16h-3zM16 20v-7h3v7h-3z"],
  ["family", "家庭", "M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-4 0-7 2.2-7 5v1h14v-1c0-2.8-3-5-7-5z"],
];

function renderTabbar() {
  tabEl.classList.remove("hidden");
  tabEl.innerHTML = TABS.map(([key, label, path]) =>
    `<button class="${S.screen === key ? "active" : ""}" data-action="nav" data-screen="${key}">
       <svg viewBox="0 0 24 24" fill="currentColor"><path d="${path}"/></svg>${label}
     </button>`).join("");
}

/* ---------------------------------------------------------- 渲染总控 */
async function render() {
  if (!S.session) {
    tabEl.classList.add("hidden");
    appEl.innerHTML = viewWelcome();
    return;
  }
  if (!S.household) {
    appEl.innerHTML = `<div class="empty" style="padding-top:38vh"><span class="em">⏳</span><p>正在进入家庭…</p></div>`;
    return;
  }
  renderTabbar();
  if (S.screen === "today") appEl.innerHTML = viewToday();
  else if (S.screen === "chores") appEl.innerHTML = viewChores();
  else if (S.screen === "stats") appEl.innerHTML = viewStats();
  else appEl.innerHTML = viewFamily();
}

async function refresh() {
  await Promise.all([loadHousehold(), loadToday()]);
  if (S.screen === "chores") await loadChores();
  if (S.screen === "stats") await loadStats();
  await render();
}

async function switchScreen(screen) {
  S.screen = screen;
  if (screen === "chores") await loadChores();
  if (screen === "stats") await loadStats();
  render();
  appEl.scrollTo({ top: 0 });
}

/* ---------------------------------------------------------- 弹层 */
function openSheet(html) {
  sheetPanel.innerHTML = `<div class="grab"></div>${html}`;
  sheetEl.classList.remove("hidden");
  sheetEl.setAttribute("aria-hidden", "false");
}
function closeSheet() {
  sheetEl.classList.add("hidden");
  sheetEl.setAttribute("aria-hidden", "true");
  sheetPanel.innerHTML = "";
}

/* ---------- 创建家庭 ---------- */
function sheetCreate() {
  openSheet(`
    <h3>创建我的家庭</h3>
    <p class="desc">先建一个家庭空间，拿到邀请码后再把家人叫进来。</p>
    <div class="field">
      <label>家庭名称</label>
      <input id="f-household" placeholder="比如：幸福一家" maxlength="24" value="我们家" />
    </div>
    <div class="field">
      <label>你的名字</label>
      <input id="f-name" placeholder="家人平时怎么叫你" maxlength="16" />
    </div>
    <div class="field">
      <label>选个头像</label>
      <div class="chip-row" id="f-emoji">
        ${EMOJIS.map((e, i) => `<button class="chip emoji ${i === 0 ? "active" : ""}" data-emoji="${e}">${e}</button>`).join("")}
      </div>
    </div>
    <button class="btn" data-action="do-create">创建家庭</button>
  `);
}

/* ---------- 加入家庭 ---------- */
function sheetJoin() {
  openSheet(`
    <h3>加入家庭</h3>
    <p class="desc">输入家人给你的 6 位邀请码，再写下你怎么称呼自己。</p>
    <div class="field">
      <label>邀请码</label>
      <input id="f-code" placeholder="例如 K7M2QP" maxlength="8" autocapitalize="characters"
             style="text-transform:uppercase;letter-spacing:4px;font-weight:700" />
    </div>
    <div class="field">
      <label>你的名字</label>
      <input id="f-name" placeholder="家人平时怎么叫你" maxlength="16" />
    </div>
    <div class="field">
      <label>选个头像</label>
      <div class="chip-row" id="f-emoji">
        ${EMOJIS.map((e, i) => `<button class="chip emoji ${i === 1 ? "active" : ""}" data-emoji="${e}">${e}</button>`).join("")}
      </div>
    </div>
    <button class="btn" data-action="do-join">加入家庭</button>
  `);
}

/* ---------- 新增 / 编辑任务 ---------- */
function sheetChore(chore = null) {
  const isEdit = !!chore;
  const c = chore || {
    title: "", category: "daily", freq: "daily", weekday: 5, monthday: 1,
    points: 2, note: "", assignee_id: null,
  };
  const members = S.household.members;

  openSheet(`
    <h3>${isEdit ? "编辑任务" : "新增家务"}</h3>
    <p class="desc">${isEdit
      ? "改完记得保存。负责人的调整会让这项任务的责任重新归属。"
      : "写得越具体，家里越不会扯皮。比如「洗碗」比「收拾厨房」清楚得多。"}</p>

    <div class="field">
      <label>任务名称</label>
      <input id="c-title" placeholder="比如：洗碗、换洗床单、约空调维修" maxlength="40"
             value="${esc(c.title)}" />
    </div>

    <div class="field">
      <label>属于哪一类</label>
      <div class="chip-row" id="c-category">
        ${Object.entries(CATS).map(([k, v]) =>
          `<button class="chip ${c.category === k ? "active" : ""}" data-val="${k}">${v.icon} ${v.full}</button>`).join("")}
      </div>
    </div>

    <div class="field">
      <label>多久做一次</label>
      <div class="chip-row" id="c-freq">
        ${Object.entries(FREQS).map(([k, l]) =>
          `<button class="chip ${c.freq === k ? "active" : ""}" data-val="${k}">${l}</button>`).join("")}
      </div>
    </div>

    <div class="field hidden" id="c-weekday-wrap">
      <label>安排在周几</label>
      <div class="chip-row" id="c-weekday">
        ${WEEKDAYS.map((l, i) =>
          `<button class="chip ${c.weekday === i ? "active" : ""}" data-val="${i}">${l}</button>`).join("")}
      </div>
    </div>

    <div class="field hidden" id="c-monthday-wrap">
      <label>安排在每月几号</label>
      <div class="chip-row" id="c-monthday">
        ${[1, 5, 10, 15, 20, 25, 28].map((d) =>
          `<button class="chip ${c.monthday === d ? "active" : ""}" data-val="${d}">${d} 号</button>`).join("")}
        <input id="c-monthday-custom" type="number" min="1" max="31" placeholder="自定义"
               style="width:92px;padding:9px 11px;border-radius:12px;border:1.5px solid #ece9f6;font-family:inherit"
               value="${[1,5,10,15,20,25,28].includes(c.monthday) ? "" : c.monthday || ""}" />
      </div>
    </div>

    <div class="field">
      <label>工作量（积分越高代表越累）</label>
      <div class="chip-row" id="c-points">
        ${[1, 2, 3, 4, 5].map((p) =>
          `<button class="chip ${c.points === p ? "active" : ""}" data-val="${p}">${"⭐".repeat(p)}</button>`).join("")}
      </div>
    </div>

    <div class="field">
      <label>谁负责（责任整卡制：一件事只归一个人）</label>
      <div class="chip-row" id="c-assignee">
        <button class="chip ${!c.assignee_id ? "active" : ""}" data-val="">暂不分配</button>
        ${members.map((m) =>
          `<button class="chip ${c.assignee_id === m.id ? "active" : ""}" data-val="${m.id}">${m.emoji} ${esc(m.name)}</button>`).join("")}
      </div>
    </div>

    <div class="field">
      <label>备注（可选）</label>
      <textarea id="c-note" placeholder="补充说明，比如「含备菜」「记得看保质期」" maxlength="120">${esc(c.note)}</textarea>
    </div>

    <button class="btn" data-action="${isEdit ? "do-save-chore" : "do-add-chore"}"
            ${isEdit ? `data-id="${chore.id}"` : ""}>${isEdit ? "保存修改" : "添加到清单"}</button>
    ${isEdit ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
        <button class="btn ghost" data-action="toggle-active" data-id="${chore.id}" data-active="${chore.is_active}">
          ${chore.is_active ? "暂停这项" : "恢复这项"}
        </button>
        <button class="btn danger" data-action="do-del-chore" data-id="${chore.id}">删除任务</button>
      </div>` : ""}
    <div style="height:8px"></div>
  `);
  syncFreqVisibility();
  bindChipGroups();
}

function syncFreqVisibility() {
  const active = $("#c-freq .chip.active")?.dataset.val;
  $("#c-weekday-wrap").classList.toggle("hidden", active !== "weekly");
  $("#c-monthday-wrap").classList.toggle("hidden", active !== "monthly");
}

function bindChipGroups() {
  ["c-category", "c-freq", "c-weekday", "c-monthday", "c-points", "c-assignee"].forEach((id) => {
    const box = document.getElementById(id);
    if (!box) return;
    box.addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      [...box.querySelectorAll(".chip")].forEach((b) => b.classList.remove("active"));
      chip.classList.add("active");
      if (id === "c-freq") syncFreqVisibility();
    });
  });
}

/* ---------- 模板导入 ---------- */
function sheetPresets() {
  const groups = S.presets || [];
  const existing = new Set(S.chores.map((c) => c.title));
  openSheet(`
    <h3>导入家务模板</h3>
    <p class="desc">下面是按你家场景整理好的三类清单，勾选后一键写进家里 —— 已经在清单里的会自动跳过。</p>
    ${groups.map((g) => `
      <div class="field">
        <label style="display:flex;justify-content:space-between;align-items:center">
          <span>${g.category === "daily" ? "🍳" : g.category === "cycle" ? "🧽" : "🧠"} ${g.label}</span>
          <button class="chip" data-action="preset-all" data-cat="${g.category}">全选本组</button>
        </label>
        <div class="card" style="box-shadow:none;border:1px solid #ece9f6;padding:4px 12px">
          ${g.items.map((it) => `
            <div class="preset-item">
              <div class="t">${esc(it.title)}<small>${esc(it.freq_text)} · ${it.points} 分${existing.has(it.title) ? " · 已存在" : ""}</small></div>
              <div class="switch ${existing.has(it.title) ? "locked" : ""}" data-action="preset-toggle"
                   data-key="${it.key}" data-cat="${g.category}"></div>
            </div>`).join("")}
        </div>
      </div>`).join("")}
    <button class="btn" data-action="do-import">导入选中的任务</button>
    <div style="height:8px"></div>
  `);
}

/* ---------- 成员 ---------- */
function sheetAddMember() {
  openSheet(`
    <h3>添加家庭成员</h3>
    <p class="desc">把家里每个人的名字都加进来，分工才有对象。</p>
    <div class="field">
      <label>名字</label>
      <input id="m-name" placeholder="比如：老公、妈妈、大宝" maxlength="16" />
    </div>
    <div class="field">
      <label>选个头像</label>
      <div class="chip-row" id="m-emoji">
        ${EMOJIS.map((e, i) => `<button class="chip emoji ${i === 2 ? "active" : ""}" data-emoji="${e}">${e}</button>`).join("")}
      </div>
    </div>
    <button class="btn" data-action="do-add-member">添加</button>
  `);
}

function sheetRename(household = false, memberId = null) {
  const current = household ? S.household.name : memberById(memberId)?.name || "";
  openSheet(`
    <h3>${household ? "修改家庭名称" : "修改我的名字"}</h3>
    <div class="field">
      <label>${household ? "家庭名称" : "你的名字"}</label>
      <input id="${household ? "r-household" : "r-member"}" value="${esc(current)}" maxlength="24" />
    </div>
    <button class="btn" data-action="${household ? "do-rename-household" : "do-rename-me"}"
            ${memberId ? `data-id="${memberId}"` : ""}>保存</button>
  `);
}

/* ---------------------------------------------------------- 事件 */
document.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action],[data-emoji]");

  // 头像选择
  if (target?.dataset.emoji) {
    const box = target.closest(".chip-row");
    [...box.querySelectorAll(".chip")].forEach((b) => b.classList.remove("active"));
    target.classList.add("active");
    return;
  }
  if (!target) return;
  const action = target.dataset.action;
  const id = Number(target.dataset.id || 0);

  try {
    switch (action) {
      /* 欢迎页 */
      case "open-create": sheetCreate(); break;
      case "open-join": sheetJoin(); break;

      case "do-create": {
        const name = $("#f-household").value.trim() || "我们家";
        const owner = $("#f-name").value.trim();
        const emoji = $("#f-emoji .chip.active")?.dataset.emoji || "🙂";
        if (!owner) return toast("请先写下你的名字");
        const data = await request("/api/households", {
          method: "POST",
          body: { name, owner_name: owner, owner_emoji: emoji },
        });
        S.session = { code: data.invite_code, memberId: data.members[0].id };
        saveSession();
        closeSheet();
        await refresh();
        toast(`家庭已创建，邀请码 ${data.invite_code}`);
        break;
      }

      case "do-join": {
        const code = $("#f-code").value.trim().toUpperCase();
        const name = $("#f-name").value.trim();
        const emoji = $("#f-emoji .chip.active")?.dataset.emoji || "🙂";
        if (!code) return toast("请输入邀请码");
        if (!name) return toast("请先写下你的名字");
        const hh = await request(`/api/households/${code}`);
        const existing = hh.members.find((m) => m.name === name);
        let memberId;
        if (existing) {
          memberId = existing.id;
        } else {
          const created = await request(`/api/households/${code}/members`, {
            method: "POST", body: { name, emoji },
          });
          memberId = created.id;
        }
        S.session = { code, memberId };
        saveSession();
        closeSheet();
        await refresh();
        toast(`欢迎加入「${hh.name}」`);
        break;
      }

      /* 导航 */
      case "nav": await switchScreen(target.dataset.screen); break;
      case "pick-day": S.selectedDay = target.dataset.day; S.screen = "today"; await refresh(); break;
      case "cat-tab": S.catFilter = target.dataset.cat; await loadChores(); render(); break;
      case "scope": S.statsScope = target.dataset.scope; await loadStats(); render(); break;

      /* 打卡 */
      case "toggle": {
        const choreId = id;
        if (target.dataset.done === "true") {
          await request(`/api/chores/${choreId}/complete?day=${S.selectedDay}`, { method: "DELETE" });
        } else {
          await request(`/api/chores/${choreId}/complete`, {
            method: "POST",
            body: { member_id: S.session.memberId, day: S.selectedDay },
          });
        }
        await Promise.all([loadToday(), S.screen === "chores" ? loadChores() : Promise.resolve()]);
        render();
        break;
      }

      /* 任务增删改 */
      case "add-chore": await loadMeta(); sheetChore(); break;
      case "edit-chore": {
        const chore = S.chores.find((c) => c.id === id)
          || S.today?.pending.find((c) => c.id === id)
          || S.today?.done.find((c) => c.id === id);
        if (!chore) return;
        await loadMeta();
        sheetChore(chore);
        break;
      }

      case "do-add-chore": {
        const body = collectChoreForm();
        if (!body) return;
        await request(`/api/households/${S.session.code}/chores`, { method: "POST", body });
        closeSheet();
        await refresh();
        toast("已加入家务清单");
        break;
      }

      case "do-save-chore": {
        const body = collectChoreForm();
        if (!body) return;
        await request(`/api/chores/${id}`, { method: "PATCH", body });
        closeSheet();
        await refresh();
        toast("已保存");
        break;
      }

      case "toggle-active": {
        await request(`/api/chores/${id}`, {
          method: "PATCH", body: { is_active: target.dataset.active !== "true" },
        });
        closeSheet();
        await refresh();
        toast(target.dataset.active === "true" ? "已暂停" : "已恢复");
        break;
      }

      case "do-del-chore": {
        if (!confirm("确定删除这项任务？相关的完成记录也会一起清掉。")) return;
        await request(`/api/chores/${id}`, { method: "DELETE" });
        closeSheet();
        await refresh();
        toast("已删除");
        break;
      }

      /* 模板导入 */
      case "import-presets": {
        await loadMeta();
        await loadChores();
        sheetPresets();
        break;
      }
      case "preset-toggle": target.classList.toggle("on"); break;
      case "preset-all": {
        const cat = target.dataset.cat;
        const switches = sheetPanel.querySelectorAll(`.switch[data-cat="${cat}"]:not(.locked)`);
        const allOn = [...switches].every((s) => s.classList.contains("on"));
        switches.forEach((s) => s.classList.toggle("on", !allOn));
        break;
      }
      case "do-import": {
        const keys = [...sheetPanel.querySelectorAll(".switch.on")].map((s) => s.dataset.key);
        if (!keys.length) return toast("还没有选择任何模板");
        const res = await request(`/api/households/${S.session.code}/chores/import`, {
          method: "POST", body: { keys },
        });
        closeSheet();
        await refresh();
        toast(res.added ? `导入了 ${res.added} 项家务` : "选中项都已存在");
        break;
      }

      /* 成员 */
      case "add-member": sheetAddMember(); break;
      case "do-add-member": {
        const name = $("#m-name").value.trim();
        const emoji = $("#m-emoji .chip.active")?.dataset.emoji || "🙂";
        if (!name) return toast("请输入名字");
        await request(`/api/households/${S.session.code}/members`, {
          method: "POST", body: { name, emoji },
        });
        closeSheet();
        await refresh();
        toast(`已添加 ${name}`);
        break;
      }
      case "del-member": {
        if (!confirm("确定把这位成员从家庭中移除？他负责的任务会变成待认领。")) return;
        await request(`/api/members/${id}`, { method: "DELETE" });
        await refresh();
        toast("已移除");
        break;
      }
      case "rename-me": sheetRename(false, id); break;
      case "do-rename-me": {
        await request(`/api/members/${id}`, { method: "PATCH", body: { name: $("#r-member").value.trim() } });
        closeSheet();
        await refresh();
        toast("已更新");
        break;
      }
      case "rename-household": sheetRename(true); break;
      case "do-rename-household": {
        await request(`/api/households/${S.session.code}`, {
          method: "PATCH", body: { name: $("#r-household").value.trim() || "我们家" },
        });
        closeSheet();
        await refresh();
        toast("已更新");
        break;
      }

      /* 自动分配 */
      case "auto-assign": {
        const res = await request(`/api/households/${S.session.code}/chores/auto-assign`, { method: "POST" });
        await refresh();
        toast(res.assigned ? `已自动分配 ${res.assigned} 项任务` : "没有需要分配的任务");
        break;
      }

      /* 邀请码 */
      case "copy-code": {
        const code = S.household.invite_code;
        try {
          await navigator.clipboard.writeText(code);
          toast("邀请码已复制");
        } catch {
          toast(`邀请码：${code}`);
        }
        break;
      }

      case "logout": {
        if (!confirm("退出后会清除本机记录，需要重新输入邀请码才能回来。")) return;
        clearSession();
        await render();
        break;
      }
    }
  } catch (err) {
    toast(err.message || "操作失败");
  }
});

function collectChoreForm() {
  const title = $("#c-title").value.trim();
  if (!title) { toast("请填写任务名称"); return null; }
  const freq = $("#c-freq .chip.active")?.dataset.val || "daily";
  let weekday = null;
  let monthday = null;
  if (freq === "weekly") weekday = Number($("#c-weekday .chip.active")?.dataset.val ?? 0);
  if (freq === "monthly") {
    const custom = $("#c-monthday-custom").value;
    monthday = custom
      ? Math.min(31, Math.max(1, Number(custom)))
      : Number($("#c-monthday .chip.active")?.dataset.val ?? 1);
  }
  const assigneeRaw = $("#c-assignee .chip.active")?.dataset.val || "";
  return {
    title,
    category: $("#c-category .chip.active")?.dataset.val || "daily",
    freq,
    weekday,
    monthday,
    points: Number($("#c-points .chip.active")?.dataset.val || 2),
    assignee_id: assigneeRaw ? Number(assigneeRaw) : null,
    clear_assignee: false,
    note: $("#c-note").value.trim(),
  };
}

/* 关闭弹层 */
sheetEl.addEventListener("click", (e) => {
  if (e.target === sheetEl) closeSheet();
});

/* ---------------------------------------------------------- 启动 */
async function boot() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) S.session = JSON.parse(raw);
  } catch { S.session = null; }

  if (S.session?.code) {
    try {
      await refresh();
      return;
    } catch (err) {
      clearSession();
      toast("家庭信息已失效，请重新加入");
    }
  }
  await render();
}

boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
