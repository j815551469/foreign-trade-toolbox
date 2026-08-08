// Trade Toolbox server.js — 局域网多用户服务器（零 npm 依赖）
// v1.1 商用加固：限流 / 强密码策略 / PBKDF2 60 万次 / 恒定时间比较 / 令牌版本撤销 /
//              原子写 + 备份轮转 / 状态校验 / CSP / 可选 HTTPS / 授权·试用门控 / 审计日志
// 商用部署须知见 docs/COMMERCIALIZATION.md
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const license = require("./license");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "data");

// —— v1.0 升级兼容：v1.0 把 users.json / .secret 放在部署根目录，v1.1 迁入 data/ ——
// 若 data/ 无该文件而部署根目录有 → 自动迁移；迁移失败则继续用旧位置（不丢账号）
function ensureDirs() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error("[FATAL] 无法创建数据目录:", DATA_DIR, e.message); }
}
ensureDirs();
function resolveDataFile(name) {
  const target = path.join(DATA_DIR, name);
  const legacy = path.join(__dirname, name);
  if (fs.existsSync(legacy) && !fs.existsSync(target)) {
    try { fs.renameSync(legacy, target); console.log(`[migrate] ${name} → data/${name}（v1.0 升级自动迁移）`); return target; }
    catch (e) { return legacy; }
  }
  return target;
}
const USERS_FILE = resolveDataFile("users.json");
const SECRET_FILE = resolveDataFile(".secret");

// —— 密码与令牌策略 ——
// env 可覆盖，但带下限校验（防止把 PBKDF2 迭代/最短密码设成无效值）
function envInt(name, def, floor, ceil) {
  const v = Number(process.env[name]);
  if (!Number.isFinite(v)) return def;
  return Math.min(Math.max(Math.floor(v), floor), ceil || Infinity);
}
const MIN_PW = envInt("MIN_PW", 8, 6, 128); // 最短密码（注册 + 管理员重置）
const MAX_PW = 128; // 最长为避免超大输入拖慢 PBKDF2
const PBKDF2_ITER = envInt("PBKDF2_ITER", 600000, 60000, 5000000); // 新哈希迭代数（OWASP ≥ 60 万）
const LEGACY_ITER = 10000; // 旧版迭代数，登录成功时自动重哈希迁移
const TOKEN_TTL = 7 * 24 * 3600 * 1000; // 7 天
const STATE_MAX_BYTES = 25 * 1024 * 1024; // 单用户状态上限（含 headroom）

// —— 注册邀请码：未配置或为已知默认值时自动生成随机码并持久化（见 COMMERCIALIZATION.md §2.1）——
function resolveRegisterKey() {
  const env = String(process.env.REGISTER_KEY || "").trim();
  const known = { trade123: true };
  if (env && !known[env]) return env;
  const file = path.join(DATA_DIR, "register-key.txt");
  try {
    const saved = fs.readFileSync(file, "utf8").trim();
    if (saved && !known[saved]) return saved;
  } catch (e) { /* 首次启动 */ }
  const fresh = crypto.randomBytes(8).toString("hex");
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, fresh); } catch (e) { /* 只读目录则每次生成 */ }
  return fresh;
}
const REGISTER_KEY = resolveRegisterKey();

// —— 审计日志（控制台 + data/audit.log，保留最近约 2MB）——
function audit(event, detail) {
  // detail 可能含用户输入（用户名等）→ 剔除换行，防 CRLF 注入伪造审计日志
  const line = `${new Date().toISOString()} [${event}] ${String(detail).replace(/[\r\n]+/g, " ")}`;
  console.log("AUDIT " + line);
  try {
    const f = path.join(DATA_DIR, "audit.log");
    try {
      const st = fs.statSync(f);
      if (st.size > 4 * 1024 * 1024) {
        // 保留最近 2MB（读尾部重写，避免把最新审计事件丢掉）
        const fd = fs.openSync(f, "r");
        const buf = Buffer.alloc(2 * 1024 * 1024);
        const bytes = fs.readSync(fd, buf, 0, buf.length, st.size - buf.length);
        fs.closeSync(fd);
        fs.writeFileSync(f, buf.slice(0, bytes));
      }
    } catch (e) { /* 无旧日志 */ }
    fs.appendFileSync(f, line + "\n");
  } catch (e) { /* 日志目录不可写则只打控制台 */ }
}

// —— 限流：内存固定窗口（按 IP + 类别），认证类先拦截再哈希（不消耗算力）——
// 注册限流放宽：注册还受随机邀请码门槛约束，真正的爆破目标是登录；各值可用 env 覆盖（便于部署调优/测试）
const RATE = {
  login: { limit: envInt("RATE_LOGIN", 20, 1, 10000), windowMs: 15 * 60 * 1000 },
  register: { limit: envInt("RATE_REGISTER", 30, 1, 10000), windowMs: 15 * 60 * 1000 },
  admin: { limit: envInt("RATE_ADMIN", 20, 1, 10000), windowMs: 15 * 60 * 1000 },
  license: { limit: envInt("RATE_LICENSE", 10, 1, 10000), windowMs: 15 * 60 * 1000 },
  state: { limit: envInt("RATE_STATE", 300, 1, 100000), windowMs: 60 * 1000 },
};
const rateBuckets = new Map();
// 状态写入队列（按用户）：串行化并发保存，避免旧数据覆盖新数据
const stateWriteQueues = new Map();

// —— HS 编码在线更新（hs-update/ 目录 + Python 管线）——
const HS_UPDATE_DIR = path.join(__dirname, "hs-update");
const HS_LAST_UPDATE_FILE = path.join(HS_UPDATE_DIR, "last-update.json");
// 纯 Node 更新引擎（run-update.js），无需 Python；spawn process.execPath 复用当前 node
const HS_RUNNER = path.join(HS_UPDATE_DIR, "run-update.js");
const hsUpdate = {
  running: false,
  startedAt: 0,
  stage: "idle", // idle | starting | fetching | aggregating | building | publishing
  totalChapters: 0,
  chaptersDone: 0,
  currentChapter: "",
  entries: 0,
  proc: null,
  clients: new Set(),
  finished: false,  // 已收 DONE（成功）
  settled: false,   // 已收 ERROR/PARTIAL（有明确结论，exit 时不再补 error）
  stopping: false,  // 用户点了「停止更新」，exit 处理器不再补 error
};
// 看门狗：进程已退出但 running 仍为 true 时（理论上 exit 处理器已清），强制复位，防止「更新中」卡死
setInterval(() => {
  if (hsUpdate.running && hsUpdate.proc && hsUpdate.proc.exitCode !== null) {
    hsUpdate.running = false;
    hsUpdate.proc = null;
    hsBroadcast("error", { message: "更新进程异常退出，已自动复位，请重新点击「在线更新」" });
    hsBroadcast("close", {});
    hsCloseClients();
    audit("hs.update.watchdog", "reset stuck running flag");
  }
}, 30000).unref();
function rateLimit(key, category) {
  const cfg = RATE[category] || RATE.login;
  const now = Date.now();
  let b = rateBuckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + cfg.windowMs }; rateBuckets.set(key, b); }
  b.count++;
  return { ok: b.count <= cfg.limit, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of rateBuckets) if (b.resetAt <= now) rateBuckets.delete(k);
}, 10 * 60 * 1000).unref();

// —— 安全响应头 / CSP（不启用 upgrade-insecure-requests：当前为明文 HTTP）——
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://open.er-api.com; worker-src 'self'; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "SAMEORIGIN",
};

// —— 基础：密钥 / 目录 / 原子写 ——
function getSecret() {
  try { return fs.readFileSync(SECRET_FILE, "utf8").trim(); }
  catch (e) {
    const s = crypto.randomBytes(32).toString("hex");
    try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SECRET_FILE, s); } catch (e2) { /* 只读目录 */ }
    return s;
  }
}
const SECRET = getSecret();

// 同步原子写（备用工具；SQLite 已接管主存储）
function atomicWriteSync(file, data) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); } catch (e) { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); }
}

// —— SQLite 存储（node:sqlite 内置，零依赖；v1.2）——
let DB = null;
const DB_FILE = path.join(DATA_DIR, "trade-toolbox.db");
function initDb() {
  try {
    const { DatabaseSync } = require("node:sqlite");
    DB = new DatabaseSync(DB_FILE);
    DB.exec("PRAGMA journal_mode=WAL;");
    DB.exec(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        salt TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL DEFAULT '',
        iter INTEGER NOT NULL DEFAULT 10000,
        pwdVersion INTEGER NOT NULL DEFAULT 1,
        displayName TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user'
      );
      CREATE TABLE IF NOT EXISTS user_state (
        username TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0
      );
    `);
    rotateDbBackup();
    migrateLegacyData();
    return true;
  } catch (e) {
    console.error("[WARN] SQLite 不可用，回退 JSON 文件存储:", e.message);
    return false;
  }
}
const USE_SQLITE = initDb();

// 启动时对 .db 做 3 档轮转备份（trade-toolbox.db.bak1=最新 … .bak3=最旧）
function rotateDbBackup() {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    fs.rmSync(DB_FILE + ".bak3", { force: true });
    if (fs.existsSync(DB_FILE + ".bak2")) fs.renameSync(DB_FILE + ".bak2", DB_FILE + ".bak3");
    if (fs.existsSync(DB_FILE + ".bak1")) fs.renameSync(DB_FILE + ".bak1", DB_FILE + ".bak2");
    fs.copyFileSync(DB_FILE, DB_FILE + ".bak1");
  } catch (e) { /* 只读目录忽略 */ }
}

// 旧版 JSON 文件 → SQLite 一次性迁移（仅当库为空；旧文件保留作备份）
function migrateLegacyData() {
  try {
    const uc = DB.prepare("SELECT COUNT(*) c FROM users").get().c;
    const sc = DB.prepare("SELECT COUNT(*) c FROM user_state").get().c;
    if (uc === 0 && fs.existsSync(USERS_FILE)) {
      const users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
      const ins = DB.prepare("INSERT OR REPLACE INTO users (username, salt, hash, iter, pwdVersion, displayName, createdAt, role) VALUES (?,?,?,?,?,?,?,?)");
      for (const [u, d] of Object.entries(users)) ins.run(u, d.salt || "", d.hash || "", Number(d.iter) || LEGACY_ITER, Number(d.pwdVersion) || 1, d.displayName || "", d.createdAt || "", d.role || "user");
      console.log("[migrate] users.json → SQLite");
    }
    if (sc === 0) {
      const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "users.json" && !f.includes(".bak") && !f.startsWith("."));
      const ins = DB.prepare("INSERT OR REPLACE INTO user_state (username, data, updated_at) VALUES (?,?,?)");
      let n = 0;
      for (const f of files) {
        try { ins.run(f.replace(/\.json$/, ""), fs.readFileSync(path.join(DATA_DIR, f), "utf8"), Date.now()); n++; } catch (e) { /* ignore */ }
      }
      if (n) console.log(`[migrate] ${n} 个用户状态文件 → SQLite`);
    }
  } catch (e) { console.error("[migrate] 迁移失败:", e.message); }
}

function userStateFilePath(username) {
  return path.join(DATA_DIR, String(username).replace(/[^A-Za-z0-9_.\-一-龥]/g, "_") + ".json");
}
// 用户状态写（SQLite 事务性原子；回退为 JSON 文件）
function saveStateFile(username, data, cb) {
  if (USE_SQLITE) {
    try {
      DB.prepare("INSERT INTO user_state (username, data, updated_at) VALUES (?,?,?) ON CONFLICT(username) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").run(username, String(data), Date.now());
      return cb(null);
    } catch (e) { return cb(e); }
  }
  const file = userStateFilePath(username);
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFile(tmp, data, (err) => {
    if (err) return cb(err);
    fs.rename(tmp, file, (e) => cb(e || null));
  });
}
function readUserState(username) {
  if (USE_SQLITE) {
    try {
      const r = DB.prepare("SELECT data FROM user_state WHERE username=?").get(username);
      return r ? String(r.data) : "{}";
    } catch (e) { return "{}"; }
  }
  const file = userStateFilePath(username);
  try { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}"; } catch (e) { return "{}"; }
}
function deleteUserData(username) {
  if (USE_SQLITE) {
    try { DB.prepare("DELETE FROM user_state WHERE username=?").run(username); } catch (e) { /* ignore */ }
  }
  try { const file = userStateFilePath(username); fs.rmSync(file, { force: true }); for (let i = 1; i <= 3; i++) fs.rmSync(file + ".bak" + i, { force: true }); } catch (e) { /* ignore */ }
}

// —— 用户账号 ——
function loadUsers() {
  const users = {};
  if (USE_SQLITE) {
    try {
      const rows = DB.prepare("SELECT * FROM users").all();
      for (const r of rows) users[r.username] = { salt: r.salt, hash: r.hash, iter: r.iter, pwdVersion: r.pwdVersion, displayName: r.displayName, createdAt: r.createdAt, role: r.role };
    } catch (e) { /* ignore */ }
  } else {
    try { Object.assign(users, JSON.parse(fs.readFileSync(USERS_FILE, "utf8"))); } catch (e) { /* ignore */ }
  }
  let changed = false, hasAdmin = false;
  for (const n of Object.keys(users)) {
    if (!users[n].role) { users[n].role = "user"; changed = true; }
    if (!users[n].pwdVersion) { users[n].pwdVersion = 1; changed = true; }
    if (!users[n].iter) { users[n].iter = LEGACY_ITER; changed = true; }
    if (users[n].role === "admin") hasAdmin = true;
  }
  // 兼容存量：无管理员时把第一个用户提升（注册已用随机邀请码保护，见 COMMERCIALIZATION.md）
  if (!hasAdmin && Object.keys(users).length) { users[Object.keys(users)[0]].role = "admin"; changed = true; }
  if (changed) saveUsers(users);
  return users;
}
function saveUsers(users) {
  if (USE_SQLITE) {
    try {
      const upsert = DB.prepare("INSERT OR REPLACE INTO users (username, salt, hash, iter, pwdVersion, displayName, createdAt, role) VALUES (?,?,?,?,?,?,?,?)");
      for (const [u, d] of Object.entries(users)) upsert.run(u, d.salt || "", d.hash || "", Number(d.iter) || LEGACY_ITER, Number(d.pwdVersion) || 1, d.displayName || "", d.createdAt || "", d.role || "user");
    } catch (e) { console.error("[DB] saveUsers 失败:", e.message); }
  } else {
    atomicWriteSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
}
// 删除单个用户账号（从 users 表移除）
function deleteUserRecord(username) {
  if (USE_SQLITE) {
    try { DB.prepare("DELETE FROM users WHERE username=?").run(username); } catch (e) { /* ignore */ }
  }
  // 回退路径也尝试从 users.json 删除
  if (!USE_SQLITE) {
    try {
      const users = loadUsers();
      delete users[username];
      saveUsers(users);
    } catch (e) { /* ignore */ }
  }
}
function isAdmin(username) {
  const u = loadUsers()[username];
  return !!(u && u.role === "admin");
}
function findUserKey(users, username) {
  // 大小写不敏感查找：注册禁止了大小写撞名，登录时统一走这里解析出规范用户名
  if (users[username]) return username;
  const hit = Object.keys(users).find((k) => k.toLowerCase() === String(username).toLowerCase());
  return hit || null;
}

// —— 密码哈希（PBKDF2-SHA256，恒定时间比较）——
function hashPassword(pw, salt, iter) {
  return crypto.pbkdf2Sync(String(pw), salt, iter, 32, "sha256").toString("hex");
}
function timingSafeHexEq(a, b) {
  const ba = Buffer.from(String(a || ""), "hex");
  const bb = Buffer.from(String(b || ""), "hex");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function verifyPassword(user, pw) {
  const iter = Number(user.iter) || LEGACY_ITER;
  return timingSafeHexEq(hashPassword(pw, user.salt, iter), user.hash);
}

// —— 令牌（HMAC 签名，带密码版本号 → 改密/登出即失效）——
function signToken(username, pwdVersion) {
  const payload = Buffer.from(JSON.stringify({ u: username, v: Number(pwdVersion) || 1, exp: Date.now() + TOKEN_TTL })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifyToken(token) {
  try {
    const [payload, sig] = String(token || "").split(".");
    if (!payload || !sig) return null;
    const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    const eb = Buffer.from(expect, "base64url");
    const sb = Buffer.from(sig, "base64url");
    if (eb.length !== sb.length || !crypto.timingSafeEqual(eb, sb)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (Date.now() > Number(data.exp)) return null;
    return { username: String(data.u), version: Number(data.v) || 1 };
  } catch (e) { return null; }
}
// 鉴权：令牌有效 + 账号存在 + 密码版本匹配 + 授权未到期（非管理员）
// 授权到期后，非管理员的实时会话立即失效（管理员保留以便激活授权）
function authToken(token) {
  const t = verifyToken(token);
  if (!t) return null;
  const users = loadUsers();
  const u = users[t.username];
  if (!u || (Number(u.pwdVersion) || 1) !== t.version) return null;
  const role = u.role || "user";
  if (role !== "admin" && license.status(DATA_DIR).mode === "expired") return null;
  return { username: t.username, role, displayName: u.displayName || t.username };
}
function authUser(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  return authToken(token);
}

// —— 授权 / 试用 ——
function licenseInfo() { return license.status(DATA_DIR); }
function userCount() { return Object.keys(loadUsers()).length; }

// —— 请求体（分块累积 + 上限 413，避免内存 OOM / O(n²) 拼接）——
function readBody(req, cb, maxBytes) {
  const limit = maxBytes || STATE_MAX_BYTES;
  const chunks = [];
  let size = 0;
  let done = false;
  req.on("data", (chunk) => {
    if (done) return;
    size += chunk.length;
    if (size > limit) {
      done = true;
      try { if (!req.res.headersSent) json(req.res, 413, { error: "请求体过大" }); } catch (e) { /* ignore */ }
      req.resume(); // 继续接收并丢弃剩余数据，让 413 能正常发出；不立即 destroy（会 ECONNRESET 丢掉响应）
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => { if (!done) cb(Buffer.concat(chunks).toString("utf8")); });
  req.on("error", () => { done = true; });
}
function parseJsonBody(body) {
  try {
    const d = JSON.parse(body || "{}");
    return d && typeof d === "object" && !Array.isArray(d) ? d : null;
  } catch (e) { return null; }
}

// —— HTTP 响应辅助 ——
function withSecurity(extra) { return { ...SECURITY_HEADERS, ...(extra || {}) }; }
function json(res, code, obj) {
  res.writeHead(code, withSecurity({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }));
  res.end(JSON.stringify(obj));
}
function plain(res, code, text) {
  res.writeHead(code, withSecurity({ "Content-Type": "text/plain; charset=utf-8" }));
  res.end(text);
}

// ================== HS 编码在线更新 ==================

function readHsLastUpdate() {
  try {
    const d = JSON.parse(fs.readFileSync(HS_LAST_UPDATE_FILE, "utf8"));
    if (d && typeof d === "object") {
      return {
        lastUpdate: d.lastUpdate || null,
        count: Number(d.count) || 0,
        added: Number.isFinite(Number(d.added)) ? Number(d.added) : undefined,
        updated: Number.isFinite(Number(d.updated)) ? Number(d.updated) : undefined,
        kept: Number.isFinite(Number(d.kept)) ? Number(d.kept) : undefined,
        okChapters: Number.isFinite(Number(d.okChapters)) ? Number(d.okChapters) : undefined,
        totalChapters: Number.isFinite(Number(d.totalChapters)) ? Number(d.totalChapters) : undefined,
        complete: d.complete,
        missing: d.missing || "",
      };
    }
  } catch (e) { /* 缺失/损坏 → null */ }
  return { lastUpdate: null, count: 0 };
}

function hsBroadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data || {})}\n\n`;
  for (const c of hsUpdate.clients) {
    try { c.res.write(payload); } catch (e) { hsUpdate.clients.delete(c); }
  }
}

function hsCloseClients() {
  for (const c of hsUpdate.clients) {
    try {
      if (c.heartbeat) clearInterval(c.heartbeat);
      c.res.end();
    } catch (e) { /* ignore */ }
  }
  hsUpdate.clients.clear();
}

function hsSnapshot() {
  return {
    running: hsUpdate.running,
    stage: hsUpdate.stage,
    startedAt: hsUpdate.startedAt,
    totalChapters: hsUpdate.totalChapters,
    chaptersDone: hsUpdate.chaptersDone,
    currentChapter: hsUpdate.currentChapter,
    entries: hsUpdate.entries,
  };
}

// Node 更新引擎 stdout 标记解析（见 run-update.js 标记协议）
const HS_MARKERS = {
  start: /^===HS_UPDATE_START===$/,
  fetch: /^===HS_UPDATE_FETCH\s+(\d+)\s*===$/,
  prog: /^PROGRESS\s+(\d+)\s*\/\s*(\d+)\s+chapter=(\S+)\s+entries=(\d+)\s*$/,
  aggregate: /^===HS_UPDATE_AGGREGATE===$/,
  build: /^===HS_UPDATE_BUILD===$/,
  done: /^===HS_UPDATE_DONE\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*===$/,
  partial: /^===HS_UPDATE_PARTIAL\s+(\d+)\s+(\d+)\s*===$/,
  error: /^===HS_UPDATE_ERROR\s+(.+?)\s*===$/,
};

function hsHandleLine(line) {
  let m;
  if (HS_MARKERS.fetch.test(line)) {
    hsUpdate.totalChapters = Number(line.match(HS_MARKERS.fetch)[1]);
    hsUpdate.stage = "fetching";
    hsUpdate.chaptersDone = 0;
    hsBroadcast("stage", { stage: "fetching", totalChapters: hsUpdate.totalChapters });
    return;
  }
  if ((m = line.match(HS_MARKERS.prog))) {
    hsUpdate.chaptersDone = Number(m[1]);
    hsUpdate.totalChapters = Number(m[2]);
    hsUpdate.currentChapter = m[3];
    hsUpdate.entries = Number(m[4]);
    hsBroadcast("progress", {
      done: hsUpdate.chaptersDone, total: hsUpdate.totalChapters,
      chapter: m[3], entries: hsUpdate.entries, pct: Math.round(Number(m[1]) * 100 / Number(m[2])),
    });
    return;
  }
  if (HS_MARKERS.aggregate.test(line)) { hsUpdate.stage = "aggregating"; hsBroadcast("stage", { stage: "aggregating" }); return; }
  if (HS_MARKERS.build.test(line)) { hsUpdate.stage = "building"; hsBroadcast("stage", { stage: "building" }); return; }
  if ((m = line.match(HS_MARKERS.done))) {
    const count = Number(m[1]), added = Number(m[2]), updated = Number(m[3]), kept = Number(m[4]);
    const okChapters = Number(m[5]), totalChapters = Number(m[6]);
    const missing = m[7] === "-" ? "" : m[7], lastUpdate = m[8].trim();
    hsUpdate.finished = true;
    hsUpdate.settled = true;
    hsUpdate.stage = "publishing";
    hsBroadcast("done", { count, added, updated, kept, okChapters, totalChapters, missing, lastUpdate });
    hsBroadcast("close", {});
    hsCloseClients();
    audit("hs.update.done", `count=${count} added=${added} updated=${updated} kept=${kept} ok=${okChapters}/${totalChapters} missing=${missing || '-'} lastUpdate=${lastUpdate}`);
    return;
  }
  if ((m = line.match(HS_MARKERS.partial))) {
    const newCount = Number(m[1]), oldCount = Number(m[2]);
    hsUpdate.settled = true;
    hsBroadcast("error", { message: `抓取不完整（${newCount} 条 < 现有 ${oldCount} 条），未覆盖现有数据，可再次点击「在线更新」续传` });
    hsBroadcast("close", {});
    hsCloseClients();
    audit("hs.update.partial", `new=${newCount} old=${oldCount}`);
    return;
  }
  if ((m = line.match(HS_MARKERS.error))) {
    hsUpdate.settled = true;
    hsBroadcast("error", { message: m[1].trim() });
    hsBroadcast("close", {});
    hsCloseClients();
    audit("hs.update.error", m[1].trim());
    return;
  }
  // 普通行 → 转发为 log（每码进度、logger 警告等）
  hsBroadcast("log", { text: line });
}

function hsStartUpdate(req, res) {
  if (hsUpdate.running) { json(res, 200, { started: false, alreadyRunning: true }); return; }
  const target = path.join(ROOT, "hs-detail.js");
  // 纯 Node 引擎：复用当前 node.exe（process.execPath），无需 Python
  const proc = spawn(process.execPath, [HS_RUNNER, "--out", target], {
    cwd: HS_UPDATE_DIR, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  hsUpdate.running = true;
  hsUpdate.startedAt = Date.now();
  hsUpdate.stage = "starting";
  hsUpdate.totalChapters = 0;
  hsUpdate.chaptersDone = 0;
  hsUpdate.currentChapter = "";
  hsUpdate.entries = 0;
  hsUpdate.finished = false;
  hsUpdate.settled = false;
  hsUpdate.proc = proc;

  let pending = "";
  proc.stdout.setEncoding("utf8");
  proc.stdout.on("data", (chunk) => {
    pending += chunk;
    let nl;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).replace(/\r$/, "");
      pending = pending.slice(nl + 1);
      hsHandleLine(line);
    }
  });
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", (chunk) => {
    pending += chunk;
    let nl;
    while ((nl = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, nl).replace(/\r$/, "");
      pending = pending.slice(nl + 1);
      hsBroadcast("log", { text: line });
    }
  });
  proc.on("exit", (code) => {
    hsUpdate.proc = null;
    hsUpdate.running = false;
    if (hsUpdate.stopping) {
      // 用户主动停止：hsStopUpdate 已广播 stopped + 清理，这里只清标记
      hsUpdate.stopping = false;
      return;
    }
    // 先清 flag 再处理尾部行：任何情况下都不允许 running 卡死
    try { if (pending.trim()) hsHandleLine(pending.trim()); } catch (e) { /* 忽略尾部行解析异常 */ }
    if (!hsUpdate.finished && !hsUpdate.settled) {
      hsBroadcast("error", { message: `更新中断（退出码 ${code}），旧数据完好，可重试续传` });
      hsBroadcast("close", {});
      hsCloseClients();
      audit("hs.update.abort", `code=${code}`);
    }
  });
  proc.on("error", (err) => {
    hsUpdate.proc = null;
    hsUpdate.running = false;
    hsBroadcast("error", { message: "无法启动更新进程：" + err.message });
    hsBroadcast("close", {});
    hsCloseClients();
    audit("hs.update.spawn.error", err.message);
  });
  hsBroadcast("stage", { stage: "starting" });
  json(res, 200, { started: true });
}

// 停止更新：杀进程树 + 删除本次抓取的临时数据（out/*.json + .incomplete）
// 已发布的数据（hs-detail.js / last-update.json）不受影响 → 不覆盖之前的数据
function hsStopUpdate(req, res) {
  if (!hsUpdate.running) { json(res, 200, { ok: false, message: "当前没有正在进行的更新" }); return; }
  hsUpdate.stopping = true;
  if (hsUpdate.proc && hsUpdate.proc.pid) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(hsUpdate.proc.pid), "/T", "/F"], { timeout: 5000 });
      else try { hsUpdate.proc.kill("SIGKILL"); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }
  // 删除本次抓取的临时数据 + 续传标记 + 聚合产物（已发布的 hs-detail.js 不动）
  // 进程刚被强杀，Windows 文件句柄可能未立即释放 → 重试删除
  const sleepSync = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (e) { /* ignore */ } };
  try {
    const outDir = path.join(HS_UPDATE_DIR, "out");
    if (fs.existsSync(outDir)) {
      for (const f of fs.readdirSync(outDir)) {
        if (/^\d{2}\.json$/.test(f) || f === ".incomplete" || f === "_all.json" || f === "_rollup.json") {
          const p = path.join(outDir, f);
          for (let attempt = 0; attempt < 8; attempt++) {
            try { fs.unlinkSync(p); break; } catch (e) {
              if (attempt < 7) sleepSync(250);
            }
          }
        }
      }
    }
  } catch (e) { /* ignore */ }
  hsBroadcast("stopped", { message: "更新已停止，本次抓取的数据已删除，未覆盖之前的数据" });
  hsBroadcast("close", {});
  hsCloseClients();
  hsUpdate.running = false;
  hsUpdate.proc = null;
  hsUpdate.finished = true;   // 收尾完成，exit 处理器不会再补 error
  hsUpdate.settled = true;
  audit("hs.update.stop", "manual stop, partial data cleared");
  json(res, 200, { ok: true, message: "更新已停止，本次抓取的数据已删除" });
}

function hsConnectSSE(req, res, me) {
  res.writeHead(200, withSecurity({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  }));
  res.write("retry: 3000\n\n");
  const client = { res, heartbeat: null };
  const snapshot = hsSnapshot();
  if (!hsUpdate.running) {
    res.write(`event: snapshot\ndata: ${JSON.stringify({ ...snapshot, running: false })}\n\n`);
    res.write(`event: close\ndata: {}\n\n`);
    res.end();
    return;
  }
  hsUpdate.clients.add(client);
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  client.heartbeat = setInterval(() => {
    try { client.res.write(": ping\n\n"); } catch (e) { clearInterval(client.heartbeat); hsUpdate.clients.delete(client); }
  }, 25000);
  client.heartbeat.unref && client.heartbeat.unref();
  req.on("close", () => {
    if (client.heartbeat) clearInterval(client.heartbeat);
    hsUpdate.clients.delete(client);
  });
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".pdf": "application/pdf",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};

// —— 主处理 ——
const handler = (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch (e) { pathname = url.pathname; }
    const method = req.method;
    const ip = req.socket.remoteAddress || "?";
    const rlKey = (cat) => ip + ":" + cat;

    // ---- API ----
    if (pathname === "/api/health") { json(res, 200, { ok: true, multiUser: true, mode: licenseInfo().mode, version: "v1.1" }); return; }

    if (pathname === "/api/license" && method === "GET") {
      const st = licenseInfo();
      // 机器码是签发授权所需（客户读给授权方），故公开；不暴露注册码配置等敏感信息
      // adminAccount：登录页显示"试用账号/初始密码"提示（仅提示，密码本身不存储，靠 TRIAL_PASS_HINT 或默认）
      const users = loadUsers();
      const adminName = Object.keys(users).find((n) => users[n].role === "admin") || "";
      const me = authUser(req);
      const isAdminReq = !!(me && me.role === "admin");
      const hasAdmin = Object.keys(users).some((n) => users[n].role === "admin");
      json(res, 200, {
        ...st,
        userCount: userCount(),
        // adminAccount：登录页提示试用管理员账号名（密码是注册时自己设置的，不提示）
        adminAccount: { username: adminName },
        // 注册邀请码：仅在首次启动（尚无管理员）时给登录页；管理员在设置页可查看复制
        registerKey: (!hasAdmin || isAdminReq) ? REGISTER_KEY : undefined,
      });
      return;
    }
    if (pathname === "/api/license" && method === "POST") {
      // 授权码本身携带签名 + 机器绑定，即为激活凭据：允许登录前在登录页直接激活（无需先登录管理员）
      const rl = rateLimit(rlKey("license"), "license");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁，请稍后再试" }); return; }
      readBody(req, (body) => {
        const d = parseJsonBody(body);
        const key = String((d && d.key) || "").trim();
        if (!key) { json(res, 400, { error: "请粘贴授权码" }); return; }
        const me = authUser(req);
        const r = license.activate(DATA_DIR, key);
        audit("license.activate", `${me ? me.username : "(登录前激活)"} → ${r.ok ? "OK" : r.error}`);
        json(res, r.ok ? 200 : 400, r.ok ? { ok: true, ...r } : { error: r.error });
      });
      return;
    }
    if (pathname === "/api/license/cancel" && method === "POST") {
      // 取消授权（仅管理员）：删除授权码，回到试用模式
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("license"), "license");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      const r = license.cancel(DATA_DIR);
      audit("license.cancel", `by=${me.username}`);
      json(res, r.ok ? 200 : 400, r.ok ? { ok: true, ...r } : { error: r.error });
      return;
    }

    if (pathname === "/api/register" && method === "POST") {
      const rl = rateLimit(rlKey("register"), "register");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁，请稍后再试" }); return; }
      readBody(req, (body) => {
        try {
          const d = parseJsonBody(body);
          const u = String((d && d.username) || "").trim();
          const pw = String((d && d.password) || "");
          const key = String((d && d.key) || "").trim();
          const display = String((d && d.displayName) || "").trim() || u;
          if (!u || !pw) { json(res, 400, { error: "用户名和密码不能为空" }); return; }
          if (pw.length < MIN_PW || pw.length > MAX_PW) { json(res, 400, { error: `密码长度需为 ${MIN_PW}-${MAX_PW} 位` }); return; }
          if (key !== REGISTER_KEY) { audit("register.fail", `ip=${ip} 邀请码错误 user=${u}`); json(res, 403, { error: "注册邀请码不正确" }); return; }
          if (!/^[A-Za-z0-9_.一-龥-]+$/.test(u)) { json(res, 400, { error: "用户名只能包含字母、数字、下划线、点、横杠或中文" }); return; }
          const st = licenseInfo();
          if (st.mode === "expired") { json(res, 403, { error: "试用已到期，请联系授权方激活（设置页输入授权码）", code: "LICENSE_EXPIRED" }); return; }
          const users = loadUsers();
          if (users[u] || Object.keys(users).some((k) => k.toLowerCase() === u.toLowerCase())) { json(res, 409, { error: "用户名已存在" }); return; }
          if (Object.keys(users).length >= (st.seats || 1)) { json(res, 403, { error: `授权人数已满（当前 ${st.seats} 席位），请联系授权方扩容`, code: "SEAT_FULL" }); return; }
          const isFirst = Object.keys(users).length === 0;
          const adminEnv = String(process.env.ADMIN_USERNAME || "").split(",").map((s) => s.trim()).filter(Boolean);
          const role = (isFirst || adminEnv.includes(u)) ? "admin" : "user";
          const salt = crypto.randomBytes(16).toString("hex");
          users[u] = { salt, hash: hashPassword(pw, salt, PBKDF2_ITER), iter: PBKDF2_ITER, pwdVersion: 1, displayName: display, createdAt: new Date().toISOString(), role };
          saveUsers(users);
          audit("register.ok", `${u} role=${role} seats=${Object.keys(users).length}/${st.seats} mode=${st.mode}`);
          json(res, 200, { ok: true, role });
        } catch (e) { json(res, 500, { error: "注册失败" }); }
      });
      return;
    }

    if (pathname === "/api/login" && method === "POST") {
      const rl = rateLimit(rlKey("login"), "login");
      if (!rl.ok) { json(res, 429, { error: "尝试次数过多，请稍后再试" }); return; }
      readBody(req, (body) => {
        try {
          const d = parseJsonBody(body);
          const u = String((d && d.username) || "").trim();
          const pw = String((d && d.password) || "");
          const users = loadUsers();
          const key = findUserKey(users, u);
          const user = key ? users[key] : null;
          if (!user) {
            // 用户不存在也执行同成本哈希，均衡响应时序，防用户名枚举
            hashPassword("timing-equalizer", crypto.randomBytes(16).toString("hex"), PBKDF2_ITER);
            audit("login.fail", `user=${u} ip=${ip}`);
            json(res, 401, { error: "用户名或密码错误" });
            return;
          }
          if (!verifyPassword(user, pw)) { audit("login.fail", `user=${u} ip=${ip}`); json(res, 401, { error: "用户名或密码错误" }); return; }
          // 旧哈希（低迭代）→ 登录成功后自动重哈希迁移到 60 万次
          if ((Number(user.iter) || LEGACY_ITER) !== PBKDF2_ITER) {
            try {
              user.salt = crypto.randomBytes(16).toString("hex");
              user.hash = hashPassword(pw, user.salt, PBKDF2_ITER);
              user.iter = PBKDF2_ITER;
              saveUsers(users);
            } catch (e) { /* 迁移失败不阻断登录 */ }
          }
          const st = licenseInfo();
          if (st.mode === "expired" && user.role !== "admin") { json(res, 403, { error: "试用已到期，请联系授权方激活（需管理员在设置页输入授权码）", code: "LICENSE_EXPIRED" }); return; }
          audit("login.ok", `user=${key}`);
          json(res, 200, { ok: true, token: signToken(key, user.pwdVersion), username: key, displayName: user.displayName || key, role: user.role || "user" });
        } catch (e) { json(res, 500, { error: "登录失败" }); }
      });
      return;
    }

    if (pathname === "/api/logout" && method === "POST") {
      const me = authUser(req);
      if (me) {
        // 登出 = 服务器端作废该用户全部令牌（bump 密码版本）
        const users = loadUsers();
        if (users[me.username]) {
          users[me.username].pwdVersion = (Number(users[me.username].pwdVersion) || 1) + 1;
          saveUsers(users);
          audit("logout", `user=${me.username}`);
        }
      }
      json(res, 200, { ok: true });
      return;
    }

    if (pathname === "/api/me") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      json(res, 200, { username: me.username, displayName: me.displayName, role: me.role });
      return;
    }

    // ---- 用户管理（仅管理员） ----
    if (pathname === "/api/users" && method === "GET") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("admin"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      const users = loadUsers();
      const list = Object.keys(users).map((n) => ({ username: n, displayName: users[n].displayName || n, role: users[n].role || "user", createdAt: users[n].createdAt || "" }));
      json(res, 200, { users: list });
      return;
    }

    if (pathname === "/api/users/reset" && method === "POST") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("admin"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      readBody(req, (body) => {
        try {
          const d = parseJsonBody(body);
          const target = String((d && d.username) || "").trim();
          const pw = String((d && d.password) || "");
          const users = loadUsers();
          const key = findUserKey(users, target);
          if (!key || !users[key]) { json(res, 404, { error: "用户不存在" }); return; }
          if (pw.length < MIN_PW || pw.length > MAX_PW) { json(res, 400, { error: `新密码长度需为 ${MIN_PW}-${MAX_PW} 位` }); return; }
          users[key].salt = crypto.randomBytes(16).toString("hex");
          users[key].hash = hashPassword(pw, users[key].salt, PBKDF2_ITER);
          users[key].iter = PBKDF2_ITER;
          users[key].pwdVersion = (Number(users[key].pwdVersion) || 1) + 1; // 作废旧令牌
          saveUsers(users);
          audit("user.reset", `by=${me.username} target=${key}`);
          json(res, 200, { ok: true });
        } catch (e) { json(res, 500, { error: "重置失败" }); }
      });
      return;
    }

    if (pathname === "/api/users/delete" && method === "POST") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("admin"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      readBody(req, (body) => {
        try {
          const d = parseJsonBody(body);
          const target = String((d && d.username) || "").trim();
          const users = loadUsers();
          const key = findUserKey(users, target);
          if (!key || !users[key]) { json(res, 404, { error: "用户不存在" }); return; }
          if (key === me.username) { json(res, 400, { error: "不能删除当前登录账号" }); return; }
          if (users[key].role === "admin" && Object.values(users).filter((u) => u.role === "admin").length <= 1) { json(res, 400, { error: "不能删除最后一名管理员" }); return; }
          delete users[key];
          saveUsers(users);
          deleteUserRecord(key); // 从 users 表删除
          deleteUserData(key); // 从 user_state / 旧 JSON 文件删除
          audit("user.delete", `by=${me.username} target=${key}`);
          json(res, 200, { ok: true });
        } catch (e) { json(res, 500, { error: "删除失败" }); }
      });
      return;
    }

    if (pathname === "/api/users/role" && method === "POST") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("admin"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      readBody(req, (body) => {
        try {
          const d = parseJsonBody(body);
          const target = String((d && d.username) || "").trim();
          const role = String((d && d.role) || "").trim();
          if (role !== "admin" && role !== "user") { json(res, 400, { error: "角色只能是 admin 或 user" }); return; }
          const users = loadUsers();
          const key = findUserKey(users, target);
          if (!key || !users[key]) { json(res, 404, { error: "用户不存在" }); return; }
          if (key === me.username && role !== "admin") { json(res, 400, { error: "不能取消自己的管理员权限" }); return; }
          if (role !== "admin" && users[key].role === "admin" && Object.values(users).filter((u) => u.role === "admin").length <= 1) { json(res, 400, { error: "不能取消最后一名管理员" }); return; }
          users[key].role = role;
          saveUsers(users);
          audit("user.role", `by=${me.username} target=${key} role=${role}`);
          json(res, 200, { ok: true });
        } catch (e) { json(res, 500, { error: "操作失败" }); }
      });
      return;
    }

    // ---- 用户数据（读写经校验 + 原子写 + 备份轮转） ----
    if (pathname === "/api/state") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (method === "GET") {
        const rl = rateLimit(rlKey("state"), "state");
        if (!rl.ok) { json(res, 429, { error: "请求过于频繁" }); return; }
        // 与写入串行化，读一致快照；SQLite 事务性原子
        const read = () => new Promise((resolve) => {
          const raw = readUserState(me.username);
          const parsed = parseJsonBody(raw);
          const ok = parsed && ["clients", "quotes", "orders", "products", "hsCodes"].every((k) => Array.isArray(parsed[k]));
          res.writeHead(200, withSecurity({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }));
          res.end(ok ? raw : "{}");
          resolve();
        });
        const queue = stateWriteQueues.get(me.username) || Promise.resolve();
        stateWriteQueues.set(me.username, queue.then(read, read));
        return;
      }
      if (method === "POST") {
        const rl = rateLimit(rlKey("state"), "state");
        if (!rl.ok) { json(res, 429, { error: "请求过于频繁" }); return; }
        readBody(req, (body) => {
          // 校验：必须是含核心集合键的对象，拒绝 null/{}/[]/垃圾串一键清空
          const parsed = parseJsonBody(body);
          const needArrays = ["clients", "quotes", "orders", "products", "hsCodes"];
          const valid = parsed && needArrays.every((k) => Array.isArray(parsed[k]));
          if (!valid) { audit("state.reject", `user=${me.username} 非法负载`); json(res, 400, { error: "数据格式无效，已拒绝保存（你的本地数据未受影响）" }); return; }
          // 按用户串行化写入，避免并发保存时旧数据覆盖新数据
          const write = () => new Promise((resolve) => {
            saveStateFile(me.username, body, (err) => {
              if (err) json(res, 500, { error: "保存失败" });
              else json(res, 200, { ok: true });
              resolve();
            });
          });
          const queue = stateWriteQueues.get(me.username) || Promise.resolve();
          stateWriteQueues.set(me.username, queue.then(write, write));
        });
        return;
      }
      json(res, 405, { error: "Method Not Allowed" });
      return;
    }

    // ---- 清空初始演示数据（仅管理员）：按演示 id / _demo 标记删除各用户文件中的演示数据，绝不碰用户自建数据 ----
    if (pathname === "/api/state/clear-demo" && method === "POST") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("admin"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      readBody(req, (body) => {
        try {
          const d = parseJsonBody(body);
          const demoIds = (d && d.demoIds) || {};
          const colls = ["clients", "products", "orders", "quotes", "hsCodes", "colorDict"];
          if (!colls.every((k) => Array.isArray(demoIds[k]))) { json(res, 400, { error: "参数无效" }); return; }
          let cleared = 0;
          const processState = (uname, raw) => {
            const state = JSON.parse(raw);
            if (!state || typeof state !== "object") return;
            let changed = false;
            colls.forEach((k) => {
              if (!Array.isArray(state[k])) return;
              const ids = new Set(demoIds[k]);
              const before = state[k].length;
              state[k] = state[k].filter((it) => !(it && (it._demo || ids.has(it.id) || ids.has(it.code))));
              cleared += before - state[k].length;
              if (before !== state[k].length) changed = true;
            });
            if (changed) {
              if (USE_SQLITE) DB.prepare("UPDATE user_state SET data=? WHERE username=?").run(JSON.stringify(state), uname);
              else atomicWriteSync(userStateFilePath(uname), JSON.stringify(state));
            }
          };
          if (USE_SQLITE) {
            const rows = DB.prepare("SELECT username, data FROM user_state").all();
            for (const row of rows) { try { processState(row.username, row.data); } catch (e) { /* 跳过损坏数据 */ } }
          } else {
            const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "users.json" && !f.includes(".bak") && !f.startsWith("."));
            files.forEach((f) => { try { processState(f.replace(/\.json$/, ""), fs.readFileSync(path.join(DATA_DIR, f), "utf8")); } catch (e) { /* ignore */ } });
          }
          audit("demo.clear", `by=${me.username} 清除演示数据 ${cleared} 条`);
          json(res, 200, { ok: true, cleared });
        } catch (e) { json(res, 500, { error: "操作失败" }); }
      });
      return;
    }

    // ---- 全量备份 / 恢复（仅管理员）----
    if (pathname === "/api/admin/backup" && method === "GET") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("admin"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      const users = loadUsers();
      const states = {};
      if (USE_SQLITE) {
        const rows = DB.prepare("SELECT username, data FROM user_state").all();
        for (const r of rows) states[r.username] = String(r.data);
      } else {
        const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "users.json" && !f.includes(".bak") && !f.startsWith("."));
        for (const f of files) { try { states[f.replace(/\.json$/, "")] = fs.readFileSync(path.join(DATA_DIR, f), "utf8"); } catch (e) { /* ignore */ } }
      }
      let licenseKey = "", registerKey = "";
      try { licenseKey = fs.readFileSync(path.join(DATA_DIR, "license.txt"), "utf8").trim(); } catch (e) { /* ignore */ }
      try { registerKey = fs.readFileSync(path.join(DATA_DIR, "register-key.txt"), "utf8").trim(); } catch (e) { /* ignore */ }
      const backup = { app: "trade-toolbox", version: "v1.2", exportedAt: new Date().toISOString(), users, states, licenseKey, registerKey };
      audit("admin.backup", `by=${me.username}`);
      const body = JSON.stringify(backup);
      res.writeHead(200, withSecurity({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="trade-toolbox-backup-${new Date().toISOString().slice(0, 10)}.json"` }));
      res.end(body);
      return;
    }
    if (pathname === "/api/admin/restore" && method === "POST") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("admin"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      readBody(req, (body) => {
        try {
          const b = JSON.parse(String(body).replace(/^﻿/, "")); // 兼容 BOM
          if (b.app !== "trade-toolbox" || !b.users || typeof b.users !== "object" || !b.states || typeof b.states !== "object") {
            json(res, 400, { error: "备份文件格式无效" }); return;
          }
          if (USE_SQLITE) { DB.prepare("DELETE FROM users").run(); }
          saveUsers(b.users);
          if (USE_SQLITE) { DB.prepare("DELETE FROM user_state").run(); }
          const up = USE_SQLITE ? DB.prepare("INSERT OR REPLACE INTO user_state (username, data, updated_at) VALUES (?,?,?)") : null;
          for (const [u, data] of Object.entries(b.states)) {
            if (USE_SQLITE) up.run(u, String(data), Date.now());
            else { try { fs.writeFileSync(userStateFilePath(u), String(data)); } catch (e) { /* ignore */ } }
          }
          const licFile = path.join(DATA_DIR, "license.txt");
          if (b.licenseKey) { try { fs.writeFileSync(licFile, b.licenseKey); } catch (e) { /* ignore */ } }
          else { try { fs.rmSync(licFile, { force: true }); } catch (e) { /* ignore */ } }
          if (b.registerKey) { try { fs.writeFileSync(path.join(DATA_DIR, "register-key.txt"), b.registerKey); } catch (e) { /* ignore */ } }
          audit("admin.restore", `by=${me.username} 恢复 ${Object.keys(b.users).length} 账号`);
          json(res, 200, { ok: true, restored: Object.keys(b.users).length });
        } catch (e) { json(res, 500, { error: "恢复失败：" + (e.message || "备份文件损坏") }); }
      });
      return;
    }

    // ---- HS 编码在线更新 ----
    if (pathname === "/api/hs/meta" && method === "GET") {
      const lu = readHsLastUpdate();
      json(res, 200, {
        lastUpdate: lu.lastUpdate,
        count: lu.count,
        added: lu.added, updated: lu.updated, kept: lu.kept,
        okChapters: lu.okChapters, totalChapters: lu.totalChapters,
        complete: lu.complete, missing: lu.missing,
        engine: "node", // 纯 Node 引擎，无需 Python
        updating: hsUpdate.running,
        chapters: hsUpdate.totalChapters || null,
      });
      return;
    }

    if (pathname === "/api/hs/update" && method === "POST") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("hs"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      hsStartUpdate(req, res);
      return;
    }

    if (pathname === "/api/hs/update/stop" && method === "POST") {
      const me = authUser(req);
      if (!me) { json(res, 401, { error: "未登录" }); return; }
      if (!isAdmin(me.username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const rl = rateLimit(rlKey("hs"), "admin");
      if (!rl.ok) { json(res, 429, { error: "操作过于频繁" }); return; }
      hsStopUpdate(req, res);
      return;
    }

    if (pathname === "/api/hs/update/stream" && method === "GET") {
      const me = authToken(url.searchParams.get("token") || "");
      if (!me || !isAdmin(me.username)) { plain(res, 403, "Forbidden"); return; }
      hsConnectSSE(req, res, me);
      return;
    }

    // ---- 静态文件 ----
    if (pathname === "/") pathname = "/index.html";
    let filePath = path.join(ROOT, pathname);
    const rel = path.relative(ROOT, filePath);
    if (rel.startsWith("..") || path.isAbsolute(rel)) { plain(res, 403, "Forbidden"); return; }
    fs.stat(filePath, (statErr, stat) => {
      if (!statErr && stat.isDirectory()) filePath = path.join(filePath, "index.html");
      fs.readFile(filePath, (readErr, data) => {
        if (readErr) { plain(res, 404, "Not Found"); return; }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, withSecurity({ "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" }));
        res.end(data);
      });
    });
  } catch (err) {
    try { plain(res, 500, "Server Error"); } catch (e) { /* ignore */ }
  }
};
const server = http.createServer(handler);

// 缓解慢速攻击
server.requestTimeout = 30 * 1000;
server.headersTimeout = 15 * 1000;

// 可选 HTTPS（SSL_CERT / SSL_KEY 或仓库根目录 cert.pem / key.pem，自签即可）
let listener = server;
const certFile = process.env.SSL_CERT || (fs.existsSync(path.join(__dirname, "cert.pem")) ? path.join(__dirname, "cert.pem") : null);
const keyFile = process.env.SSL_KEY || (fs.existsSync(path.join(__dirname, "key.pem")) ? path.join(__dirname, "key.pem") : null);
if (certFile && keyFile) {
  try {
    listener = https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, handler);
  } catch (e) { console.error("[WARN] HTTPS 证书读取失败，回退 HTTP:", e.message); listener = server; }
} else if (process.env.SSL_CERT || process.env.SSL_KEY) {
  console.warn("[WARN] 配置了 SSL 但 cert/key 文件缺失，继续以 HTTP 启动。");
}
// HTTPS 监听器也继承慢速攻击防护
if (listener !== server) {
  listener.requestTimeout = 30 * 1000;
  listener.headersTimeout = 15 * 1000;
}

listener.listen(PORT, HOST, () => {
  const st = licenseInfo();
  console.log(`Trade Toolbox v1.1 running at http${listener === server ? "" : "s"}://localhost:${PORT}`);
  console.log(`LAN access: http${listener === server ? "" : "s"}://<server-ip>:${PORT}`);
  console.log(`Serving: ${ROOT}  |  data dir: ${DATA_DIR}`);
  console.log(`Register key: ${REGISTER_KEY}  (部署后请修改 env REGISTER_KEY，或用首次启动自动生成的随机码)`);
  console.log(`License: mode=${st.mode}${st.mode === "licensed" ? ` company=${st.company} seats=${st.seats}` : st.mode === "trial" ? ` trialLeft=${st.daysLeft}天 seats=${st.seats}` : ""}`);
  if (st.mode === "licensed") {
    const uc = Object.keys(loadUsers()).length;
    if (uc > (st.seats || 1)) console.warn(`[WARN] 当前用户数 ${uc} 超过授权席位 ${st.seats}，请及时续费/扩容，否则新账号将无法注册`);
  }
  console.log(`Multi-user: ON  |  Admin: ${Object.keys(loadUsers()).filter((n) => loadUsers()[n].role === "admin").join(", ") || "(暂无，首个注册用户自动成为管理员)"}`);
  if (listener !== server) console.log("HTTPS: ON（已加载证书）");
  if (process.env.AUTO_OPEN === "1") {
    try { require("child_process").exec(`start http://localhost:${PORT}`); } catch (e) { /* ignore */ }
  }
});

function shutdown() {
  // 若 HS 更新 Python 进程存活，先杀进程树（win32 下 taskkill /T 覆盖孙进程 fetch_all）
  if (hsUpdate.proc && hsUpdate.proc.pid) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(hsUpdate.proc.pid), "/T", "/F"], { timeout: 5000 });
      else try { hsUpdate.proc.kill("SIGKILL"); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }
  try { listener.close(() => process.exit(0)); } catch (e) { process.exit(0); }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
