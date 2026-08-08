"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (value = "") => String(value).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
// 存储型 XSS 消毒（单证模板等用户可编辑 HTML）：用 DOMPurify 清理脚本/事件/危险 URL
const sanitizeHtml = (html) => (window.DOMPurify ? window.DOMPurify.sanitize(String(html == null ? "" : html)) : String(html == null ? "" : html));
const uid = () => "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (value, digits = 2) => {
  const n = Number(value);
  if (!isFinite(n)) return "0";
  return n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtInt = (value) => {
  const n = Number(value);
  if (!isFinite(n)) return "0";
  return Math.round(n).toLocaleString("zh-CN");
};
const dateISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => dateISO(new Date());
const pad = (n) => String(n).padStart(2, "0");

// 系统版本号：升级时改这里，登录页/设置页会显示；增量升级包按此命名
const APP_VERSION = "v1.1";

// 单证模板主色（buildDefaultDocTemplates 与各 tpl* 帮助函数共用）
const TPL_C = "#1f3a5f";

const STORE_KEY = "tradeToolboxV1";
// 单证模板版本：版本升级时重建默认模板（丢弃旧版 localStorage 里的模板），保证用户拿到最新专业版
const DOC_TPL_VERSION = 2;
const defaultRates = () => Object.fromEntries(TRADE_DATA.currencies.map((c) => [c.code, c.rate]));
// 给内置演示数据打上 _demo 标记（管理员"清空初始演示数据"按此识别，只删演示、绝不删用户自建数据）
const markDemo = (arr) => JSON.parse(JSON.stringify(arr || [])).map((x) => ({ ...x, _demo: true }));
const defaultState = () => ({
  clients: markDemo(DEMO_CLIENTS),
  quotes: markDemo(DEMO_QUOTES),
  products: markDemo(TRADE_DATA.products),
  orders: markDemo(TRADE_DATA.orders),
  colorDict: markDemo(TRADE_DATA.colorDict),
  hsCodes: markDemo(TRADE_DATA.hsCodes),
  logisticsItems: [{ id: "lg1", name: "默认货物", len: 60, width: 40, height: 35, weight: 18, qty: 500 }],
  logisticsRates: JSON.parse(JSON.stringify(TRADE_DATA.logisticsRates)),
  containers: JSON.parse(JSON.stringify(TRADE_DATA.containers)),
  lastLogistics: null,
  rates: defaultRates(),
  settings: { company: "", sales: "", email: "", phone: "", baseCity: "Asia/Shanghai", myStart: "09:00", myEnd: "18:00", defaultIncoterm: "FOB", defaultPayment: "30% T/T deposit + 70% before shipment", defaultPort: "Ningbo", defaultCurrency: "USD", defaultValidity: "15 days", defaultDelivery: "25 days after deposit", sellerAddress: "", invoicePrefix: "INV", bankName: "", bankAccount: "", bankSwift: "", bankAddress: "" },
  docBuilder: { invoiceNo: "", poNo: "", date: todayISO(), seller: "", sellerAddress: "", buyer: "", buyerAddress: "", bank: "", cartons: "", currency: "USD", terms: "", payment: "", delivery: "", validity: "", from: "", to: "", vessel: "", marks: "", weight: "", volume: "", shipDate: "", eta: "", notes: "", docItems: [] },
  docCounter: 0,
  docHistory: [],
  ratesUpdatedAt: 0,
  docTemplates: buildDefaultDocTemplates(),
  docTplVersion: DOC_TPL_VERSION,
  lastQuoteCalc: null,
  customEmails: {},
  _owner: "", // 数据归属用户名：防跨账号串数据，并用于「本地 vs 服务器谁新」判定
  updatedAt: 0, // 最后保存时间戳
  checklist: { sea: [], air: [], express: [] }
});

function ensureHsIds(hs) {
  return (hs || []).map((h) => (h && h.id ? h : { ...h, id: uid() }));
}

function normalizeDocBuilder(base, raw) {
  const b = { ...base, ...(raw && typeof raw === "object" ? raw : {}) };
  // 旧版本单行货物字段 → 迁移为明细第一行
  if (!Array.isArray(b.docItems)) {
    b.docItems = (b.product || b.amount) ? [{ desc: b.product || "", hs: b.hs || "", qty: b.qty || "", unitPrice: b.unitPrice || "" }] : [];
  }
  return b;
}

function normalizeProducts(list) {
  // 数字字段强制转 Number（根因：导入/加载的字符串值会进入 innerHTML 属性与文本上下文 → XSS 注入面）
  return (list || []).map((p) => {
    const b = { ...p, nameEn: p.nameEn || "" };
    b.priceTiers = Array.isArray(p.priceTiers) ? p.priceTiers.map((t) => ({ ...t, qty: Number(t.qty) || 0, price: Number(t.price) || 0 })) : [];
    b.cartonL = Number(p.cartonL) || 0;
    b.cartonW = Number(p.cartonW) || 0;
    b.cartonH = Number(p.cartonH) || 0;
    b.cartonWeight = Number(p.cartonWeight) || 0;
    b.qtyPerCarton = Number(p.qtyPerCarton) || 0;
    b.unitCost = Number(p.unitCost) || 0;
    b.moq = Number(p.moq) || 0;
    return b;
  });
}
function normalizeLogistics(list) {
  return (list || []).map((it) => ({
    ...it,
    len: Number(it.len) || 0,
    width: Number(it.width) || 0,
    height: Number(it.height) || 0,
    weight: Number(it.weight) || 0,
    qty: Number(it.qty) || 0,
  }));
}
function normalizeContainers(list) {
  return (list || []).map((c) => ({ ...c, volume: Number(c.volume) || 0, usable: Number(c.usable) || 0, payload: Number(c.payload) || 0 }));
}

function normalizeClients(list) {
  return (list || []).map((c) => ({ phone: "", source: "自主开发", level: "B", timezone: "", ...c }));
}

function normalizeOrders(list) {
  return (list || []).map((o) => {
    if (Array.isArray(o.items)) return o;
    // 旧版本单产品订单 → 迁移为明细第一行
    const items = (o.product || o.qty || o.amount)
      ? [{ pid: "", name: o.product || "", hs: o.hs || "", qty: String(o.qty || ""), unitPrice: o.amount && o.qty ? (Number(o.amount) / Number(o.qty)).toFixed(2) : "", amount: o.amount || 0 }]
      : [];
    return { ...o, items };
  });
}

function normalizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  const base = defaultState();
  return {
    ...base,
    ...s,
    clients: normalizeClients(Array.isArray(s.clients) ? s.clients : base.clients),
    quotes: Array.isArray(s.quotes) ? s.quotes : base.quotes,
    products: normalizeProducts(Array.isArray(s.products) ? s.products : base.products),
    orders: normalizeOrders(Array.isArray(s.orders) ? s.orders : base.orders),
    colorDict: Array.isArray(s.colorDict) && s.colorDict.length ? s.colorDict : base.colorDict,
    hsCodes: ensureHsIds(Array.isArray(s.hsCodes) ? s.hsCodes : base.hsCodes),
    logisticsItems: normalizeLogistics(Array.isArray(s.logisticsItems) ? s.logisticsItems : base.logisticsItems),
    logisticsRates: Array.isArray(s.logisticsRates) && s.logisticsRates.length ? s.logisticsRates : base.logisticsRates,
    containers: normalizeContainers(Array.isArray(s.containers) && s.containers.length ? s.containers : base.containers),
    customEmails: s.customEmails && typeof s.customEmails === "object" && !Array.isArray(s.customEmails) ? s.customEmails : {},
    rates: { ...defaultRates(), ...(s.rates && typeof s.rates === "object" ? s.rates : {}) },
    settings: { ...base.settings, ...(s.settings && typeof s.settings === "object" ? s.settings : {}) },
    docBuilder: normalizeDocBuilder(base.docBuilder, s.docBuilder),
    docTemplates: (s.docTplVersion === DOC_TPL_VERSION && s.docTemplates && typeof s.docTemplates === "object" ? s.docTemplates : base.docTemplates),
    docTplVersion: DOC_TPL_VERSION,
    checklist: { sea: [], air: [], express: [], ...(s.checklist && typeof s.checklist === "object" ? s.checklist : {}) },
    docHistory: Array.isArray(s.docHistory) ? s.docHistory : [],
    ratesUpdatedAt: s.ratesUpdatedAt || 0,
    lastQuoteCalc: s.lastQuoteCalc || null,
    lastLogistics: s.lastLogistics || null
  };
}

let state;
try {
  state = normalizeState(JSON.parse(localStorage.getItem(STORE_KEY) || "null") || null);
} catch (err) {
  state = normalizeState(null);
}

// —— 多用户登录 ——
let auth = loadAuth();
function loadAuth() {
  try {
    const a = JSON.parse(localStorage.getItem("tradeToolboxAuth") || '{"token":"","username":""}');
    return (a && typeof a === "object") ? { token: String(a.token || ""), username: String(a.username || ""), role: String(a.role || "") } : { token: "", username: "" };
  } catch (err) { return { token: "", username: "" }; }
}
function saveAuth() {
  try { localStorage.setItem("tradeToolboxAuth", JSON.stringify(auth)); } catch (err) { /* ignore */ }
}

function saveState() {
  if (auth.username) state._owner = auth.username;
  state.updatedAt = Date.now();
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    // localStorage 满（约 5MB）会静默失败 → 提示一次，避免用户误以为已保存
    if (!storageWarned) {
      storageWarned = true;
      toast("本机存储空间已满，数据可能未完整保存，请清理数据或改用服务器保存", 5000);
    }
  }
  if (auth.token) scheduleServerSave();
}

let serverSaveTimer = null;
let sessionEpoch = 0; // 会话代际：登出/切换账号时 +1，使排队的过期保存定时器作废（防止 A 的数据被写进 B 的账号）
let saveFailNotified = false;
let storageWarned = false;

function scheduleServerSave() {
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(pushUserState, 600);
}

function notifySaveFail() {
  if (saveFailNotified) return;
  saveFailNotified = true;
  toast("保存失败：无法连接服务器，当前改动可能未同步，请检查网络", 4000);
}

async function pushUserState() {
  // 捕获调度时的会话与账号；期间若登出/切换账号，本次推送作废
  const epoch = sessionEpoch;
  const uname = auth.username;
  const tok = auth.token;
  if (!tok) return;
  try {
    const r = await fetch("api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: JSON.stringify(state)
    });
    if (epoch !== sessionEpoch || uname !== auth.username || tok !== auth.token) return; // 会话已切换，丢弃
    if (r.ok) { saveFailNotified = false; } else notifySaveFail();
  } catch (err) {
    if (epoch === sessionEpoch && uname === auth.username) notifySaveFail();
  }
}

// 立即清空排队并推送一次（用于 resetData/importData 等破坏性操作：推送失败可回滚）
async function flushState() {
  clearTimeout(serverSaveTimer);
  serverSaveTimer = null;
  if (!auth.token) return true;
  const epoch = sessionEpoch, uname = auth.username, tok = auth.token;
  try {
    const r = await fetch("api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
      body: JSON.stringify(state)
    });
    if (epoch !== sessionEpoch || uname !== auth.username) return false;
    return r.ok;
  } catch (e) { return false; }
}

async function initAuth() {
  const screen = $("#authScreen");
  if (!screen) return;
  let served = false;
  try {
    const r = await fetch("api/me", { headers: auth.token ? { Authorization: "Bearer " + auth.token } : {} });
    served = true;
    if (r.status === 200) {
      const me = await r.json();
      auth.username = me.username || auth.username;
      auth.role = me.role || auth.role || "";
      saveAuth();
      await loadUserState();
      enterApp();
      return;
    }
    auth = { token: "", username: "" };
    saveAuth();
  } catch (err) { served = false; }
  if (served) showAuthLogin();
  else enterApp();
}

function enterApp() {
  $("#authScreen")?.classList.remove("auth-visible");
  const initial = location.hash.replace("#", "");
  go(sectionMeta[initial] ? initial : "dashboard");
  if (auth.username) toast(`已登录：${auth.username}`);
  renderSettings();
}

function showAuthLogin() {
  $("#authLoading").style.display = "none";
  $("#authLoginForm").style.display = "block";
  $("#authRegisterForm").style.display = "none";
  $("#authScreen").classList.add("auth-visible");
  setTimeout(() => $("#authUsername")?.focus(), 50);
  updateAuthLicenseHint();
}

// 登录页左上角授权卡片：试用状态 + 试用账号提示 + 已激活公司名/到期日
async function updateAuthLicenseHint() {
  const el = $("#authLicenseHint");
  if (!el) return;
  try {
    const r = await fetch("api/license", { cache: "no-store" });
    const d = await r.json();
    const daysToExpiry = d.expires ? Math.ceil((Date.parse(d.expires) - Date.now()) / (24 * 3600 * 1000)) : Infinity;
    // 全新安装（尚无账号）：显示注册邀请码并自动填入注册框（引导第一个注册成为管理员）
    if (d.registerKey) {
      const rk = d.registerKey || "";
      const regKeyEl = $("#regKey");
      if (regKeyEl && !regKeyEl.value) regKeyEl.value = rk;
      // 仅在首次启动（尚无管理员）时显示；不提示"自动填入"
      el.innerHTML = `还没有账号？<strong>注册邀请码：${esc(rk)}</strong> · 第一个注册的账号自动成为管理员。`;
      refreshIcons();
      return;
    }
    // 有账号后：所有人员只显示公司名与授权到期日（授权管理在设置页，仅管理员可见）
    if (d.mode === "licensed") {
      if (isFinite(daysToExpiry) && daysToExpiry <= 3) {
        el.innerHTML = `<span style="color:#b45309;font-weight:600"><i data-lucide="alert-triangle"></i> 授权将于 <strong>${daysToExpiry} 天</strong>后到期（${esc(String(d.expires).slice(0, 10))}）</span>`;
      } else {
        el.innerHTML = `<span style="color:#334155">${esc(d.company || "")} · 授权到期 ${esc(String(d.expires || "").slice(0, 10) || "永久")}</span>`;
      }
    } else if (d.mode === "trial") {
      const warn = Number(d.daysLeft) <= 3;
      el.innerHTML = `<span${warn ? ` style="color:#b45309;font-weight:600"` : ""}>试用中 · 剩余 <strong>${Number(d.daysLeft) || 0} 天</strong>${warn ? "（请尽快联系管理员激活）" : ""}</span>`;
    } else {
      el.innerHTML = `<span style="color:#dc2626;font-weight:600">授权已到期，请联系管理员</span>`;
    }
    refreshIcons();
  } catch (e) { el.textContent = ""; }
}

// 授权弹窗（登录页左上角"激活/管理授权"按钮打开）
async function doLogin() {
  clearTimeout(serverSaveTimer); serverSaveTimer = null;
  const u = $("#authUsername").value.trim();
  const p = $("#authPassword").value;
  const err = $("#authError");
  if (!u || !p) { err.textContent = "请输入用户名和密码"; return; }
  try {
    const r = await fetch("api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p }) });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || "登录失败"; return; }
    sessionEpoch++;
    saveFailNotified = false;
    auth = { token: data.token, username: data.username, role: data.role || "" };
    saveAuth();
    err.textContent = "";
    await loadUserState();
    enterApp();
  } catch (e) { err.textContent = "无法连接服务器"; }
}

async function doRegister() {
  const u = $("#regUsername").value.trim();
  const d = $("#regDisplayName").value.trim();
  const p = $("#regPassword").value;
  const k = $("#regKey").value.trim();
  const err = $("#authError2");
  if (!u || !p || !k) { err.textContent = "请填写用户名、密码和邀请码"; return; }
  try {
    const r = await fetch("api/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: u, password: p, displayName: d, key: k }) });
    const data = await r.json();
    if (!r.ok) { err.textContent = data.error || "注册失败"; return; }
    err.textContent = "注册成功，请登录";
    $("#authUsername").value = u;
    $("#regPassword").value = ""; $("#regKey").value = "";
    showAuthLogin();
  } catch (e) { err.textContent = "无法连接服务器"; }
}

async function loadUserState() {
  clearTimeout(serverSaveTimer); serverSaveTimer = null;
  try {
    const r = await fetch("api/state", { headers: { Authorization: "Bearer " + auth.token }, cache: "no-store" });
    if (r.ok) {
      const data = await r.json();
      if (data && typeof data === "object") {
        // 同用户本地数据比服务器新（离线编辑/未 flush 的改动）→ 本地优先并上传，避免被服务器旧快照覆盖
        let local = null;
        try {
          const ls = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
          if (ls && typeof ls === "object" && !Array.isArray(ls)) local = ls;
        } catch (e) { /* ignore */ }
        if (local && local._owner === auth.username && Number(local.updatedAt || 0) > Number(data.updatedAt || 0)) {
          state = normalizeState(local);
          saveState();
          return;
        }
        state = normalizeState(data);
        saveState();
        return;
      }
    }
    // 加载失败/损坏：清空内存并只写本地存储，绝不在错误的账号下把上个用户数据推送上去
    state = normalizeState(null);
    clearTimeout(serverSaveTimer); serverSaveTimer = null;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  } catch (err) { /* 本地模式（file://） */ }
}

async function logout() {
  const tok = auth.token;
  if (tok) {
    clearTimeout(serverSaveTimer); serverSaveTimer = null;
    // 先把最后一次改动写回服务器，再注销（best-effort，失败不阻断）
    try { await fetch("api/state", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify(state) }); } catch (e) { /* ignore */ }
    try { await fetch("api/logout", { method: "POST", headers: { Authorization: "Bearer " + tok } }); } catch (e) { /* ignore */ }
  }
  sessionEpoch++;
  saveFailNotified = false;
  auth = { token: "", username: "" };
  saveAuth();
  $("#authLoading").style.display = "none";
  $("#authError").textContent = "";
  showAuthLogin();
}

function refreshIcons() {
  if (window.lucide) lucide.createIcons();
}

let toastTimer;
function toast(message) {
  const old = $(".toast");
  if (old) old.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.remove(), 2400);
}

function closeModal() {
  // 清理可能残留的产品/颜色下拉与二级选择弹窗
  closeDropdown(".prod-dd");
  closeDropdown(".color-picker");
  const pk = document.querySelector(".pk-overlay");
  if (pk) pk.remove();
  if (window.__pdfUrl) {
    try { URL.revokeObjectURL(window.__pdfUrl); } catch (err) { /* ignore */ }
    window.__pdfUrl = "";
  }
  $("#modalRoot").innerHTML = "";
}

function openModal(html) {
  closeModal();
  $("#modalRoot").innerHTML = `<div class="modal-overlay">${html}</div>`;
  refreshIcons();
  $(".modal-overlay").addEventListener("click", (e) => { if (e.target === e.currentTarget) closeModal(); });
  $("#modalCloseBtn")?.addEventListener("click", closeModal);
  $("#modalCancelBtn")?.addEventListener("click", closeModal);
}

function downloadFile(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob(["\ufeff" + text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("已复制到剪贴板");
  } catch (err) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("已复制到剪贴板");
  }
}

const STATUS_COLORS = {
  "潜在客户": "gray", "已联系": "teal", "报价中": "blue", "新报价": "blue",
  "跟进中": "amber", "已成交": "green", "流失": "red", "丢失": "red"
};
function statusBadge(text) {
  return `<span class="badge ${STATUS_COLORS[text] || "gray"}">${esc(text)}</span>`;
}

function tzParts(tz, date = new Date()) {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
    return { ...parts, year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour % 24, minute: +parts.minute, second: +parts.second };
  } catch (err) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(), second: date.getSeconds(), weekday: date.toLocaleDateString("en-US", { weekday: "short" }) };
  }
}

function tzOffsetMin(tz, date = new Date()) {
  const p = tzParts(tz, date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return (asUtc - date.getTime()) / 60000;
}

function timeInTz(tz, date = new Date()) {
  const p = tzParts(tz, date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const sectionMeta = {};
$$(".section").forEach((sec) => {
  const id = sec.id.replace("section-", "");
  sectionMeta[id] = { title: sec.dataset.title || "", subtitle: sec.dataset.subtitle || "" };
});

function go(sectionId) {
  $$(".section").forEach((sec) => sec.classList.toggle("active", sec.id === `section-${sectionId}`));
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.section === sectionId));
  const meta = sectionMeta[sectionId] || {};
  $("#pageTitle").textContent = meta.title || "";
  $("#pageSubtitle").textContent = meta.subtitle || "";
  closeSidebar();
  window.scrollTo({ top: 0, behavior: "instant" });
  const renderer = renderers[sectionId];
  if (renderer) renderer();
  refreshIcons();
  try { if (location.hash !== "#" + sectionId) history.replaceState(null, "", "#" + sectionId); } catch (err) { /* file:// may block history */ }
}

function openSidebar() {
  $("#sidebar").classList.add("open");
  $("#overlay").classList.add("show");
}
function closeSidebar() {
  $("#sidebar").classList.remove("open");
  $("#overlay").classList.remove("show");
}

function updateClocks() {
  const dash = $("#dashClocks");
  if (dash) {
    const cities = [["北京", "Asia/Shanghai"], ["伦敦", "Europe/London"], ["纽约", "America/New_York"], ["迪拜", "Asia/Dubai"], ["悉尼", "Australia/Sydney"]];
    dash.innerHTML = cities.map(([city, tz]) => {
      const p = tzParts(tz);
      return `<div class="clock-card"><div class="city">${esc(city)}</div><div class="time">${pad(p.hour)}:${pad(p.minute)}</div><div class="offset">${WEEKDAYS[p.weekday === "Sun" ? 0 : p.weekday === "Mon" ? 1 : p.weekday === "Tue" ? 2 : p.weekday === "Wed" ? 3 : p.weekday === "Thu" ? 4 : p.weekday === "Fri" ? 5 : 6]}</div></div>`;
    }).join("");
  }
  const side = $("#sidebarTime");
  if (side) side.textContent = `本地 ${timeInTz(state.settings.baseCity || "Asia/Shanghai")}`;
}

function renderDashboard() {
  const now = new Date();
  const soon = dateISO(new Date(now.getTime() + 7 * 86400000));
  const activeClients = state.clients.filter((c) => ["已联系", "报价中", "跟进中", "新报价"].includes(c.status));
  const pending = state.clients.filter((c) => c.nextFollowUp && c.nextFollowUp <= soon);
  const activeOrders = state.orders.filter((o) => !["已完成", "已取消"].includes(o.status));
  // 订单交期提醒：14 天内到期或已逾期（未完成）
  const dueOrders = state.orders.filter((o) => !["已完成", "已取消"].includes(o.status) && o.deliveryDate)
    .map((o) => ({ ...o, days: Math.ceil((new Date(o.deliveryDate) - now) / 86400000) }))
    .filter((o) => o.days <= 14)
    .sort((a, b) => a.days - b.days);
  $("#dashStats").innerHTML = `
    <div class="stat-card"><div class="stat-label">客户总数</div><div class="stat-value">${state.clients.length}</div><div class="stat-note">活跃 ${activeClients.length}</div></div>
    <div class="stat-card"><div class="stat-label">报价记录</div><div class="stat-value">${state.quotes.length}</div><div class="stat-note">成交 ${state.quotes.filter((q) => q.status === "已成交").length}</div></div>
    <div class="stat-card"><div class="stat-label">进行中订单</div><div class="stat-value">${activeOrders.length}</div><div class="stat-note">共 ${state.orders.length} 单</div></div>
    <div class="stat-card"><div class="stat-label">7 天内待跟进</div><div class="stat-value">${pending.length}</div><div class="stat-note">客户</div></div>
    <div class="stat-card"><div class="stat-label">14 天内交期</div><div class="stat-value">${dueOrders.length}</div><div class="stat-note">订单</div></div>
    <div class="stat-card"><div class="stat-label">产品资料</div><div class="stat-value">${state.products.length}</div><div class="stat-note">可带入报价</div></div>`;

  const followList = pending.sort((a, b) => (a.nextFollowUp || "").localeCompare(b.nextFollowUp || ""));
  $("#dashFollowups").innerHTML = followList.length ? followList.slice(0, 5).map((c) => {
    const days = Math.ceil((new Date(c.nextFollowUp) - now) / 86400000);
    return `<div class="stack-item clickable js-dash-client" data-id="${c.id}"><div class="item-main"><div class="item-title">${esc(c.company || c.name)}</div><div class="item-sub">${esc(c.country)} · ${esc(c.name)}</div></div><div class="item-end">${statusBadge(c.status)}<div class="hint">${days >= 0 ? `${days} 天后` : `逾期 ${-days} 天`}</div></div></div>`;
  }).join("") : `<div class="empty-state">暂无待跟进客户</div>`;

  const recent = [...state.quotes].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  $("#dashQuotes").innerHTML = recent.length ? recent.map((q) => `
    <div class="stack-item clickable js-dash-quote" data-id="${q.id}"><div class="item-main"><div class="item-title">${esc(q.product)}</div><div class="item-sub">${esc(q.clientName || "")} · ${esc(q.incoterm || "")} · ${esc(q.date || "")}</div></div><div class="item-end"><strong>${fmt(q.unitPrice)} ${esc(q.currency)}</strong><div>${statusBadge(q.status)}</div></div></div>
  `).join("") : `<div class="empty-state">暂无报价记录</div>`;
  const recentOrders = [...state.orders].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || "")).slice(0, 5);
  $("#dashOrders").innerHTML = recentOrders.length ? recentOrders.map((o) => `
    <div class="stack-item clickable js-dash-order" data-id="${o.id}"><div class="item-main"><div class="item-title">${esc(o.product)}</div><div class="item-sub">${esc(o.poNo)} · ${esc(o.clientName)} · ${esc(o.orderDate || "")}</div></div><div class="item-end"><strong>${fmt(o.amount)} ${esc(o.currency)}</strong><div>${statusBadge(o.status)}</div></div></div>
  `).join("") : `<div class="empty-state">暂无订单记录</div>`;
  $("#dashDeliveries").innerHTML = dueOrders.length ? dueOrders.slice(0, 6).map((o) => `
    <div class="stack-item clickable js-dash-order" data-id="${o.id}"><div class="item-main"><div class="item-title">${esc(o.product)}</div><div class="item-sub">${esc(o.poNo)} · ${esc(o.clientName)} · 交期 ${esc(o.deliveryDate)}</div></div><div class="item-end">${statusBadge(o.status)}<div class="hint ${o.days < 0 ? "danger-text" : ""}">${o.days < 0 ? `逾期 ${-o.days} 天` : `${o.days} 天后到期`}</div></div></div>
  `).join("") : `<div class="empty-state">暂无近 14 天交期的订单</div>`;
  // 报价超期未跟进提醒
  const staleQuotes = state.quotes.filter((q) => ["新报价", "跟进中"].includes(q.status) && q.date)
    .map((q) => ({ ...q, days: Math.floor((now.getTime() - new Date(q.date).getTime()) / 86400000) }))
    .filter((q) => q.days >= 3)
    .sort((a, b) => b.days - a.days);
  $("#dashStaleQuotes").innerHTML = staleQuotes.length ? staleQuotes.slice(0, 6).map((q) => `
    <div class="stack-item clickable js-dash-quote" data-id="${q.id}"><div class="item-main"><div class="item-title">${esc(q.product)}</div><div class="item-sub">${esc(q.clientName || "")} · ${esc(q.ref || "")} · ${esc(q.date || "")}</div></div><div class="item-end">${statusBadge(q.status)}<div class="hint danger-text">已 ${q.days} 天未跟进</div></div></div>
  `).join("") : `<div class="empty-state">暂无超期未跟进的报价</div>`;
  updateClocks();
}

const QUOTE_REQUIRED = {
  EXW: ["qCost", "qPack", "qRebate", "qMargin", "qCommission", "qBank", "qOther", "qQty", "qRate"],
  FOB: ["qCost", "qPack", "qRebate", "qMargin", "qCommission", "qBank", "qOther", "qQty", "qRate", "qDomestic"],
  CFR: ["qCost", "qPack", "qRebate", "qMargin", "qCommission", "qBank", "qOther", "qQty", "qRate", "qDomestic", "qFreight"],
  CIF: ["qCost", "qPack", "qRebate", "qMargin", "qCommission", "qBank", "qOther", "qQty", "qRate", "qDomestic", "qFreight", "qInsurance"]
};
const QUOTE_FIELD_LABELS = {
  qProduct: "产品名称", qCost: "出厂成本", qPack: "包装成本", qRebate: "出口退税率", qMargin: "目标利润率",
  qCommission: "佣金比例", qBank: "银行手续费", qOther: "其他杂费", qQty: "数量", qRate: "汇率",
  qDomestic: "港前杂费", qFreight: "海运费总计", qInsurance: "保险费率"
};

function validateQuoteRequired() {
  const t = $("#qIncoterm").value;
  const missing = (QUOTE_REQUIRED[t] || []).filter((id) => {
    const el = $("#" + id);
    return el && !el.value.trim();
  });
  if (missing.length) {
    toast(`请填写必填项：${missing.map((id) => QUOTE_FIELD_LABELS[id] || id).join("、")}`);
    const first = $("#" + missing[0]);
    if (first) first.focus();
    return false;
  }
  return true;
}

function updateQuoteRequiredMarks() {
  const t = $("#qIncoterm").value;
  const required = QUOTE_REQUIRED[t] || [];
  $$("#section-quote .form-grid label").forEach((label) => {
    const input = label.querySelector("input,select");
    if (!input || !input.id) return;
    const isReq = required.includes(input.id);
    const isEmpty = isReq && !input.value.trim();
    label.classList.toggle("field-required", isReq);
    label.classList.toggle("field-optional", !isReq);
    label.classList.toggle("field-missing", isEmpty);
    const box = input.closest(".input-box") || label;
    let mark = box.querySelector(".req-mark");
    if (isEmpty && !mark) {
      mark = document.createElement("span");
      mark.className = "req-mark";
      mark.textContent = "!";
      box.appendChild(mark);
    }
    if (!isEmpty && mark) mark.remove();
  });
}

function wrapQuoteInputs() {
  $$("#section-quote .form-grid input, #section-quote .form-grid select").forEach((el) => {
    if (el.closest(".input-box")) return;
    const box = document.createElement("div");
    box.className = "input-box";
    el.parentNode.insertBefore(box, el);
    box.appendChild(el);
  });
}

let quoteRestoreDone = false;

function renderQuote() {
  wrapQuoteInputs();
  const sel = $("#qProductSelect");
  const current = sel.value;
  sel.innerHTML = `<option value="">手动填写</option>` + state.products.map((p) => `<option value="${p.id}">${esc(p.model)} ${esc(p.name)}${p.nameEn ? " · " + esc(p.nameEn) : ""}</option>`).join("");
  if (current && state.products.some((p) => p.id === current)) sel.value = current;
  const fallback = state.settings.defaultCurrency && state.rates[state.settings.defaultCurrency] ? state.settings.defaultCurrency : "USD";
  const prevCur = $("#qCurrency").value;
  $("#qCurrency").innerHTML = TRADE_DATA.currencies.map((c) => `<option value="${c.code}">${c.code}</option>`).join("");
  const cur = prevCur && state.rates[prevCur] ? prevCur : fallback;
  $("#qCurrency").value = cur;
  $("#qRate").value = (state.rates.CNY / state.rates[cur]).toFixed(4);
  renderQuoteTermGuide();
  updateQuoteTermsHint();
  // 仅页面加载后的首次渲染恢复上次计算值；单页内切换不再覆盖用户未保存的手动输入
  if (!quoteRestoreDone) {
    restoreLastQuoteCalc();
    quoteRestoreDone = true;
  }
  updateQuoteTermsHint();
  updateQuoteSavedHint();
}

function restoreLastQuoteCalc() {
  if (window.__skipQuoteRestore) {
    window.__skipQuoteRestore = false;
    return;
  }
  const d = state.lastQuoteCalc;
  if (!d) return;
  const map = {
    qProduct: d.product, qIncoterm: d.incoterm, qCurrency: d.currency,
    qCost: d.cost, qPack: d.pack, qDomestic: d.domestic, qRebate: d.rebate,
    qMargin: d.margin, qCommission: d.commission, qBank: d.bank, qOther: d.other,
    qQty: d.qty, qRate: d.rate, qFreight: d.freight, qInsurance: d.insurance,
    qTargetPrice: d.target
  };
  Object.entries(map).forEach(([id, val]) => {
    const el = $("#" + id);
    if (el && val !== undefined && val !== null && val !== "") el.value = val;
  });
}

function updateQuoteSavedHint() {
  const d = state.lastQuoteCalc;
  $("#quoteSavedHint").innerHTML = d && d.savedAt
    ? `<span class="saved-dot"></span> 上次计算已保存到本机（${esc(d.savedAt)}），刷新页面后会自动恢复`
    : "";
}

function renderQuoteTermGuide() {
  const rows = [
    ["EXW", "出厂成本、包装成本、出口退税率、目标利润率、佣金比例、银行手续费、其他杂费、数量、汇率", "港前杂费、海运费、保险费率", "买方上门提货，卖方只承担出厂前成本"],
    ["FOB", "EXW 必填项 + 港前杂费", "海运费、保险费率", "卖方负责国内运输、报关并装到装运港船上"],
    ["CFR", "EXW 必填项 + 港前杂费 + 海运费总计", "保险费率", "卖方承担运费，风险在装运港转移"],
    ["CIF", "EXW 必填项 + 港前杂费 + 海运费总计 + 保险费率", "无", "卖方承担运费并购买运输保险"]
  ];
  $("#quoteTermGuide").innerHTML = `<table class="data-table"><thead><tr><th>成交方式</th><th>需要填写</th><th>不参与计算</th><th>说明</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td><strong>${r[0]}</strong></td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join("")
  }</tbody></table>`;
}

function updateQuoteTermsHint() {
  const t = $("#qIncoterm").value;
  const map = {
    EXW: "出厂成本、包装成本、退税率、利润率、佣金、银行手续费、其他杂费；港前杂费、海运费、保险不参与计算。",
    FOB: "出厂成本、包装成本、退税率、利润率、佣金、银行手续费、其他杂费、港前杂费；海运费、保险不参与计算。",
    CFR: "FOB 所需全部字段，另需填写海运费总计；保险不参与计算。",
    CIF: "FOB 所需全部字段，另需填写海运费总计和保险费率。"
  };
  updateQuoteRequiredMarks();
  $("#quoteTermsHint").innerHTML = `<span class="terms-hint-label">当前 ${esc(t)} 必填：</span>${map[t] || ""} <span class="terms-hint-note">未填写的必填项会在输入框内显示 <span class="req-mark">!</span>。</span>`;
}

function reverseQuote() {
  const target = Number($("#qTargetPrice").value);
  if (!target || !window.lastQuote) { toast("请先计算一次报价，再输入目标价"); return; }
  calcQuote();
  const q = window.lastQuote;
  const priceCny = target * q.rate;
  const margin = (priceCny * (1 - q.commission) / q.unitCost) - 1;
  if (!isFinite(margin)) { toast("目标价无效"); return; }
  $("#qMargin").value = (margin * 100).toFixed(2);
  calcQuote();
  toast(`目标价 ${target} ${q.currency} 对应利润率约 ${(margin * 100).toFixed(1)}%`);
}

function copyCalcQuoteSummary() {
  if (!window.lastQuote) { toast("请先计算报价"); return; }
  const q = window.lastQuote;
  copyText(`QUOTATION\nProduct: ${q.product}\nPrice: ${q.currency} ${q.priceQuote} / pc\nQty: ${q.qty}\nIncoterm: ${q.incoterm}\nPayment: ${state.settings.defaultPayment}\nDelivery: ${state.settings.defaultDelivery}\nValidity: ${state.settings.defaultValidity}\nPort: ${state.settings.defaultPort}`);
}

function calcQuote() {
  if (!validateQuoteRequired()) return;
  const product = $("#qProduct").value.trim() || "未命名产品";
  const incoterm = $("#qIncoterm").value;
  const currency = $("#qCurrency").value;
  const cost = Number($("#qCost").value) || 0;
  const pack = Number($("#qPack").value) || 0;
  const domestic = Number($("#qDomestic").value) || 0;
  const bank = Number($("#qBank").value) || 0;
  const other = Number($("#qOther").value) || 0;
  const rebate = (Number($("#qRebate").value) || 0) / 100;
  const margin = (Number($("#qMargin").value) || 0) / 100;
  const commission = (Number($("#qCommission").value) || 0) / 100;
  if (!(commission >= 0 && commission < 1)) { toast("佣金比例必须为 0% ~ 100% 之间"); $("#qCommission").focus(); return; }
  const qty = Number($("#qQty").value) || 0;
  const rate = Number($("#qRate").value) || 7.2;
  const freightUsd = Number($("#qFreight").value) || 0;
  const insuranceRate = (Number($("#qInsurance").value) || 0) / 100;

  const factoryUnit = (cost + pack) * (1 - rebate);
  const exwUnit = factoryUnit + bank + other;
  const freightUnit = (freightUsd * rate) / Math.max(qty, 1);
  const fobUnit = exwUnit + domestic;
  const cfrUnit = fobUnit + freightUnit;
  const insuranceUnit = (fobUnit + freightUnit) * insuranceRate;
  const cifUnit = cfrUnit + insuranceUnit;
  const termNames = ["EXW", "FOB", "CFR", "CIF"];
  const costByTerm = { EXW: exwUnit, FOB: fobUnit, CFR: cfrUnit, CIF: cifUnit };
  const terms = {};
  termNames.forEach((t) => {
    const unitCost = costByTerm[t];
    const priceCny = unitCost * (1 + margin) / (1 - commission);
    // 佣金已计入售价，利润/利润率按扣佣金后的净额计算，与"目标价反推"口径一致
    const netUnit = priceCny * (1 - commission) - unitCost;
    const total = priceCny * qty;
    const totalCost = unitCost * qty;
    terms[t] = {
      unitCost, priceCny, priceQuote: priceCny / rate, total, totalCost,
      profit: netUnit * qty,
      marginActual: unitCost > 0 ? netUnit / unitCost : 0
    };
  });
  const sel = terms[incoterm] || terms.FOB;
  if (!sel || !isFinite(sel.priceCny) || sel.priceCny <= 0) { toast("报价计算异常，请检查成本与佣金比例等输入"); return; }

  window.lastQuote = { product, incoterm, priceCny: sel.priceCny, priceQuote: sel.priceQuote, qty, currency, unitCost: sel.unitCost, freightUnit, insuranceUnit, baseUnit: fobUnit, profit: sel.profit, total: sel.total, rate, margin, commission, terms };
  $("#quoteResult").innerHTML = `
    <div class="result-cell highlight"><div class="result-label">${esc(incoterm)} ${esc(currency)} 单价</div><div class="result-value">${esc(currency)} ${fmt(sel.priceQuote)}</div></div>
    <div class="result-cell highlight"><div class="result-label">人民币单价</div><div class="result-value">¥${fmt(sel.priceCny)}</div></div>
    <div class="result-cell"><div class="result-label">单件成本</div><div class="result-value">¥${fmt(sel.unitCost)}</div></div>
    <div class="result-cell"><div class="result-label">单件利润</div><div class="result-value">¥${fmt(sel.profit / Math.max(qty, 1))}</div></div>
    <div class="result-cell"><div class="result-label">订单总额</div><div class="result-value">${esc(currency)} ${fmt(sel.total / rate)}</div></div>
    <div class="result-cell"><div class="result-label">实际利润率</div><div class="result-value">${fmt(sel.marginActual * 100, 1)}%</div></div>`;
  $("#quoteBreakdown").innerHTML = `
    <p>出厂成本（产品+包装，退税后）¥${fmt(factoryUnit)}；港前杂费 ¥${fmt(domestic)}；银行 ¥${fmt(bank)}；其他 ¥${fmt(other)}。</p>
    <p>海运费分摊 ¥${fmt(freightUnit)}；保险费分摊 ¥${fmt(insuranceUnit)}；各成交方式成本：EXW ¥${fmt(exwUnit)} / FOB ¥${fmt(fobUnit)} / CFR ¥${fmt(cfrUnit)} / CIF ¥${fmt(cifUnit)}。</p>
    <p>目标利润率 ${fmt(margin * 100, 1)}%，佣金 ${fmt(commission * 100, 1)}%，${esc(incoterm)} 实际利润率 ${fmt(sel.marginActual * 100, 1)}%。</p>
    <p>建议对外报价：<strong>${esc(currency)} ${fmt(sel.priceQuote)} / pc ${esc(incoterm)} ${esc(product)}</strong></p>`;
  const costItems = [
    ["产品+包装（退税后）", factoryUnit],
    ["银行+其他杂费", bank + other],
    ["港前杂费", ["FOB", "CFR", "CIF"].includes(incoterm) ? domestic : 0],
    ["海运费分摊", ["CFR", "CIF"].includes(incoterm) ? freightUnit : 0],
    ["保险费分摊", incoterm === "CIF" ? insuranceUnit : 0],
    ["单件总成本", sel.unitCost]
  ];
  $("#quoteCostTable").innerHTML = `<table class="data-table"><thead><tr><th>成本项目</th><th>单件（RMB）</th><th>占比</th></tr></thead><tbody>
    ${costItems.map(([name, val]) => `<tr><td>${esc(name)}</td><td>¥${fmt(val)}</td><td>${fmt(sel.unitCost ? (val / sel.unitCost) * 100 : 0, 1)}%</td></tr>`).join("")}
  </tbody></table>`;
  $("#quoteCompareTable").innerHTML = `<table class="data-table"><thead><tr><th>指标</th>${termNames.map((t) => `<th class="${t === incoterm ? "quote-current-term" : ""}">${t}${t === incoterm ? "（当前）" : ""}</th>`).join("")}</tr></thead><tbody>
    ${[
      ["单件成本 ¥", (t) => fmt(terms[t].unitCost)],
      [`报价单价 ${esc(currency)}`, (t) => fmt(terms[t].priceQuote)],
      ["单件利润 ¥", (t) => fmt(terms[t].profit / Math.max(qty, 1))],
      ["实际利润率", (t) => `${fmt(terms[t].marginActual * 100, 1)}%`],
      [`订单总额 ${esc(currency)}`, (t) => fmt(terms[t].total / rate)]
    ].map(([label, fn]) => `<tr><td>${label}</td>${termNames.map((t) => `<td class="${t === incoterm ? "quote-current-term" : ""}">${fn(t)}</td>`).join("")}</tr>`).join("")}
  </tbody></table>`;
  state.lastQuoteCalc = {
    product, incoterm, currency, cost, pack, domestic, rebate: rebate * 100, margin: margin * 100,
    commission: commission * 100, bank, other, qty, rate, freight: freightUsd, insurance: insuranceRate * 100,
    target: $("#qTargetPrice").value, savedAt: todayISO(), priceQuote: sel.priceQuote, priceCny: sel.priceCny,
    unitCost: sel.unitCost, profit: sel.profit
  };
  saveState();
  updateQuoteSavedHint();
}

function saveQuoteFromCalc() {
  if (!window.lastQuote) { toast("请先计算报价"); return; }
  const q = window.lastQuote;
  // 保存成本/汇率/利润快照，供报价记录显示利润与历史对比
  window.__quoteSnapshot = { rate: q.rate, unitCost: q.unitCost, marginPct: q.margin * 100, commissionPct: q.commission * 100, priceCny: q.priceCny, profit: q.profit, freightUnit: q.freightUnit, insuranceUnit: q.insuranceUnit };
  openQuoteModal(null, {
    product: q.product, qty: q.qty, unitPrice: q.priceQuote, incoterm: q.incoterm, currency: q.currency,
    payment: state.settings.defaultPayment, delivery: state.settings.defaultDelivery,
    validity: state.settings.defaultValidity, port: state.settings.defaultPort, date: todayISO(),
    items: [{ name: q.product, hs: "", qty: String(q.qty || ""), unitPrice: q.priceQuote ? Number(q.priceQuote).toFixed(2) : "" }]
  });
}

function renderLogisticsItems() {
  const items = state.logisticsItems || [];
  $("#logisticsItemsTable tbody").innerHTML = items.length ? items.map((it, idx) => `
    <tr class="logistics-item-row" data-idx="${idx}">
      <td><input class="lg-name" value="${esc(it.name || `货物${idx + 1}`)}"></td>
      <td><input type="number" class="lg-len" value="${esc(it.len ?? 0)}" step="0.1"></td>
      <td><input type="number" class="lg-width" value="${esc(it.width ?? 0)}" step="0.1"></td>
      <td><input type="number" class="lg-height" value="${esc(it.height ?? 0)}" step="0.1"></td>
      <td><input type="number" class="lg-weight" value="${esc(it.weight ?? 0)}" step="0.1"></td>
      <td><input type="number" class="lg-qty" value="${esc(it.qty ?? 0)}" step="1"></td>
      <td class="lg-subtotal">${fmt((it.len * it.width * it.height) / 1000000 * (it.qty || 0), 3)}</td>
      <td><div class="actions"><button class="icon-btn js-del-logistics-item" data-idx="${idx}" title="删除"><i data-lucide="trash-2"></i></button></div></td>
    </tr>`).join("") : `<tr><td colspan="8" class="empty-state">暂无货物，点击“新增货物”添加</td></tr>`;
  refreshIcons();
}

function collectLogisticsItems() {
  const rows = $$("#logisticsItemsTable tbody tr");
  state.logisticsItems = rows.map((tr, idx) => {
    const old = state.logisticsItems[idx] || {};
    return {
      id: old.id || uid(),
      name: tr.querySelector(".lg-name")?.value.trim() || `货物${idx + 1}`,
      len: Number(tr.querySelector(".lg-len")?.value) || 0,
      width: Number(tr.querySelector(".lg-width")?.value) || 0,
      height: Number(tr.querySelector(".lg-height")?.value) || 0,
      weight: Number(tr.querySelector(".lg-weight")?.value) || 0,
      qty: Number(tr.querySelector(".lg-qty")?.value) || 0
    };
  });
  saveState();
  return state.logisticsItems;
}

function addLogisticsItem() {
  state.logisticsItems.push({ id: uid(), name: `货物${state.logisticsItems.length + 1}`, len: 60, width: 40, height: 35, weight: 18, qty: 100 });
  saveState();
  renderLogisticsItems();
}

function renderLogistics() {
  renderLogisticsItems();
  const containerRows = state.containers.map((c) => `
    <tr><td><strong>${esc(c.code)}</strong></td><td>${esc(c.inner)}</td><td>${fmt(c.volume)} m³</td><td>${fmt(c.usable)} m³</td><td>${esc(c.payload ?? 0)} t</td><td>${esc(c.note)}</td></tr>`).join("");
  $("#containerTable").innerHTML = `<table class="data-table"><thead><tr><th>柜型</th><th>内尺寸</th><th>理论容积</th><th>可用容积</th><th>最大载重</th><th>说明</th></tr></thead><tbody>${containerRows}</tbody></table>`;
  const routeSel = $("#frRoute");
  const currentRoute = routeSel.value;
  routeSel.innerHTML = state.logisticsRates.map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join("");
  if (currentRoute && state.logisticsRates.some((r) => r.id === currentRoute)) {
    routeSel.value = currentRoute;
  } else {
    routeSel.value = state.logisticsRates[0]?.id || "";
  }
  $("#logisticsRateTable").innerHTML = `<table class="data-table"><thead><tr><th>航线</th><th>拼箱 USD/CBM</th><th>20GP USD</th><th>40HQ USD</th><th>空运 USD/kg</th><th>快递 USD/kg</th></tr></thead><tbody>${state.logisticsRates.map((r) => `<tr><td>${esc(r.name)}</td><td>${fmt(r.lcl)}</td><td>${fmt(r.fcl20)}</td><td>${fmt(r.fcl40)}</td><td>${fmt(r.air)}</td><td>${fmt(r.express)}</td></tr>`).join("")}</tbody></table>`;
  // 仅在未填过手动费率时按航线预填，避免覆盖用户编辑过的拼箱单价
  if (!$("#frRate").value) applyFreightRoute();
}

function applyFreightRoute() {
  const route = state.logisticsRates.find((r) => r.id === $("#frRoute").value);
  if (route) $("#frRate").value = route.lcl;
}

function bestStack(container, item) {
  const dims = (container.inner.match(/[\d.]+/g) || []).map(Number);
  if (dims.length < 3 || !item.len || !item.width || !item.height || !item.weight) return null;
  const [cl, cw, ch] = dims;
  const L = cl * 100, W = cw * 100, H = ch * 100;
  const oris = [
    [item.len, item.width, item.height],
    [item.width, item.len, item.height],
    [item.len, item.height, item.width],
    [item.height, item.len, item.width],
    [item.width, item.height, item.len],
    [item.height, item.width, item.len]
  ];
  let best = null;
  for (const [a, b, c] of oris) {
    if (a > L || b > W || c > H) continue;
    const perLayer = Math.floor(L / a) * Math.floor(W / b);
    const layers = Math.floor(H / c);
    const byWeight = Math.floor((container.payload * 1000) / Math.max(item.weight, 0.01));
    const total = Math.min(perLayer * layers, byWeight);
    if (!best || total > best.total) best = { a, b, c, perLayer, layers, total, byWeight };
  }
  if (!best) return null;
  return { ...best, text: `每层 ${Math.floor(L / best.a)}×${Math.floor(W / best.b)} 箱，共 ${best.layers} 层` };
}

function summarizeLogistics(items) {
  const rows = items.map((it) => {
    const cbm = (it.len * it.width * it.height) / 1000000;
    return { ...it, cbm, totalCbm: cbm * it.qty, totalWeight: it.weight * it.qty, airVol: (it.len * it.width * it.height) / 6000 * it.qty, expressVol: (it.len * it.width * it.height) / 5000 * it.qty };
  });
  const totalCartons = rows.reduce((s, r) => s + r.qty, 0);
  const totalCbm = rows.reduce((s, r) => s + r.totalCbm, 0);
  const totalWeight = rows.reduce((s, r) => s + r.totalWeight, 0);
  const airVol = rows.reduce((s, r) => s + r.airVol, 0);
  const expressVol = rows.reduce((s, r) => s + r.expressVol, 0);
  return { items: rows, totalCbm, totalWeight, totalCartons, airVol, expressVol, airCharge: Math.max(totalWeight, airVol), expressCharge: Math.max(totalWeight, expressVol) };
}

function calcLogistics() {
  const lg = summarizeLogistics(collectLogisticsItems());
  const items = lg.items, rows = lg.items;
  const totalCartons = lg.totalCartons, totalCbm = lg.totalCbm, totalWeight = lg.totalWeight;
  const airVol = lg.airVol, expressVol = lg.expressVol, airCharge = lg.airCharge, expressCharge = lg.expressCharge;
  window.lastLogistics = lg;
  state.lastLogistics = window.lastLogistics;
  saveState();

  $("#logisticsResult").innerHTML = `
    <div class="result-cell highlight"><div class="result-label">货物种类</div><div class="result-value">${fmtInt(items.length)}</div></div>
    <div class="result-cell highlight"><div class="result-label">总箱数</div><div class="result-value">${fmtInt(totalCartons)}</div></div>
    <div class="result-cell"><div class="result-label">总方数</div><div class="result-value">${fmt(totalCbm, 2)} m³</div></div>
    <div class="result-cell"><div class="result-label">总毛重</div><div class="result-value">${fmt(totalWeight, 1)} kg</div></div>
    <div class="result-cell"><div class="result-label">空运计费重</div><div class="result-value">${fmt(airCharge, 0)} kg</div></div>
    <div class="result-cell"><div class="result-label">快递计费重</div><div class="result-value">${fmt(expressCharge, 0)} kg</div></div>`;
  const density = totalCbm > 0 ? totalWeight / totalCbm : 0;
  $("#logisticsSummary").innerHTML = `<p>平均单箱体积 ${fmt(totalCbm / Math.max(totalCartons, 1), 4)} m³；货物密度 ${fmt(density, 0)} kg/m³，${density < 300 ? "偏轻抛货" : density > 500 ? "偏重货" : "体积重量较均衡"}。</p>`;

  const containerCards = state.containers.map((c) => {
    const byVol = totalCbm > 0 ? Math.ceil(totalCbm / c.usable) : 0;
    const byWeight = totalWeight > 0 ? Math.ceil(totalWeight / (c.payload * 1000)) : 0;
    const needed = Math.max(byVol, byWeight);
    const volPct = Math.min(100, (totalCbm / c.usable) * 100);
    const wtPct = Math.min(100, (totalWeight / (c.payload * 1000)) * 100);
    return `<div class="result-cell"><div class="result-label">${esc(c.code)}</div><div class="result-value">${needed} 柜</div><div class="hint">体积 ${fmt(volPct, 1)}% · 重量 ${fmt(wtPct, 1)}%</div></div>`;
  }).join("");
  $("#containerCalcResult").innerHTML = containerCards;

  const fits = state.containers.filter((c) => totalCbm <= c.usable && totalWeight <= c.payload * 1000);
  const suggested = fits.length ? fits[0] : state.containers[2];
  const suggestedCount = Math.max(Math.ceil(totalCbm / suggested.usable), Math.ceil(totalWeight / (suggested.payload * 1000)), 1);
  $("#containerPlan").innerHTML = `<table class="data-table"><thead><tr><th>柜型</th><th>体积利用率</th><th>重量利用率</th><th>需要柜数</th><th>堆叠方案</th><th>建议</th></tr></thead><tbody>${
    state.containers.map((c) => {
      const byVol = totalCbm > 0 ? Math.ceil(totalCbm / c.usable) : 0;
      const byWeight = totalWeight > 0 ? Math.ceil(totalWeight / (c.payload * 1000)) : 0;
      const needed = Math.max(byVol, byWeight);
      const volPct = Math.min(100, (totalCbm / c.usable) * 100);
      const wtPct = Math.min(100, (totalWeight / (c.payload * 1000)) * 100);
      const stack = rows.length === 1 ? bestStack(c, rows[0]) : null;
      const stackText = stack ? `${stack.text}，可装 ${fmtInt(stack.total)} 箱` : rows.length > 1 ? "多货物按体积汇总" : "无法装入";
      return `<tr><td><strong>${esc(c.code)}</strong></td><td><div class="util-bar"><span style="width:${volPct}%"></span></div>${fmt(volPct, 1)}%</td><td><div class="util-bar weight"><span style="width:${wtPct}%"></span></div>${fmt(wtPct, 1)}%</td><td>${needed}</td><td>${esc(stackText)}</td><td>${totalCbm < 15 ? "建议拼箱 / 空运" : c.code === suggested.code ? `建议 ${esc(suggested.code)} × ${suggestedCount}` : "备选"}</td></tr>`;
    }).join("")
  }</tbody></table>`;
}

function copyLogisticsPlan() {
  const lg = window.lastLogistics || state.lastLogistics;
  if (!lg) { toast("请先计算装柜方案"); return; }
  const lines = [
    "LOGISTICS PLAN",
    `Cartons: ${fmtInt(lg.totalCartons)}`,
    `Volume: ${fmt(lg.totalCbm, 2)} CBM`,
    `Gross Weight: ${fmt(lg.totalWeight, 1)} kg`,
    `Air Chargeable: ${fmt(lg.airCharge, 0)} kg`,
    `Express Chargeable: ${fmt(lg.expressCharge, 0)} kg`,
    `Suggested: ${lg.totalCbm < 15 ? "LCL / Air" : "FCL"}`
  ];
  lg.items.forEach((it, i) => lines.push(`${i + 1}. ${it.name}: ${fmtInt(it.qty)} cartons, ${fmt(it.totalCbm, 3)} CBM, ${fmt(it.totalWeight, 1)} kg`));
  copyText(lines.join("\n"));
}

function calcFreight() {
  // 优先按当前货物清单实时汇总，避免使用上次计算的过期结果
  const items = collectLogisticsItems();
  const lg = items.some((it) => it.qty > 0) ? summarizeLogistics(items) : (window.lastLogistics || state.lastLogistics);
  if (!lg || (lg.totalCbm <= 0 && lg.totalWeight <= 0)) { toast("请先填写货物并计算装柜方案"); return; }
  const route = state.logisticsRates.find((r) => r.id === $("#frRoute").value) || state.logisticsRates[0];
  const cur = $("#frCurrency").value;
  const conv = (usd) => cur === "USD" ? usd : usd * (state.rates[cur] || 1);
  const surcharge = Number($("#frSurcharge").value) || 0;
  // "海运拼箱单价"输入框可编辑，以此为准
  const lclRate = Number($("#frRate").value) || route.lcl;
  const container = state.containers.find((c) => lg.totalCbm <= c.usable && lg.totalWeight <= c.payload * 1000) || state.containers[2];
  const fclRate = container.code === "20GP" ? route.fcl20 : route.fcl40;
  const fclCount = Math.max(
    lg.totalCbm > 0 ? Math.ceil(lg.totalCbm / container.usable) : 0,
    lg.totalWeight > 0 ? Math.ceil(lg.totalWeight / (container.payload * 1000)) : 0,
    1
  );
  const fclSuffix = fclCount > 1 ? ` ×${fclCount}` : "";
  // 附加费折回 USD，供"从物流带入报价器"统一换算
  const usdConv = (usdAmt) => usdAmt + surcharge / (state.rates[cur] || 1);
  const options = [
    { name: "海运拼箱", unit: `${fmt(lg.totalCbm, 2)} m³`, rate: lclRate, cost: conv(lg.totalCbm * lclRate) + surcharge, usdCost: usdConv(lg.totalCbm * lclRate), note: "小批量 / 低于整柜时更划算" },
    { name: `海运整柜 ${container.code}${fclSuffix}`, unit: container.code + fclSuffix, rate: fclRate, cost: conv(fclRate * fclCount) + surcharge, usdCost: usdConv(fclRate * fclCount), note: "大批量 / 整柜更划算" },
    { name: "空运", unit: `${fmt(lg.airCharge, 0)} kg`, rate: route.air, cost: conv(lg.airCharge * route.air) + surcharge, usdCost: usdConv(lg.airCharge * route.air), note: "交期紧 / 高货值" },
    { name: "国际快递", unit: `${fmt(lg.expressCharge, 0)} kg`, rate: route.express, cost: conv(lg.expressCharge * route.express) + surcharge, usdCost: usdConv(lg.expressCharge * route.express), note: "样品 / 小件 / 紧急补货" }
  ];
  const best = options.reduce((a, b) => (b.cost < a.cost ? b : a));
  // 供报价器"从物流估算带入"
  lg.freight = { usd: best.usdCost, name: best.name };
  state.lastLogistics = lg;
  saveState();
  $("#freightResult").innerHTML = options.map((o) => `<div class="result-cell ${o === best ? "highlight" : ""}"><div class="result-label">${esc(o.name)}</div><div class="result-value">${esc(cur)} ${fmt(o.cost)}</div><div class="hint">${esc(o.unit)} · 参考价 ${fmt(o.rate)}</div></div>`).join("");
  $("#freightCompare").innerHTML = `<table class="data-table"><thead><tr><th>方式</th><th>计费单位</th><th>参考单价</th><th>附加费</th><th>合计</th><th>说明</th></tr></thead><tbody>${
    options.map((o) => `<tr class="${o === best ? "quote-current-term" : ""}"><td><strong>${esc(o.name)}</strong>${o === best ? "（最低）" : ""}</td><td>${esc(o.unit)}</td><td>${fmt(o.rate)}</td><td>${fmt(surcharge)}</td><td><strong>${esc(cur)} ${fmt(o.cost)}</strong></td><td>${esc(o.note)}</td></tr>`).join("")
  }</tbody></table><div class="hint">当前最低运费：${esc(best.name)}，约 ${esc(cur)} ${fmt(best.cost)}。实际费用请以货代 / 快递报价为准。</div>`;
}

function applyFreightToQuote() {
  const lg = window.lastLogistics || state.lastLogistics;
  if (!lg || !lg.freight || !(lg.freight.usd > 0)) { toast("请先在物流与装柜页计算一次运费对比"); return; }
  const cur = $("#qCurrency").value;
  const amount = lg.freight.usd * (state.rates[cur] || 1);
  $("#qFreight").value = Math.round(amount * 100) / 100;
  toast(`已从物流估算带入海运费（${lg.freight.name}）`);
}

function openLogisticsSettings() {
  openModal(`
    <div class="modal modal-lg-settings">
      <div class="modal-head"><h3>运价与柜型设置</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
      <h4 class="lg-set-title">航线运价（USD）</h4>
      <div class="table-wrap"><table class="data-table" id="lgRateEditTable">
        <thead><tr><th>航线</th><th>拼箱/CBM</th><th>20GP</th><th>40HQ</th><th>空运/kg</th><th>快递/kg</th><th></th></tr></thead>
        <tbody>${(state.logisticsRates || []).map((r, i) => `
          <tr class="lg-rate-row" data-i="${i}">
            <td><input class="lr-name" value="${esc(r.name)}"></td>
            <td><input type="number" class="lr-lcl" value="${r.lcl}" step="0.01"></td>
            <td><input type="number" class="lr-fcl20" value="${r.fcl20}" step="1"></td>
            <td><input type="number" class="lr-fcl40" value="${r.fcl40}" step="1"></td>
            <td><input type="number" class="lr-air" value="${r.air}" step="0.01"></td>
            <td><input type="number" class="lr-express" value="${r.express}" step="0.01"></td>
            <td><button type="button" class="icon-btn js-del-lg-rate" title="删除"><i data-lucide="trash-2"></i></button></td>
          </tr>`).join("")}
        </tbody>
      </table></div>
      <div class="btn-row"><button class="btn ghost" id="addLgRateBtn"><i data-lucide="plus"></i><span>新增航线</span></button></div>
      <h4 class="lg-set-title">柜型参数</h4>
      <div class="table-wrap"><table class="data-table" id="lgContainerEditTable">
        <thead><tr><th>柜型</th><th>内尺寸 m</th><th>容积</th><th>可用</th><th>载重 t</th><th>说明</th><th></th></tr></thead>
        <tbody>${(state.containers || []).map((c, i) => `
          <tr class="lg-container-row" data-i="${i}">
            <td><input class="lc-code" value="${esc(c.code)}" style="width:60px"></td>
            <td><input class="lc-inner" value="${esc(c.inner)}"></td>
            <td><input type="number" class="lc-volume" value="${c.volume}" step="0.1" style="width:70px"></td>
            <td><input type="number" class="lc-usable" value="${c.usable}" step="0.1" style="width:70px"></td>
            <td><input type="number" class="lc-payload" value="${c.payload}" step="0.1" style="width:60px"></td>
            <td><input class="lc-note" value="${esc(c.note || "")}"></td>
            <td><button type="button" class="icon-btn js-del-lg-container" title="删除"><i data-lucide="trash-2"></i></button></td>
          </tr>`).join("")}
        </tbody>
      </table></div>
      <div class="btn-row"><button class="btn ghost" id="addLgContainerBtn"><i data-lucide="plus"></i><span>新增柜型</span></button></div>
      <div class="modal-actions"><button class="btn" id="modalCancelBtn">取消</button><button class="btn primary" id="saveLgSettingsBtn">保存</button></div>
    </div>`);
  $("#addLgRateBtn").addEventListener("click", () => {
    document.querySelector("#lgRateEditTable tbody").insertAdjacentHTML("beforeend", `<tr class="lg-rate-row"><td><input class="lr-name" placeholder="航线名称"></td><td><input type="number" class="lr-lcl" step="0.01" value="0"></td><td><input type="number" class="lr-fcl20" step="1" value="0"></td><td><input type="number" class="lr-fcl40" step="1" value="0"></td><td><input type="number" class="lr-air" step="0.01" value="0"></td><td><input type="number" class="lr-express" step="0.01" value="0"></td><td><button type="button" class="icon-btn js-del-lg-rate" title="删除"><i data-lucide="trash-2"></i></button></td></tr>`);
    refreshIcons();
  });
  $("#addLgContainerBtn").addEventListener("click", () => {
    document.querySelector("#lgContainerEditTable tbody").insertAdjacentHTML("beforeend", `<tr class="lg-container-row"><td><input class="lc-code" style="width:60px" placeholder="40HQ"></td><td><input class="lc-inner" placeholder="12.03 x 2.35 x 2.69 m"></td><td><input type="number" class="lc-volume" step="0.1" value="0" style="width:70px"></td><td><input type="number" class="lc-usable" step="0.1" value="0" style="width:70px"></td><td><input type="number" class="lc-payload" step="0.1" value="0" style="width:60px"></td><td><input class="lc-note"></td><td><button type="button" class="icon-btn js-del-lg-container" title="删除"><i data-lucide="trash-2"></i></button></td></tr>`);
    refreshIcons();
  });
  $("#lgRateEditTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-del-lg-rate");
    if (btn) btn.closest("tr").remove();
  });
  $("#lgContainerEditTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-del-lg-container");
    if (btn) btn.closest("tr").remove();
  });
  $("#saveLgSettingsBtn").addEventListener("click", () => {
    const rates = Array.from(document.querySelectorAll("#lgRateEditTable .lg-rate-row")).map((tr, i) => ({
      id: (state.logisticsRates[i] || {}).id || "route-" + uid(),
      name: tr.querySelector(".lr-name")?.value.trim() || `航线${i + 1}`,
      lcl: Number(tr.querySelector(".lr-lcl")?.value) || 0,
      fcl20: Number(tr.querySelector(".lr-fcl20")?.value) || 0,
      fcl40: Number(tr.querySelector(".lr-fcl40")?.value) || 0,
      air: Number(tr.querySelector(".lr-air")?.value) || 0,
      express: Number(tr.querySelector(".lr-express")?.value) || 0
    })).filter((r) => r.name);
    const containers = Array.from(document.querySelectorAll("#lgContainerEditTable .lg-container-row")).map((tr) => ({
      code: tr.querySelector(".lc-code")?.value.trim() || "CUSTOM",
      inner: tr.querySelector(".lc-inner")?.value.trim() || "0 x 0 x 0 m",
      volume: Number(tr.querySelector(".lc-volume")?.value) || 0,
      usable: Number(tr.querySelector(".lc-usable")?.value) || 0,
      payload: Number(tr.querySelector(".lc-payload")?.value) || 0,
      note: tr.querySelector(".lc-note")?.value.trim() || ""
    })).filter((c) => c.usable > 0);
    if (!rates.length) { toast("至少保留一条航线"); return; }
    if (!containers.length) { toast("至少保留一个柜型"); return; }
    state.logisticsRates = rates;
    state.containers = containers;
    saveState();
    closeModal();
    renderLogistics();
    toast("运价与柜型已保存");
  });
}

function renderCurrency() {
  const prevFrom = $("#curFrom").value;
  const prevTo = $("#curTo").value;
  const options = TRADE_DATA.currencies.map((c) => `<option value="${c.code}">${c.code} ${esc(c.name)}</option>`).join("");
  $("#curFrom").innerHTML = options;
  $("#curTo").innerHTML = options;
  // 保留用户正在进行的换算币种，仅在首次进入时使用默认值
  $("#curFrom").value = prevFrom && TRADE_DATA.currencies.some((c) => c.code === prevFrom) ? prevFrom : "USD";
  $("#curTo").value = prevTo && TRADE_DATA.currencies.some((c) => c.code === prevTo) ? prevTo : "CNY";
  $("#rateTable").innerHTML = `<table class="data-table"><thead><tr><th>币种</th><th>代码</th><th>汇率（1 USD = ?）</th><th>反向（1 币种 = ? USD）</th></tr></thead><tbody>${
    TRADE_DATA.currencies.map((c) => {
      const rate = state.rates[c.code] ?? c.rate;
      const inverse = rate ? 1 / rate : 0;
      return `<tr><td>${esc(c.name)}</td><td><strong>${c.code}</strong></td><td><input type="number" step="0.0001" data-rate="${c.code}" value="${esc(rate ?? "")}"></td><td>${fmt(inverse, 6)}</td></tr>`;
    }).join("")
  }</tbody></table>`;
  const updEl = $("#rateUpdatedHint");
  if (updEl) {
    const mins = state.ratesUpdatedAt ? Math.max(1, Math.round((Date.now() - state.ratesUpdatedAt) / 60000)) : null;
    updEl.textContent = mins !== null ? `1 USD = ? · 更新于 ${mins} 分钟前` : "1 USD = ?";
  }
  convertCurrency();
}

function convertCurrency() {
  const amount = Number($("#curAmount").value) || 0;
  const from = $("#curFrom").value;
  const to = $("#curTo").value;
  const result = amount / (state.rates[from] || 1) * (state.rates[to] || 1);
  $("#curResult").textContent = `${fmt(amount, 2)} ${from} = ${fmt(result, 4)} ${to}`;
}

async function refreshRates(silent) {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const data = await res.json();
    if (data && data.rates) {
      Object.keys(state.rates).forEach((code) => { if (data.rates[code]) state.rates[code] = data.rates[code]; });
      state.ratesUpdatedAt = Date.now();
      saveState();
      renderCurrency();
      if (!silent) toast("汇率已在线更新");
    } else throw new Error("bad response");
  } catch (err) {
    if (!silent) toast("在线更新失败，当前使用本地汇率");
  }
}

function refreshQuoteRate() {
  const cur = $("#qCurrency").value;
  if (state.rates[cur]) $("#qRate").value = (state.rates.CNY / state.rates[cur]).toFixed(4);
}

async function fetchLatestRateForQuote() {
  await refreshRates();
  refreshQuoteRate();
}

function renderUnit() {
  $("#unitCat").innerHTML = Object.entries(TRADE_DATA.unitCategories).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("");
  fillUnitSelects();
  convertUnit();
}

function fillUnitSelects() {
  const cat = $("#unitCat").value;
  const units = TRADE_DATA.unitCategories[cat]?.units || {};
  const options = Object.keys(units).map((k) => `<option value="${k}">${esc(k)}</option>`).join("");
  $("#unitFrom").innerHTML = options;
  $("#unitTo").innerHTML = options;
}

function convertUnit() {
  const cat = $("#unitCat").value;
  const value = Number($("#unitValue").value) || 0;
  const from = $("#unitFrom").value;
  const to = $("#unitTo").value;
  let result = 0;
  if (cat === "temperature") {
    if (from === "C") result = to === "F" ? value * 9 / 5 + 32 : to === "K" ? value + 273.15 : value;
    if (from === "F") result = to === "C" ? (value - 32) * 5 / 9 : to === "K" ? (value - 32) * 5 / 9 + 273.15 : value;
    if (from === "K") result = to === "C" ? value - 273.15 : to === "F" ? (value - 273.15) * 9 / 5 + 32 : value;
  } else {
    const units = TRADE_DATA.unitCategories[cat]?.units || {};
    result = value * (units[from] || 1) / (units[to] || 1);
  }
  $("#unitResult").textContent = `${fmt(value, 4)} ${from} = ${fmt(result, 6)} ${to}`;
}

function renderTimezone() {
  const prevMine = $("#tzMine").value;
  const prevClient = $("#tzClient").value;
  const options = TRADE_DATA.timezones.map((t) => `<option value="${t.tz}">${esc(t.city)}</option>`).join("");
  $("#tzMine").innerHTML = options;
  $("#tzClient").innerHTML = options;
  // 保留用户选择的城市，仅在首次进入时使用默认值
  $("#tzMine").value = prevMine && TRADE_DATA.timezones.some((t) => t.tz === prevMine) ? prevMine : (state.settings.baseCity || "Asia/Shanghai");
  $("#tzClient").value = prevClient && TRADE_DATA.timezones.some((t) => t.tz === prevClient) ? prevClient : "America/New_York";
  $("#tzCities").innerHTML = TRADE_DATA.timezones.map((t) => `<button class="city-chip" data-tz="${t.tz}" data-city="${esc(t.city)}"><strong>${esc(t.city)}</strong><span>${timeInTz(t.tz)}</span></button>`).join("");
  calcTz();
}

function calcTz() {
  const mine = $("#tzMine").value;
  const client = $("#tzClient").value;
  const now = new Date();
  const mineOffset = tzOffsetMin(mine, now);
  const start = $("#tzMyStart").value.split(":").map(Number);
  const end = $("#tzMyEnd").value.split(":").map(Number);
  const myParts = tzParts(mine, now);
  const baseUtcStart = Date.UTC(myParts.year, myParts.month - 1, myParts.day, start[0] || 9, start[1] || 0) - mineOffset * 60000;
  const baseUtcEnd = Date.UTC(myParts.year, myParts.month - 1, myParts.day, end[0] || 18, end[1] || 0) - mineOffset * 60000;
  // 工作时间以真实 UTC 时刻表达；跨午夜（如 22:00-06:00）时窗口为环绕式
  const overnight = baseUtcStart > baseUtcEnd;
  const nowMs = now.getTime();
  const overlap = overnight ? (nowMs >= baseUtcStart || nowMs <= baseUtcEnd) : (nowMs >= baseUtcStart && nowMs <= baseUtcEnd);
  const weekday = tzParts(client, now).weekday;
  const businessDay = !["Sat", "Sun"].includes(weekday);
  $("#tzResult").innerHTML = `
    <div class="tz-line"><span class="tz-city">${esc($("#tzMine").selectedOptions[0]?.textContent || "")}</span><span class="tz-time">${timeInTz(mine, now)}</span></div>
    <div class="tz-line"><span class="tz-city">${esc($("#tzClient").selectedOptions[0]?.textContent || "")}</span><span class="tz-time">${timeInTz(client, now)}</span></div>
    <div class="tz-line"><span class="tz-city">我的工作时间对应客户</span><span class="tz-time">${timeInTz(client, new Date(baseUtcStart))} - ${timeInTz(client, new Date(baseUtcEnd))}</span></div>
    <div class="tz-overlap">${overlap && businessDay ? "现在适合与客户沟通" : "当前可能不是客户工作时段"}</div>`;
}

function renderClients() {
  const q = ($("#clientSearch").value || "").toLowerCase();
  const f = $("#clientFilter").value;
  const lf = $("#clientLevelFilter").value;
  const sf = $("#clientSourceFilter").value;
  let list = state.clients.filter((c) => {
    const matchQ = !q || `${c.name} ${c.company} ${c.country} ${c.email} ${c.phone}`.toLowerCase().includes(q);
    const matchF = (!f || c.status === f) && (!lf || c.level === lf) && (!sf || c.source === sf);
    return matchQ && matchF;
  });
  $("#clientTable").innerHTML = `<thead><tr><th>客户</th><th>等级</th><th>国家</th><th>来源</th><th>状态</th><th>下次跟进</th><th>备注</th><th class="actions">操作</th></tr></thead><tbody>${
    list.length ? list.map((c) => `
      <tr><td><div class="cell-main">${esc(c.company || c.name)}</div><div class="cell-sub">${esc(c.name)} · ${esc(c.email)}${c.phone ? " · " + esc(c.phone) : ""}</div></td>
      <td>${levelBadge(c.level)}</td><td>${esc(c.country)}</td><td>${esc(c.source || "—")}</td><td>${statusBadge(c.status)}</td><td>${esc(c.nextFollowUp || "—")}</td><td style="max-width:200px"><div class="cell-sub">${esc(c.notes || "")}</div></td>
      <td><div class="actions"><button class="icon-btn js-view-client" data-id="${c.id}" title="详情"><i data-lucide="eye"></i></button><button class="icon-btn js-edit-client" data-id="${c.id}" title="编辑"><i data-lucide="pencil"></i></button><button class="icon-btn js-del-client" data-id="${c.id}" title="删除"><i data-lucide="trash-2"></i></button></div></td></tr>
    `).join("") : `<tr><td colspan="8" class="empty-state">没有匹配的客户</td></tr>`
  }</tbody>`;
  refreshIcons();
}

function clientModal(id) {
  const c = state.clients.find((x) => x.id === id) || {};
  const statuses = ["潜在客户", "已联系", "报价中", "跟进中", "已成交", "流失"];
  const sources = ["展会", "阿里国际站", "转介绍", "官网询盘", "自主开发", "社媒", "其他"];
  const countryOptions = TRADE_DATA.countries.map((x) => `<option ${x.name === c.country ? "selected" : ""}>${esc(x.name)}</option>`).join("");
  const tzOptions = TRADE_DATA.timezones.map((t) => `<option value="${t.tz}" ${t.tz === c.timezone ? "selected" : ""}>${esc(t.city)}</option>`).join("");
  openModal(`
    <div class="modal"><div class="modal-head"><h3>${id ? "编辑客户" : "新增客户"}</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
    <div class="form-grid">
      <label>联系人<input id="cName" value="${esc(c.name || "")}"></label>
      <label>公司名称<input id="cCompany" value="${esc(c.company || "")}"></label>
      <label>邮箱<input id="cEmail" type="email" value="${esc(c.email || "")}"></label>
      <label>电话 / WhatsApp<input id="cPhone" value="${esc(c.phone || "")}" placeholder="+86 ..."></label>
      <label>国家<select id="cCountry"><option value="">未选择</option>${countryOptions}</select></label>
      <label>时区<select id="cTimezone"><option value="">自动按国家</option>${tzOptions}</select></label>
      <label>状态<select id="cStatus">${statuses.map((s) => `<option ${s === c.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>客户等级<select id="cLevel"><option ${(c.level || "B") === "A" ? "selected" : ""}>A</option><option ${(c.level || "B") === "B" ? "selected" : ""}>B</option><option ${(c.level || "B") === "C" ? "selected" : ""}>C</option></select></label>
      <label>客户来源<select id="cSource">${sources.map((s) => `<option ${s === (c.source || "自主开发") ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>下次跟进日期<input id="cFollow" type="date" value="${esc(c.nextFollowUp || "")}"></label>
    </div>
    <label style="display:block;margin-top:12px">备注<textarea id="cNotes" style="min-height:70px">${esc(c.notes || "")}</textarea></label>
    <div class="modal-actions"><button class="btn" id="modalCancelBtn">取消</button><button class="btn primary" id="modalSaveClientBtn" data-id="${id || ""}">保存</button></div></div>`);
  // 国家 → 自动带出时区
  $("#cCountry").addEventListener("change", () => {
    const country = $("#cCountry").value;
    const tz = TRADE_DATA.countries.find((x) => x.name === country)?.timezone || "";
    if (tz && !$("#cTimezone").value) $("#cTimezone").value = tz;
  });
}

function levelBadge(level) {
  const color = level === "A" ? "red" : level === "B" ? "amber" : level === "C" ? "gray" : "gray";
  return `<span class="badge ${color}">${esc(level || "B")} 级</span>`;
}

function clientDetail(id) {
  const c = state.clients.find((x) => x.id === id);
  if (!c) return;
  const quotes = state.quotes.filter((q) => q.clientId === id || q.clientName === c.company || q.clientName === c.name);
  const orders = state.orders.filter((o) => o.clientId === id || o.clientName === c.company || o.clientName === c.name);
  openModal(`
    <div class="modal"><div class="modal-head"><h3>${esc(c.company || c.name)}</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
    <div class="country-info-row" style="margin-bottom:12px">
      <div class="country-info-cell"><div class="lbl">联系人</div><div class="val">${esc(c.name || "—")}</div></div>
      <div class="country-info-cell"><div class="lbl">等级</div><div class="val">${levelBadge(c.level)}</div></div>
      <div class="country-info-cell"><div class="lbl">国家</div><div class="val">${esc(c.country || "—")}</div></div>
      <div class="country-info-cell"><div class="lbl">来源</div><div class="val">${esc(c.source || "—")}</div></div>
      <div class="country-info-cell"><div class="lbl">状态</div><div class="val">${statusBadge(c.status)}</div></div>
      <div class="country-info-cell"><div class="lbl">邮箱</div><div class="val">${esc(c.email || "—")}</div></div>
      <div class="country-info-cell"><div class="lbl">电话</div><div class="val">${esc(c.phone || "—")}</div></div>
      <div class="country-info-cell"><div class="lbl">本地时间</div><div class="val">${c.timezone ? timeInTz(c.timezone) : "—"}</div></div>
      <div class="country-info-cell"><div class="lbl">下次跟进</div><div class="val">${esc(c.nextFollowUp || "—")}</div></div>
      <div class="country-info-cell"><div class="lbl">备注</div><div class="val">${esc(c.notes || "—")}</div></div>
    </div>
    <div class="form-grid">
      <div class="country-note"><h4>报价记录（${quotes.length}）</h4>${quotes.length ? quotes.map((q) => `<div class="stack-item"><div class="item-main"><div class="item-title">${esc(q.product)}</div><div class="item-sub">${esc(q.ref)} · ${esc(q.date || "")}</div></div><div class="item-end"><strong>${fmt(q.unitPrice)} ${esc(q.currency)}</strong><div>${statusBadge(q.status)}</div></div></div>`).join("") : "<div class='hint'>暂无报价</div>"}</div>
      <div class="country-note"><h4>订单记录（${orders.length}）</h4>${orders.length ? orders.map((o) => `<div class="stack-item"><div class="item-main"><div class="item-title">${esc(o.product)}</div><div class="item-sub">${esc(o.poNo)} · ${esc(o.status)}</div></div><div class="item-end"><strong>${fmt(o.amount)} ${esc(o.currency)}</strong></div></div>`).join("") : "<div class='hint'>暂无订单</div>"}</div>
    </div>
    <div class="modal-actions"><button class="btn" id="modalCancelBtn">关闭</button><button class="btn primary js-edit-client" data-id="${c.id}">编辑客户</button></div></div>`);
}

function saveClientFromModal(id) {
  const data = {
    name: $("#cName").value.trim(), company: $("#cCompany").value.trim(), email: $("#cEmail").value.trim(),
    phone: $("#cPhone").value.trim(), country: $("#cCountry").value, timezone: $("#cTimezone").value,
    status: $("#cStatus").value, level: $("#cLevel").value, source: $("#cSource").value,
    nextFollowUp: $("#cFollow").value, notes: $("#cNotes").value.trim()
  };
  if (!data.name && !data.company) { toast("请填写客户姓名或公司"); return; }
  if (id) {
    const idx = state.clients.findIndex((x) => x.id === id);
    if (idx >= 0) state.clients[idx] = { ...state.clients[idx], ...data };
  } else {
    state.clients.unshift({ id: uid(), ...data });
  }
  saveState();
  $("#modalRoot").innerHTML = "";
  renderClients();
  toast("客户已保存");
}

function exportClients() {
  const rows = [["姓名", "公司", "邮箱", "电话", "国家", "时区", "状态", "等级", "来源", "下次跟进", "备注"]];
  state.clients.forEach((c) => rows.push([c.name, c.company, c.email, c.phone, c.country, c.timezone, c.status, c.level, c.source, c.nextFollowUp, c.notes]));
  const csv = rows.map((r) => r.map((v) => `"${String(v || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile("clients.csv", csv, "text/csv;charset=utf-8");
}

function importClientsCsv(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const bytes = new Uint8Array(reader.result);
      let text = new TextDecoder("utf-8").decode(bytes);
      if (text.includes("�")) { try { text = new TextDecoder("gbk").decode(bytes); } catch (e) { /* 保留 UTF-8 */ } }
      const rows = parseCsvText(text);
      if (rows.length < 2) { toast("CSV 内容为空"); return; }
      const headers = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (keys) => { for (const k of keys) { const i = headers.indexOf(k); if (i >= 0) return i; } return -1; };
      const iName = idx(["姓名", "name", "联系人", "contact"]);
      const iCompany = idx(["公司", "company", "客户公司"]);
      const iEmail = idx(["邮箱", "email"]);
      const iPhone = idx(["电话", "phone", "whatsapp"]);
      const iCountry = idx(["国家", "country"]);
      const iStatus = idx(["状态", "status"]);
      const iLevel = idx(["等级", "level"]);
      const iSource = idx(["来源", "source"]);
      const iFollow = idx(["下次跟进", "跟进", "nextfollowup", "follow"]);
      const iNotes = idx(["备注", "notes", "note"]);
      if (iName < 0 && iCompany < 0) { toast("未找到姓名/公司列，请使用 姓名 / 公司 表头"); return; }
      const statusMap = { "潜在客户": "潜在客户", "已联系": "已联系", "报价中": "报价中", "跟进中": "跟进中", "已成交": "已成交", "流失": "流失" };
      const sources = ["展会", "阿里国际站", "转介绍", "官网询盘", "自主开发", "社媒", "其他"];
      const existing = new Set(state.clients.map((c) => (c.email || "").toLowerCase()));
      let added = 0, skipped = 0;
      rows.slice(1).forEach((r) => {
        const get = (i) => (i >= 0 && r[i] !== undefined ? r[i].trim() : "");
        const email = get(iEmail);
        if (email && existing.has(email.toLowerCase())) { skipped++; return; }
        const name = get(iName), company = get(iCompany);
        if (!name && !company) return;
        const country = get(iCountry);
        const timezone = TRADE_DATA.countries.find((x) => x.name === country)?.timezone || "";
        const client = {
          id: uid(), name, company, email, phone: get(iPhone), country, timezone,
          status: statusMap[get(iStatus)] || "潜在客户",
          level: ["A", "B", "C"].includes(get(iLevel)) ? get(iLevel) : "B",
          source: sources.includes(get(iSource)) ? get(iSource) : "自主开发",
          nextFollowUp: get(iFollow) || "", notes: get(iNotes)
        };
        state.clients.unshift(client);
        existing.add(email.toLowerCase());
        added++;
      });
      if (!added) { toast(skipped ? `没有新客户（${skipped} 条因邮箱重复跳过）` : "没有可导入的客户"); return; }
      saveState();
      renderClients();
      toast(`已导入 ${added} 个客户${skipped ? `，跳过 ${skipped} 条重复` : ""}`);
    } catch (err) { toast("导入失败，请检查 CSV 格式"); }
  };
  reader.readAsArrayBuffer(file);
}

function renderQuotes() {
  const q = ($("#quoteSearch").value || "").toLowerCase();
  const f = $("#quoteFilter").value;
  let list = state.quotes.filter((x) => {
    const matchQ = !q || `${x.product} ${x.clientName} ${x.ref}`.toLowerCase().includes(q);
    const matchF = !f || x.status === f;
    return matchQ && matchF;
  }).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  $("#quoteTable").innerHTML = `<thead><tr><th>编号</th><th>客户</th><th>产品</th><th>价格</th><th>数量</th><th>条款</th><th>付款/交期</th><th>利润率</th><th>状态</th><th>日期</th><th class="actions">操作</th></tr></thead><tbody>${
    list.length ? list.map((x) => `
      <tr><td>${esc(x.ref)}</td><td>${esc(x.clientName || "—")}</td><td>${esc(x.product)}</td><td><strong>${x.items && x.items.length > 1 ? fmt(x.amount) : fmt(x.unitPrice)} ${esc(x.currency || "USD")}</strong>${x.items && x.items.length > 1 ? `<div class="cell-sub">${fmtInt(x.qty)} 件 · ${x.items.length} 项合计</div>` : ""}</td><td>${fmtInt(x.qty)}</td><td>${esc(x.incoterm || "—")}</td>
      <td><div class="cell-sub">${esc(x.payment || "—")}</div><div class="cell-sub">${esc(x.delivery || "—")} / ${esc(x.validity || "—")}</div></td>
      <td>${x.marginPct !== undefined && x.marginPct !== null ? `<strong>${fmt(x.marginPct, 1)}%</strong><div class="cell-sub">成本 ¥${fmt(x.unitCost || 0)}</div>` : "—"}</td>
      <td><select class="js-quote-status" data-id="${x.id}" style="min-width:92px">${["新报价", "跟进中", "已成交", "丢失"].map((s) => `<option ${s === x.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td>${esc(x.date || "—")}</td><td><div class="actions"><button class="icon-btn js-quote-pdf" data-id="${x.id}" title="报价单 PDF"><i data-lucide="file-down"></i></button><button class="icon-btn js-copy-quote" data-id="${x.id}" title="复制摘要"><i data-lucide="copy"></i></button><button class="icon-btn js-to-order" data-id="${x.id}" title="转为订单"><i data-lucide="clipboard-list"></i></button><button class="icon-btn js-del-quote" data-id="${x.id}" title="删除"><i data-lucide="trash-2"></i></button></div></td></tr>
    `).join("") : `<tr><td colspan="11" class="empty-state">暂无报价记录</td></tr>`
  }</tbody>`;
  refreshIcons();
}

function quotationPdf(q) {
  const doc = pdfInstance();
  if (!doc) return null;
  const cur = q.currency || "USD";
  const company = state.settings.company || "";
  const sales = state.settings.sales || "";
  const date = q.date || todayISO();
  const items = Array.isArray(q.items) && q.items.length
    ? q.items.map((it) => ({ desc: it.name || "-", hs: it.hs || "", qty: String(it.qty || ""), unitPrice: it.unitPrice || "", amount: orderItemAmount(it) }))
    : [{ desc: q.product || "-", qty: String(q.qty || ""), unitPrice: q.unitPrice || "", amount: (Number(q.unitPrice) || 0) * (Number(q.qty) || 0) }];
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0), 0) || Number(q.amount) || 0;
  let y = pdfHeader(doc, "QUOTATION", `${q.ref || ""}  |  Date: ${date}`);
  y = pdfField(doc, y, "Client", q.clientName || "-");
  y = pdfField(doc, y, "Incoterm", q.incoterm || "-");
  y = pdfField(doc, y, "Payment", q.payment || "-");
  y = pdfField(doc, y, "Delivery", q.delivery || "-");
  y = pdfField(doc, y, "Validity", q.validity || "-");
  y = pdfField(doc, y, "Port", q.port || "-");
  y += 3;
  y = pdfGoodsTable(doc, y, items, cur);
  y += 3;
  y = pdfField(doc, y, "Amount in Words", amountInWords(total, cur));
  y = pdfField(doc, y, "Notes", q.notes || "-");
  y += 6;
  pdfSignature(doc, y, "Prepared by " + (sales || company));
  pdfFooter(doc);
  return doc;
}

function quoteModal(id) {
  openQuoteModal(id);
}

// 贸易条款下拉（保留无法匹配的自定义值）
function incotermSelect(current, id) {
  const codes = TRADE_DATA.incoterms.map((t) => t.code);
  const opts = codes.map((c) => `<option ${c === current ? "selected" : ""}>${c}</option>`).join("");
  const extra = current && !codes.includes(current) ? `<option selected>${esc(current)}</option>` : "";
  return `<select id="${id}" class="full">${opts}${extra}</select>`;
}

// 付款方式英文预设下拉（与贸易条款 select 一致；保留自定义值作为额外选项）
function paymentOptions(current) {
  const presets = TRADE_DATA.paymentTerms.map((t) => t.en);
  const val = String(current || "").trim();
  const extra = val && !presets.includes(val) ? `<option value="${esc(val)}" selected>${esc(val)}</option>` : "";
  return `<option value="">手动填写</option>` + presets.map((p) => `<option value="${esc(p)}" ${p === val ? "selected" : ""}>${esc(p)}</option>`).join("") + extra;
}
function paymentSelect(current, id) {
  return `<select id="${id}" class="full">${paymentOptions(current)}</select>`;
}
function fillPaymentSelect(sel, current) {
  if (!sel) return;
  sel.innerHTML = paymentOptions(current);
  sel.value = String(current || "").trim();
}

function openQuoteModal(id, prefill) {
  const q = id ? (state.quotes.find((x) => x.id === id) || {}) : {};
  const src = prefill || q;
  const items = (Array.isArray(src.items) && src.items.length) ? src.items
    : (src.product ? [{ pid: "", name: src.product, hs: src.hs || "", qty: String(src.qty || ""), unitPrice: src.unitPrice || "" }] : []);
  const orphan = src.clientId && !state.clients.some((c) => c.id === src.clientId)
    ? `<option value="${src.clientId}" selected>${esc(src.clientName || "已删除客户")}（已删除）</option>` : "";
  const clientOptions = `<option value="">未选择</option>` + orphan + state.clients.map((c) => `<option value="${c.id}" ${c.id === src.clientId ? "selected" : ""}>${esc(c.company || c.name)}</option>`).join("");
  const refVal = src.ref || `QT-${todayISO().replace(/-/g, "")}-${Math.floor(Math.random() * 90 + 10)}`;
  const statusOptions = ["新报价", "跟进中", "已成交", "丢失"].map((s) => `<option ${s === src.status ? "selected" : ""}>${s}</option>`).join("");
  const curOptions = TRADE_DATA.currencies.map((c) => `<option value="${c.code}" ${c.code === (src.currency || "USD") ? "selected" : ""}>${c.code}</option>`).join("");
  openModal(`
    <div class="modal modal-quote"><div class="modal-head"><h3>${id ? "编辑报价" : prefill ? "保存报价记录" : "新增报价"}</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
    <div class="form-grid">
      <label>报价编号<input id="quoteRef" value="${esc(refVal)}"></label>
      <label>关联客户<select id="quoteClient">${clientOptions}</select></label>
      <label>状态<select id="quoteStatus">${statusOptions}</select></label>
      <label>币种<select id="quoteCurrency">${curOptions}</select></label>
      <label>贸易条款${incotermSelect(src.incoterm || "", "quoteTerms")}</label>
      <label>付款方式${paymentSelect(src.payment || state.settings.defaultPayment, "quotePayment")}</label>
      <label>交期<input id="quoteDelivery" value="${esc(src.delivery || state.settings.defaultDelivery)}"></label>
      <label>报价有效期<input id="quoteValidity" value="${esc(src.validity || state.settings.defaultValidity)}"></label>
      <label>起运港 / 目的港<input id="quotePort" value="${esc(src.port || state.settings.defaultPort)}"></label>
      <label>日期<input id="quoteDate" type="date" value="${esc(src.date || todayISO())}"></label>
    </div>
    <div class="order-items-section">
      <div class="order-items-head"><span>产品明细</span></div>
      <div class="table-wrap"><table class="data-table" id="quoteItemsTable">
        <thead><tr><th>产品</th><th>HS</th><th>颜色</th><th>数量</th><th>单价</th><th>金额</th><th class="actions">操作</th></tr></thead>
        <tbody></tbody>
      </table></div>
      <div class="btn-row order-add-row"><button class="btn ghost" id="addQuoteItemRowBtn"><i data-lucide="plus"></i><span>新增一行</span></button></div>
      <div class="order-total" id="quoteTotalDisplay">合计：<strong>0.00</strong></div>
    </div>
    <label style="display:block;margin-top:12px">备注<textarea id="quoteNotes" style="min-height:60px">${esc(src.notes || "")}</textarea></label>
    <div class="modal-actions"><button class="btn" id="modalCancelBtn">取消</button><button class="btn primary" id="modalSaveQuoteBtn" data-id="${id || ""}">保存</button></div></div>`);
  renderQuoteItems(items);
  $("#addQuoteItemRowBtn").addEventListener("click", addQuoteItemRow);
  $("#quoteItemsTable").addEventListener("input", (e) => {
    const tr = e.target.closest(".quote-item-row");
    if (!tr) return;
    const qty = tr.querySelector(".qi-qty")?.value || "";
    const price = tr.querySelector(".qi-price")?.value || "";
    const amountTd = tr.querySelector(".qi-amount");
    if (amountTd) amountTd.textContent = fmt(orderItemAmount({ qty, unitPrice: price }), 2);
    updateQuoteTotal();
  });
  $("#quoteItemsTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-del-quote-item");
    if (btn) { btn.closest(".quote-item-row").remove(); updateQuoteTotal(); }
  });
}

function renderQuoteItems(items) {
  const list = (items && items.length ? items : []);
  $("#quoteItemsTable tbody").innerHTML = list.length ? list.map((it, i) => `
    <tr class="quote-item-row" data-pid="${esc(it.pid || "")}" data-colors="${esc((it.colors || []).join(","))}">
      <td><input class="qi-pick" value="${esc(it.name || "")}" placeholder="输入型号/品名选产品（可手填）"></td>
      <td><input class="qi-hs" value="${esc(it.hs || "")}" placeholder="9405.42"></td>
      <td><button type="button" class="qi-color btn ghost">${colorBadgesHtml(it.colors) || "＋ 选颜色"}</button></td>
      <td><input class="qi-qty" value="${esc(it.qty || "")}" placeholder="1,000"></td>
      <td><input class="qi-price" type="number" step="0.01" value="${it.unitPrice ?? ""}" placeholder="3.85"></td>
      <td class="qi-amount">${fmt(orderItemAmount(it), 2)}</td>
      <td><div class="actions"><button class="icon-btn js-del-quote-item" title="删除"><i data-lucide="trash-2"></i></button></div></td>
    </tr>`).join("") : emptyQuoteRowHtml();
  attachRowPickers();
  updateQuoteTotal();
  attachHsAutocompletes();
  refreshIcons();
}

function emptyQuoteRowHtml() {
  return `<tr class="quote-item-row" data-pid="" data-colors="">
    <td><input class="qi-pick" placeholder="输入型号/品名选产品（可手填）"></td>
    <td><input class="qi-hs" placeholder="9405.42"></td>
    <td><button type="button" class="qi-color btn ghost">＋ 选颜色</button></td>
    <td><input class="qi-qty" placeholder="1,000"></td>
    <td><input class="qi-price" type="number" step="0.01" placeholder="3.85"></td>
    <td class="qi-amount">0.00</td>
    <td><div class="actions"><button class="icon-btn js-del-quote-item" title="删除"><i data-lucide="trash-2"></i></button></div></td>
  </tr>`;
}

function addQuoteItemRow() {
  $("#quoteItemsTable tbody").insertAdjacentHTML("beforeend", emptyQuoteRowHtml());
  attachRowPickers();
  updateQuoteTotal();
  attachHsAutocompletes();
  refreshIcons();
  const rows = document.querySelectorAll("#quoteItemsTable .qi-pick");
  const last = rows[rows.length - 1];
  if (last) last.focus();
}

function updateQuoteTotal() {
  const rows = $$("#quoteItemsTable .quote-item-row");
  const total = rows.reduce((s, tr) => s + orderItemAmount({ qty: tr.querySelector(".qi-qty")?.value, unitPrice: tr.querySelector(".qi-price")?.value }), 0);
  const el = $("#quoteTotalDisplay");
  if (el) el.innerHTML = `合计：<strong>${fmt(total, 2)}</strong>`;
  return total;
}

function saveQuoteFromModal(id) {
  const clientId = $("#quoteClient").value;
  const client = state.clients.find((c) => c.id === clientId);
  const rows = $$("#quoteItemsTable .quote-item-row");
  const items = rows.map((tr) => {
    const qty = tr.querySelector(".qi-qty")?.value.trim() || "";
    const unitPrice = tr.querySelector(".qi-price")?.value || "";
    const pickName = (tr.querySelector(".qi-pick")?.value || "").trim();
    return {
      pid: tr.dataset.pid || "",
      name: pickName,
      hs: tr.querySelector(".qi-hs")?.value.trim() || "",
      colors: (tr.dataset.colors || "").split(",").filter(Boolean),
      qty,
      unitPrice,
      amount: orderItemAmount({ qty, unitPrice })
    };
  }).filter((it) => it.name || it.qty);
  const totalQty = items.reduce((s, it) => s + parseQty(it.qty), 0);
  const totalAmount = items.reduce((s, it) => s + it.amount, 0);
  const product = items.length ? (items.length === 1 ? items[0].name : `${items[0].name} 等 ${items.length} 项`) : "";
  const data = {
    ref: $("#quoteRef").value.trim(), clientId, clientName: client ? client.company || client.name : "",
    items, product, status: $("#quoteStatus").value,
    qty: totalQty, unitPrice: items.length ? (Number(items[0].unitPrice) || 0) : 0, amount: totalAmount,
    incoterm: $("#quoteTerms").value.trim(), date: $("#quoteDate").value, notes: $("#quoteNotes").value.trim(),
    currency: $("#quoteCurrency")?.value || "USD", payment: $("#quotePayment")?.value.trim() || "", delivery: $("#quoteDelivery")?.value.trim() || "",
    validity: $("#quoteValidity")?.value.trim() || "", port: $("#quotePort")?.value.trim() || ""
  };
  // 从计算器保存时附带成本/汇率/利润快照
  const snap = window.__quoteSnapshot;
  if (snap) {
    Object.assign(data, snap);
    window.__quoteSnapshot = null;
  }
  if (!data.product) { toast("请填写至少一个产品"); return; }
  if (id) {
    const idx = state.quotes.findIndex((x) => x.id === id);
    if (idx >= 0) state.quotes[idx] = { ...state.quotes[idx], ...data };
  } else {
    state.quotes.unshift({ id: uid(), ...data });
  }
  saveState();
  $("#modalRoot").innerHTML = "";
  renderQuotes();
  toast("报价记录已保存");
}

function copyQuoteSummary(id) {
  const q = state.quotes.find((x) => x.id === id);
  if (!q) return;
  copyText(`QUOTATION ${q.ref}\nProduct: ${q.product}\nPrice: ${q.currency || "USD"} ${q.unitPrice} / pc\nQty: ${q.qty}\nIncoterm: ${q.incoterm || "-"}\nPayment: ${q.payment || "-"}\nDelivery: ${q.delivery || "-"}\nValidity: ${q.validity || "-"}\nPort: ${q.port || "-"}\nStatus: ${q.status}\nDate: ${q.date || "-"}`);
}

function exportQuotes() {
  const rows = [["编号", "客户", "产品", "单价", "币种", "数量", "贸易条款", "付款方式", "交期", "有效期", "港口", "状态", "日期", "成本RMB", "利润率%", "备注"]];
  state.quotes.forEach((q) => rows.push([q.ref, q.clientName, q.product, q.unitPrice, q.currency, q.qty, q.incoterm, q.payment, q.delivery, q.validity, q.port, q.status, q.date, q.unitCost ?? "", q.marginPct ?? "", q.notes]));
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile("quotes.csv", csv, "text/csv;charset=utf-8");
}

function quoteToOrder(id) {
  const q = state.quotes.find((x) => x.id === id);
  if (!q) return;
  const items = (Array.isArray(q.items) && q.items.length)
    ? q.items.map((it) => ({ pid: it.pid || "", name: it.name || "", hs: it.hs || "", colors: it.colors || [], qty: String(it.qty || ""), unitPrice: String(it.unitPrice || ""), amount: orderItemAmount(it) }))
    : [{ pid: "", name: q.product || "", hs: "", qty: String(q.qty || ""), unitPrice: q.unitPrice ? String(q.unitPrice) : "", amount: (Number(q.unitPrice) || 0) * (Number(q.qty) || 0) }];
  const qty = items.reduce((s, it) => s + parseQty(it.qty), 0);
  const amount = items.reduce((s, it) => s + (Number(it.amount) || 0), 0);
  const order = {
    id: uid(),
    poNo: `PO-${todayISO().replace(/-/g, "")}-${Math.floor(Math.random() * 90 + 10)}`,
    clientId: q.clientId || "",
    clientName: q.clientName || "",
    items,
    product: items.length ? (items.length === 1 ? items[0].name : `${items[0].name} 等 ${items.length} 项`) : "",
    qty,
    amount,
    currency: q.currency || "USD",
    status: "已接单",
    incoterm: q.incoterm || state.settings.defaultIncoterm || "",
    payment: q.payment || state.settings.defaultPayment || "",
    orderDate: todayISO(),
    deliveryDate: "",
    port: q.port || state.settings.defaultPort || "",
    tracking: "",
    notes: `由报价 ${q.ref || ""} 转入`
  };
  state.orders.unshift(order);
  saveState();
  renderOrders();
  go("orders");
  orderModal(order.id);
  toast("已从报价创建订单，请确认信息");
}

function exportOrders() {
  const rows = [["PO 号", "客户", "产品", "数量", "金额", "币种", "成本RMB", "毛利RMB", "状态", "贸易条款", "付款方式", "下单日期", "交期", "港口", "物流单号", "明细", "备注"]];
  state.orders.forEach((o) => rows.push([o.poNo, o.clientName, o.product, o.qty, o.amount, o.currency, o.cost ?? "", o.profit ?? "", o.status, o.incoterm, o.payment, o.orderDate, o.deliveryDate, o.port, o.tracking, (o.items || []).map((it) => `${it.name} x${it.qty} @${it.unitPrice}`).join("; "), o.notes]));
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile("orders.csv", csv, "text/csv;charset=utf-8");
}

function copyOrderSummary(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const itemLines = (o.items || []).map((it, i) => `${i + 1}. ${it.name || "-"}  | HS: ${it.hs || "-"}  | Qty: ${it.qty || "-"}  | Unit: ${o.currency || "USD"} ${it.unitPrice || "-"}  | Amount: ${o.currency || "USD"} ${fmt(it.amount || 0, 2)}`).join("\n");
  copyText(`ORDER ${o.poNo}\nClient: ${o.clientName}\nProduct: ${o.product}\nQty: ${o.qty}\nAmount: ${o.currency || "USD"} ${o.amount}\nItems:\n${itemLines || "-"}\nStatus: ${o.status}\nIncoterm: ${o.incoterm || "-"}\nPayment: ${o.payment || "-"}\nOrder Date: ${o.orderDate || "-"}\nDelivery: ${o.deliveryDate || "-"}\nPort: ${o.port || "-"}\nTracking: ${o.tracking || "-"}\nNotes: ${o.notes || "-"}`);
}

function renderEmails() {
  const cat = $("#emailCategory").value;
  const templates = TRADE_DATA.emailTemplates.filter((t) => t.category === cat);
  const customKeys = Object.keys(state.customEmails).filter((k) => k.startsWith(cat + ":"));
  $("#emailTemplateList").innerHTML = [
    ...templates.map((t, i) => `<button class="template-item" data-tpl="${i}" data-cat="${cat}"><strong>${esc(t.title)}</strong><span>常用模板</span></button>`),
    ...customKeys.map((k) => `<button class="template-item" data-custom="${esc(k)}"><strong>${esc(k.split(":")[1])}</strong><span>我的模板</span></button>`)
  ].join("");
  if (!window.currentEmailTemplate || window.currentEmailTemplate.category !== cat) {
    const first = templates[0];
    if (first) selectEmailTemplate(first);
  }
  const sc = $("#emailSrcClient");
  if (sc && !sc.dataset.filled) { sc.dataset.filled = "1"; sc.innerHTML = `<option value="">选择客户带入变量</option>` + state.clients.map((c) => `<option value="${c.id}">${esc(c.company || c.name)}</option>`).join(""); }
  const sq = $("#emailSrcQuote");
  if (sq && !sq.dataset.filled) { sq.dataset.filled = "1"; sq.innerHTML = `<option value="">选择报价带入变量</option>` + state.quotes.map((q) => `<option value="${q.id}">${esc(q.ref)} · ${esc(q.product)}</option>`).join(""); }
  const so = $("#emailSrcOrder");
  if (so && !so.dataset.filled) { so.dataset.filled = "1"; so.innerHTML = `<option value="">选择订单带入变量</option>` + state.orders.map((o) => `<option value="${o.id}">${esc(o.poNo)} · ${esc(o.product)}</option>`).join(""); }
}

function fillEmailVarsFrom(src) {
  const map = {
    "Customer Name": src.name, "Company": src.company, "Email": src.email, "Phone": src.phone,
    "Price": src.unitPrice !== undefined && src.unitPrice !== null ? `${src.currency || ""} ${src.unitPrice}`.trim() : "",
    "Amount": src.amount !== undefined && src.amount !== null ? `${src.currency || ""} ${src.amount}`.trim() : "",
    "Order No.": src.poNo || src.ref || "", "Product": src.product || "", "Quantity": src.qty || "",
    "Payment Terms": src.payment || "", "Delivery Time": src.deliveryDate || src.delivery || "",
    "Ship Date": src.shipDate || src.deliveryDate || "", "Tracking No.": src.tracking || "",
    "Validity": src.validity || "", "Port": src.port || ""
  };
  let filled = 0;
  $$("#emailVars input").forEach((input) => {
    const v = input.dataset.var;
    if (v && map[v] !== undefined && String(map[v]) !== "") { input.value = map[v]; filled++; }
  });
  toast(filled ? `已从${src._label || "记录"}带入 ${filled} 个变量` : "当前模板变量与该记录不匹配");
}

function sendEmailViaClient() {
  const subjectInput = $("#emailSubject");
  const subject = (subjectInput && subjectInput.value.trim()) || (window.currentEmailTemplate ? window.currentEmailTemplate.title : "外贸业务邮件");
  const body = $("#emailContent").value || "";
  const emailInput = document.querySelector('#emailVars input[data-var="Email"]');
  const to = emailInput ? emailInput.value.trim() : "";
  const href = "mailto:" + encodeURIComponent(to) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body.replace(/\r?\n/g, "\r\n"));
  if (body.length > 1800) toast("正文较长，部分邮件客户端可能截断，建议用“复制”后手动发送");
  window.location.href = href;
}

function selectEmailTemplate(tpl) {
  window.currentEmailTemplate = tpl;
  $("#emailContent").value = tpl.body;
  $("#emailContent").textContent = tpl.body;
  const subjectInput = $("#emailSubject");
  if (subjectInput) subjectInput.value = tpl.subject || tpl.title;
  const allText = `${tpl.subject || ""}\n${tpl.body}`;
  const vars = [...new Set([...allText.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]))];
  const defaults = { "Customer Name": "", "Company": state.settings.company || "Your Company", "Your Name": state.settings.sales || "", "Email": state.settings.email || "", "Phone": state.settings.phone || "" };
  $("#emailVars").innerHTML = vars.map((v) => `<label>${esc(v)}<input data-var="${esc(v)}" value="${esc(defaults[v] || "")}" placeholder="${esc(v)}"></label>`).join("") || `<div class="hint">该模板没有变量</div>`;
  refreshIcons();
}

function applyEmailVars() {
  const values = {};
  $$("#emailVars input").forEach((input) => { values[input.dataset.var] = input.value; });
  const fill = (text) => String(text || "").replace(/\{\{([^}]+)\}\}/g, (m, k) => (k in values && values[k] !== "" ? values[k] : m));
  // 单次正则替换：避免后插入的变量值被再次当作变量处理
  $("#emailContent").value = fill($("#emailContent").value);
  $("#emailSubject").value = fill($("#emailSubject").value);
  toast("变量已填充");
}

function saveCustomEmail() {
  const cat = $("#emailCategory").value;
  const title = prompt("输入自定义模板名称", "自定义模板");
  if (!title || !title.trim()) return;
  const key = `${cat}:${title.trim()}`;
  if (state.customEmails[key] !== undefined && !confirm(`已存在同名模板"${title.trim()}"，覆盖它吗？`)) return;
  state.customEmails[key] = $("#emailContent").value;
  saveState();
  renderEmails();
  toast("自定义模板已保存");
}

function renderTerms() {
  $("#incotermGrid").innerHTML = TRADE_DATA.incoterms.map((t) => `
    <div class="term-card"><div class="term-code">${esc(t.code)}</div><div class="term-name">${esc(t.name)}</div><div class="term-desc">${esc(t.desc)}</div><div class="term-desc">风险转移：${esc(t.risk)}</div><div class="term-desc">运输：${esc(t.transport)}</div><span class="term-tag">${esc(t.tips)}</span></div>`).join("");
  $("#paymentTable").innerHTML = `<table class="data-table"><thead><tr><th>方式</th><th>名称</th><th>风险</th><th>说明</th></tr></thead><tbody>${TRADE_DATA.paymentTerms.map((p) => `<tr><td><strong>${esc(p.code)}</strong></td><td>${esc(p.name)}</td><td>${statusBadge(p.risk === "低" ? "已成交" : p.risk === "中" ? "报价中" : "流失")}</td><td>${esc(p.desc)}</td></tr>`).join("")}</tbody></table>`;
}

let activeCountry = null;
function renderCountries() {
  const q = ($("#countrySearch").value || "").toLowerCase();
  const list = TRADE_DATA.countries.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  $("#countryList").innerHTML = list.map((c) => `<button class="country-item ${activeCountry === c.name ? "active" : ""}" data-country="${esc(c.name)}"><strong>${esc(c.name)}</strong><span>${esc(c.currency)} · ${esc(c.timezone)}</span></button>`).join("");
  if (!activeCountry && list.length) activeCountry = list[0].name;
  if (activeCountry) renderCountryDetail(activeCountry);
}

function renderCountryDetail(name) {
  const c = TRADE_DATA.countries.find((x) => x.name === name);
  if (!c) return;
  const extra = TRADE_DATA.countryExtras[name] || {};
  activeCountry = c.name;
  $("#countryDetail").innerHTML = `
    <div class="country-info-row">
      <div class="country-info-cell"><div class="lbl">货币</div><div class="val">${esc(c.currency)}</div></div>
      <div class="country-info-cell"><div class="lbl">时区</div><div class="val">${esc(c.timezone)}</div></div>
      <div class="country-info-cell"><div class="lbl">电话区号</div><div class="val">${esc(c.phone)}</div></div>
      <div class="country-info-cell"><div class="lbl">主要语言</div><div class="val">${esc(c.language)}</div></div>
      <div class="country-info-cell"><div class="lbl">主要节假日</div><div class="val">${esc(c.holidays)}</div></div>
      <div class="country-info-cell"><div class="lbl">常见付款</div><div class="val">${esc(c.payment)}</div></div>
      <div class="country-info-cell"><div class="lbl">工作日</div><div class="val">${esc(extra.workWeek || "周一至周五")}</div></div>
      <div class="country-info-cell"><div class="lbl">主流平台</div><div class="val">${esc(extra.platforms || "—")}</div></div>
      <div class="country-info-cell"><div class="lbl">常见认证</div><div class="val">${esc(extra.certification || "按品类确认")}</div></div>
    </div>
    <div class="country-note"><h4>商务建议</h4>${esc(c.tips)}</div>
    <div class="country-note"><h4>市场特点</h4>${esc(extra.marketNote || "—")}</div>
    <div class="country-note"><h4>当前时间</h4>${timeInTz(c.timezone)}（${WEEKDAYS[["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(tzParts(c.timezone).weekday)]}）</div>`;
}

// —— 单证 PDF 模板（专业版）——
// 统一 A4 794×1123 版面；占位符由 renderTemplateHtml 替换：
// {{company}}/{{sales}}/{{email}}/{{phone}}/{{contact}}/{{docX}}/{{docGoodsRows}}/{{docAmountWords}}
function tplShell(body, opts = {}) {
  const size = opts.fontSize || 12;
  return `<div class="doc-tpl" style="position:relative;width:794px;height:1123px;box-sizing:border-box;padding:42px 54px;background:#fff;font-family:'Helvetica Neue',Helvetica,Arial,'PingFang SC','Microsoft YaHei',sans-serif;color:#22303c;font-size:${size}px;">${body}</div>`;
}

// 公司信头：公司名 + 英文地址 + 联系方式
function tplLetterhead() {
  return `<div style="border-bottom:2.5px solid ${TPL_C};padding-bottom:10px;margin-bottom:11px;"><div style="font-size:24px;font-weight:800;color:${TPL_C};letter-spacing:0.5px;line-height:1.2;">{{company}}</div><div style="font-size:10.5px;color:#5a6b78;margin-top:4px;max-width:480px;">{{docSellerAddress}}</div><div style="font-size:9.5px;color:#8a98a5;margin-top:3px;">{{contact}}</div></div>`;
}

// 文档标题 + 右侧编号信息块（rows: [label, value][]）
function tplTitle(title, subtitle, rows) {
  return `<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;"><div><div style="font-size:21px;font-weight:800;color:${TPL_C};letter-spacing:2px;">${title}</div>${subtitle ? `<div style="font-size:10px;color:#8a98a5;margin-top:3px;">${subtitle}</div>` : ""}</div><table style="border-collapse:collapse;font-size:10.5px;">${(rows || []).map((r) => `<tr><td style="text-align:right;color:#8a98a5;padding:1.5px 8px 1.5px 0;">${r[0]}</td><td style="text-align:right;font-weight:700;color:#22303c;">${r[1]}</td></tr>`).join("")}</table></div>`;
}

// 收发货人双栏
function tplParties(lLabel, lName, lAddr, rLabel, rName, rAddr) {
  const cell = (label, name, addr) => `<td style="width:50%;vertical-align:top;padding:8px 10px;border:1px solid #dce3e9;background:#f6f9fb;"><div style="font-size:8.5px;font-weight:700;color:#8a98a5;letter-spacing:1.5px;margin-bottom:3px;">${label}</div><div style="font-size:11.5px;font-weight:700;color:#22303c;">${name}</div><div style="font-size:10px;color:#5a6b78;margin-top:2px;line-height:1.5;">${addr}</div></td>`;
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>${cell(lLabel, lName, lAddr)}<td style="width:10px;"></td>${cell(rLabel, rName, rAddr)}</tr></table>`;
}

// 承运类三栏（BL 用）：Shipper / Consignee / Notify Party
function tplTriParties(a, b, c) {
  const cell = (label, name, addr) => `<td style="width:33.3%;vertical-align:top;padding:8px 10px;border:1px solid #dce3e9;background:#f6f9fb;"><div style="font-size:8.5px;font-weight:700;color:#8a98a5;letter-spacing:1px;margin-bottom:3px;">${label}</div><div style="font-size:11px;font-weight:700;color:#22303c;">${name}</div><div style="font-size:9.5px;color:#5a6b78;margin-top:2px;line-height:1.45;">${addr}</div></td>`;
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:12px;"><tr>${cell(a[0], a[1], a[2])}${cell(b[0], b[1], b[2])}${cell(c[0], c[1], c[2])}</tr></table>`;
}

// 货物明细表：No. / Description / HS Code / Quantity / Unit Price / Amount
function tplGoodsTable(totalLabel = "TOTAL") {
  return `<table style="width:100%;border-collapse:collapse;margin-top:4px;"><thead><tr style="background:${TPL_C};color:#fff;"><th style="width:24px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">No.</th><th style="padding:5px 8px;font-size:8.5px;font-weight:600;text-align:left;border:1px solid ${TPL_C};">Description of Goods</th><th style="width:54px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">HS Code</th><th style="width:78px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">Quantity</th><th style="width:70px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">Unit Price<br><span style="font-size:7.5px;font-weight:400;">{{docCurrency}}</span></th><th style="width:84px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">Amount<br><span style="font-size:7.5px;font-weight:400;">{{docCurrency}}</span></th></tr></thead><tbody>{{docGoodsRows}}</tbody><tfoot><tr style="background:#f0f4f8;"><td colspan="5" style="padding:5px 8px;border:1px solid #dce3e9;font-size:10px;font-weight:700;text-align:right;color:#22303c;">${totalLabel}</td><td style="padding:5px 8px;border:1px solid #dce3e9;font-size:10.5px;font-weight:800;text-align:right;color:${TPL_C};">{{docCurrency}} {{docAmount}}</td></tr></tfoot></table>`;
}

// 无价货物表（PL/SA/CO/BL/AWB 用）：不含单价金额，合计行可显示总数量
function tplGoodsTablePlain(totalLabel = "TOTAL", totalVal = "{{docTotalQty}}") {
  return `<table style="width:100%;border-collapse:collapse;margin-top:4px;"><thead><tr style="background:${TPL_C};color:#fff;"><th style="width:24px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">No.</th><th style="padding:5px 8px;font-size:8.5px;font-weight:600;text-align:left;border:1px solid ${TPL_C};">Description of Goods</th><th style="width:54px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">HS Code</th><th style="width:110px;padding:5px 4px;font-size:8.5px;font-weight:600;border:1px solid ${TPL_C};">Quantity</th></tr></thead><tbody>{{docGoodsRowsPlain}}</tbody><tfoot><tr style="background:#f0f4f8;"><td colspan="3" style="padding:5px 8px;border:1px solid #dce3e9;font-size:10px;font-weight:700;text-align:right;color:#22303c;">${totalLabel}</td><td style="padding:5px 8px;border:1px solid #dce3e9;font-size:10.5px;font-weight:800;text-align:right;color:${TPL_C};">${totalVal}</td></tr></tfoot></table>`;
}

// 金额大写
function tplAmountWords() {
  return `<div style="margin-top:7px;font-size:10.5px;color:#22303c;"><span style="color:#5a6b78;font-weight:700;">Amount in Words:</span> <b>{{docAmountWords}}</b></div>`;
}

// 明细行（label / value 两列；value 保留换行，供唛头/银行多行）
function tplDetails(rows) {
  return `<table style="width:100%;border-collapse:collapse;margin-top:10px;">${rows.map((r) => `<tr><td style="width:150px;padding:4.5px 10px;border:1px solid #dce3e9;background:#f4f7f9;font-size:10px;font-weight:600;color:#5a6b78;">${r[0]}</td><td style="padding:4.5px 12px;border:1px solid #dce3e9;font-size:10.5px;color:#22303c;white-space:pre-wrap;">${r[1]}</td></tr>`).join("")}</table>`;
}

// 装箱/运输汇总框（labels 可定制，如 BL 去掉净重）
function tplShipSummary(labels = [["TOTAL CARTONS", "{{docCartonCount}}", "CTNS"], ["GROSS WEIGHT", "{{docGrossWeight}}", "KGS"], ["NET WEIGHT", "{{docNetWeight}}", "KGS"], ["MEASUREMENT", "{{docVolumeVal}}", "CBM"]]) {
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:10px;"><tr>${labels.map(([k, v, u]) => `<td style="width:${Math.floor(100 / labels.length)}%;padding:7px 8px;border:1px solid #dce3e9;background:#f6f9fb;"><div style="font-size:8.5px;font-weight:700;color:#8a98a5;letter-spacing:0.5px;">${k}</div><div style="font-size:12px;font-weight:800;color:${TPL_C};margin-top:2px;">${v} <span style="font-size:8.5px;color:#8a98a5;font-weight:600;">${u}</span></div></td>`).join("")}</tr></table>`;
}

// 唛头框
function tplMarks() {
  return `<div style="margin-top:10px;border:1px solid #dce3e9;background:#fbfcfe;padding:7px 12px;"><div style="font-size:8.5px;font-weight:700;color:#8a98a5;letter-spacing:1.5px;margin-bottom:2px;">SHIPPING MARKS</div><div style="font-size:10.5px;color:#22303c;white-space:pre-wrap;">{{docMarks}}</div></div>`;
}

// 银行信息
function tplBank() {
  return `<div style="margin-top:10px;font-size:10px;color:#5a6b78;line-height:1.7;"><div style="font-weight:700;color:#22303c;letter-spacing:0.5px;margin-bottom:2px;">BANK DETAILS</div><div style="white-space:pre-wrap;">{{docBank}}</div></div>`;
}

// 条款框（PI/CI）
function tplTerms(lines) {
  return `<div style="margin-top:12px;border:1px solid #dce3e9;border-left:3px solid ${TPL_C};padding:8px 12px;font-size:10px;color:#5a6b78;line-height:1.75;"><div style="font-weight:700;color:#22303c;margin-bottom:3px;">TERMS &amp; CONDITIONS</div>${lines}</div>`;
}

// 备注
function tplNotes() {
  return `<div style="margin-top:10px;font-size:10px;color:#5a6b78;"><span style="color:#22303c;font-weight:600;">Remarks:</span> {{docNotes}}</div>`;
}

// 签章区
function tplSignature(leftLabel, leftName, rightLabel) {
  return `<div style="margin-top:14px;display:flex;justify-content:space-between;align-items:flex-end;"><div style="min-width:220px;"><div style="font-size:9px;color:#8a98a5;letter-spacing:0.5px;">${leftLabel}</div><div style="font-size:11px;font-weight:700;color:#22303c;margin-top:12px;">${leftName}</div></div><div style="width:210px;text-align:center;"><div style="font-size:9px;color:#8a98a5;letter-spacing:0.5px;">${rightLabel}</div><div style="margin-top:12px;border-top:1px solid #9aa8b3;padding-top:5px;font-size:10px;color:#4b5c69;">Signature / Date</div></div></div>`;
}

// 运费条款（BL 用）：只填 FREIGHT PREPAID / FREIGHT COLLECT
function tplFreight() {
  return `<div style="margin-top:10px;border:1px solid #dce3e9;padding:7px 12px;font-size:10.5px;color:#22303c;background:#fbfcfe;"><b>Freight:</b> {{docFreight}}</div>`;
}

// AWB 非流通声明
function tplNotNegotiable() {
  return `<div style="margin:0 0 8px;font-size:12px;font-weight:800;color:#c0392b;letter-spacing:2px;">NOT NEGOTIABLE</div>`;
}

// 页脚：单据号 + 页码
function tplFooter() {
  return `<div style="position:absolute;left:54px;right:54px;bottom:20px;border-top:1px solid #e3e9ee;padding-top:7px;display:flex;justify-content:space-between;font-size:8.5px;color:#a3afb8;"><span>{{docInvoiceNo}} · Page 1 / 1</span><span>{{docSellerAddress}}</span></div>`;
}

function buildDefaultDocTemplates() {
  // —— PI 形式发票：待确认报价，含有效期/付款/条款 ——
  const pi = tplShell(
    tplLetterhead() +
    tplTitle("PROFORMA INVOICE", "For confirmation purposes only — not a commercial invoice · Country of Origin: People's Republic of China", [["No.", "{{docInvoiceNo}}"], ["Date", "{{docDate}}"], ["PO No.", "{{docPoNo}}"], ["Validity", "{{docValidity}}"]] ) +
    tplParties("SELLER / BENEFICIARY", "{{docSeller}}", "{{docSellerAddress}}", "BUYER", "{{docBuyer}}", "{{docBuyerAddress}}") +
    tplGoodsTable("TOTAL AMOUNT") +
    tplAmountWords() +
    tplDetails([["Incoterm", "{{docTerms}} (Incoterms 2020)"], ["Payment / Delivery", "{{docPayment}} · {{docDelivery}}"], ["Shipment by", "{{docVessel}}"], ["Port of Loading → Discharge", "{{docFrom}} → {{docTo}}"], ["Marks & Numbers", "{{docMarks}}"], ["Buyer VAT / Tax ID", "{{docBuyerVat}}"]] ) +
    tplBank() +
    tplTerms(`<div>1. This proforma invoice is subject to our final confirmation and shall not constitute a binding offer until confirmed in writing by {{company}}.</div><div>2. This proforma invoice remains valid for {{docValidity}} from the date of issue.</div><div>3. Goods once sold are not returnable without prior written consent.</div><div>4. All banking charges outside China are for the account of the buyer.</div><div>5. Goods shall be shipped in accordance with the Incoterm stated above.</div>`) +
    tplNotes() +
    tplSignature("For and on behalf of", "{{company}}", "Authorized Signature") +
    tplFooter()
  );

  // —— CI 商业发票：清关/结汇核心单据 ——
  const ci = tplShell(
    tplLetterhead() +
    tplTitle("COMMERCIAL INVOICE", "Country of Origin: People's Republic of China", [["No.", "{{docInvoiceNo}}"], ["Date", "{{docDate}}"], ["PO No.", "{{docPoNo}}"]] ) +
    tplParties("SELLER", "{{docSeller}}", "{{docSellerAddress}}", "BUYER", "{{docBuyer}}", "{{docBuyerAddress}}") +
    tplGoodsTable("TOTAL AMOUNT") +
    tplAmountWords() +
    tplShipSummary() +
    tplDetails([["Incoterm", "{{docTerms}}"], ["Payment Terms", "{{docPayment}}"], ["L/C No.", "{{docLcNo}}"], ["Port of Loading", "{{docFrom}}"], ["Port of Discharge", "{{docTo}}"], ["Vessel / Flight", "{{docVessel}}"], ["Ship Date", "{{docShipDate}}"], ["Marks & Numbers", "{{docMarks}}"]] ) +
    `<div style="margin-top:8px;font-size:9px;color:#8a98a5;">E. &amp; O.E. — We hereby certify that the goods described in this invoice are of People's Republic of China origin and that the value stated is true and correct.</div>` +
    tplBank() +
    tplNotes() +
    tplSignature("For and on behalf of", "{{company}}", "Authorized Signature") +
    tplFooter()
  );

  // —— PL 装箱单：箱数/毛净重/体积（非价值单据，不出单价金额） ——
  const pl = tplShell(
    tplLetterhead() +
    tplTitle("PACKING LIST", "Packing / Weight / Measurement Details", [["No.", "{{docInvoiceNo}}"], ["Date", "{{docDate}}"], ["PO No.", "{{docPoNo}}"]] ) +
    tplParties("SELLER", "{{docSeller}}", "{{docSellerAddress}}", "BUYER", "{{docBuyer}}", "{{docBuyerAddress}}") +
    tplShipSummary() +
    tplGoodsTablePlain("TOTAL QUANTITY", "{{docTotalQty}}") +
    tplDetails([["Incoterm", "{{docTerms}}"], ["Country of Origin", "People's Republic of China"], ["Carton Size (L×W×H)", "{{docCartonSize}}"], ["Port of Loading", "{{docFrom}}"], ["Port of Discharge", "{{docTo}}"], ["Vessel / Flight", "{{docVessel}}"], ["Ship Date", "{{docShipDate}}"]] ) +
    tplMarks() +
    `<div style="margin-top:8px;font-size:9.5px;color:#5a6b78;">All goods are packed in export standard cartons, suitable for long-distance ocean/air transportation.</div>` +
    tplNotes() +
    tplSignature("For and on behalf of", "{{company}}", "Authorized Signature") +
    tplFooter()
  );

  // —— SA 装船通知：发给买方（FOB/CFR 买方需凭此投保）的通知函 ——
  const sa = tplShell(
    tplLetterhead() +
    tplTitle("SHIPPING ADVICE", "Advice of Dispatch", [["Invoice No.", "{{docInvoiceNo}}"], ["Date", "{{docDate}}"]] ) +
    `<div style="font-size:11px;color:#22303c;line-height:1.9;margin-bottom:10px;">Dear Sirs / Madams,<br><br>We are pleased to advise you that the following shipment has been dispatched on <b>{{docShipDate}}</b> in accordance with the terms and conditions of your order. Please arrange insurance and delivery accordingly.</div>` +
    tplDetails([["B/L or AWB No.", "{{docBlNo}}"], ["Container / Seal No.", "{{docContainerNo}}"], ["PO No.", "{{docPoNo}}"], ["Incoterm", "{{docTerms}}"], ["Vessel / Flight", "{{docVessel}}"], ["Port of Loading", "{{docFrom}}"], ["Port of Discharge", "{{docTo}}"], ["Ship Date / ETD", "{{docShipDate}}"], ["ETA", "{{docEta}}"], ["Contact / Tracking", "{{contact}}"]] ) +
    tplGoodsTablePlain("TOTAL QUANTITY", "{{docTotalQty}}") +
    tplShipSummary() +
    tplNotes() +
    tplSignature("Yours faithfully", "{{company}}", "For and on behalf of {{company}}") +
    tplFooter()
  );

  // —— CO 原产地证：出口商自签参考件，含标准声明与认证段 ——
  const co = tplShell(
    tplLetterhead() +
    `<div style="background:${TPL_C};color:#fff;text-align:center;font-size:13px;font-weight:800;letter-spacing:6px;padding:5px 0;margin-bottom:10px;">ORIGINAL</div>` +
    tplTitle("CERTIFICATE OF ORIGIN", "Non-preferential · People's Republic of China", [["Certificate No.", "{{docCertNo}}"], ["Date", "{{docDate}}"]] ) +
    tplDetails([["Exporter", "{{docSeller}} · {{docSellerAddress}}"], ["Consignee", "{{docBuyer}} · {{docBuyerAddress}}"], ["Country of Origin", "People's Republic of China"], ["Country of Destination", "{{docTo}}"], ["Means of transport and route", "By sea, from {{docFrom}} to {{docTo}}"]] ) +
    `<div style="margin-top:10px;font-size:10.5px;color:#22303c;"><b>Number and kind of packages:</b> {{docCartonCount}} CTNS &nbsp;&nbsp; <b>Gross weight:</b> {{docGrossWeight}} KGS</div>` +
    tplGoodsTablePlain("TOTAL QUANTITY", "{{docTotalQty}}") +
    tplDetails([["Marks & Numbers", "{{docMarks}}"], ["Number and date of invoice", "{{docInvoiceNo}} / {{docDate}}"]] ) +
    `<div style="margin-top:10px;border:1px solid #dce3e9;border-left:3px solid ${TPL_C};padding:9px 12px;font-size:10px;color:#22303c;line-height:1.75;"><div><b>Declaration by the Exporter:</b> The undersigned hereby declares that the above details and statements are correct; that all the goods were produced in the People's Republic of China and that they comply with the Rules of Origin of the People's Republic of China.</div><div style="margin-top:5px;"><b>Certification:</b> It is hereby certified that the declaration by the exporter is correct.</div></div>` +
    `<div style="margin-top:8px;font-size:9px;color:#8a98a5;">Note: This is a non-preferential self-issued certificate for reference. For preferential origin (e.g. RCEP / ASEAN / China-Australia FTA) or customs-recognized certificates, please obtain from CCPIT / the competent issuing authority.</div>` +
    tplSignature("Declaration by the Exporter", "{{company}}", "Authorized Signature &amp; Company Stamp") +
    tplFooter()
  );

  // —— BL 海运提单草案：承运格式，不含货价 ——
  const bl = tplShell(
    tplLetterhead() +
    tplTitle("BILL OF LADING", "DRAFT — For reference only, not a negotiable document", [["B/L No.", "{{docBlNo}}"], ["Date", "{{docDate}}"]] ) +
    tplTriParties(["SHIPPER", "{{docSeller}}", "{{docSellerAddress}}"], ["CONSIGNEE", "{{docBuyer}}", "{{docBuyerAddress}}"], ["NOTIFY PARTY", "{{docBuyer}}", "{{docBuyerAddress}}"]) +
    tplDetails([["Vessel / Voyage", "{{docVessel}}"], ["Port of Loading", "{{docFrom}}"], ["Port of Discharge", "{{docTo}}"], ["Container / Seal No.", "{{docContainerNo}}"], ["Marks & Numbers", "{{docMarks}}"]] ) +
    tplGoodsTablePlain("TOTAL") +
    tplShipSummary([["TOTAL PACKAGES", "{{docCartonCount}}", "CTNS"], ["GROSS WEIGHT", "{{docGrossWeight}}", "KGS"], ["MEASUREMENT", "{{docVolumeVal}}", "CBM"]]) +
    tplFreight() +
    `<div style="margin-top:8px;font-size:9px;color:#8a98a5;">SHIPPED ON BOARD this ______ day of ____________ 20____ · No. of Original Bs/L: 3/3 (to be issued by the carrier) · Place of Issue: ________________</div>` +
    tplNotes() +
    tplSignature("For the Carrier / its Agent", "{{docCarrier}}", "Place and Date of Issue") +
    tplFooter()
  );

  // —— AWB 空运单草案：非流通凭证 ——
  const awb = tplShell(
    tplLetterhead() +
    tplTitle("AIR WAYBILL", "DRAFT — For reference only, to be issued by the carrier", [["AWB No.", "{{docBlNo}}"], ["Date", "{{docDate}}"]] ) +
    tplNotNegotiable() +
    tplParties("SHIPPER", "{{docSeller}}", "{{docSellerAddress}}", "CONSIGNEE", "{{docBuyer}}", "{{docBuyerAddress}}") +
    tplDetails([["Airport of Departure", "{{docFrom}}"], ["Airport of Arrival", "{{docTo}}"], ["Flight No. / Date", "{{docVessel}}"], ["Handling Information", "{{docNotes}}"], ["Declared Value for Carriage", "NVD / ________________"], ["Declared Value for Customs", "NVD / ________________"], ["Amount of Insurance", "NIL / ________________"]] ) +
    tplGoodsTablePlain("TOTAL PIECES", "{{docCartonCount}}") +
    tplShipSummary([["NO. OF PIECES (RCP)", "{{docCartonCount}}", "PCS"], ["GROSS WEIGHT", "{{docGrossWeight}}", "KGS"], ["CHARGEABLE WEIGHT", "{{docGrossWeight}}", "KGS"]]) +
    tplFreight() +
    `<div style="margin-top:8px;font-size:9px;color:#8a98a5;">This Air Waybill is subject to the Conditions of Contract on the reverse hereof. It is NOT negotiable. Original 1 — for Carrier, Original 2 — for Consignee, Original 3 — for Shipper.</div>` +
    tplSignature("Signature of Shipper or His Agent", "{{company}}", "Signature of Issuing Carrier or Its Agent") +
    tplFooter()
  );

  // —— BC 受益人证明：信用证项下书式证明 ——
  const bc = tplShell(
    tplLetterhead() +
    tplTitle("BENEFICIARY CERTIFICATE", "", [["No.", "{{docCertNo}}"], ["Date", "{{docDate}}"]] ) +
    `<div style="font-size:11px;color:#22303c;line-height:2;margin-bottom:12px;">We, <b>{{company}}</b>, hereby certify that the goods covered by our Invoice No. <b>{{docInvoiceNo}}</b> under L/C No. <b>{{docLcNo}}</b> and Purchase Order No. <b>{{docPoNo}}</b> have been shipped on board <b>{{docVessel}}</b> from <b>{{docFrom}}</b> to <b>{{docTo}}</b> on <b>{{docShipDate}}</b> in accordance with the terms and conditions of the above letter of credit.<br>This certificate is issued in one original for presentation under the above letter of credit.</div>` +
    tplDetails([["Beneficiary", "{{docSeller}}"], ["Invoice No.", "{{docInvoiceNo}}"], ["L/C No.", "{{docLcNo}}"], ["PO No.", "{{docPoNo}}"], ["Ship Date", "{{docShipDate}}"], ["Vessel / Flight", "{{docVessel}}"], ["Goods", "{{docGoodsSummary}}"]] ) +
    `<div style="margin-top:10px;border:1px solid #dce3e9;border-left:3px solid ${TPL_C};padding:8px 12px;font-size:10px;color:#5a6b78;line-height:1.7;"><b style="color:#22303c;">Additional Certification:</b> {{docNotes}}</div>` +
    tplSignature("For and on behalf of", "{{company}}", "Authorized Signature") +
    tplFooter()
  );

  return { pi, ci, pl, sa, co, bl, awb, bc };
}

const DOC_GENERATORS = {
  pi: { name: "Proforma Invoice", file: "PI" },
  ci: { name: "Commercial Invoice", file: "CI" },
  pl: { name: "Packing List", file: "PL" },
  sa: { name: "Shipping Advice", file: "SA" },
  co: { name: "Certificate of Origin", file: "CO" },
  bl: { name: "Draft Bill of Lading", file: "BL" },
  awb: { name: "Draft Air Waybill", file: "AWB" },
  bc: { name: "Beneficiary Certificate", file: "BC" }
};

const DOC_BUILDER_FIELDS = ["invoiceNo", "poNo", "date", "seller", "sellerAddress", "buyer", "buyerAddress", "bank", "cartons", "currency", "terms", "payment", "delivery", "validity", "from", "to", "vessel", "marks", "weight", "volume", "shipDate", "eta", "notes", "lcNo", "blNo", "containerNo", "freight", "carrier", "cartonSize", "certNo", "buyerVat"];

const DOC_FIELD_LABELS = {
  invoiceNo: "发票号", poNo: "PO 号", date: "日期", seller: "卖方", sellerAddress: "卖方地址", buyer: "买方",
  buyerAddress: "买方地址", bank: "银行信息", payment: "付款方式", docItems: "货物明细", cartons: "箱数",
  currency: "币种", terms: "贸易条款", delivery: "交期", validity: "有效期", marks: "唛头", weight: "毛重/净重", volume: "体积",
  from: "起运港", to: "目的港", vessel: "船名/航班", shipDate: "装运日期", eta: "预计到港", notes: "备注",
  lcNo: "L/C 号", blNo: "提单/运单号", containerNo: "集装箱/铅封号", freight: "运费条款", carrier: "承运人",
  cartonSize: "箱规 (L×W×H)", certNo: "证书号", buyerVat: "买方税号"
};

// 每类单证需要显示的字段与必填字段（与各单证模板实际使用内容对应；货物明细统一为 docItems）
const DOC_FIELDS = {
  pi: {
    show: ["invoiceNo", "poNo", "date", "seller", "sellerAddress", "buyer", "buyerAddress", "bank", "docItems", "currency", "terms", "payment", "delivery", "validity", "from", "to", "vessel", "marks", "buyerVat", "notes"],
    required: ["seller", "buyer", "docItems", "terms"]
  },
  ci: {
    show: ["invoiceNo", "poNo", "date", "seller", "sellerAddress", "buyer", "buyerAddress", "bank", "docItems", "currency", "terms", "payment", "lcNo", "cartons", "weight", "volume", "from", "to", "vessel", "marks", "buyerVat", "notes"],
    required: ["seller", "buyer", "docItems", "terms"]
  },
  pl: {
    show: ["invoiceNo", "poNo", "date", "seller", "buyer", "docItems", "cartons", "currency", "weight", "volume", "cartonSize", "from", "to", "vessel", "marks", "notes"],
    required: ["seller", "buyer", "docItems", "cartons", "weight", "volume"]
  },
  sa: {
    show: ["invoiceNo", "poNo", "date", "seller", "buyer", "docItems", "currency", "terms", "blNo", "containerNo", "from", "to", "vessel", "shipDate", "eta", "notes"],
    required: ["seller", "buyer", "docItems", "terms", "from", "to", "vessel"]
  },
  co: {
    show: ["invoiceNo", "poNo", "date", "seller", "buyer", "docItems", "cartons", "weight", "marks", "certNo", "from", "to", "vessel", "notes"],
    required: ["seller", "buyer", "docItems"]
  },
  bl: {
    show: ["invoiceNo", "poNo", "date", "seller", "buyer", "docItems", "weight", "volume", "marks", "blNo", "containerNo", "freight", "carrier", "from", "to", "vessel", "notes"],
    required: ["seller", "buyer", "docItems", "from", "to", "vessel"]
  },
  awb: {
    show: ["invoiceNo", "date", "seller", "buyer", "docItems", "weight", "volume", "marks", "blNo", "freight", "carrier", "from", "to", "vessel", "notes"],
    required: ["seller", "buyer", "docItems", "from", "to", "vessel", "weight"]
  },
  bc: {
    show: ["invoiceNo", "poNo", "date", "seller", "docItems", "lcNo", "certNo", "shipDate", "vessel", "notes"],
    required: ["seller", "docItems"]
  }
};

const DOC_ENGLISH = ["seller", "sellerAddress", "buyer", "buyerAddress", "bank", "marks", "from", "to", "vessel", "terms", "payment", "delivery", "validity", "cartons", "weight", "volume", "lcNo", "blNo", "containerNo", "freight", "carrier", "cartonSize", "certNo", "buyerVat"];

function fillDocBuilderForm() {
  $("#docCurrency").innerHTML = TRADE_DATA.currencies.map((c) => `<option value="${c.code}">${c.code}</option>`).join("");
  const orderSel = $("#docOrderSelect");
  const currentOrder = orderSel.value;
  orderSel.innerHTML = `<option value="">手动填写</option>` + state.orders.map((o) => `<option value="${o.id}">${esc(o.poNo)} · ${esc(o.clientName)}</option>`).join("");
  if (currentOrder && state.orders.some((o) => o.id === currentOrder)) orderSel.value = currentOrder;
  const d = state.docBuilder || {};
  $("#docInvoiceNo").value = d.invoiceNo || "";
  $("#docPoNo").value = d.poNo || "";
  $("#docDate").value = d.date || todayISO();
  $("#docSeller").value = d.seller || state.settings.company || "";
  $("#docSellerAddress").value = d.sellerAddress || state.settings.sellerAddress || "";
  $("#docBuyer").value = d.buyer || "";
  $("#docBuyerAddress").value = d.buyerAddress || "";
  $("#docBank").value = d.bank || buildBankInfo();
  $("#docCartons").value = d.cartons || "";
  $("#docCurrency").value = d.currency || "USD";
  const docTermsVal = d.terms || state.settings.defaultIncoterm || "";
  const termsEl = $("#docTerms");
  if (termsEl) {
    termsEl.innerHTML = TRADE_DATA.incoterms.map((t) => `<option ${t.code === docTermsVal ? "selected" : ""}>${t.code}</option>`).join("")
      + (docTermsVal && !TRADE_DATA.incoterms.some((t) => t.code === docTermsVal) ? `<option selected>${esc(docTermsVal)}</option>` : "");
    termsEl.value = docTermsVal;
  }
  fillPaymentSelect($("#docPayment"), d.payment || state.settings.defaultPayment);
  $("#docDelivery").value = d.delivery || state.settings.defaultDelivery || "";
  $("#docValidity").value = d.validity || state.settings.defaultValidity || "";
  $("#docFrom").value = d.from || "";
  $("#docTo").value = d.to || "";
  $("#docVessel").value = d.vessel || "";
  $("#docMarks").value = d.marks || "";
  $("#docWeight").value = d.weight || "";
  $("#docVolume").value = d.volume || "";
  $("#docShipDate").value = d.shipDate || "";
  $("#docEta").value = d.eta || "";
  $("#docNotes").value = d.notes || "";
  $("#docLcNo").value = d.lcNo || "";
  $("#docBlNo").value = d.blNo || "";
  $("#docContainerNo").value = d.containerNo || "";
  $("#docFreight").value = d.freight || "";
  $("#docCarrier").value = d.carrier || "";
  $("#docCartonSize").value = d.cartonSize || "";
  $("#docCertNo").value = d.certNo || "";
  $("#docBuyerVat").value = d.buyerVat || "";
  renderDocItems();
}

function fillDocFromOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const client = state.clients.find((c) => c.id === o.clientId);
  const product = state.products.find((p) => (o.product || "").includes(p.model) || (o.product || "").includes(p.name));
  const ports = (o.port || "").split(/[→\->]+/).map((s) => s.trim()).filter(Boolean);
  const qty = Number(o.qty) || 0;
  const cartons = product && product.qtyPerCarton ? Math.ceil(qty / product.qtyPerCarton) : "";
  const cartonCbm = product && product.cartonL && product.cartonW && product.cartonH ? ((product.cartonL * product.cartonW * product.cartonH) / 1000000).toFixed(2) : "";
  const volume = product && cartons ? (Number(cartonCbm) * cartons).toFixed(2) : "";
  const weight = product && cartons ? (product.cartonWeight * cartons).toFixed(1) : "";
  $("#docPoNo").value = o.poNo || "";
  $("#docBuyer").value = client ? client.company || client.name : o.clientName || "";
  // 订单多产品明细 → 单证多行货物
  const orderItems = (Array.isArray(o.items) && o.items.length) ? o.items
    : (o.product ? [{ name: o.product, hs: product ? product.hsCode : "", qty: o.qty ? String(o.qty) : "", unitPrice: qty && o.amount ? (o.amount / qty).toFixed(2) : "" }] : []);
  if (!Array.isArray(state.docBuilder.docItems)) state.docBuilder.docItems = [];
  state.docBuilder.docItems = orderItems.map((it) => ({
    desc: it.name || "",
    hs: it.hs || "",
    qty: it.qty ? String(it.qty).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "",
    unitPrice: it.unitPrice || ""
  }));
  renderDocItems();
  $("#docCartons").value = cartons ? String(cartons) : "";
  $("#docCurrency").value = o.currency || "USD";
  const tEl = $("#docTerms");
  if (tEl && o.incoterm && !TRADE_DATA.incoterms.some((t) => t.code === o.incoterm)) {
    tEl.insertAdjacentHTML("beforeend", `<option value="${esc(o.incoterm)}" selected>${esc(o.incoterm)}</option>`);
  }
  $("#docTerms").value = o.incoterm || "";
  fillPaymentSelect($("#docPayment"), o.payment || "");
  $("#docFrom").value = ports[0] || "";
  $("#docTo").value = ports[1] || "";
  $("#docVessel").value = "";
  $("#docWeight").value = weight;
  $("#docVolume").value = volume;
  $("#docShipDate").value = "";
  $("#docEta").value = o.deliveryDate || "";
  if (!$("#docDate").value) $("#docDate").value = todayISO();
  collectDocData();
  updateDocRequiredMarks();
  updateDocFieldHint();
  toast("已从订单带入单证信息");
}

function collectDocData() {
  const data = {};
  DOC_BUILDER_FIELDS.forEach((f) => {
    const el = $(`#doc${f[0].toUpperCase()}${f.slice(1)}`);
    if (el) data[f] = el.value.trim();
  });
  const items = collectDocItems();
  data.docItems = items;
  data.amount = fmt(updateDocTotal(), 2);
  // 兼容旧字段：把第一行货物同步到 product/hs/qty/unitPrice，供模板/PDF 使用
  const first = items[0] || {};
  data.product = first.desc || "";
  data.hs = first.hs || "";
  data.qty = first.qty || "";
  data.unitPrice = first.unitPrice || "";
  state.docBuilder = data;
  saveState();
  return data;
}

function parseQty(v) {
  const m = String(v || "").match(/\d[\d,.]*/);
  return m ? Number(m[0].replace(/,/g, "")) || 0 : 0;
}

function docItemAmount(it) {
  const p = Number(it.unitPrice);
  return p ? parseQty(it.qty) * p : 0;
}

function renderDocItems() {
  const items = Array.isArray(state.docBuilder.docItems) ? state.docBuilder.docItems : [];
  $("#docItemsTable tbody").innerHTML = items.length ? items.map((it, i) => `
    <tr class="doc-item-row" data-i="${i}">
      <td><input class="di-desc" value="${esc(it.desc || "")}" placeholder="输入型号/品名选产品（自动填英文名）"></td>
      <td><input class="di-hs" value="${esc(it.hs || "")}" placeholder="9405.42"></td>
      <td><input class="di-qty" value="${esc(it.qty || "")}" placeholder="1,000 pcs"></td>
      <td><input class="di-price" type="number" step="0.01" value="${it.unitPrice ?? ""}" placeholder="3.85"></td>
      <td class="di-amount">${fmt(docItemAmount(it), 2)}</td>
      <td><div class="actions"><button class="icon-btn js-del-doc-item" data-i="${i}" title="删除"><i data-lucide="trash-2"></i></button></div></td>
    </tr>`).join("") : `<tr><td colspan="6" class="empty-state">暂无货物，点击“新增一行”添加</td></tr>`;
  updateDocTotal();
  attachHsAutocompletes();
  attachDocProductDropdowns();
  updateDocEnMarks();
  refreshIcons();
}

// 单证货物名称：像订单一样从产品库选择，但只填英文名（无英文名时用型号/品名兜底）
function attachDocProductDropdowns() {
  $$("#docItemsTable .di-desc").forEach((input) => {
    if (input.dataset.docDd) return;
    input.dataset.docDd = "1";
    attachProductDropdown(input, (inp, p) => {
      // 单证货物描述取产品管理的英文名；无英文名时用型号/品名兜底并提示补充
      inp.value = p.nameEn || p.model || p.name;
      if (!p.nameEn) {
        toast(`产品「${p.name}」未填英文名，已用型号/品名代替，建议到产品管理补充英文名。`);
      }
      const hs = inp.closest("tr").querySelector(".di-hs");
      if (hs) hs.value = p.hsCode || "";
    });
  });
}

function collectDocItems() {
  const rows = $$("#docItemsTable tbody tr");
  const list = rows.map((tr) => {
    const qty = tr.querySelector(".di-qty")?.value.trim() || "";
    const unitPrice = tr.querySelector(".di-price")?.value || "";
    return {
      desc: tr.querySelector(".di-desc")?.value.trim() || "",
      hs: tr.querySelector(".di-hs")?.value.trim() || "",
      qty,
      unitPrice,
      amount: docItemAmount({ qty, unitPrice })
    };
  });
  if (!Array.isArray(state.docBuilder.docItems)) state.docBuilder.docItems = [];
  state.docBuilder.docItems = list;
  return list;
}

function updateDocTotal() {
  const items = Array.isArray(state.docBuilder.docItems) ? state.docBuilder.docItems : [];
  const total = items.reduce((s, it) => s + docItemAmount(it), 0);
  const el = $("#docTotalDisplay");
  if (el) el.textContent = fmt(total, 2);
  return total;
}

function addDocItem() {
  // 先把当前表格已输入的行同步进 state，再追加空行，避免重建表格时丢失已填内容
  collectDocItems();
  state.docBuilder.docItems.push({ desc: "", hs: "", qty: "", unitPrice: "" });
  renderDocItems();
  saveState();
}

function wrapDocInputs() {
  $$("#section-docs [data-doc-field] input, #section-docs [data-doc-field] select, #section-docs [data-doc-field] textarea").forEach((el) => {
    if (el.closest(".doc-items-wrap") || el.closest(".input-box")) return;
    const box = document.createElement("div");
    box.className = "input-box";
    el.parentNode.insertBefore(box, el);
    box.appendChild(el);
  });
}

function applyDocFieldVisibility() {
  const cfg = DOC_FIELDS[$("#docGenType").value] || DOC_FIELDS.pi;
  $$("#section-docs [data-doc-field]").forEach((el) => {
    const visible = cfg.show.includes(el.dataset.docField);
    el.classList.toggle("doc-field-hidden", !visible);
  });
}

function updateDocRequiredMarks() {
  const cfg = DOC_FIELDS[$("#docGenType").value] || DOC_FIELDS.pi;
  $$("#section-docs [data-doc-field]").forEach((el) => {
    const field = el.dataset.docField;
    const isReq = cfg.required.includes(field);
    const hidden = el.classList.contains("doc-field-hidden");
    if (field === "docItems") {
      const hasItem = Array.from(el.querySelectorAll(".di-desc")).some((i) => i.value.trim());
      el.classList.toggle("field-required", isReq && !hidden);
      el.classList.toggle("field-optional", !isReq);
      el.classList.toggle("field-missing", isReq && !hidden && !hasItem);
      let mark = el.querySelector(":scope > .req-mark");
      if (isReq && !hidden && !hasItem && !mark) {
        mark = document.createElement("span");
        mark.className = "req-mark";
        mark.textContent = "!";
        el.appendChild(mark);
      }
      if ((!isReq || hidden || hasItem) && mark) mark.remove();
      return;
    }
    const input = el.querySelector("input, select, textarea");
    if (!input) return;
    const isEmpty = !input.value.trim();
    el.classList.toggle("field-required", isReq && !hidden);
    el.classList.toggle("field-optional", !isReq);
    el.classList.toggle("field-missing", isReq && !hidden && isEmpty);
    const box = input.closest(".input-box") || el;
    let mark = box.querySelector(".req-mark");
    if (isReq && !hidden && isEmpty && !mark) {
      mark = document.createElement("span");
      mark.className = "req-mark";
      mark.textContent = "!";
      box.appendChild(mark);
    }
    if ((!isReq || hidden || !isEmpty) && mark) mark.remove();
  });
}

function updateDocFieldHint() {
  const type = $("#docGenType").value;
  const cfg = DOC_FIELDS[type] || DOC_FIELDS.pi;
  const required = cfg.required.map((f) => DOC_FIELD_LABELS[f] || f).join("、");
  const enList = cfg.show.filter((f) => DOC_ENGLISH.includes(f)).map((f) => DOC_FIELD_LABELS[f] || f).join("、");
  const hint = $("#docFieldHint");
  if (hint) hint.textContent = `本单据必填：${required}。单证内容需全英文，请用英文填写：${enList}。`;
}

// —— 单证全英文校验 ——
// 检测常见非英文字符（中日韩、阿拉伯、西里尔、泰文、天城文等）
function hasNonEnglish(str) {
  return /[一-鿿぀-ヿ가-힯؀-ۿЀ-ӿ฀-๿ऀ-ॿ]/.test(String(str || ""));
}

// 收集数据中所有含非英文字符的字段（用于预览/生成前拦截）
function docEnIssues(data) {
  const list = [];
  const push = (label, val) => { if (hasNonEnglish(val)) list.push(label); };
  const d = data || {};
  push("卖方", d.seller); push("卖方地址", d.sellerAddress);
  push("买方", d.buyer); push("买方地址", d.buyerAddress);
  push("银行信息", d.bank); push("唛头", d.marks);
  push("起运港", d.from); push("目的港", d.to);
  push("船名/航班", d.vessel); push("贸易条款", d.terms);
  push("付款方式", d.payment); push("L/C 号", d.lcNo);
  push("提单/运单号", d.blNo); push("集装箱/铅封号", d.containerNo);
  push("运费条款", d.freight); push("承运人", d.carrier);
  push("箱规", d.cartonSize); push("证书号", d.certNo);
  push("买方税号", d.buyerVat); push("备注", d.notes);
  push("交期", d.delivery); push("有效期", d.validity);
  push("箱数", d.cartons); push("毛重/净重", d.weight); push("体积", d.volume);
  (Array.isArray(d.docItems) ? d.docItems : []).forEach((it, i) => {
    if (hasNonEnglish(it.desc)) list.push(`货物明细第 ${i + 1} 行描述`);
  });
  return list;
}

// 预览/生成前英文检查：含非英文字符则拦截并提示
function assertDocEnglish(data) {
  const issues = docEnIssues(data);
  if (!issues.length) return true;
  updateDocEnMarks();
  toast(`单证需全英文，以下内容含非英文字符：${issues.join("、")}`);
  return false;
}

// 填写时实时英文标记：英文字段含非英文字符时给输入框加红色警示
function updateDocEnMarks() {
  $$("#section-docs [data-doc-field]").forEach((el) => {
    const field = el.dataset.docField;
    const isEnField = DOC_ENGLISH.includes(field) || field === "notes";
    const input = field === "docItems" ? null : el.querySelector("input, textarea");
    if (!input) return;
    const bad = isEnField && hasNonEnglish(input.value);
    el.classList.toggle("field-en-warn", bad);
    const box = input.closest(".input-box") || el;
    let mark = box.querySelector(".en-mark");
    if (bad && !mark) {
      mark = document.createElement("span");
      mark.className = "en-mark";
      mark.textContent = "需英文";
      box.appendChild(mark);
    }
    if (!bad && mark) mark.remove();
  });
  $$("#docItemsTable .di-desc").forEach((inp) => {
    inp.closest("tr")?.classList.toggle("row-en-warn", hasNonEnglish(inp.value));
  });
}

function docMissingRequired(type, data) {
  const cfg = DOC_FIELDS[type] || DOC_FIELDS.pi;
  const items = Array.isArray(data.docItems) ? data.docItems : [];
  const missing = [];
  cfg.required.forEach((f) => {
    if (f === "docItems") {
      if (!items.some((it) => (it.desc || "").trim())) missing.push("docItems");
    } else if (!String(data[f] || "").trim()) missing.push(f);
  });
  return missing;
}

function focusDocField(field) {
  if (field === "docItems") {
    const el = document.querySelector("#docItemsTable .di-desc");
    if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    return;
  }
  const el = document.getElementById("doc" + field[0].toUpperCase() + field.slice(1));
  if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
}

// —— 金额大写（英文发票用语）——
const NUM_WORDS_ONES = ["ZERO","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN"];
const NUM_WORDS_TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
const NUM_WORDS_UNITS = ["", " THOUSAND", " MILLION", " BILLION", " TRILLION"];
const CURRENCY_WORDS = { USD: "US DOLLARS", EUR: "EUROS", CNY: "RENMINBI", GBP: "POUNDS STERLING", JPY: "JAPANESE YEN", AUD: "AUSTRALIAN DOLLARS", CAD: "CANADIAN DOLLARS", HKD: "HONG KONG DOLLARS", SGD: "SINGAPORE DOLLARS", KRW: "KOREAN WON", INR: "INDIAN RUPEES", RUB: "RUSSIAN ROUBLES", BRL: "BRAZILIAN REAIS", MXN: "MEXICAN PESOS", AED: "UAE DIRHAMS", TRY: "TURKISH LIRA", THB: "THAI BAHT", VND: "VIETNAMESE DONG", IDR: "INDONESIAN RUPIAH", MYR: "MALAYSIAN RINGGIT", PHP: "PHILIPPINE PESOS", ZAR: "SOUTH AFRICAN RAND" };

function numToWords(n) {
  n = Math.floor(Math.abs(n));
  if (!n) return "ZERO";
  const three = (x) => {
    const parts = [];
    const h = Math.floor(x / 100);
    const r = x % 100;
    if (h) parts.push(NUM_WORDS_ONES[h] + " HUNDRED");
    if (r >= 20) parts.push(NUM_WORDS_TENS[Math.floor(r / 10)] + (r % 10 ? "-" + NUM_WORDS_ONES[r % 10] : ""));
    else if (r) parts.push(NUM_WORDS_ONES[r]);
    return parts.join(" ");
  };
  const groups = [];
  let unit = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) groups.push(three(chunk) + NUM_WORDS_UNITS[unit]);
    n = Math.floor(n / 1000);
    unit++;
  }
  return groups.reverse().join(" ");
}

function amountInWords(amount, currency) {
  const cur = CURRENCY_WORDS[currency] || currency + " CURRENCY";
  const abs = Math.abs(Number(amount) || 0);
  const major = Math.floor(abs);
  const cents = Math.round((abs - major) * 100);
  const centsWords = cents ? ` AND ${cents}/100` : "";
  return `SAY ${cur} ${numToWords(major)}${centsWords} ONLY`;
}

// —— 发票号自动递增 ——
function nextInvoiceNo() {
  const prefix = (state.settings.invoicePrefix || "INV").trim() || "INV";
  const n = (Number(state.docCounter) || 0) + 1;
  state.docCounter = n;
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${String(n).padStart(3, "0")}`;
}

function buildBankInfo() {
  const s = state.settings;
  const lines = [];
  if (s.bankName) lines.push(`Bank: ${s.bankName}`);
  if (s.bankAccount) lines.push(`Account: ${s.bankAccount}`);
  if (s.bankSwift) lines.push(`SWIFT: ${s.bankSwift}`);
  if (s.bankAddress) lines.push(`Address: ${s.bankAddress}`);
  return lines.join("\n");
}

function renderDocs() {
  fillDocBuilderForm();
  const mode = $("#docMode").value;
  const items = TRADE_DATA.docChecklist[mode] || [];
  const saved = state.checklist[mode] || [];
  $("#docChecklist").innerHTML = items.map((item, i) => {
    const gen = item.gen && DOC_GENERATORS[item.gen] ? `<button type="button" class="btn ghost js-doc-pdf" data-gen="${item.gen}" title="生成 ${esc(item.title)} PDF"><i data-lucide="file-down"></i><span>PDF</span></button>` : "";
    return `<div class="check-item ${saved[i] ? "done" : ""}">
      <label class="check-hit"><input type="checkbox" data-doc-i="${i}" ${saved[i] ? "checked" : ""}><span class="check-main"><span class="check-title">${esc(item.title)}</span><span class="check-desc">${esc(item.desc)}</span><span class="doc-meta">${esc(item.phase || "")} · ${esc(item.owner || "")} · ${esc(item.when || "")} · ${esc(item.purpose || "")}</span></span></label>
      ${gen}
    </div>`;
  }).join("") || `<div class="empty-state">暂无清单</div>`;
  const done = saved.filter(Boolean).length;
  $("#docProgress").style.width = `${items.length ? (done / items.length) * 100 : 0}%`;
  $("#docProgressText").textContent = `已完成 ${done} / ${items.length}`;
  wrapDocInputs();
  applyDocFieldVisibility();
  updateDocRequiredMarks();
  updateDocFieldHint();
  updateDocEnMarks();
  renderDocHistory();
  refreshIcons();
}

function saveDocCheck() {
  const mode = $("#docMode").value;
  const items = TRADE_DATA.docChecklist[mode] || [];
  const saved = items.map((item, i) => Boolean($(`#docChecklist input[data-doc-i="${i}"]`)?.checked));
  state.checklist[mode] = saved;
  saveState();
  renderDocs();
}

function docText(type, data) {
  const company = data.seller || state.settings.company || "[Your Company]";
  const sales = state.settings.sales || "[Sales]";
  const buyer = data.buyer || "[Buyer]";
  const date = data.date || todayISO();
  const currency = data.currency || "USD";
  const amount = data.amount || "0.00";
  const amountWords = amountInWords(Number(String(amount).replace(/,/g, "")) || 0, currency);
  const invNo = data.invoiceNo || "INV-" + Date.now().toString().slice(-6);
  const items = Array.isArray(data.docItems) && data.docItems.length ? data.docItems : [];
  const goodsLines = items.length ? items.map((it, i) => `${i + 1}. ${it.desc || "[Product]"}  | HS: ${it.hs || "-"}  | Qty: ${it.qty || "-"}  | Unit: ${currency} ${it.unitPrice || "-"}  | Amount: ${currency} ${fmt(docItemAmount(it), 2)}`).join("\n") : "1. [Product]  | HS: -  | Qty: -  | Unit: -  | Amount: -";
  const cartonCount = (String(data.cartons || "").match(/\d[\d,.]*/) || [""])[0] || "-";
  const w = String(data.weight || "").split("/").map((s) => s.trim());
  const grossW = w[0] || "-";
  const netW = w[1] || "-";
  const volume = (String(data.volume || "").match(/\d[\d,.]*/) || [""])[0] || "-";
  const contact = [state.settings.email, state.settings.phone].filter(Boolean).join("  |  ");
  const head = `${company}${data.sellerAddress ? "\n" + data.sellerAddress : ""}${contact ? "\n" + contact : ""}`;
  const meta = `No.: ${invNo}\nDate: ${date}\nPO No.: ${data.poNo || "-"}`;
  const parties = `SELLER:\n${company}\n${data.sellerAddress || "-"}\n\nBUYER:\n${buyer}\n${data.buyerAddress || "-"}`;
  const goods = `GOODS:\n${goodsLines}\n\nTOTAL: ${currency} ${amount}\n${amountWords}`;
  const ship = `Incoterm: ${data.terms || "-"}\nPayment: ${data.payment || "-"}\nDelivery: ${data.delivery || "-"}\nValidity: ${data.validity || "-"}\nPort of Loading: ${data.from || "-"}\nPort of Discharge: ${data.to || "-"}\nVessel / Flight: ${data.vessel || "-"}\nShip Date: ${data.shipDate || "-"}\nETA: ${data.eta || "-"}\nMarks: ${data.marks || "N/M"}`;
  if (type === "ci") return `COMMERCIAL INVOICE\n${head}\n\n${meta}\n\n${parties}\n\nCountry of Origin: People's Republic of China\nL/C No.: ${data.lcNo || "-"}\n\n${goods}\n\n${ship}\n\nRemarks: ${data.notes || "-"}\n\nBANK DETAILS:\n${data.bank || "-"}\n\nE. & O.E. — We hereby certify that the goods are of People's Republic of China origin and the value stated is true and correct.\n\nFor and on behalf of ${company}\n\n${sales}\nAuthorized Signature / Date: ______________`;
  if (type === "pi") return `PROFORMA INVOICE (For confirmation purposes only)\n${head}\n\n${meta}\nValidity: ${data.validity || "15 days"}\n\n${parties}\n\n${goods}\n\n${ship}\n\nTERMS & CONDITIONS:\n1. Payment: ${data.payment || "-"}\n2. Delivery: ${data.delivery || "-"}\n3. This proforma invoice is valid for ${data.validity || "15 days"} from the date of issue.\n4. Goods once sold are not returnable without prior written consent.\n5. All banking charges outside China are for the account of the buyer.\n\nBANK DETAILS:\n${data.bank || "-"}\n\nFor and on behalf of ${company}\n\n${sales}\nAuthorized Signature / Date: ______________`;
  if (type === "pl") return `PACKING LIST\n${head}\n\n${meta}\n\n${parties}\n\nTotal Cartons: ${cartonCount}\nGross Weight: ${grossW} KGS\nNet Weight: ${netW} KGS\nMeasurement: ${volume} CBM\n\n${goods}\n\nPort of Loading: ${data.from || "-"}\nPort of Discharge: ${data.to || "-"}\nVessel / Flight: ${data.vessel || "-"}\n\nSHIPPING MARKS:\n${data.marks || "N/M"}\n\nRemarks: ${data.notes || "-"}\n\nFor and on behalf of ${company}\n\n${sales}\nAuthorized Signature / Date: ______________`;
  if (type === "sa") return `SHIPPING ADVICE\n${head}\n\n${meta}\n\nDear Sirs / Madams,\n\nWe are pleased to advise you that the following shipment has been dispatched on ${data.shipDate || "-"} in accordance with the terms and conditions of your order. Please arrange insurance and delivery accordingly.\n\nB/L or AWB No.: ${data.blNo || "-"}\nContainer / Seal No.: ${data.containerNo || "-"}\n${ship}\n\n${goods}\n\nContact / Tracking: ${contact || "-"}\n\nBest regards,\n${company}\n${sales}`;
  if (type === "co") return `CERTIFICATE OF ORIGIN (NON-PREFERENTIAL — SELF-ISSUED FOR REFERENCE)\nCertificate No.: ${data.certNo || "________"}\nDate: ${date}\n\nExporter: ${company}\n${data.sellerAddress || "-"}\n\nConsignee: ${buyer}\n${data.buyerAddress || "-"}\n\nCountry of Origin: People's Republic of China\nCountry of Destination: ${data.to || "-"}\nNumber and kind of packages: ${cartonCount} CTNS · Gross weight: ${grossW} KGS\nTransport Route: By sea, from ${data.from || "-"} to ${data.to || "-"}\nMarks & Numbers: ${data.marks || "N/M"}\n\n${goods}\n\nDeclaration by the Exporter:\nThe undersigned hereby declares that the above details and statements are correct; that all the goods were produced in the People's Republic of China and that they comply with the Rules of Origin of the People's Republic of China.\n\nCertification:\nIt is hereby certified that the declaration by the exporter is correct.\n\nNote: For preferential origin (RCEP/ASEAN/China-Australia FTA) or customs-recognized certificates, please obtain from CCPIT / the competent issuing authority.\n\nFor and on behalf of ${company}\n\n${sales}\nAuthorized Signature & Company Stamp / Date: ______________`;
  if (type === "bl") return `DRAFT BILL OF LADING (FOR REFERENCE ONLY — NOT A NEGOTIABLE DOCUMENT)\n${head}\n\nB/L No.: ${data.blNo || "-"}\nDate: ${date}\n\nShipper:\n${company}\n${data.sellerAddress || "-"}\n\nConsignee:\n${buyer}\n${data.buyerAddress || "-"}\n\nNotify Party:\n${buyer}\n${data.buyerAddress || "-"}\n\nVessel / Voyage: ${data.vessel || "-"}\nPort of Loading: ${data.from || "-"}\nPort of Discharge: ${data.to || "-"}\nContainer / Seal No.: ${data.containerNo || "-"}\nMarks & Numbers: ${data.marks || "N/M"}\n\n${goods}\n\nTotal Packages: ${cartonCount}\nGross Weight: ${grossW} KGS\nMeasurement: ${volume} CBM\nFreight: ${data.freight || "FREIGHT COLLECT / PREPAID"}\n\nRemarks: ${data.notes || "-"}\n\nFor the Carrier / its Agent: ${data.carrier || "________________"}\n\n${sales}\nPlace and Date of Issue: ______________`;
  if (type === "awb") return `DRAFT AIR WAYBILL (FOR REFERENCE ONLY — NOT NEGOTIABLE)\n${head}\n\nAWB No.: ${data.blNo || "-"}\nDate: ${date}\n\nShipper:\n${company}\n${data.sellerAddress || "-"}\n\nConsignee:\n${buyer}\n${data.buyerAddress || "-"}\n\nAirport of Departure: ${data.from || "-"}\nAirport of Arrival: ${data.to || "-"}\nFlight No. / Date: ${data.vessel || "-"}\nHandling Information: ${data.notes || "-"}\nDeclared Value for Carriage: NVD\nDeclared Value for Customs: NVD\nMarks & Numbers: ${data.marks || "N/M"}\n\n${goods}\n\nTotal Pieces: ${cartonCount}\nGross Weight: ${grossW} KGS\nChargeable Weight: ${grossW} KGS\nFreight: ${data.freight || "FREIGHT COLLECT / PREPAID"}\n\nThis Air Waybill is not negotiable. Original 1 — for Carrier, Original 2 — for Consignee, Original 3 — for Shipper.\n\nSignature of Shipper or His Agent: ${company}\nSignature of Issuing Carrier or Its Agent: ${data.carrier || "________________"}\n\n${sales}\nIssued on / Date: ______________`;
  if (type === "bc") return `BENEFICIARY CERTIFICATE\n${head}\n\nNo.: ${data.certNo || data.invoiceNo || "-"}\nDate: ${date}\n\nWe, ${company}, hereby certify that the goods covered by our Invoice No. ${invNo} under L/C No. ${data.lcNo || "-"} and Purchase Order No. ${data.poNo || "-"} have been shipped on board ${data.vessel || "-"} from ${data.from || "-"} to ${data.to || "-"} on ${data.shipDate || "-"} in accordance with the terms and conditions of the above letter of credit.\nThis certificate is issued in one original for presentation under the above letter of credit.\n\nShip Date: ${data.shipDate || "-"}\nVessel / Flight: ${data.vessel || "-"}\n\n${goods}\n\nAdditional Certification:\n${data.notes || "-"}\n\nFor and on behalf of ${company}\n\n${sales}\nAuthorized Signature / Date: ______________`;
  return "";
}

function genDoc() {
  const type = $("#docGenType").value;
  const data = collectDocData();
  const missing = docMissingRequired(type, data);
  if (missing.length) {
    toast(`请先填写必填项：${missing.map((f) => DOC_FIELD_LABELS[f] || f).join("、")}`);
    focusDocField(missing[0]);
    return;
  }
  if (!assertDocEnglish(data)) return;
  if (!data.invoiceNo) {
    data.invoiceNo = nextInvoiceNo();
    $("#docInvoiceNo").value = data.invoiceNo;
    collectDocData();
  }
  const text = docText(type, data);
  if (!text) { toast("暂不支持该单据类型"); return; }
  $("#docOutput").value = text;
  toast("文本预览已生成");
}

function printDoc() {
  const type = $("#docGenType").value;
  const data = collectDocData();
  const missing = docMissingRequired(type, data);
  if (missing.length) {
    toast(`请先填写必填项：${missing.map((f) => DOC_FIELD_LABELS[f] || f).join("、")}`);
    focusDocField(missing[0]);
    return;
  }
  if (!assertDocEnglish(data)) return;
  addDocHistory(type, data);
  const html = renderDocTemplate(type, data);
  const win = window.open("", "_blank", "width=900,height=1200");
  if (!win) { toast("浏览器拦截了弹窗，请允许后重试"); return; }
  // 只消毒模板内容，保留静态的 <head>/<style>@page A4</style>（否则打印会被裁成非 A4）
  win.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(DOC_GENERATORS[type].name)}</title><style>@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; } .doc-tpl { height: auto !important; min-height: 1123px; }</style></head><body>${sanitizeHtml(html)}</body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch (err) { /* ignore */ } }, 350);
}

function pdfInstance() {
  if (!window.jspdf || !window.jspdf.jsPDF) { toast("PDF 组件未加载，请刷新页面"); return null; }
  return new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
}

function pdfHeader(doc, title, subtitle) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(24, 41, 62);
  doc.rect(0, 0, w, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(title, w / 2, 12, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(subtitle || "", w / 2, 20, { align: "center" });
  doc.setTextColor(28, 38, 48);
  doc.setDrawColor(185, 195, 205);
  doc.line(15, 32, w - 15, 32);
  return 38;
}

function pdfField(doc, y, label, value, xLabel = 15, xValue = 52, maxW = 143) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(110, 120, 130);
  doc.text(label, xLabel, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(25, 35, 45);
  const lines = doc.splitTextToSize(String(value || "-"), maxW);
  doc.text(lines, xValue, y);
  return y + 5 + (lines.length - 1) * 4.5;
}

function pdfTable(doc, y, headers, row) {
  const w = doc.internal.pageSize.getWidth();
  const x0 = 15;
  const widths = [72, 20, 28, 26, 34];
  const rowH = 8;
  const totalW = widths.reduce((a, b) => a + b, 0);
  doc.setFillColor(235, 240, 245);
  doc.rect(x0, y - 5.5, totalW, rowH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  let cx = x0;
  headers.forEach((h, i) => {
    doc.text(h, cx + 2, y, { maxWidth: widths[i] - 4 });
    cx += widths[i];
  });
  doc.setFont("helvetica", "normal");
  y += rowH;
  cx = x0;
  row.forEach((cell, i) => {
    doc.text(String(cell || "-"), cx + 2, y, { maxWidth: widths[i] - 4 });
    cx += widths[i];
  });
  doc.setDrawColor(185, 195, 205);
  doc.rect(x0, y - 5.5, totalW, rowH, "S");
  doc.line(x0, y + 2.5, x0 + totalW, y + 2.5);
  return y + 7;
}

function pdfGoodsTable(doc, y, items, currency) {
  const w = doc.internal.pageSize.getWidth();
  const x0 = 15;
  const widths = [9, 57, 20, 30, 27, 32];
  const rowH = 8;
  const totalW = widths.reduce((a, b) => a + b, 0);
  const headers = ["No.", "Description", "HS Code", "Quantity", "Unit Price", "Amount"];
  const list = (items && items.length ? items : [{}]);
  doc.setFillColor(235, 240, 245);
  doc.rect(x0, y - 5.5, totalW, rowH, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  let cx = x0;
  headers.forEach((h, i) => { doc.text(h, cx + 1.5, y, { maxWidth: widths[i] - 3 }); cx += widths[i]; });
  doc.setFont("helvetica", "normal");
  doc.setDrawColor(185, 195, 205);
  doc.rect(x0, y - 5.5, totalW, rowH, "S");
  y += rowH;
  list.forEach((it, idx) => {
    const amt = docItemAmount(it);
    const row = [String(idx + 1), it.desc || "-", it.hs || "-", it.qty || "-", currency + " " + (Number(it.unitPrice) || "-"), currency + " " + fmt(amt, 2)];
    cx = x0;
    row.forEach((cell, i) => { doc.text(String(cell), cx + 1.5, y, { maxWidth: widths[i] - 3 }); cx += widths[i]; });
    doc.rect(x0, y - 5.5, totalW, rowH, "S");
    y += rowH;
  });
  const total = list.reduce((s, it) => s + docItemAmount(it), 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(`Total: ${currency} ${fmt(total, 2)}`, w - 15, y + 4, { align: "right" });
  return y + 8;
}

function pdfSignature(doc, y, label) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(25, 35, 45);
  doc.text(label + ": ______________________", 15, y);
  return y + 7;
}

function pdfFooter(doc) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(135, 145, 155);
    doc.text(`Generated by Trade Toolbox | Page ${i} / ${pages}`, w - 15, h - 8, { align: "right" });
  }
}

function drawPdfDocument(doc, type, data) {
  const company = data.seller || state.settings.company || "[Your Company]";
  const buyer = data.buyer || "[Buyer]";
  const currency = data.currency || "USD";
  const date = data.date || todayISO();
  const invNo = data.invoiceNo || "INV-" + Date.now().toString().slice(-6);
  let y;
  if (type === "pi" || type === "ci") {
    y = pdfHeader(doc, type === "pi" ? "PROFORMA INVOICE" : "COMMERCIAL INVOICE", `${invNo}  |  PO: ${data.poNo || "-"}  |  Date: ${date}`);
    y = pdfField(doc, y, "Seller", company);
    y = pdfField(doc, y, "Seller Address", data.sellerAddress);
    y = pdfField(doc, y, "Buyer", buyer);
    y = pdfField(doc, y, "Buyer Address", data.buyerAddress);
    y = pdfField(doc, y, "Invoice No.", invNo);
    y = pdfField(doc, y, "PO No.", data.poNo);
    y = pdfField(doc, y, "Terms", data.terms);
    y = pdfField(doc, y, "Payment", data.payment);
    y += 3;
    y = pdfGoodsTable(doc, y, data.docItems, currency);
    y = pdfField(doc, y, "Amount in Words", amountInWords(Number(String(data.amount || "").replace(/,/g, "")) || 0, currency));
    y = pdfField(doc, y, "Marks", data.marks);
    y = pdfField(doc, y, "Bank Details", data.bank || "-");
    y = pdfField(doc, y, "Loading", data.from);
    y = pdfField(doc, y, "Discharge", data.to);
    y = pdfField(doc, y, "Vessel / Flight", data.vessel);
    y = pdfField(doc, y, "Ship Date", data.shipDate);
    y = pdfField(doc, y, "ETA", data.eta);
    y = pdfField(doc, y, "Remarks", data.notes);
    y += 6;
    pdfSignature(doc, y, "Prepared by");
  } else if (type === "pl") {
    y = pdfHeader(doc, "PACKING LIST", `${invNo}  |  PO: ${data.poNo || "-"}  |  Date: ${date}`);
    y = pdfField(doc, y, "Seller", company);
    y = pdfField(doc, y, "Buyer", buyer);
    y = pdfField(doc, y, "Buyer Address", data.buyerAddress);
    y = pdfField(doc, y, "Invoice No.", invNo);
    y = pdfField(doc, y, "PO No.", data.poNo);
    y += 3;
    y = pdfGoodsTable(doc, y, data.docItems, currency);
    y = pdfField(doc, y, "Cartons", data.cartons);
    y = pdfField(doc, y, "Gross / Net Weight", data.weight);
    y = pdfField(doc, y, "Volume", data.volume);
    y = pdfField(doc, y, "Marks", data.marks);
    y = pdfField(doc, y, "Loading", data.from);
    y = pdfField(doc, y, "Discharge", data.to);
    y = pdfField(doc, y, "Vessel / Flight", data.vessel);
    y = pdfField(doc, y, "Remarks", data.notes);
    y += 6;
    pdfSignature(doc, y, "Prepared by");
  } else if (type === "sa") {
    y = pdfHeader(doc, "SHIPPING ADVICE", `PO: ${data.poNo || "-"}  |  Date: ${date}`);
    y = pdfField(doc, y, "To", buyer);
    y = pdfField(doc, y, "From", company);
    y = pdfField(doc, y, "Invoice No.", invNo);
    y = pdfField(doc, y, "PO No.", data.poNo);
    y = pdfField(doc, y, "Product", data.product);
    y = pdfField(doc, y, "Quantity", data.qty);
    y = pdfField(doc, y, "Total", `${currency} ${data.amount || "-"}`);
    y = pdfField(doc, y, "Incoterm", data.terms);
    y = pdfField(doc, y, "Vessel / Flight", data.vessel);
    y = pdfField(doc, y, "Loading", data.from);
    y = pdfField(doc, y, "Discharge", data.to);
    y = pdfField(doc, y, "Ship Date", data.shipDate);
    y = pdfField(doc, y, "ETA", data.eta);
    y = pdfField(doc, y, "Contact / Tracking", state.settings.phone || data.notes);
    y += 6;
    pdfSignature(doc, y, "Best regards");
  } else if (type === "co") {
    y = pdfHeader(doc, "CERTIFICATE OF ORIGIN", `Certificate No.: ${data.invoiceNo || "CO-" + Date.now().toString().slice(-6)}  |  Date: ${date}`);
    y = pdfField(doc, y, "Exporter", company);
    y = pdfField(doc, y, "Consignee", buyer);
    y = pdfField(doc, y, "Country of Origin", "People's Republic of China");
    y = pdfField(doc, y, "Transport", `${data.vessel || "-"} from ${data.from || "-"} to ${data.to || "-"}`);
    y += 3;
    y = pdfGoodsTable(doc, y, data.docItems, currency);
    y = pdfField(doc, y, "Marks", data.marks);
    y = pdfField(doc, y, "Remarks", data.notes);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Declaration: We hereby certify that the goods described above", 15, y);
    doc.text("originate in the People's Republic of China.", 15, y + 5);
    y += 12;
    pdfSignature(doc, y, "Authorized Signature");
  } else if (type === "bl") {
    y = pdfHeader(doc, "DRAFT BILL OF LADING", "For reference only - not a negotiable document");
    y = pdfField(doc, y, "Shipper", company);
    y = pdfField(doc, y, "Consignee", buyer);
    y = pdfField(doc, y, "Notify Party", buyer);
    y = pdfField(doc, y, "Vessel / Voyage", data.vessel);
    y = pdfField(doc, y, "Port of Loading", data.from);
    y = pdfField(doc, y, "Port of Discharge", data.to);
    y = pdfField(doc, y, "Marks", data.marks);
    y += 3;
    y = pdfGoodsTable(doc, y, data.docItems, currency);
    y = pdfField(doc, y, "Gross Weight", data.weight);
    y = pdfField(doc, y, "Volume", data.volume);
    y = pdfField(doc, y, "Freight Terms", data.payment || "Freight Collect / Prepaid");
    y = pdfField(doc, y, "Date", date);
    y += 6;
    pdfSignature(doc, y, "For the Carrier");
  } else if (type === "awb") {
    y = pdfHeader(doc, "DRAFT AIR WAYBILL", "For reference only - to be issued by the carrier");
    y = pdfField(doc, y, "Shipper", company);
    y = pdfField(doc, y, "Consignee", buyer);
    y = pdfField(doc, y, "Airport of Departure", data.from);
    y = pdfField(doc, y, "Airport of Arrival", data.to);
    y = pdfField(doc, y, "Flight No.", data.vessel);
    y += 3;
    y = pdfGoodsTable(doc, y, data.docItems, currency);
    y = pdfField(doc, y, "Chargeable Weight", data.weight);
    y = pdfField(doc, y, "Volume", data.volume);
    y = pdfField(doc, y, "Marks", data.marks);
    y = pdfField(doc, y, "Date", date);
    y = pdfField(doc, y, "Remarks", data.notes);
    y += 6;
    pdfSignature(doc, y, "For the Carrier");
  } else if (type === "bc") {
    y = pdfHeader(doc, "BENEFICIARY CERTIFICATE", `Date: ${date}`);
    y = pdfField(doc, y, "Issued by", company);
    y = pdfField(doc, y, "Invoice No.", invNo);
    y = pdfField(doc, y, "PO No.", data.poNo);
    y = pdfField(doc, y, "Product", data.product);
    y = pdfField(doc, y, "Quantity", data.qty);
    y = pdfField(doc, y, "Ship Date", data.shipDate);
    y = pdfField(doc, y, "Vessel / Flight", data.vessel);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(`We hereby certify that the shipment covered by Invoice No. ${invNo} for PO No. ${data.poNo || "-"} has been made in accordance with the terms and conditions of the relevant contract / letter of credit.`, 180);
    doc.text(lines, 15, y);
    y += lines.length * 5 + 8;
    pdfSignature(doc, y, "Authorized Signature");
  }
}

function docTemplateHtml(type) {
  return (state.docTemplates && state.docTemplates[type]) || buildDefaultDocTemplates()[type] || "";
}

function renderTemplateHtml(html, data) {
  const src = data || {};
  const values = { ...src };
  Object.entries(src).forEach(([key, value]) => {
    if (key && !key.startsWith("doc")) {
      values["doc" + key[0].toUpperCase() + key.slice(1)] = value;
    }
  });
  values.company = src.seller || state.settings.company || "";
  values.sales = state.settings.sales || "";
  values.email = state.settings.email || "";
  values.phone = state.settings.phone || "";
  values.contact = [values.email, values.phone].filter(Boolean).join("  ·  ");
  // 英文单据日期格式：YYYY-MM-DD → 07 Aug 2026
  values.docDate = src.date ? fmtDateEn(src.date) : values.docDate || "";
  // 运费条款（BL/AWB）：缺省展示 FREIGHT COLLECT / PREPAID 供勾选
  values.docFreight = String(src.freight || "").trim() || "FREIGHT COLLECT / PREPAID";
  // 金额与金额大写（统一千分位+两位小数，避免与行内金额格式不一致）
  const amountNum = Number(String(src.amount || "").replace(/,/g, "")) || 0;
  values.docAmount = fmt(amountNum, 2);
  values.docAmountWords = amountInWords(amountNum, src.currency || "USD");
  // 装箱/重量/体积解析（剥离用户已带的单位，由模板统一补 KGS/CBM）
  const cartonsTxt = String(src.cartons || "").trim();
  values.docCartonCount = (cartonsTxt.match(/\d[\d,.]*/) || [""])[0] || "-";
  const stripUnit = (s) => String(s || "").replace(/\s*(kg|kgs|kilograms?|kilos?|lbs?|pounds?|mt|tons?|cbm|m3|m³|g)\s*$/i, "").trim();
  const weightParts = String(src.weight || "").split("/").map((s) => stripUnit(s));
  values.docGrossWeight = weightParts[0] || "-";
  values.docNetWeight = weightParts[1] || "-";
  values.docVolumeVal = stripUnit(String(src.volume || "")) || "-";
  // 唛头为空显示 N/M（单证惯例）
  values.docMarks = String(src.marks || "").trim() || "N/M";
  // 多行货物行
  const items = Array.isArray(src.docItems) && src.docItems.length ? src.docItems : [];
  const currency = src.currency || "USD";
  values.docGoodsSummary = items.length ? items.map((it) => `${it.desc || "?"} × ${it.qty || "?"}`).join("; ") : "-";
  // 总数量（取第一个数量单位，把 "1,000 pcs" 汇总为数字和）
  const qtyUnit = (String((items[0] && items[0].qty) || "").match(/[a-zA-Z]+/) || [""])[0] || "PCS";
  const totalQtyNum = items.reduce((s, it) => s + (parseFloat(String(it.qty || "").replace(/[^0-9.]/g, "")) || 0), 0);
  values.docTotalQty = totalQtyNum ? fmt(totalQtyNum, 0) + " " + qtyUnit.toUpperCase() : "-";
  // 发票式货物行（No/Desc/HS/Qty/Unit/Amount，PI/CI 用）
  const goodsCell = (it, i, priceCols) => {
    const amt = docItemAmount(it);
    const base = `<td style="padding:3.5px 4px;border:1px solid #dce3e9;text-align:center;font-size:9px;color:#5a6b78;">${i + 1}</td><td style="padding:3.5px 8px;border:1px solid #dce3e9;font-size:9px;color:#22303c;">${esc(it.desc || "-")}</td><td style="padding:3.5px 4px;border:1px solid #dce3e9;font-size:9px;color:#22303c;">${esc(it.hs || "-")}</td><td style="padding:3.5px 4px;border:1px solid #dce3e9;font-size:9px;text-align:right;color:#22303c;">${esc(it.qty || "-")}</td>`;
    return priceCols ? base + `<td style="padding:3.5px 4px;border:1px solid #dce3e9;font-size:9px;text-align:right;color:#22303c;">${fmt(Number(it.unitPrice) || 0, 2)}</td><td style="padding:3.5px 4px;border:1px solid #dce3e9;font-size:9px;text-align:right;color:#22303c;font-weight:700;">${fmt(amt, 2)}</td>` : base;
  };
  values.docGoodsRows = items.length ? items.map((it, i) => `<tr>${goodsCell(it, i, true)}</tr>`).join("") : `<tr><td colspan="6" style="padding:5px 8px;border:1px solid #dce3e9;font-size:9.5px;color:#8a98a5;">-</td></tr>`;
  // 无价货物行（No/Desc/HS/Qty，PL/SA/CO/BL/AWB 用）
  values.docGoodsRowsPlain = items.length ? items.map((it, i) => `<tr>${goodsCell(it, i, false)}</tr>`).join("") : `<tr><td colspan="4" style="padding:5px 8px;border:1px solid #dce3e9;font-size:9.5px;color:#8a98a5;">-</td></tr>`;
  // 先替换 raw 占位符，其余字段统一转义（空值显示 "-"）
  html = html.split("{{docGoodsRows}}").join(values.docGoodsRows);
  html = html.split("{{docGoodsRowsPlain}}").join(values.docGoodsRowsPlain);
  Object.entries(values).forEach(([key, value]) => {
    if (key === "docGoodsRows" || key === "docGoodsRowsPlain") return;
    html = html.split(`{{${key}}}`).join(esc(value === "" || value == null ? "-" : value));
  });
  return html.replace(/\{\{[^}]+\}\}/g, "-");
}

// 英文单据日期：2026-08-07 → 07 Aug 2026
function fmtDateEn(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return dateStr || "";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mon = MONTHS[(Number(m[2]) || 1) - 1] || "";
  return `${String(Number(m[3])).padStart(2, "0")} ${mon} ${m[1]}`;
}

function renderDocTemplate(type, data) {
  // 模板来自可编辑/可导入的 docTemplates → 输出前统一 DOMPurify 消毒，阻断存储型 XSS
  return sanitizeHtml(renderTemplateHtml(docTemplateHtml(type), data));
}

async function captureTemplatePage(type, data) {
  if (!window.html2canvas) throw new Error("html2canvas not loaded");
  let root = $("#docRenderRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "docRenderRoot";
    root.style.cssText = "position:fixed;left:-12000px;top:0;width:794px;height:1123px;z-index:-1;pointer-events:none;background:#fff;overflow:hidden;";
    document.body.appendChild(root);
  }
  root.style.display = "block";
  root.innerHTML = renderDocTemplate(type, data);
  if (document.fonts && document.fonts.ready) await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 220));
  const el = root.firstElementChild;
  if (!el) throw new Error("template empty");
  // 内容超出单页会被静默裁掉——超界时提示用户精简，而不是出一张残缺单据
  if (el.scrollHeight > el.clientHeight + 2) {
    toast("内容超出单页 A4，PDF 会被裁切，请精简货物行数或备注后再生成。");
  }
  const captureOptions = {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
    logging: false,
    windowWidth: 794,
    windowHeight: 1123,
    onclone: (doc) => {
      const clonedRoot = doc.getElementById("docRenderRoot");
      if (clonedRoot) {
        clonedRoot.style.left = "0px";
        clonedRoot.style.top = "0px";
        clonedRoot.style.zIndex = "9999";
      }
    }
  };
  try {
    let canvas = await window.html2canvas(el, captureOptions);
    if (isCanvasBlank(canvas)) {
      await new Promise((r) => setTimeout(r, 120));
      canvas = await window.html2canvas(el, captureOptions);
      if (isCanvasBlank(canvas)) throw new Error("blank template capture");
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  } finally {
    root.style.display = "none";
  }
}

function isCanvasBlank(canvas) {
  try {
    const ctx = canvas.getContext("2d");
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 32) {
      if (data[i] < 245 || data[i + 1] < 245 || data[i + 2] < 245 || data[i + 3] < 200) nonWhite++;
    }
    return nonWhite < 10;
  } catch (err) {
    return true;
  }
}

async function buildTemplatePdf(gens, data) {
  if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF not loaded");
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  for (let i = 0; i < gens.length; i++) {
    const img = await captureTemplatePage(gens[i], data);
    if (i > 0) doc.addPage();
    doc.addImage(img, "JPEG", 0, 0, 210, 297);
  }
  pdfFooter(doc);
  return doc;
}

// pdf.js worker 加载：仅 http(s) 部署。同一源下直接指定相对路径，pdf.js 用真实 Worker 渲染，
// 无需 fetch/blob、无需主线程兜底。本机使用请通过服务器（start-server）访问，不走 file://。
let pdfWorkerReady = false;
function ensurePdfWorker() {
  if (!window.pdfjsLib || pdfWorkerReady) return;
  pdfWorkerReady = true;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
}

async function renderPdfPreview(doc, htmlFallback) {
  const wrap = $("#pdfCanvasWrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="pdf-loading">正在渲染预览...</div>`;
  try {
    if (!window.pdfjsLib) throw new Error("pdf.js not loaded");
    await ensurePdfWorker();
    const pdf = await window.pdfjsLib.getDocument({ data: doc.output("arraybuffer") }).promise;
    wrap.innerHTML = "";
    const maxW = Math.min(wrap.clientWidth || 760, 760);
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(0.5, maxW / base.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx, viewport }).promise;
      const item = document.createElement("div");
      item.className = "pdf-page-wrap";
      const label = document.createElement("div");
      label.className = "pdf-page-label";
      label.textContent = `第 ${i} / ${pdf.numPages} 页`;
      item.append(label, canvas);
      wrap.appendChild(item);
    }
  } catch (err) {
    if (htmlFallback) {
      wrap.innerHTML = `<div class="pdf-html-fallback"><div class="hint" style="margin-bottom:8px;">PDF 预览不可用（file:// 或浏览器限制时常见），下方为文档版式预览，可点“下载 PDF”获取正式文件。</div>${sanitizeHtml(htmlFallback)}</div>`;
    } else {
      wrap.innerHTML = `<div class="empty-state">PDF 预览渲染失败，可直接下载查看。</div>`;
    }
  }
}

function openPdfPreview(doc, filename, title, htmlFallback) {
  const pages = doc.internal.getNumberOfPages();
  window.__pdfDoc = doc;
  window.__pdfName = filename;
  openModal(`
    <div class="modal modal-pdf-preview">
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
      <div class="pdf-preview-meta">A4 · ${pages} 页 · ${esc(filename)}</div>
      <div id="pdfCanvasWrap" class="pdf-preview-wrap"><div class="pdf-loading">正在渲染预览...</div></div>
      <div class="modal-actions">
        <button class="btn" id="pdfCloseBtn"><i data-lucide="x"></i><span>关闭</span></button>
        <button class="btn primary" id="pdfDownloadBtn"><i data-lucide="download"></i><span>下载 PDF</span></button>
      </div>
    </div>`);
  $("#pdfCloseBtn").addEventListener("click", closeModal);
  $("#pdfDownloadBtn").addEventListener("click", () => {
    window.__pdfDoc.save(window.__pdfName);
    toast("PDF 已导出");
    closeModal();
  });
  renderPdfPreview(doc, htmlFallback);
}

async function genDocPdf(type) {
  const data = collectDocData();
  const missing = docMissingRequired(type, data);
  if (missing.length) {
    toast(`请先填写必填项：${missing.map((f) => DOC_FIELD_LABELS[f] || f).join("、")}`);
    focusDocField(missing[0]);
    return;
  }
  if (!assertDocEnglish(data)) return;
  if (!data.invoiceNo) {
    data.invoiceNo = nextInvoiceNo();
    $("#docInvoiceNo").value = data.invoiceNo;
    collectDocData();
  }
  addDocHistory(type, data);
  const fallbackHtml = renderDocTemplate(type, data);
  try {
    const doc = await buildTemplatePdf([type], data);
    openPdfPreview(doc, `${DOC_GENERATORS[type].file}-${todayISO()}.pdf`, `${DOC_GENERATORS[type].name} 预览`, fallbackHtml);
  } catch (err) {
    const doc = pdfInstance();
    if (!doc) return;
    drawPdfDocument(doc, type, data);
    pdfFooter(doc);
    openPdfPreview(doc, `${DOC_GENERATORS[type].file}-${todayISO()}.pdf`, `${DOC_GENERATORS[type].name} 预览`, fallbackHtml);
  }
}

function addDocHistory(type, data) {
  if (!Array.isArray(state.docHistory)) state.docHistory = [];
  state.docHistory.unshift({
    id: uid(),
    type,
    name: DOC_GENERATORS[type] ? DOC_GENERATORS[type].name : type,
    invoiceNo: data.invoiceNo || "",
    date: data.date || todayISO(),
    seller: data.seller || "",
    buyer: data.buyer || "",
    amount: data.amount || "0",
    currency: data.currency || "USD",
    data: JSON.parse(JSON.stringify(data)),
    createdAt: new Date().toISOString()
  });
  if (state.docHistory.length > 100) state.docHistory.length = 100;
  saveState();
  renderDocHistory();
}

function renderDocHistory() {
  const wrap = $("#docHistory");
  if (!wrap) return;
  const list = Array.isArray(state.docHistory) ? state.docHistory : [];
  wrap.innerHTML = list.length ? list.slice(0, 30).map((h) => `
    <div class="dh-item">
      <div class="dh-main"><strong>${esc(h.name)}</strong><div class="cell-sub">${esc(h.invoiceNo || "—")} · ${esc(h.date || "")} · ${esc(h.buyer || "")}</div></div>
      <div class="dh-amount">${esc(h.currency)} ${fmt(h.amount || 0, 2)}</div>
      <div class="actions">
        <button class="icon-btn js-dh-open" data-id="${h.id}" title="重新打开"><i data-lucide="folder-open"></i></button>
        <button class="icon-btn js-dh-print" data-id="${h.id}" title="打印"><i data-lucide="printer"></i></button>
        <button class="icon-btn js-dh-pdf" data-id="${h.id}" title="PDF"><i data-lucide="file-down"></i></button>
        <button class="icon-btn js-dh-del" data-id="${h.id}" title="删除"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`).join("") : `<div class="empty-state">暂无已生成记录</div>`;
  refreshIcons();
}

function loadDocHistory(id) {
  const h = state.docHistory.find((x) => x.id === id);
  if (!h) return null;
  state.docBuilder = normalizeDocBuilder(defaultState().docBuilder, h.data || {});
  $("#docGenType").value = h.type;
  go("docs");
  renderDocs();
  return h;
}

async function exportCheckedPdf() {
  const mode = $("#docMode").value;
  const items = TRADE_DATA.docChecklist[mode] || [];
  const saved = state.checklist[mode] || [];
  const gens = [...new Set(items.filter((item, i) => saved[i] && item.gen && DOC_GENERATORS[item.gen]).map((item) => item.gen))];
  if (!gens.length) { toast("请先勾选可生成 PDF 的单证"); return; }
  const data = collectDocData();
  if (!assertDocEnglish(data)) return;
  const fallbackHtml = gens.map((g) => renderDocTemplate(g, data)).join(`<div style="height:22px"></div>`);
  try {
    const doc = await buildTemplatePdf(gens, data);
    openPdfPreview(doc, `export-documents-${todayISO()}.pdf`, `已勾选单证预览（${gens.length} 份）`, fallbackHtml);
  } catch (err) {
    const doc = pdfInstance();
    if (!doc) return;
    gens.forEach((g, i) => {
      if (i > 0) doc.addPage();
      drawPdfDocument(doc, g, data);
    });
    pdfFooter(doc);
    openPdfPreview(doc, `export-documents-${todayISO()}.pdf`, `已勾选单证预览（${gens.length} 份）`, fallbackHtml);
  }
}

function renderSettings() {
  fillPaymentSelect($("#setPayment"), state.settings.defaultPayment);
  $("#setCurrency").innerHTML = TRADE_DATA.currencies.map((c) => `<option value="${c.code}">${c.code}</option>`).join("");
  $("#setCompany").value = state.settings.company;
  $("#setSales").value = state.settings.sales;
  $("#setEmail").value = state.settings.email;
  $("#setPhone").value = state.settings.phone;
  $("#setIncoterm").innerHTML = TRADE_DATA.incoterms.map((t) => `<option>${t.code}</option>`).join("");
  $("#setIncoterm").value = state.settings.defaultIncoterm;
  $("#setPort").value = state.settings.defaultPort;
  $("#setCurrency").value = state.settings.defaultCurrency;
  $("#setValidity").value = state.settings.defaultValidity;
  $("#setDelivery").value = state.settings.defaultDelivery;
  $("#setSellerAddress").value = state.settings.sellerAddress;
  $("#setInvoicePrefix").value = state.settings.invoicePrefix;
  $("#setBankName").value = state.settings.bankName;
  $("#setBankAccount").value = state.settings.bankAccount;
  $("#setBankSwift").value = state.settings.bankSwift;
  $("#setBankAddress").value = state.settings.bankAddress;
  const acc = $("#accountInfo");
  if (acc) {
    acc.innerHTML = auth.username
      ? `<div class="account-info"><i data-lucide="user"></i><span>当前账号：<strong>${esc(auth.username)}</strong>${auth.role === "admin" ? ' <span class="role-admin">管理员</span>' : ""}</span></div>`
      : `<div class="account-info"><i data-lucide="user-x"></i><span>未登录（本机模式，数据仅存本浏览器）</span></div>`;
    refreshIcons();
  }
  const versionInfo = $("#appVersionInfo");
  if (versionInfo) versionInfo.textContent = `系统版本：${APP_VERSION}`;
  // 用户管理面板仅管理员可见
  const umPanel = $("#userManagePanel");
  if (umPanel) {
    umPanel.style.display = auth.role === "admin" ? "" : "none";
    if (auth.role === "admin") renderUserManagement();
  }
  // 清空初始演示数据仅管理员可见
  const cdBtn = $("#clearDemoBtn");
  if (cdBtn) cdBtn.style.display = auth.role === "admin" ? "" : "none";
  renderLicenseStatus();
}

// —— 授权 / 试用 ——
async function renderLicenseStatus() {
  const statusEl = $("#licenseStatus");
  if (!statusEl) return;
  try {
    const r = await fetch("api/license", { cache: "no-store", headers: auth.token ? { Authorization: "Bearer " + auth.token } : {} });
    const d = await r.json();
    if (!r.ok) { statusEl.innerHTML = `<span class="cell-sub">无法获取授权状态：${esc(d.error || "未知错误")}</span>`; return; }
    const mcEl = $("#licenseMachine");
    if (mcEl) mcEl.innerHTML = `机器码：<code>${esc(d.machine || "-")}</code>`;
    // 注册邀请码：管理员可见并可一键复制
    const rkEl = $("#licenseRegKey");
    const rkCodeEl = $("#licenseRegKeyCode");
    if (rkEl && rkCodeEl) {
      if (d.registerKey) {
        rkEl.style.display = "";
        rkCodeEl.textContent = d.registerKey;
      } else {
        rkEl.style.display = "none";
      }
    }
    const copyRkBtn = $("#copyRegKeyBtn");
    if (copyRkBtn) copyRkBtn.onclick = () => { if (d.registerKey) { copyText(d.registerKey); toast("注册邀请码已复制"); } };
    const daysToExpiry = d.expires ? Math.ceil((Date.parse(d.expires) - Date.now()) / (24 * 3600 * 1000)) : Infinity;
    if (d.mode === "licensed") {
      if (isFinite(daysToExpiry) && daysToExpiry <= 3) {
        statusEl.innerHTML = `<span style="color:#b45309;font-weight:600"><i data-lucide="alert-triangle"></i> 授权将于 <strong>${daysToExpiry} 天</strong>后到期（${esc(String(d.expires).slice(0, 10))}），请及时联系授权方续费！</span>`;
      } else {
        statusEl.innerHTML = `<span><i data-lucide="badge-check"></i> 已激活授权 · <strong>${esc(d.company || "")}</strong> · ${Number(d.seats) || "-"} 席位${d.expires ? " · 到期 " + esc(String(d.expires).slice(0, 10)) : " · 永久"}</span>`;
      }
    } else if (d.mode === "trial") {
      const warn = Number(d.daysLeft) <= 3;
      statusEl.innerHTML = `<span${warn ? ` style="color:#b45309;font-weight:600"` : ""}><i data-lucide="hourglass"></i> 试用期剩余 <strong>${Number(d.daysLeft) || 0} 天</strong>（${Number(d.seats) || "-"} 席位）${warn ? "，请尽快激活授权！" : ""}</span>`;
    } else {
      statusEl.innerHTML = `<span><i data-lucide="alert-triangle"></i> 试用已到期，请联系授权方获取授权码激活（需管理员登录）</span>`;
    }
    const row = $("#licenseActivateRow");
    if (row) row.style.display = auth.role === "admin" ? "" : "none";
    refreshIcons();
  } catch (e) {
    statusEl.innerHTML = `<span class="cell-sub">未通过服务器访问（本机模式，无授权限制）</span>`;
  }
}
async function activateLicense() {
  // 授权管理在设置页（仅管理员），授权码输入为设置页 #licenseKeyInput
  const key = (($("#licenseKeyInput") && $("#licenseKeyInput").value) || "").trim();
  if (!key) { toast("请先粘贴授权码"); return; }
  try {
    const r = await fetch("api/license", {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // 授权码本身即凭据
      body: JSON.stringify({ key })
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || "激活失败"); return; }
    toast("授权激活成功");
    await updateAuthLicenseHint();
    if (typeof renderLicenseStatus === "function") renderLicenseStatus();
    if (typeof renderUserManagement === "function") renderUserManagement();
  } catch (e) { toast("无法连接服务器"); }
}

// —— 用户管理（管理员） ——
async function renderUserManagement() {
  const wrap = $("#userManageList");
  if (!wrap) return;
  wrap.innerHTML = `<div class="hint">加载中…</div>`;
  try {
    const r = await fetch("api/users", { headers: { Authorization: "Bearer " + auth.token } });
    const data = await r.json();
    if (!r.ok) { wrap.innerHTML = `<div class="empty-state">${esc(data.error || "加载失败")}</div>`; return; }
    const list = data.users || [];
    wrap.innerHTML = list.length ? `<table class="data-table"><thead><tr><th>用户名</th><th>显示名</th><th>角色</th><th>注册时间</th><th class="actions">操作</th></tr></thead><tbody>${
      list.map((u) => `<tr>
        <td>${esc(u.username)}</td>
        <td>${esc(u.displayName)}</td>
        <td>${u.role === "admin" ? '<span class="role-admin">管理员</span>' : '<span class="role-user">普通用户</span>'}</td>
        <td>${esc((u.createdAt || "").slice(0, 10))}</td>
        <td><div class="actions">
          <button class="icon-btn js-user-reset" data-user="${esc(u.username)}" title="重置密码"><i data-lucide="key"></i></button>
          <button class="icon-btn js-user-role" data-user="${esc(u.username)}" data-role="${u.role === "admin" ? "user" : "admin"}" title="${u.role === "admin" ? "取消管理员" : "设为管理员"}"><i data-lucide="shield"></i></button>
          <button class="icon-btn danger js-user-del" data-user="${esc(u.username)}" title="删除用户"><i data-lucide="trash-2"></i></button>
        </div></td>
      </tr>`).join("")
    }</tbody></table>` : `<div class="empty-state">暂无用户</div>`;
    refreshIcons();
  } catch (e) { wrap.innerHTML = `<div class="empty-state">无法连接服务器</div>`; }
}

async function resetUserPassword(username) {
  const pw = prompt(`为「${username}」设置新密码（至少 8 位）：`);
  if (pw === null || !pw.trim()) return;
  if (pw.trim().length < 8) { toast("密码至少 8 位"); return; }
  try {
    const r = await fetch("api/users/reset", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + auth.token }, body: JSON.stringify({ username, password: pw.trim() }) });
    const d = await r.json();
    if (r.ok) { toast("密码已重置"); renderUserManagement(); } else { toast(d.error || "重置失败"); }
  } catch (e) { toast("无法连接服务器"); }
}

async function setUserRole(username, role) {
  if (role === "user" && !confirm(`确定取消「${username}」的管理员权限吗？`)) return;
  try {
    const r = await fetch("api/users/role", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + auth.token }, body: JSON.stringify({ username, role }) });
    const d = await r.json();
    if (r.ok) { toast(role === "admin" ? "已设为管理员" : "已取消管理员"); renderUserManagement(); } else { toast(d.error || "操作失败"); }
  } catch (e) { toast("无法连接服务器"); }
}

async function deleteUser(username) {
  if (!confirm(`确定删除用户「${username}」及其全部数据吗？此操作不可恢复！`)) return;
  try {
    const r = await fetch("api/users/delete", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + auth.token }, body: JSON.stringify({ username }) });
    const d = await r.json();
    if (r.ok) { toast("用户已删除"); renderUserManagement(); } else { toast(d.error || "删除失败"); }
  } catch (e) { toast("无法连接服务器"); }
}

function saveSettings() {
  state.settings.company = $("#setCompany").value.trim();
  state.settings.sales = $("#setSales").value.trim();
  state.settings.email = $("#setEmail").value.trim();
  state.settings.phone = $("#setPhone").value.trim();
  state.settings.defaultIncoterm = $("#setIncoterm").value;
  state.settings.defaultPayment = $("#setPayment").value.trim();
  state.settings.defaultPort = $("#setPort").value.trim();
  state.settings.defaultCurrency = $("#setCurrency").value;
  state.settings.defaultValidity = $("#setValidity").value.trim();
  state.settings.defaultDelivery = $("#setDelivery").value.trim();
  state.settings.sellerAddress = $("#setSellerAddress").value.trim();
  state.settings.invoicePrefix = $("#setInvoicePrefix").value.trim() || "INV";
  state.settings.bankName = $("#setBankName").value.trim();
  state.settings.bankAccount = $("#setBankAccount").value.trim();
  state.settings.bankSwift = $("#setBankSwift").value.trim();
  state.settings.bankAddress = $("#setBankAddress").value.trim();
  saveState();
  toast("设置已保存");
}

function colorById(id) {
  return (state.colorDict || []).find((c) => c.id === id);
}

function productColorText(p) {
  const colors = Array.isArray(p.colors) ? p.colors : [];
  return colors.map((id) => {
    const c = colorById(id);
    return c ? `${c.zh}${c.en}` : "";
  }).filter(Boolean);
}

function colorDot(c) {
  const zh = c && c.zh ? c.zh : "";
  const map = { "红": "#e5484d", "橙": "#f76b15", "黄": "#f5d90a", "绿": "#30a46c", "蓝": "#3e63dd", "紫": "#8e4ec6", "粉": "#ff87ab", "灰": "#8b8d98", "黑": "#1a1a1a", "白": "#f8f9fa", "棕": "#ad7f58", "银": "#c7c9cc", "金": "#e7b10a", "青": "#12a594", "米": "#f0e6d2", "卡": "#c3a35a", "咖": "#6f4e37", "香": "#f7e7ce", "亚": "#dfd3c3", "迷": "#6b8e4e", "渐": "#9a7bff", "七": "#ff8fab" };
  for (const k of Object.keys(map)) if (zh.includes(k)) return map[k];
  return "#8b8d98";
}

function renderColorChips(selected = []) {
  const dict = state.colorDict || [];
  return `<div class="color-chips" id="colorChipsWrap">` + (dict.length ? dict.map((c) => {
    const on = selected.includes(c.id);
    return `<button type="button" class="color-chip ${on ? "on" : ""}" data-color-id="${c.id}"><span class="color-dot" style="background:${colorDot(c)}"></span>${esc(c.zh)} ${esc(c.en)}</button>`;
  }).join("") : `<span class="hint">颜色字典为空，点"管理颜色字典"添加</span>`) + `</div>`;
}

function openColorDict() {
  openModal(`
    <div class="modal">
      <div class="modal-head"><h3>颜色字典</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
      <div class="cd-top">
        <input id="cdSearch" class="search-input" placeholder="搜索颜色…">
        <input id="cdImportFile" type="file" accept=".csv" hidden>
        <button class="btn ghost" id="cdImportBtn"><i data-lucide="upload"></i><span>导入 CSV</span></button>
      </div>
      <div class="form-grid">
        <label>颜色中文<input id="cdZh" placeholder="例如：米白"></label>
        <label>英文名<input id="cdEn" placeholder="例如：Beige"></label>
      </div>
      <div class="btn-row"><button class="btn primary" id="cdAddBtn"><i data-lucide="plus"></i><span>添加颜色</span></button></div>
      <div class="cd-list" id="cdList"></div>
      <div class="hint">CSV 格式：第一列中文，第二列英文（可带表头）。订单引用颜色的行在删除颜色时会一并清除。</div>
      <div class="modal-actions"><button class="btn" id="modalCancelBtn">关闭</button></div>
    </div>`);
  const render = () => {
    const q = ($("#cdSearch").value || "").toLowerCase();
    const dict = (state.colorDict || []).filter((c) => !q || `${c.zh} ${c.en}`.toLowerCase().includes(q));
    $("#cdList").innerHTML = dict.length ? dict.map((c) => `
      <div class="cd-item">
        <span class="color-dot" style="background:${colorDot(c)}"></span>
        <span class="cd-name"><strong>${esc(c.zh)}</strong> <small>${esc(c.en)}</small></span>
        <button type="button" class="icon-btn js-edit-color" data-id="${c.id}" title="编辑"><i data-lucide="pencil"></i></button>
        <button type="button" class="icon-btn js-del-color" data-id="${c.id}" title="删除"><i data-lucide="trash-2"></i></button>
      </div>`).join("") : `<div class="hint">没有匹配颜色</div>`;
    refreshIcons();
  };
  render();
  $("#cdSearch").addEventListener("input", render);
  $("#cdAddBtn").addEventListener("click", () => {
    const zh = $("#cdZh").value.trim();
    const en = $("#cdEn").value.trim();
    if (!zh && !en) { toast("请填写颜色名称"); return; }
    state.colorDict.push({ id: uid(), zh: zh || en, en: en || zh });
    saveState();
    $("#cdZh").value = ""; $("#cdEn").value = "";
    render();
    toast("颜色已添加");
  });
  $("#cdList").addEventListener("click", (e) => {
    const del = e.target.closest(".js-del-color");
    if (del) {
      if (confirm("删除该颜色？订单中引用该颜色的行会一并清除")) {
        state.colorDict = state.colorDict.filter((c) => c.id !== del.dataset.id);
        state.orders.forEach((o) => (o.items || []).forEach((it) => { if (it.colors) it.colors = it.colors.filter((id) => id !== del.dataset.id); }));
        saveState();
        render();
        toast("颜色已删除");
      }
      return;
    }
    const edit = e.target.closest(".js-edit-color");
    if (edit) {
      const c = state.colorDict.find((x) => x.id === edit.dataset.id);
      if (!c) return;
      const zh = prompt("颜色中文名", c.zh);
      if (zh === null) return;
      const en = prompt("英文名", c.en);
      if (en === null) return;
      c.zh = zh.trim() || c.zh;
      c.en = en.trim() || c.en;
      saveState();
      render();
      toast("颜色已更新");
    }
  });
  $("#cdImportBtn").addEventListener("click", () => $("#cdImportFile").click());
  $("#cdImportFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const bytes = new Uint8Array(reader.result);
        let text = new TextDecoder("utf-8").decode(bytes);
        if (text.includes("�")) { try { text = new TextDecoder("gbk").decode(bytes); } catch (err) { /* 保留 UTF-8 */ } }
        const rows = parseCsvText(text).filter((r) => r.length && String(r[0] || "").trim());
        let added = 0;
        rows.forEach((r, i) => {
          const zh = String(r[0] || "").trim();
          const en = String(r[1] || "").trim();
          if (!zh && !en) return;
          if (i === 0 && ["中文", "颜色", "颜色中文", "color", "颜色名"].includes(zh.toLowerCase())) return; // 跳过表头
          const zhLow = zh.toLowerCase(), enLow = en.toLowerCase();
          const exists = state.colorDict.some((c) => c.zh.toLowerCase() === zhLow || (en && c.en.toLowerCase() === enLow));
          if (exists) return;
          state.colorDict.push({ id: uid(), zh: zh || en, en: en || zh });
          added++;
        });
        if (added) { saveState(); render(); toast(`已导入 ${added} 个颜色`); }
        else toast("没有可导入的新颜色");
      } catch (err) { toast("导入失败，请检查 CSV（第一列中文，第二列英文）"); }
    };
    reader.readAsArrayBuffer(file);
  });
}

function renderProducts() {
  const q = ($("#productSearch").value || "").toLowerCase();
  const list = state.products.filter((p) => `${p.model} ${p.name} ${p.category} ${p.hsCode} ${p.supplier}`.toLowerCase().includes(q));
  $("#productTable").innerHTML = `<thead><tr><th>产品</th><th>类别</th><th>HS 编码</th><th>成本</th><th>MOQ</th><th>包装</th><th>供应商</th><th class="actions">操作</th></tr></thead><tbody>${
    list.length ? list.map((p) => {
      const tiers = (p.priceTiers || []).filter((t) => t.qty > 0 && t.price > 0).sort((a, b) => a.qty - b.qty);
      return `<tr><td><div class="cell-main">${esc(p.model)} ${esc(p.name)}</div><div class="cell-sub">${p.nameEn ? esc(p.nameEn) + " · " : ""}${esc(p.notes || "")}</div></td>
      <td>${esc(p.category)}</td><td>${esc(p.hsCode)}</td><td><strong>¥${fmt(p.unitCost)}</strong>${tiers.length ? `<div class="cell-sub">${esc(tiers.map((t) => `${fmtInt(t.qty)}+:¥${t.price}`).join(" "))}</div>` : ""}</td><td>${fmtInt(p.moq)}</td>
      <td><div class="cell-sub">${esc(p.cartonL ?? 0)}×${esc(p.cartonW ?? 0)}×${esc(p.cartonH ?? 0)} cm</div><div class="cell-sub">${esc(p.cartonWeight ?? 0)} kg / ${esc(p.qtyPerCarton ?? 0)} pcs</div></td>
      <td>${esc(p.supplier)}</td>
      <td><div class="actions"><button class="icon-btn js-load-product" data-id="${p.id}" title="带入报价"><i data-lucide="calculator"></i></button><button class="icon-btn js-edit-product" data-id="${p.id}" title="编辑"><i data-lucide="pencil"></i></button><button class="icon-btn js-del-product" data-id="${p.id}" title="删除"><i data-lucide="trash-2"></i></button></div></td></tr>`;
    }).join("") : `<tr><td colspan="8" class="empty-state">暂无产品资料</td></tr>`
  }</tbody>`;
  refreshIcons();
}

function productModal(id) {
  const p = state.products.find((x) => x.id === id) || {};
  openModal(`
    <div class="modal"><div class="modal-head"><h3>${id ? "编辑产品" : "新增产品"}</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
    <div class="form-grid">
      <label>型号<input id="pModel" value="${esc(p.model || "")}"></label>
      <label>产品名称<input id="pName" value="${esc(p.name || "")}"></label>
      <label>英文名<input id="pNameEn" value="${esc(p.nameEn || "")}" placeholder="LED Light Strip 5m"></label>
      <label>类别<input id="pCategory" value="${esc(p.category || "")}"></label>
      <label>HS 编码<input id="pHsCode" value="${esc(p.hsCode || "")}"></label>
      <label>单位成本（RMB）<input id="pUnitCost" type="number" value="${esc(p.unitCost ?? "")}" step="0.01"></label>
      <label>MOQ<input id="pMoq" type="number" value="${esc(p.moq ?? "")}"></label>
      <label>外箱长（cm）<input id="pCartonL" type="number" value="${esc(p.cartonL ?? "")}"></label>
      <label>外箱宽（cm）<input id="pCartonW" type="number" value="${esc(p.cartonW ?? "")}"></label>
      <label>外箱高（cm）<input id="pCartonH" type="number" value="${esc(p.cartonH ?? "")}"></label>
      <label>每箱毛重（kg）<input id="pCartonWeight" type="number" value="${esc(p.cartonWeight ?? "")}"></label>
      <label>每箱数量<input id="pQtyPerCarton" type="number" value="${esc(p.qtyPerCarton ?? "")}"></label>
      <label>供应商<input id="pSupplier" value="${esc(p.supplier || "")}"></label>
    </div>
    <div class="color-field">
      <div class="color-field-head"><span>价格阶梯（数量 ≥ / 成本 ¥ 每件）</span><button type="button" class="link-btn" id="addPriceTierBtn"><i data-lucide="plus"></i><span>加一档</span></button></div>
      <div id="priceTierList"></div>
    </div>
    <label style="display:block;margin-top:12px">备注<textarea id="pNotes" style="min-height:64px">${esc(p.notes || "")}</textarea></label>
    <div class="modal-actions"><button class="btn" id="modalCancelBtn">取消</button><button class="btn primary" id="modalSaveProductBtn" data-id="${id || ""}">保存</button></div></div>`);
  attachHsAutocompletes();
  renderPriceTiers(Array.isArray(p.priceTiers) ? p.priceTiers : []);
  $("#addPriceTierBtn").addEventListener("click", () => {
    $("#priceTierList").insertAdjacentHTML("beforeend", `<div class="tier-row"><span>数量 ≥</span><input type="number" class="pt-qty" placeholder="5000" style="width:90px"><span>成本 ¥</span><input type="number" class="pt-price" step="0.01" placeholder="11" style="width:90px"><button type="button" class="icon-btn js-del-tier" title="删除"><i data-lucide="trash-2"></i></button></div>`);
    refreshIcons();
  });
  $("#priceTierList").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-del-tier");
    if (btn) btn.closest(".tier-row").remove();
  });
}

function renderPriceTiers(tiers) {
  const list = (tiers && tiers.length) ? tiers : [{ qty: "", price: "" }];
  $("#priceTierList").innerHTML = list.map((t, i) => `
    <div class="tier-row"><span>数量 ≥</span><input type="number" class="pt-qty" value="${esc(t.qty ?? "")}" placeholder="1000" style="width:90px"><span>成本 ¥</span><input type="number" class="pt-price" step="0.01" value="${esc(t.price ?? "")}" placeholder="12" style="width:90px"><button type="button" class="icon-btn js-del-tier" title="删除"><i data-lucide="trash-2"></i></button></div>`).join("");
  refreshIcons();
}

function productTierPrice(p, qty) {
  const tiers = (p.priceTiers || []).filter((t) => t.qty > 0 && t.price > 0).sort((a, b) => a.qty - b.qty);
  if (!tiers.length) return null;
  let best = null;
  for (const t of tiers) if (Number(qty) >= t.qty) best = t;
  return best;
}

// —— HS 编码自动补全 ——
function hsAutocomplete(input) {
  input.setAttribute("autocomplete", "off");
  let box = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    close();
    if (q.length < 2) return;
    const hits = hsAll().filter((h) => `${h.code} ${h.name || ""} ${h.keywords || ""}`.toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) return;
    box = document.createElement("div");
    box.className = "hs-ac";
    box.innerHTML = hits.map((h) => `<button type="button" data-code="${esc(h.code)}">${esc(h.code)} <small>${esc((h.name || h.category || "").slice(0, 44))}</small></button>`).join("");
    const rect = input.getBoundingClientRect();
    box.style.position = "absolute";
    box.style.top = (rect.bottom + window.scrollY + 2) + "px";
    box.style.left = rect.left + "px";
    box.style.minWidth = Math.max(rect.width, 240) + "px";
    document.body.appendChild(box);
    box.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (b) {
        input.value = b.dataset.code;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        close();
      }
    });
  });
}

function attachHsAutocompletes() {
  $$(".di-hs, .oi-hs, #pHsCode").forEach((el) => {
    if (el.dataset.hsAc) return;
    el.dataset.hsAc = "1";
    hsAutocomplete(el);
  });
}

function saveProductFromModal(id) {
  const data = {
    model: $("#pModel").value.trim(), name: $("#pName").value.trim(), nameEn: $("#pNameEn").value.trim(), category: $("#pCategory").value.trim(),
    hsCode: $("#pHsCode").value.trim(), unitCost: Number($("#pUnitCost").value) || 0, moq: Number($("#pMoq").value) || 0,
    cartonL: Number($("#pCartonL").value) || 0, cartonW: Number($("#pCartonW").value) || 0, cartonH: Number($("#pCartonH").value) || 0,
    cartonWeight: Number($("#pCartonWeight").value) || 0, qtyPerCarton: Number($("#pQtyPerCarton").value) || 0,
    supplier: $("#pSupplier").value.trim(), notes: $("#pNotes").value.trim(),
    priceTiers: $$("#priceTierList .tier-row").map((tr) => ({ qty: Number(tr.querySelector(".pt-qty")?.value) || 0, price: Number(tr.querySelector(".pt-price")?.value) || 0 })).filter((t) => t.qty > 0 && t.price > 0).sort((a, b) => a.qty - b.qty)
  };
  if (!data.model && !data.name) { toast("请填写型号或产品名称"); return; }
  if (id) {
    const idx = state.products.findIndex((x) => x.id === id);
    if (idx >= 0) state.products[idx] = { ...state.products[idx], ...data };
  } else {
    state.products.unshift({ id: uid(), ...data });
  }
  saveState();
  $("#modalRoot").innerHTML = "";
  renderProducts();
  toast("产品已保存");
}

function exportProducts() {
  const rows = [["型号", "产品名称", "英文名", "类别", "HS编码", "单位成本", "MOQ", "箱长", "箱宽", "箱高", "箱重", "每箱数量", "价格阶梯", "供应商", "备注"]];
  state.products.forEach((p) => rows.push([p.model, p.name, p.nameEn, p.category, p.hsCode, p.unitCost, p.moq, p.cartonL, p.cartonW, p.cartonH, p.cartonWeight, p.qtyPerCarton, (p.priceTiers || []).map((t) => `${t.qty}+:${t.price}`).join("; "), p.supplier, p.notes]));
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile("products.csv", csv, "text/csv;charset=utf-8");
}

function loadProductToQuote(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  $("#qProductSelect").value = p.id;
  // 产品名称取产品库英文名（报价/报价单用英文）
  const enName = (p.nameEn || p.model || p.name).trim();
  $("#qProduct").value = enName;
  const tier = productTierPrice(p, Number(p.moq) || 0);
  $("#qCost").value = tier ? tier.price : p.unitCost;
  $("#qQty").value = p.moq || "";
  if (!state.logisticsItems.length) state.logisticsItems.push({ id: uid(), name: "货物1", len: 60, width: 40, height: 35, weight: 18, qty: 100 });
  state.logisticsItems[0] = {
    ...state.logisticsItems[0],
    name: enName,
    len: p.cartonL || state.logisticsItems[0].len,
    width: p.cartonW || state.logisticsItems[0].width,
    height: p.cartonH || state.logisticsItems[0].height,
    weight: p.cartonWeight || state.logisticsItems[0].weight,
    // 物流清单的 qty 是"箱数"：由 MOQ(件) ÷ 每箱数量 折算，避免把件数当作箱数放大体积/重量
    qty: p.qtyPerCarton ? Math.max(1, Math.ceil((p.moq || 0) / p.qtyPerCarton)) : (p.moq || state.logisticsItems[0].qty)
  };
  saveState();
  renderLogisticsItems();
  window.__skipQuoteRestore = true;
  go("quote");
  toast("产品已带入报价");
}

const ORDER_STATUSES = ["样品确认中", "已接单", "生产中", "验货中", "已发货", "已到港", "已完成", "已取消"];

function renderOrders() {
  const q = ($("#orderSearch").value || "").toLowerCase();
  const f = $("#orderFilter").value;
  const list = state.orders.filter((o) => {
    const itemNames = (o.items || []).map((i) => i.name || "").join(" ");
    const matchQ = !q || `${o.poNo} ${o.clientName} ${o.product} ${itemNames}`.toLowerCase().includes(q);
    return matchQ && (!f || o.status === f);
  }).sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
  $("#orderTable").innerHTML = `<thead><tr><th>PO 号</th><th>客户</th><th>产品</th><th>数量</th><th>金额</th><th>毛利(RMB)</th><th>状态</th><th>交期</th><th>港口</th><th>物流单号</th><th class="actions">操作</th></tr></thead><tbody>${
    list.length ? list.map((o) => {
      const n = (o.items && o.items.length) || 0;
      const profitCls = o.profit !== undefined && o.profit !== null && o.profit < 0 ? "danger-text" : "";
      return `<tr><td><strong>${esc(o.poNo)}</strong></td><td>${esc(o.clientName)}</td><td>${esc(o.product)}${n > 1 ? `<span class="badge blue">${n} 项</span>` : ""}</td><td>${fmtInt(o.qty)}</td><td>${fmt(o.amount)} ${esc(o.currency)}</td>
      <td class="${profitCls}">${o.profit !== undefined && o.profit !== null ? `¥${fmt(o.profit)}` : "—"}</td>
      <td><select class="js-order-status" data-id="${o.id}" style="min-width:108px">${ORDER_STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></td>
      <td>${esc(o.deliveryDate || "—")}</td><td>${esc(o.port || "—")}</td><td>${esc(o.tracking || "—")}</td>
      <td><div class="actions"><button class="icon-btn js-copy-order" data-id="${o.id}" title="复制摘要"><i data-lucide="copy"></i></button><button class="icon-btn js-edit-order" data-id="${o.id}" title="编辑"><i data-lucide="pencil"></i></button><button class="icon-btn js-del-order" data-id="${o.id}" title="删除"><i data-lucide="trash-2"></i></button></div></td></tr>`;
    }).join("") : `<tr><td colspan="11" class="empty-state">暂无订单</td></tr>`
  }</tbody>`;
  refreshIcons();
}

function orderItemAmount(it) {
  const p = Number(it.unitPrice);
  return p ? parseQty(it.qty) * p : 0;
}

function orderItemProfitRmb(it, rate) {
  // 金额(订单币) 折 RMB − 成本(RMB/件) × 数量
  return orderItemAmount({ qty: it.qty, unitPrice: it.unitPrice }) * (rate || 1) - (Number(it.cost) || 0) * parseQty(it.qty);
}

function cnyPerOrderCurrency(cur) {
  // 1 订单币 = ? RMB
  return (state.rates.CNY || 7.2) / (state.rates[cur] || 1);
}

function colorBadgesHtml(ids) {
  return (ids || []).map((cid) => { const c = colorById(cid); return c ? `<span class="color-badge">${esc(c.zh)}${esc(c.en)}</span>` : ""; }).join("");
}

function closeDropdown(cls) {
  const el = document.querySelector(cls);
  if (el) el.remove();
}

// 产品输入框下拉：聚焦/输入时在框正下方左对齐弹出，选中即带进行
function applyProductToRow(input, p) {
  const tr = input.closest("tr");
  const qtyEl = tr.querySelector(".oi-qty, .qi-qty");
  const priceEl = tr.querySelector(".oi-price, .qi-price");
  const costEl = tr.querySelector(".oi-cost");
  const hsEl = tr.querySelector(".oi-hs, .qi-hs");
  const qty = Number(qtyEl?.value) || Number(p.moq) || 0;
  const tier = productTierPrice(p, qty);
  tr.dataset.pid = p.id;
  input.value = `${p.model} ${p.name}`;
  if (hsEl) hsEl.value = p.hsCode || "";
  if (priceEl) priceEl.value = (tier ? tier.price : p.unitCost) || "";
  if (costEl) costEl.value = p.unitCost || "";
  if (priceEl) priceEl.dispatchEvent(new Event("input", { bubbles: true }));
  if (qtyEl) qtyEl.focus(); // 选中后跳到数量，一路回车往下录
}

function attachProductDropdown(input, onPick) {
  if (input.dataset.dd) return;
  input.dataset.dd = "1";
  let box = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  const pick = (p) => { if (p) (onPick ? onPick(input, p) : applyProductToRow(input, p)); };
  const show = () => {
    if (!box) {
      box = document.createElement("div");
      box.className = "prod-dd";
      box.style.position = "fixed"; // fixed 定位，不受弹窗内部滚动影响，永远对到输入框下方
      document.body.appendChild(box);
      box.addEventListener("click", (e) => {
        const item = e.target.closest(".prod-item");
        if (item) {
          const p = state.products.find((x) => x.id === item.dataset.id);
          close();
          pick(p);
        }
      });
    }
    const r = input.getBoundingClientRect();
    box.style.left = r.left + "px";   // 左对齐输入框左边缘
    box.style.top = (r.bottom + 4) + "px";
    box.style.width = Math.max(r.width, 360) + "px";
    const q = input.value.trim().toLowerCase();
    const hits = state.products.filter((p) => !q || `${p.model} ${p.name} ${p.nameEn} ${p.hsCode} ${p.category} ${p.supplier}`.toLowerCase().includes(q)).slice(0, 20);
    box.innerHTML = hits.length ? hits.map((p) => {
      const tier = productTierPrice(p, Number(p.moq) || 0);
      return `<button type="button" class="prod-item" data-id="${p.id}"><strong>${esc(p.model)} ${esc(p.name)}</strong>${p.nameEn ? `<em class="prod-en">${esc(p.nameEn)}</em>` : ""}<span>${esc(p.hsCode || "")} · ¥${fmt(tier ? tier.price : p.unitCost)} · ${esc(p.category || "")}</span></button>`;
    }).join("") : `<div class="empty-state">无匹配产品，可到「产品管理」添加</div>`;
  };
  const onClickDoc = (e) => { if (box && e.target !== input && !box.contains(e.target)) close(); };
  input.addEventListener("focus", show);
  input.addEventListener("click", show);
  input.addEventListener("input", show);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { const first = box && box.querySelector(".prod-item"); if (first) { first.click(); e.preventDefault(); } }
    else if (e.key === "Escape") close();
  });
  // 手动完整输入产品名后失焦也算选中
  input.addEventListener("change", () => {
    const val = (input.value || "").trim().toLowerCase();
    const p = state.products.find((x) => `${x.model} ${x.name}`.trim().toLowerCase() === val);
    pick(p);
  });
  setTimeout(() => document.addEventListener("click", onClickDoc), 0);
}

function openColorPicker(anchorBtn, current, callback) {
  closeDropdown(".color-picker");
  const box = document.createElement("div");
  box.className = "color-picker";
  box.innerHTML = `<div class="color-chips" id="cpChips">${renderColorChips(current || [])}</div><div class="btn-row cp-foot"><span class="hint">颜色字典在订单页工具栏管理</span><button type="button" class="btn primary" id="cpOkBtn">确定</button></div>`;
  const rect = anchorBtn.getBoundingClientRect();
  box.style.position = "absolute";
  box.style.top = (rect.bottom + window.scrollY + 2) + "px";
  box.style.left = rect.left + "px";
  box.style.width = "320px";
  document.body.appendChild(box);
  const close = () => box.remove();
  const onClick = (e) => {
    if (!box) { document.removeEventListener("click", onClick); return; }
    if (anchorBtn && (e.target === anchorBtn || anchorBtn.contains(e.target))) return;
    if (!box.contains(e.target)) { close(); document.removeEventListener("click", onClick); }
  };
  setTimeout(() => document.addEventListener("click", onClick), 0);
  box.querySelector("#cpChips").addEventListener("click", (e) => { const chip = e.target.closest(".color-chip"); if (chip) chip.classList.toggle("on"); });
  box.querySelector("#cpOkBtn").addEventListener("click", () => {
    const ids = $$("#cpChips .color-chip.on").map((c) => c.dataset.colorId);
    close();
    if (callback) callback(ids);
  });
  refreshIcons();
}

function attachRowPickers() {
  $$("#orderItemsTable .oi-pick, #quoteItemsTable .qi-pick").forEach((input) => {
    if (input.dataset.pick) return;
    input.dataset.pick = "1";
    attachProductDropdown(input);
  });
  $$("#orderItemsTable .oi-color, #quoteItemsTable .qi-color").forEach((btn) => {
    if (btn.dataset.pick) return;
    btn.dataset.pick = "1";
    btn.addEventListener("click", () => {
      const tr = btn.closest("tr");
      const current = (tr.dataset.colors || "").split(",").filter(Boolean);
      openColorPicker(btn, current, (ids) => {
        tr.dataset.colors = ids.join(",");
        btn.innerHTML = colorBadgesHtml(ids) || "＋ 选颜色";
      });
    });
  });
}

function renderOrderItems(items) {
  const list = (items && items.length ? items : []);
  const rate = cnyPerOrderCurrency($("#orderCurrency").value);
  $("#orderItemsTable tbody").innerHTML = list.length ? list.map((it, i) => `
    <tr class="order-item-row" data-pid="${esc(it.pid || "")}" data-colors="${esc((it.colors || []).join(","))}">
      <td><input class="oi-pick" value="${esc(it.name || "")}" placeholder="输入型号/品名选产品（可手填）"></td>
      <td><input class="oi-hs" value="${esc(it.hs || "")}" placeholder="9405.42"></td>
      <td><button type="button" class="oi-color btn ghost">${colorBadgesHtml(it.colors) || "＋ 选颜色"}</button></td>
      <td><input class="oi-qty" value="${esc(it.qty || "")}" placeholder="1,000"></td>
      <td><input class="oi-price" type="number" step="0.01" value="${it.unitPrice ?? ""}" placeholder="3.85"></td>
      <td><input class="oi-cost" type="number" step="0.01" value="${it.cost ?? ""}" placeholder="成本" title="成本 RMB/件"></td>
      <td class="oi-amount">${fmt(orderItemAmount(it), 2)}</td>
      <td class="oi-profit">${fmt(orderItemProfitRmb(it, rate), 2)}</td>
      <td><div class="actions"><button class="icon-btn js-del-order-item" title="删除"><i data-lucide="trash-2"></i></button></div></td>
    </tr>`).join("") : emptyOrderRowHtml();
  attachRowPickers();
  updateOrderTotal();
  attachHsAutocompletes();
  refreshIcons();
}

function emptyOrderRowHtml() {
  return `<tr class="order-item-row" data-pid="" data-colors="">
    <td><input class="oi-pick" placeholder="输入型号/品名选产品（可手填）"></td>
    <td><input class="oi-hs" placeholder="9405.42"></td>
    <td><button type="button" class="oi-color btn ghost">＋ 选颜色</button></td>
    <td><input class="oi-qty" placeholder="1,000"></td>
    <td><input class="oi-price" type="number" step="0.01" placeholder="3.85"></td>
    <td><input class="oi-cost" type="number" step="0.01" placeholder="成本"></td>
    <td class="oi-amount">0.00</td>
    <td class="oi-profit">0.00</td>
    <td><div class="actions"><button class="icon-btn js-del-order-item" title="删除"><i data-lucide="trash-2"></i></button></div></td>
  </tr>`;
}

function addOrderItemRow() {
  $("#orderItemsTable tbody").insertAdjacentHTML("beforeend", emptyOrderRowHtml());
  attachRowPickers();
  updateOrderTotal();
  attachHsAutocompletes();
  refreshIcons();
  // 新行自动聚焦产品框并弹出下拉
  const rows = document.querySelectorAll("#orderItemsTable .oi-pick");
  const last = rows[rows.length - 1];
  if (last) last.focus();
}

function updateOrderTotal() {
  const rate = cnyPerOrderCurrency($("#orderCurrency").value);
  const rows = $$("#orderItemsTable .order-item-row");
  let totalAmount = 0, totalCost = 0;
  rows.forEach((tr) => {
    const it = { qty: tr.querySelector(".oi-qty")?.value, unitPrice: tr.querySelector(".oi-price")?.value, cost: tr.querySelector(".oi-cost")?.value };
    totalAmount += orderItemAmount(it);
    totalCost += (Number(it.cost) || 0) * parseQty(it.qty);
    const profitTd = tr.querySelector(".oi-profit");
    if (profitTd) profitTd.textContent = fmt(orderItemProfitRmb(it, rate), 2);
  });
  const profit = totalAmount * rate - totalCost;
  const el = $("#orderTotalDisplay");
  if (el) el.innerHTML = `订单总额 <strong>${fmt(totalAmount, 2)}</strong> · 毛利(RMB) <strong>${fmt(profit, 2)}</strong>（${totalAmount ? fmt(profit / (totalAmount * rate) * 100, 1) : 0}%）`;
  return totalAmount;
}

function orderModal(id) {
  const o = state.orders.find((x) => x.id === id) || {};
  const items = Array.isArray(o.items) && o.items.length ? o.items
    : (o.product || o.qty || o.amount ? [{ pid: "", name: o.product || "", hs: o.hs || "", qty: String(o.qty || ""), unitPrice: o.amount && o.qty ? (Number(o.amount) / Number(o.qty)).toFixed(2) : "", amount: o.amount || 0 }] : []);
  const orphan = o.clientId && !state.clients.some((c) => c.id === o.clientId)
    ? `<option value="${o.clientId}" selected>${esc(o.clientName || "已删除客户")}（已删除）</option>` : "";
  const options = `<option value="">未选择</option>` + orphan + state.clients.map((c) => `<option value="${c.id}" ${c.id === o.clientId ? "selected" : ""}>${esc(c.company || c.name)}</option>`).join("");
  openModal(`
    <div class="modal modal-order"><div class="modal-head"><h3>${id ? "编辑订单" : "新增订单"}</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
    <div class="form-grid">
      <label>PO 号<input id="orderPo" value="${esc(o.poNo || `PO-${todayISO().replace(/-/g, "")}-${Math.floor(Math.random() * 90 + 10)}`)}"></label>
      <label>客户<select id="orderClient">${options}</select></label>
      <label>币种<select id="orderCurrency">${TRADE_DATA.currencies.map((c) => `<option value="${c.code}" ${c.code === o.currency ? "selected" : ""}>${c.code}</option>`).join("")}</select></label>
      <label>状态<select id="orderStatus">${ORDER_STATUSES.map((s) => `<option ${s === o.status ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <label>贸易条款${incotermSelect(o.incoterm || state.settings.defaultIncoterm, "orderIncoterm")}</label>
      <label>付款方式${paymentSelect(o.payment || state.settings.defaultPayment, "orderPayment")}</label>
      <label>下单日期<input id="orderDate" type="date" value="${esc(o.orderDate || todayISO())}"></label>
      <label>预计交期<input id="orderDelivery" type="date" value="${esc(o.deliveryDate || "")}"></label>
      <label>起运港→目的港<input id="orderPort" value="${esc(o.port || state.settings.defaultPort)}"></label>
      <label>物流单号<input id="orderTracking" value="${esc(o.tracking || "")}"></label>
    </div>
    <div class="order-items-section">
      <div class="order-items-head"><span>产品明细</span></div>
      <div class="table-wrap"><table class="data-table" id="orderItemsTable">
        <thead><tr><th>产品</th><th>HS</th><th>颜色</th><th>数量</th><th>单价</th><th>成本(RMB)</th><th>金额</th><th>毛利(RMB)</th><th class="actions">操作</th></tr></thead>
        <tbody></tbody>
      </table></div>
      <div class="btn-row order-add-row"><button class="btn ghost" id="addOrderItemRowBtn"><i data-lucide="plus"></i><span>新增一行</span></button></div>
      <div class="order-total" id="orderTotalDisplay">订单总额：<strong>0.00</strong></div>
    </div>
    <label style="display:block;margin-top:12px">备注<textarea id="orderNotes" style="min-height:64px">${esc(o.notes || "")}</textarea></label>
    <div class="modal-actions"><button class="btn" id="modalCancelBtn">取消</button><button class="btn primary" id="modalSaveOrderBtn" data-id="${id || ""}">保存</button></div></div>`);
  renderOrderItems(items);
  $("#addOrderItemRowBtn").addEventListener("click", addOrderItemRow);
  $("#orderItemsTable").addEventListener("input", (e) => {
    const tr = e.target.closest(".order-item-row");
    if (!tr) return;
    const qty = tr.querySelector(".oi-qty")?.value || "";
    const price = tr.querySelector(".oi-price")?.value || "";
    const amountTd = tr.querySelector(".oi-amount");
    if (amountTd) amountTd.textContent = fmt(orderItemAmount({ qty, unitPrice: price }), 2);
    updateOrderTotal();
  });
  $("#orderItemsTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-del-order-item");
    if (btn) { btn.closest(".order-item-row").remove(); updateOrderTotal(); }
  });
}

function saveOrderFromModal(id) {
  const clientId = $("#orderClient").value;
  const client = state.clients.find((c) => c.id === clientId);
  const rows = $$("#orderItemsTable .order-item-row");
  const items = rows.map((tr) => {
    const qty = tr.querySelector(".oi-qty")?.value.trim() || "";
    const unitPrice = tr.querySelector(".oi-price")?.value || "";
    const cost = Number(tr.querySelector(".oi-cost")?.value) || 0;
    const pickName = (tr.querySelector(".oi-pick")?.value || "").trim();
    return {
      pid: tr.dataset.pid || "",
      name: pickName,
      hs: tr.querySelector(".oi-hs")?.value.trim() || "",
      colors: (tr.dataset.colors || "").split(",").filter(Boolean),
      qty,
      unitPrice,
      cost,
      amount: orderItemAmount({ qty, unitPrice })
    };
  }).filter((it) => it.name || it.qty);
  const totalQty = items.reduce((s, it) => s + parseQty(it.qty), 0);
  const totalAmount = items.reduce((s, it) => s + it.amount, 0);
  const totalCost = items.reduce((s, it) => s + (Number(it.cost) || 0) * parseQty(it.qty), 0);
  const rate = cnyPerOrderCurrency($("#orderCurrency").value);
  const profit = totalAmount * rate - totalCost;
  const product = items.length ? (items.length === 1 ? items[0].name : `${items[0].name} 等 ${items.length} 项`) : "";
  const data = {
    poNo: $("#orderPo").value.trim(), clientId, clientName: client ? client.company || client.name : "",
    items, product, qty: totalQty, amount: totalAmount, cost: totalCost, profit,
    currency: $("#orderCurrency").value, status: $("#orderStatus").value, incoterm: $("#orderIncoterm").value.trim(),
    payment: $("#orderPayment").value.trim(), orderDate: $("#orderDate").value, deliveryDate: $("#orderDelivery").value,
    port: $("#orderPort").value.trim(), tracking: $("#orderTracking").value.trim(), notes: $("#orderNotes").value.trim()
  };
  if (!data.poNo && !data.product) { toast("请填写订单号或至少一个产品"); return; }
  if (id) {
    const idx = state.orders.findIndex((x) => x.id === id);
    if (idx >= 0) state.orders[idx] = { ...state.orders[idx], ...data };
  } else {
    state.orders.unshift({ id: uid(), ...data });
  }
  saveState();
  $("#modalRoot").innerHTML = "";
  renderOrders();
  toast("订单已保存");
}

function hsKey(raw) {
  // 以完整编码字符串去重：中文"章/类"条目（如"第一类"）与带 ex 前缀的海关参考编码
  // 不会因数字归一化而与正式税号互相覆盖
  return String(raw || "").trim();
}

function hsAll() {
  const byCode = new Map();
  state.hsCodes.forEach((h) => byCode.set(hsKey(h.code), h));
  const full = typeof FULL_HS_CODES !== "undefined" ? FULL_HS_CODES : [];
  full.forEach((h) => {
    const key = hsKey(h.code);
    if (!byCode.has(key)) byCode.set(key, h);
  });
  return [...byCode.values()];
}

function renderHs() {
  const q = ($("#hsSearch").value || "").toLowerCase();
  const f = $("#hsFilter").value;
  const all = hsAll();
  const list = all.filter((h) => {
    const digits = String(h.code || "").replace(/\D/g, "");
    const matchQ = !q || `${h.code} ${h.code6 || ""} ${digits} ${h.name || ""} ${h.group || ""} ${h.sub || ""} ${h.category} ${h.keywords || ""} ${h.notes || ""}`.toLowerCase().includes(q);
    return matchQ && (!f || h.category === f);
  });
  const shown = list.slice(0, 200);
  const info = $("#hsResultInfo");
  if (info) info.textContent = list.length > shown.length ? `共 ${list.length} 条，显示前 ${shown.length} 条，请继续输入关键词缩小范围。` : `共 ${list.length} 条。`;
  $("#hsTable").innerHTML = `<thead><tr><th>HS 编码</th><th>品名</th><th>品类</th><th>出口退税</th><th>监管 / 检疫</th><th>注意事项</th><th class="actions">操作</th></tr></thead><tbody>${
    shown.length ? shown.map((h) => `
      <tr><td><strong>${esc(h.code)}</strong><div class="cell-sub">${h.code6 ? `国际 6 位：${esc(h.code6)}` : `层级：${h.level || 6} 位`}</div></td>
      <td><div class="cell-main">${esc(h.name || h.category)}</div>${h.group ? `<div class="cell-sub">${esc(h.group)}${h.sub ? ` · ${esc(h.sub)}` : ""}</div>` : ""}<div class="cell-sub">${esc(h.keywords || "")}</div></td>
      <td>${esc(h.category)}</td><td>${esc(h.rebate || "-")}</td>
      <td><div class="cell-sub">监管：${esc(h.supervision || "-")}</div><div class="cell-sub">检疫：${esc(h.inspection || "-")}</div></td>
      <td style="max-width:260px"><div class="cell-sub">${esc(h.notes || "")}</div><div class="cell-sub">${esc(h.source || "")}</div></td>
      <td>${h.full ? `<span class="badge teal">完整库</span>` : `<div class="actions"><button class="icon-btn js-edit-hs" data-id="${h.id}" title="编辑"><i data-lucide="pencil"></i></button><button class="icon-btn js-del-hs" data-id="${h.id}" title="删除"><i data-lucide="trash-2"></i></button></div>`}</td></tr>
    `).join("") : `<tr><td colspan="7" class="empty-state">没有匹配结果</td></tr>`
  }</tbody>`;
  refreshIcons();
}

function hsModal(id) {
  const h = state.hsCodes.find((x) => x.id === id) || {};
  openModal(`
    <div class="modal"><div class="modal-head"><h3>${id ? "编辑 HS 编码" : "新增 HS 编码"}</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
    <div class="form-grid">
      <label>海关 10 位编码<input id="hsCode" value="${esc(h.code || "")}" placeholder="9405.42.90"></label>
      <label>国际 6 位编码<input id="hsCode6" value="${esc(h.code6 || "")}" placeholder="9405.42"></label>
      <label>商品品名<input id="hsName" value="${esc(h.name || "")}" placeholder="其他电灯及照明装置"></label>
      <label>品类<input id="hsCategory" value="${esc(h.category || "")}"></label>
      <label>关键词<input id="hsKeywords" value="${esc(h.keywords || "")}"></label>
      <label>出口退税率<input id="hsRebate" value="${esc(h.rebate || "")}" placeholder="13%"></label>
      <label>监管条件<input id="hsSupervision" value="${esc(h.supervision || "")}"></label>
      <label>检验检疫类别<input id="hsInspection" value="${esc(h.inspection || "")}"></label>
    </div>
    <label style="display:block;margin-top:12px">申报注意事项<textarea id="hsNotes" style="min-height:64px">${esc(h.notes || "")}</textarea></label>
    <label style="display:block;margin-top:10px">数据来源<input id="hsSource" value="${esc(h.source || "用户录入")}"></label>
    <div class="modal-actions"><button class="btn" id="modalCancelBtn">取消</button><button class="btn primary" id="modalSaveHsBtn" data-id="${id || ""}">保存</button></div></div>`);
}

function saveHsFromModal(id) {
  const data = {
    code: $("#hsCode").value.trim(), code6: $("#hsCode6").value.trim(), name: $("#hsName").value.trim(),
    category: $("#hsCategory").value.trim(), keywords: $("#hsKeywords").value.trim(), rebate: $("#hsRebate").value.trim(),
    supervision: $("#hsSupervision").value.trim(), inspection: $("#hsInspection").value.trim(), notes: $("#hsNotes").value.trim(), source: $("#hsSource").value.trim() || "用户录入"
  };
  if (!data.code) { toast("请填写海关编码"); return; }
  if (!data.code6) data.code6 = data.code.replace(/\./g, "").slice(0, 6).replace(/(\d{4})(\d{2})/, "$1.$2");
  if (id) {
    const idx = state.hsCodes.findIndex((x) => x.id === id);
    if (idx >= 0) state.hsCodes[idx] = { ...state.hsCodes[idx], ...data };
  } else {
    state.hsCodes.unshift({ id: uid(), ...data });
  }
  saveState();
  $("#modalRoot").innerHTML = "";
  renderHs();
  toast("HS 编码已保存");
}

function exportHs() {
  const rows = [["code", "code6", "name", "category", "keywords", "rebate", "supervision", "inspection", "notes", "source"]];
  state.hsCodes.forEach((h) => rows.push([h.code, h.code6, h.name, h.category, h.keywords, h.rebate, h.supervision, h.inspection, h.notes, h.source]));
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  downloadFile("hs-codes.csv", csv, "text/csv;charset=utf-8");
}

function parseCsvText(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      row.push(cur); cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}

function importHsCsv(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      // 兼容中文版 Excel 另存的 ANSI/GBK 编码 CSV：先按 UTF-8 解码，出现乱码字符时回退 GBK
      const bytes = new Uint8Array(reader.result);
      let text = new TextDecoder("utf-8").decode(bytes);
      if (text.includes("�")) {
        try { text = new TextDecoder("gbk").decode(bytes); } catch (err) { /* 保留 UTF-8 结果 */ }
      }
      const rows = parseCsvText(text);
      if (rows.length < 2) { toast("CSV 内容为空"); return; }
      const headers = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (keys) => {
        for (const k of keys) {
          const i = headers.indexOf(k);
          if (i >= 0) return i;
        }
        return -1;
      };
      const iCode = idx(["code", "hs", "海关编码", "hs code"]);
      const iCode6 = idx(["code6", "hs6", "国际6位", "国际 6 位"]);
      const iName = idx(["name", "品名", "商品名称"]);
      const iCat = idx(["category", "品类", "类别"]);
      const iKw = idx(["keywords", "关键词"]);
      const iRebate = idx(["rebate", "出口退税", "退税率"]);
      const iSup = idx(["supervision", "监管", "监管条件"]);
      const iIns = idx(["inspection", "检验检疫", "检疫"]);
      const iNotes = idx(["notes", "备注", "注意事项"]);
      const iSource = idx(["source", "来源"]);
      if (iCode < 0) { toast("未找到编码列，请使用 code / 海关编码 表头"); return; }
      const list = rows.slice(1).map((r) => {
        const get = (i) => (i >= 0 && r[i] !== undefined ? r[i].trim() : "");
        const code = get(iCode);
        const code6 = get(iCode6) || code.replace(/\./g, "").slice(0, 6).replace(/(\d{4})(\d{2})/, "$1.$2");
        return { id: uid(), code, code6, name: get(iName), category: get(iCat), keywords: get(iKw), rebate: get(iRebate), supervision: get(iSup), inspection: get(iIns), notes: get(iNotes), source: get(iSource) || "用户导入" };
      }).filter((h) => h.code);
      if (!list.length) { toast("没有可导入的编码"); return; }
      if (!confirm(`导入后将替换当前 ${state.hsCodes.length} 条自定义 HS 编码（内置税则库不受影响），共 ${list.length} 条，继续？`)) return;
      state.hsCodes = list;
      saveState();
      renderHs();
      toast(`已导入 ${list.length} 条 HS 编码`);
    } catch (err) {
      toast("导入失败，请检查 CSV 格式");
    }
  };
  reader.readAsArrayBuffer(file);
}

function resetHsCodes() {
  if (!confirm("恢复内置 HS 编码并覆盖当前库？")) return;
  state.hsCodes = JSON.parse(JSON.stringify(TRADE_DATA.hsCodes));
  saveState();
  renderHs();
  toast("已恢复内置 HS 编码");
}

function renderGlossary() {
  const q = ($("#glossarySearch").value || "").toLowerCase();
  const f = $("#glossaryFilter").value;
  const list = TRADE_DATA.glossary.filter((g) => {
    const matchQ = !q || `${g.en} ${g.zh} ${g.example}`.toLowerCase().includes(q);
    return matchQ && (!f || g.category === f);
  });
  $("#glossaryList").innerHTML = list.map((g) => `
    <div class="glossary-item"><div class="glossary-head"><strong>${esc(g.en)}</strong><span class="badge teal">${esc(g.category)}</span></div>
    <div class="glossary-zh">${esc(g.zh)}</div><div class="glossary-example">${esc(g.example)}</div>
    <button class="btn ghost js-copy-glossary" data-text="${esc(g.example)}"><i data-lucide="copy"></i><span>复制例句</span></button></div>`).join("") || `<div class="empty-state">没有匹配结果</div>`;
  refreshIcons();
}

function exportData() {
  downloadFile("trade-toolbox-data.json", JSON.stringify(state, null, 2), "application/json");
}

async function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(reader.result);
      const prev = JSON.stringify(state);
      state = normalizeState(data);
      const ok = await flushState();
      if (!ok && auth.token) {
        // 推送失败 → 回滚，避免破坏服务器副本
        try { state = normalizeState(JSON.parse(prev)); } catch (e) { state = normalizeState(null); }
        saveState();
        toast("导入失败：无法连接服务器，已保留原数据");
        return;
      }
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
      go("dashboard");
      toast("数据已导入");
    } catch (err) {
      toast("导入失败，请检查 JSON 文件");
    }
  };
  reader.readAsText(file);
}

async function resetData() {
  if (!confirm("确定清空当前数据并恢复演示数据吗？")) return;
  const prev = JSON.stringify(state);
  state = normalizeState(null);
  const ok = await flushState();
  if (!ok && auth.token) {
    // 推送失败 → 回滚，避免服务器副本被破坏性操作清空后丢失
    try { state = normalizeState(JSON.parse(prev)); } catch (e) { state = normalizeState(null); }
    saveState();
    toast("重置失败：无法连接服务器，已保留原数据");
    return;
  }
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  go("dashboard");
  toast("已恢复演示数据");
}

// —— 清空初始演示数据（仅管理员）——
// 从 data.js 的内置演示数据提取 id 集合（含 id/code），服务器据此删除所有用户文件里的演示项
function buildDemoIds() {
  const ids = (arr) => (arr || []).map((x) => x && (x.id || x.code)).filter(Boolean);
  return {
    clients: ids(DEMO_CLIENTS),
    products: ids(TRADE_DATA.products),
    orders: ids(TRADE_DATA.orders),
    quotes: ids(DEMO_QUOTES),
    hsCodes: ids(TRADE_DATA.hsCodes),
    colorDict: ids(TRADE_DATA.colorDict),
  };
}
async function clearDemoData() {
  if (!confirm("将删除所有账号里内置的演示数据（演示客户/产品/订单/报价/HS编码/颜色字典），不会删除你自行添加的数据。此操作不可撤销，确定继续？")) return;
  try {
    const r = await fetch("api/state/clear-demo", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + auth.token },
      body: JSON.stringify({ demoIds: buildDemoIds() })
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || "操作失败"); return; }
    toast(`已清除 ${d.cleared || 0} 条演示数据`);
    // 强制从服务器重载（绕过"本地更新优先"保护），让清除后的数据立即生效
    clearTimeout(serverSaveTimer); serverSaveTimer = null;
    try {
      const res = await fetch("api/state", { headers: { Authorization: "Bearer " + auth.token }, cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") { state = normalizeState(data); localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
      }
    } catch (e) { /* ignore */ }
    renderSettings();
    if (typeof renderDashboard === "function") renderDashboard();
  } catch (e) { toast("无法连接服务器"); }
}

// —— Ctrl+K 全局搜索 ——
function openGlobalSearch() {
  openModal(`
    <div class="modal modal-global-search">
      <div class="modal-head"><h3>全局搜索</h3><button class="icon-btn" id="modalCloseBtn"><i data-lucide="x"></i></button></div>
      <input id="globalSearchInput" class="search-input full" placeholder="搜索客户 / 订单 / 报价 / 产品 / HS 编码…（Enter 打开第一个结果）" autocomplete="off">
      <div id="globalSearchResults" class="global-search-results"></div>
      <div class="hint">快捷键：Ctrl / ⌘ + K 随时打开</div>
    </div>`);
  const input = $("#globalSearchInput");
  if (input) {
    input.focus();
    input.addEventListener("input", renderGlobalSearch);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = document.querySelector("#globalSearchResults .gs-item");
        if (first) first.click();
      }
      if (e.key === "Escape") closeModal();
    });
  }
  const wrap = $("#globalSearchResults");
  if (wrap) {
    wrap.addEventListener("click", (e) => {
      const item = e.target.closest(".gs-item");
      if (item) gsGo(item.dataset.action, item.dataset.id, item.dataset.code);
    });
  }
  $("#globalSearchResults").innerHTML = `<div class="hint">输入关键词开始搜索</div>`;
}

function renderGlobalSearch() {
  const q = ($("#globalSearchInput").value || "").trim().toLowerCase();
  const wrap = $("#globalSearchResults");
  if (!wrap) return;
  if (!q) { wrap.innerHTML = `<div class="hint">输入关键词开始搜索</div>`; return; }
  const groups = [];
  const clientHits = state.clients.filter((c) => `${c.name} ${c.company} ${c.email} ${c.country}`.toLowerCase().includes(q)).slice(0, 5);
  if (clientHits.length) groups.push({ label: "客户", items: clientHits.map((c) => `<button class="gs-item" data-action="client" data-id="${c.id}"><strong>${esc(c.company || c.name)}</strong><span>${esc(c.country)} · ${esc(c.status)}</span></button>`) });
  const orderHits = state.orders.filter((o) => `${o.poNo} ${o.clientName} ${o.product}`.toLowerCase().includes(q)).slice(0, 5);
  if (orderHits.length) groups.push({ label: "订单", items: orderHits.map((o) => `<button class="gs-item" data-action="order" data-id="${o.id}"><strong>${esc(o.poNo)}</strong><span>${esc(o.clientName)} · ${esc(o.product)}</span></button>`) });
  const quoteHits = state.quotes.filter((x) => `${x.ref} ${x.clientName} ${x.product}`.toLowerCase().includes(q)).slice(0, 5);
  if (quoteHits.length) groups.push({ label: "报价", items: quoteHits.map((x) => `<button class="gs-item" data-action="quote" data-id="${x.id}"><strong>${esc(x.ref)}</strong><span>${esc(x.clientName)} · ${esc(x.product)}</span></button>`) });
  const productHits = state.products.filter((p) => `${p.model} ${p.name} ${p.hsCode}`.toLowerCase().includes(q)).slice(0, 5);
  if (productHits.length) groups.push({ label: "产品", items: productHits.map((p) => `<button class="gs-item" data-action="product" data-id="${p.id}"><strong>${esc(p.model)} ${esc(p.name)}</strong><span>${esc(p.hsCode)}</span></button>`) });
  const hsHits = hsAll().filter((h) => `${h.code} ${h.name || ""} ${h.keywords || ""}`.toLowerCase().includes(q)).slice(0, 5);
  if (hsHits.length) groups.push({ label: "HS 编码", items: hsHits.map((h) => `<button class="gs-item" data-action="hs" data-code="${esc(h.code)}"><strong>${esc(h.code)}</strong><span>${esc(h.name || h.category)}</span></button>`) });
  if (!groups.length) { wrap.innerHTML = `<div class="empty-state">没有匹配结果</div>`; return; }
  wrap.innerHTML = groups.map((g) => `<div class="gs-group"><div class="gs-label">${esc(g.label)}</div>${g.items.join("")}</div>`).join("");
}

function gsGo(action, id, code) {
  closeModal();
  if (action === "client") { go("clients"); clientDetail(id); }
  else if (action === "order") { go("orders"); orderModal(id); }
  else if (action === "quote") { go("quotes"); quoteModal(id); }
  else if (action === "product") {
    const p = state.products.find((x) => x.id === id);
    go("products");
    $("#productSearch").value = (p && p.name) || "";
    renderProducts();
  }
  else if (action === "hs") { go("hs"); $("#hsSearch").value = code || ""; renderHs(); }
}

const renderers = {
  dashboard: renderDashboard,
  quote: renderQuote,
  products: renderProducts,
  logistics: renderLogistics,
  currency: renderCurrency,
  unit: renderUnit,
  timezone: renderTimezone,
  clients: renderClients,
  quotes: renderQuotes,
  orders: renderOrders,
  email: renderEmails,
  terms: renderTerms,
  countries: renderCountries,
  hs: renderHs,
  glossary: renderGlossary,
  docs: renderDocs,
  settings: renderSettings
};

function init() {
  $("#todayBadge").textContent = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  // 版本号显示（登录页）
  const vEl = $("#appVersion");
  if (vEl) vEl.textContent = APP_VERSION;

  $("#menuBtn").addEventListener("click", openSidebar);
  $("#overlay").addEventListener("click", closeSidebar);
  $$(".nav-item").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.section)));
  $("#quickQuoteBtn").addEventListener("click", () => go("quote"));

  document.addEventListener("click", (e) => {
    const goto = e.target.closest("[data-goto]");
    if (goto) go(goto.dataset.goto);
    const editClient = e.target.closest(".js-edit-client");
    if (editClient) clientModal(editClient.dataset.id);
    const viewClient = e.target.closest(".js-view-client");
    if (viewClient) clientDetail(viewClient.dataset.id);
    const delClient = e.target.closest(".js-del-client");
    if (delClient) {
      if (confirm("确定删除该客户吗？")) {
        state.clients = state.clients.filter((c) => c.id !== delClient.dataset.id);
        saveState();
        renderClients();
        toast("客户已删除");
      }
    }
    const tplBtn = e.target.closest(".template-item");
    if (tplBtn) {
      if (tplBtn.dataset.custom) {
        const body = state.customEmails[tplBtn.dataset.custom] || "";
        // 走统一入口，确保变量面板随自定义模板刷新
        selectEmailTemplate({ category: $("#emailCategory").value, title: tplBtn.dataset.custom.split(":")[1], body });
      } else {
        const tpl = TRADE_DATA.emailTemplates.filter((t) => t.category === tplBtn.dataset.cat)[Number(tplBtn.dataset.tpl)];
        if (tpl) selectEmailTemplate(tpl);
      }
      renderEmails();
    }
    const countryBtn = e.target.closest(".country-item");
    if (countryBtn) renderCountryDetail(countryBtn.dataset.country);
    const cityChip = e.target.closest(".city-chip");
    if (cityChip) {
      $("#tzClient").value = cityChip.dataset.tz;
      calcTz();
    }
    const dhOpen = e.target.closest(".js-dh-open");
    if (dhOpen) loadDocHistory(dhOpen.dataset.id);
    const dhPrint = e.target.closest(".js-dh-print");
    if (dhPrint) { if (loadDocHistory(dhPrint.dataset.id)) printDoc(); }
    const dhPdf = e.target.closest(".js-dh-pdf");
    if (dhPdf) { if (loadDocHistory(dhPdf.dataset.id)) genDocPdf($("#docGenType").value); }
    const dhDel = e.target.closest(".js-dh-del");
    if (dhDel) {
      state.docHistory = state.docHistory.filter((x) => x.id !== dhDel.dataset.id);
      saveState();
      renderDocHistory();
    }
    const dashClient = e.target.closest(".js-dash-client");
    if (dashClient) clientDetail(dashClient.dataset.id);
    const dashQuote = e.target.closest(".js-dash-quote");
    if (dashQuote) quoteModal(dashQuote.dataset.id);
    const dashOrder = e.target.closest(".js-dash-order");
    if (dashOrder) { go("orders"); orderModal(dashOrder.dataset.id); }
    const quotePdf = e.target.closest(".js-quote-pdf");
    if (quotePdf) {
      const q = state.quotes.find((x) => x.id === quotePdf.dataset.id);
      const doc = q && quotationPdf(q);
      if (doc) openPdfPreview(doc, `${(q.ref || "quotation").replace(/[^\w-]/g, "")}-quotation.pdf`, "报价单预览");
    }
    const copyQuote = e.target.closest(".js-copy-quote");
    if (copyQuote) copyQuoteSummary(copyQuote.dataset.id);
    const toOrder = e.target.closest(".js-to-order");
    if (toOrder) quoteToOrder(toOrder.dataset.id);
    const delQuote = e.target.closest(".js-del-quote");
    if (delQuote) {
      if (confirm("确定删除该报价记录吗？")) {
        state.quotes = state.quotes.filter((q) => q.id !== delQuote.dataset.id);
        saveState();
        renderQuotes();
        toast("报价已删除");
      }
    }
    const loadProduct = e.target.closest(".js-load-product");
    if (loadProduct) loadProductToQuote(loadProduct.dataset.id);
    const editProduct = e.target.closest(".js-edit-product");
    if (editProduct) productModal(editProduct.dataset.id);
    const delProduct = e.target.closest(".js-del-product");
    if (delProduct) {
      if (confirm("确定删除该产品吗？")) {
        state.products = state.products.filter((p) => p.id !== delProduct.dataset.id);
        saveState();
        renderProducts();
        toast("产品已删除");
      }
    }
    const copyOrder = e.target.closest(".js-copy-order");
    if (copyOrder) copyOrderSummary(copyOrder.dataset.id);
    const editOrder = e.target.closest(".js-edit-order");
    if (editOrder) orderModal(editOrder.dataset.id);
    const delOrder = e.target.closest(".js-del-order");
    if (delOrder) {
      if (confirm("确定删除该订单吗？")) {
        state.orders = state.orders.filter((o) => o.id !== delOrder.dataset.id);
        saveState();
        renderOrders();
        toast("订单已删除");
      }
    }
    const copyGlossary = e.target.closest(".js-copy-glossary");
    if (copyGlossary) copyText(copyGlossary.dataset.text || "");
    const editHs = e.target.closest(".js-edit-hs");
    if (editHs) hsModal(editHs.dataset.id);
    const delHs = e.target.closest(".js-del-hs");
    if (delHs) {
      if (confirm("确定删除该 HS 编码吗？")) {
        state.hsCodes = state.hsCodes.filter((h) => h.id !== delHs.dataset.id);
        saveState();
        renderHs();
        toast("HS 编码已删除");
      }
    }
    const saveProductBtn = e.target.closest("#modalSaveProductBtn");
    if (saveProductBtn) saveProductFromModal(saveProductBtn.dataset.id || null);
    const saveOrderBtn = e.target.closest("#modalSaveOrderBtn");
    if (saveOrderBtn) saveOrderFromModal(saveOrderBtn.dataset.id || null);
    const saveClientBtn = e.target.closest("#modalSaveClientBtn");
    if (saveClientBtn) saveClientFromModal(saveClientBtn.dataset.id || null);
    const saveHsBtn = e.target.closest("#modalSaveHsBtn");
    if (saveHsBtn) saveHsFromModal(saveHsBtn.dataset.id || null);
    const saveQuoteBtn = e.target.closest("#modalSaveQuoteBtn");
    if (saveQuoteBtn) saveQuoteFromModal(saveQuoteBtn.dataset.id || null);
  });

  $("#calcQuoteBtn").addEventListener("click", calcQuote);
  $("#qIncoterm").addEventListener("change", updateQuoteTermsHint);
  $("#section-quote .form-grid").addEventListener("input", updateQuoteRequiredMarks);
  $("#section-quote .form-grid").addEventListener("change", updateQuoteRequiredMarks);
  $("#reverseQuoteBtn").addEventListener("click", reverseQuote);
  $("#qFreightFromLogisticsBtn").addEventListener("click", applyFreightToQuote);
  $("#qRefreshRateBtn").addEventListener("click", fetchLatestRateForQuote);
  $("#saveQuoteBtn").addEventListener("click", saveQuoteFromCalc);
  $("#copyQuoteSummaryBtn").addEventListener("click", copyCalcQuoteSummary);
  $("#qProductSelect").addEventListener("change", (e) => { if (e.target.value) loadProductToQuote(e.target.value); else renderQuote(); });
  // 产品名称支持从产品库点选（选中后填入英文名并带出成本/数量）
  const qProductEl = $("#qProduct");
  if (qProductEl) {
    attachProductDropdown(qProductEl, (inp, p) => { loadProductToQuote(p.id); });
  }
  // 报价数量变化 → 自动命中产品价格阶梯
  $("#qQty").addEventListener("input", () => {
    const pid = $("#qProductSelect").value;
    const p = state.products.find((x) => x.id === pid);
    if (!p || !(p.priceTiers || []).length) return;
    const tier = productTierPrice(p, Number($("#qQty").value) || 0);
    if (tier) $("#qCost").value = tier.price;
  });
  $("#qCurrency").addEventListener("change", () => {
    const cur = $("#qCurrency").value;
    if (state.rates[cur]) $("#qRate").value = (state.rates.CNY / state.rates[cur]).toFixed(4);
  });
  $("#calcLogisticsBtn").addEventListener("click", calcLogistics);
  $("#calcFreightBtn").addEventListener("click", calcFreight);
  $("#logisticsSettingsBtn").addEventListener("click", openLogisticsSettings);
  $("#frRoute").addEventListener("change", applyFreightRoute);
  $("#addLogisticsItemBtn").addEventListener("click", addLogisticsItem);
  $("#copyLogisticsPlanBtn").addEventListener("click", copyLogisticsPlan);
  $("#logisticsItemsTable").addEventListener("input", (e) => {
    const tr = e.target.closest(".logistics-item-row");
    if (!tr) return;
    const idx = Number(tr.dataset.idx);
    const item = {
      id: state.logisticsItems[idx]?.id || uid(),
      name: tr.querySelector(".lg-name")?.value.trim() || `货物${idx + 1}`,
      len: Number(tr.querySelector(".lg-len")?.value) || 0,
      width: Number(tr.querySelector(".lg-width")?.value) || 0,
      height: Number(tr.querySelector(".lg-height")?.value) || 0,
      weight: Number(tr.querySelector(".lg-weight")?.value) || 0,
      qty: Number(tr.querySelector(".lg-qty")?.value) || 0
    };
    state.logisticsItems[idx] = item;
    tr.querySelector(".lg-subtotal").textContent = fmt((item.len * item.width * item.height) / 1000000 * item.qty, 3);
    saveState();
  });
  $("#logisticsItemsTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-del-logistics-item");
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    state.logisticsItems.splice(idx, 1);
    if (!state.logisticsItems.length) state.logisticsItems.push({ id: uid(), name: "货物1", len: 60, width: 40, height: 35, weight: 18, qty: 100 });
    saveState();
    renderLogisticsItems();
  });

  $("#productSearch").addEventListener("input", renderProducts);
  $("#addProductBtn").addEventListener("click", () => productModal(null));
  $("#exportProductsBtn").addEventListener("click", exportProducts);
  $("#colorDictBtn").addEventListener("click", openColorDict);

  $("#orderSearch").addEventListener("input", renderOrders);
  $("#orderFilter").addEventListener("change", renderOrders);
  $("#addOrderBtn").addEventListener("click", () => orderModal(null));
  $("#exportOrdersBtn").addEventListener("click", exportOrders);
  $("#orderTable").addEventListener("change", (e) => {
    const sel = e.target.closest(".js-order-status");
    if (!sel) return;
    const o = state.orders.find((x) => x.id === sel.dataset.id);
    if (o) { o.status = sel.value; saveState(); renderOrders(); toast("订单状态已更新"); }
  });

  $("#hsSearch").addEventListener("input", renderHs);
  $("#hsFilter").addEventListener("change", renderHs);
  $("#addHsBtn").addEventListener("click", () => hsModal(null));
  $("#exportHsBtn").addEventListener("click", exportHs);
  $("#importHsBtn").addEventListener("click", () => $("#hsImportFile").click());
  $("#hsImportFile").addEventListener("change", (e) => { if (e.target.files[0]) importHsCsv(e.target.files[0]); e.target.value = ""; });
  $("#resetHsBtn").addEventListener("click", resetHsCodes);
  $("#glossarySearch").addEventListener("input", renderGlossary);
  $("#glossaryFilter").addEventListener("change", renderGlossary);

  $("#refreshRatesBtn").addEventListener("click", refreshRates);
  $("#curAmount").addEventListener("input", convertCurrency);
  $("#curFrom").addEventListener("change", convertCurrency);
  $("#curTo").addEventListener("change", convertCurrency);
  $("#swapCurBtn").addEventListener("click", () => { const f = $("#curFrom").value; $("#curFrom").value = $("#curTo").value; $("#curTo").value = f; convertCurrency(); });
  $("#rateTable").addEventListener("input", (e) => {
    const cell = e.target.closest("input[data-rate]");
    if (!cell) return;
    const code = cell.dataset.rate;
    const v = Number(cell.value);
    if (cell.value.trim() === "" || !isFinite(v) || v <= 0) { cell.value = state.rates[code] || ""; return; }
    state.rates[code] = v;
    saveState();
    // 同步刷新该行反向列与换算结果，避免显示过期数据
    const inv = cell.closest("tr")?.querySelector("td:nth-child(4)");
    if (inv) inv.textContent = fmt(1 / v, 6);
    convertCurrency();
  });

  $("#unitCat").addEventListener("change", () => { fillUnitSelects(); convertUnit(); });
  $("#unitValue").addEventListener("input", convertUnit);
  $("#unitFrom").addEventListener("change", convertUnit);
  $("#unitTo").addEventListener("change", convertUnit);
  $("#calcUnitBtn").addEventListener("click", convertUnit);

  $("#tzMine").addEventListener("change", calcTz);
  $("#tzClient").addEventListener("change", calcTz);
  $("#tzMyStart").addEventListener("change", calcTz);
  $("#tzMyEnd").addEventListener("change", calcTz);
  $("#calcTzBtn").addEventListener("click", calcTz);

  $("#clientSearch").addEventListener("input", renderClients);
  $("#clientFilter").addEventListener("change", renderClients);
  $("#clientLevelFilter").addEventListener("change", renderClients);
  $("#clientSourceFilter").addEventListener("change", renderClients);
  $("#addClientBtn").addEventListener("click", () => clientModal(null));
  $("#exportClientsBtn").addEventListener("click", exportClients);
  $("#importClientsBtn").addEventListener("click", () => $("#clientImportFile").click());
  $("#clientImportFile").addEventListener("change", (e) => { if (e.target.files[0]) importClientsCsv(e.target.files[0]); e.target.value = ""; });

  $("#quoteSearch").addEventListener("input", renderQuotes);
  $("#quoteFilter").addEventListener("change", renderQuotes);
  $("#addQuoteBtn").addEventListener("click", () => quoteModal(null));
  $("#exportQuotesBtn").addEventListener("click", exportQuotes);
  $("#quoteTable").addEventListener("change", (e) => {
    const sel = e.target.closest(".js-quote-status");
    if (!sel) return;
    const q = state.quotes.find((x) => x.id === sel.dataset.id);
    if (q) { q.status = sel.value; saveState(); renderQuotes(); toast("状态已更新"); }
  });

  $("#emailCategory").addEventListener("change", renderEmails);
  $("#applyVarsBtn").addEventListener("click", applyEmailVars);
  $("#copyEmailBtn").addEventListener("click", () => copyText($("#emailContent").value));
  $("#saveCustomTemplateBtn").addEventListener("click", saveCustomEmail);
  $("#sendEmailBtn").addEventListener("click", sendEmailViaClient);
  $("#emailSrcClient").addEventListener("change", () => {
    const c = state.clients.find((x) => x.id === $("#emailSrcClient").value);
    if (c) fillEmailVarsFrom({ _label: "客户", name: c.name, company: c.company, email: c.email, phone: c.phone });
  });
  $("#emailSrcQuote").addEventListener("change", () => {
    const q = state.quotes.find((x) => x.id === $("#emailSrcQuote").value);
    if (q) fillEmailVarsFrom({ _label: "报价", name: q.clientName, company: q.clientName, product: q.product, unitPrice: q.unitPrice, currency: q.currency, date: q.date, amount: (Number(q.unitPrice) || 0) * (Number(q.qty) || 0), qty: q.qty, payment: q.payment, delivery: q.delivery, validity: q.validity, port: q.port, ref: q.ref });
  });
  $("#emailSrcOrder").addEventListener("change", () => {
    const o = state.orders.find((x) => x.id === $("#emailSrcOrder").value);
    if (o) fillEmailVarsFrom({ _label: "订单", name: o.clientName, company: o.clientName, product: o.product, qty: o.qty, amount: o.amount, currency: o.currency, poNo: o.poNo, payment: o.payment, deliveryDate: o.deliveryDate, tracking: o.tracking });
  });

  $("#countrySearch").addEventListener("input", renderCountries);

  $("#docMode").addEventListener("change", renderDocs);
  $("#docGenType").addEventListener("change", () => { applyDocFieldVisibility(); updateDocRequiredMarks(); updateDocFieldHint(); updateDocEnMarks(); });
  // 单证英文字段实时英文标记
  $("#section-docs").addEventListener("input", (e) => {
    if (e.target.matches("[data-doc-field] input, [data-doc-field] textarea, #docItemsTable .di-desc, #docItemsTable .di-hs")) updateDocEnMarks();
  });
  $("#docChecklist").addEventListener("change", saveDocCheck);
  $("#docChecklist").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-doc-pdf");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      genDocPdf(btn.dataset.gen);
    }
  });
  $("#genDocBtn").addEventListener("click", genDoc);
  $("#genDocPdfBtn").addEventListener("click", () => genDocPdf($("#docGenType").value));
  $("#printDocBtn").addEventListener("click", printDoc);
  $("#docHistoryClearBtn").addEventListener("click", () => {
    if (!confirm("确定清空全部已生成单证记录吗？")) return;
    state.docHistory = [];
    saveState();
    renderDocHistory();
  });
  $("#exportCheckedPdfBtn").addEventListener("click", exportCheckedPdf);
  $("#copyDocBtn").addEventListener("click", () => copyText($("#docOutput").value));
  $("#addDocItemBtn").addEventListener("click", addDocItem);
  $("#docItemsTable").addEventListener("input", (e) => {
    const tr = e.target.closest(".doc-item-row");
    if (!tr) return;
    const qty = tr.querySelector(".di-qty")?.value || "";
    const price = tr.querySelector(".di-price")?.value || "";
    const amountTd = tr.querySelector(".di-amount");
    if (amountTd) amountTd.textContent = fmt(docItemAmount({ qty, unitPrice: price }), 2);
    updateDocTotal();
    collectDocData();
    updateDocRequiredMarks();
    updateDocEnMarks();
  });
  $("#docItemsTable").addEventListener("click", (e) => {
    const btn = e.target.closest(".js-del-doc-item");
    if (!btn) return;
    state.docBuilder.docItems.splice(Number(btn.dataset.i), 1);
    renderDocItems();
    collectDocData();
    updateDocRequiredMarks();
    updateDocEnMarks();
  });
  $("#docOrderSelect").addEventListener("change", (e) => { if (e.target.value) fillDocFromOrder(e.target.value); });
  $("#docClearBtn").addEventListener("click", () => {
    state.docBuilder = { ...defaultState().docBuilder, seller: state.settings.company || "", terms: state.settings.defaultIncoterm || "", payment: state.settings.defaultPayment || "" };
    saveState();
    $("#docOrderSelect").value = "";
    renderDocs();
    toast("单证信息已清空");
  });
  $$("#section-docs input, #section-docs select, #section-docs textarea").forEach((el) => {
    el.addEventListener("input", () => { if (el.id.startsWith("doc")) { collectDocData(); updateDocRequiredMarks(); updateDocEnMarks(); } });
    el.addEventListener("change", () => { if (el.id.startsWith("doc")) { collectDocData(); updateDocRequiredMarks(); updateDocEnMarks(); } });
  });

  $("#saveSettingsBtn").addEventListener("click", saveSettings);
  $("#exportDataBtn").addEventListener("click", exportData);
  $("#importDataBtn").addEventListener("click", () => $("#importDataFile").click());
  $("#importDataFile").addEventListener("change", (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; });
  $("#resetDataBtn").addEventListener("click", resetData);
  $("#clearDemoBtn")?.addEventListener("click", clearDemoData);
  // 用户管理（管理员）
  $("#refreshUsersBtn")?.addEventListener("click", renderUserManagement);
  $("#userManageList")?.addEventListener("click", (e) => {
    const resetBtn = e.target.closest(".js-user-reset");
    if (resetBtn) { resetUserPassword(resetBtn.dataset.user); return; }
    const roleBtn = e.target.closest(".js-user-role");
    if (roleBtn) { setUserRole(roleBtn.dataset.user, roleBtn.dataset.role); return; }
    const delBtn = e.target.closest(".js-user-del");
    if (delBtn) { deleteUser(delBtn.dataset.user); return; }
  });
  // 授权/试用（设置页激活，仅管理员可见）
  $("#activateLicenseBtn")?.addEventListener("click", activateLicense);

  // 登录/注册
  $("#authLoginBtn").addEventListener("click", doLogin);
  $("#authUsername").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("#authPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
  $("#authShowRegister").addEventListener("click", () => {
    $("#authLoginForm").style.display = "none";
    $("#authRegisterForm").style.display = "block";
    $("#authError").textContent = "";
  });
  $("#authShowLogin").addEventListener("click", () => {
    $("#authRegisterForm").style.display = "none";
    $("#authLoginForm").style.display = "block";
    $("#authError2").textContent = "";
  });
  $("#regBtn").addEventListener("click", doRegister);
  $("#logoutBtn").addEventListener("click", logout);

  $("#clientFilter").innerHTML = `<option value="">全部状态</option>` + ["潜在客户", "已联系", "报价中", "跟进中", "已成交", "流失"].map((s) => `<option>${s}</option>`).join("");
  $("#clientLevelFilter").innerHTML = `<option value="">全部等级</option>` + ["A", "B", "C"].map((s) => `<option>${s}</option>`).join("");
  $("#clientSourceFilter").innerHTML = `<option value="">全部来源</option>` + ["展会", "阿里国际站", "转介绍", "官网询盘", "自主开发", "社媒", "其他"].map((s) => `<option>${s}</option>`).join("");
  $("#quoteFilter").innerHTML = `<option value="">全部状态</option>` + ["新报价", "跟进中", "已成交", "丢失"].map((s) => `<option>${s}</option>`).join("");
  $("#orderFilter").innerHTML = `<option value="">全部状态</option>` + ORDER_STATUSES.map((s) => `<option>${s}</option>`).join("");
  $("#hsFilter").innerHTML = `<option value="">全部分类</option>` + [...new Set(hsAll().map((h) => h.category))].map((s) => `<option>${esc(s)}</option>`).join("");
  $("#glossaryFilter").innerHTML = `<option value="">全部分类</option>` + [...new Set(TRADE_DATA.glossary.map((g) => g.category))].map((s) => `<option>${esc(s)}</option>`).join("");
  $("#emailCategory").innerHTML = TRADE_DATA.emailCategories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("");

  const initial = location.hash.replace("#", "");
  go(sectionMeta[initial] ? initial : "dashboard");
  // 多用户：由服务器提供时需登录；file:// 本地模式直接进入
  initAuth();
  // 汇率超过 12 小时未更新则静默自动刷新一次
  if (!state.ratesUpdatedAt || Date.now() - state.ratesUpdatedAt > 12 * 3600 * 1000) refreshRates(true);
  window.addEventListener("hashchange", () => {
    const id = location.hash.replace("#", "");
    if (sectionMeta[id]) go(id);
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "k" || e.key === "K")) {
      e.preventDefault();
      openGlobalSearch();
    }
  });
  setInterval(() => {
    updateClocks();
    if ($("#section-dashboard").classList.contains("active")) renderDashboard();
  }, 20000);
  // 关页/刷新前尽量把排队中的改动写回服务器（keepalive 有大小限制，best-effort）
  window.addEventListener("pagehide", () => {
    if (!auth.token || !serverSaveTimer) return;
    clearTimeout(serverSaveTimer);
    serverSaveTimer = null;
    try {
      fetch("api/state", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + auth.token },
        body: JSON.stringify(state)
      }).catch(() => { /* ignore */ });
    } catch (e) { /* ignore */ }
  });
}

document.addEventListener("DOMContentLoaded", init);
