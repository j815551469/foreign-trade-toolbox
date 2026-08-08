// Trade Toolbox server.js — 局域网多用户服务器（零 npm 依赖）
// v1.1 商用加固：限流 / 强密码策略 / PBKDF2 60 万次 / 恒定时间比较 / 令牌版本撤销 /
//              原子写 + 备份轮转 / 状态校验 / CSP / 可选 HTTPS / 授权·试用门控 / 审计日志
// 商用部署须知见 docs/COMMERCIALIZATION.md
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

// 同步原子写（users.json 等小文件）
function atomicWriteSync(file, data) {
  const tmp = file + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, data);
  try { fs.renameSync(tmp, file); } catch (e) { fs.copyFileSync(tmp, file); fs.unlinkSync(tmp); }
}
// 异步原子写 + 备份轮转（state 文件：保留最近 3 份 .bak1=最新备份 … .bak3=最旧）
// 关键：Windows rename 不覆盖已存在文件，必须「从最旧往前腾位」（先删 bak3 → bak2→bak3 → bak1→bak2 → file→bak1）
function saveStateFile(file, data, cb) {
  const tmp = file + ".tmp-" + process.pid + "-" + Date.now();
  fs.writeFile(tmp, data, (err) => {
    if (err) return cb(err);
    const put = (e) => { if (e) return cb(e); fs.rename(tmp, file, (e2) => cb(e2 || null)); };
    fs.stat(file, (statErr) => {
      if (statErr) return put(null); // 无旧文件 → 直接写入
      // 先删最旧的 bak3 腾出位置
      fs.unlink(file + ".bak3", () => {
        const shift = (n) => { // n: 把第 n-1 档移入第 n 档（n=3→bak2入bak3 … n=1→file入bak1），最后 n=0 放新文件
          if (n < 1) return put(null);
          const to = n === 3 ? file + ".bak3" : file + ".bak" + n;
          const from = n === 1 ? file : file + ".bak" + (n - 1);
          fs.rename(from, to, (e) => {
            if (e && e.code !== "ENOENT") return cb(e);
            shift(n - 1);
          });
        };
        shift(3);
      });
    });
  });
}

// —— 用户账号 ——
function loadUsers() {
  let users;
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch (e) { return {}; }
  let changed = false, hasAdmin = false;
  for (const n of Object.keys(users)) {
    if (!users[n].role) { users[n].role = "user"; changed = true; }
    if (!users[n].pwdVersion) { users[n].pwdVersion = 1; changed = true; }
    if (!users[n].iter) { users[n].iter = LEGACY_ITER; changed = true; }
    if (users[n].role === "admin") hasAdmin = true;
  }
  // 兼容存量：无管理员时把第一个用户提升（注册已用随机邀请码保护，见 COMMERCIALIZATION.md）
  if (!hasAdmin && Object.keys(users).length) { users[Object.keys(users)[0]].role = "admin"; changed = true; }
  if (changed) { try { atomicWriteSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch (e) { /* ignore */ } }
  return users;
}
function saveUsers(users) {
  atomicWriteSync(USERS_FILE, JSON.stringify(users, null, 2));
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
function authUser(req) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  const t = verifyToken(token);
  if (!t) return null;
  const users = loadUsers();
  const u = users[t.username];
  if (!u || (Number(u.pwdVersion) || 1) !== t.version) return null;
  const role = u.role || "user";
  if (role !== "admin" && license.status(DATA_DIR).mode === "expired") return null;
  return { username: t.username, role, displayName: u.displayName || t.username };
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
      const passHint = String(process.env.TRIAL_PASS_HINT || "admin123");
      json(res, 200, {
        ...st,
        userCount: userCount(),
        adminAccount: { username: adminName, passHint },
        // 全新安装（尚无账号）时把注册邀请码直接给登录页，方便首次使用；注册第一个账号后不再暴露
        registerKey: Object.keys(users).length === 0 ? REGISTER_KEY : undefined,
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
          try { fs.unlinkSync(path.join(DATA_DIR, String(key).replace(/[^A-Za-z0-9_.\-一-龥]/g, "_") + ".json")); } catch (e) { /* 数据文件可能不存在 */ }
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
      const file = path.join(DATA_DIR, String(me.username).replace(/[^A-Za-z0-9_.\-一-龥]/g, "_") + ".json");
      if (method === "GET") {
        const rl = rateLimit(rlKey("state"), "state");
        if (!rl.ok) { json(res, 429, { error: "请求过于频繁" }); return; }
        // 与写入串行化：等该用户写入队列清空后再读，避免读到备份轮转中间的空窗（旧数据被读成空 → 客户端回写演示数据覆盖真数据）
        const read = () => new Promise((resolve) => {
          let raw = "{}";
          try {
            if (fs.existsSync(file)) raw = fs.readFileSync(file, "utf8");
            else if (fs.existsSync(file + ".bak1")) raw = fs.readFileSync(file + ".bak1", "utf8"); // 轮转间隙回退到上一版
          } catch (e) { /* fallthrough */ }
          // 校验：损坏/形状不符时返回空对象，绝不把坏数据当权威副本
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
            saveStateFile(file, body, (err) => {
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
        res.writeHead(200, withSecurity({ "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-cache" }));
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
  try { listener.close(() => process.exit(0)); } catch (e) { process.exit(0); }
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
