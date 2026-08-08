const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(__dirname, "users.json");
const SECRET_FILE = path.join(__dirname, ".secret");
// 注册邀请码：环境变量 REGISTER_KEY 可覆盖，默认 trade123
const REGISTER_KEY = process.env.REGISTER_KEY || "trade123";
const TOKEN_TTL = 7 * 24 * 3600 * 1000; // 7 天

// ---------- 基础 ----------
function getSecret() {
  try {
    return fs.readFileSync(SECRET_FILE, "utf8").trim();
  } catch (e) {
    const s = crypto.randomBytes(32).toString("hex");
    fs.writeFileSync(SECRET_FILE, s);
    return s;
  }
}
const SECRET = getSecret();

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
ensureDirs();

function loadUsers() {
  let users;
  try { users = JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); } catch (e) { return {}; }
  // 兼容：旧用户无 role 字段补 default；保证至少一名管理员（首个用户自动成为管理员）
  let changed = false, hasAdmin = false;
  const names = Object.keys(users);
  for (const n of names) {
    if (!users[n].role) { users[n].role = "user"; changed = true; }
    if (users[n].role === "admin") hasAdmin = true;
  }
  if (!hasAdmin && names.length) { users[names[0]].role = "admin"; changed = true; }
  if (changed) { try { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); } catch (e) {} }
  return users;
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}
function isAdmin(username) {
  const u = loadUsers()[username];
  return !!(u && u.role === "admin");
}

function hashPassword(pw, salt) {
  return crypto.pbkdf2Sync(String(pw), salt, 10000, 32, "sha256").toString("hex");
}

function signToken(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + TOKEN_TTL })).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return payload + "." + sig;
}
function verifyToken(token) {
  try {
    const [payload, sig] = String(token || "").split(".");
    const expect = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
    if (sig !== expect) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (Date.now() > data.exp) return null;
    return data.u;
  } catch (e) { return null; }
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function readBody(req, cb) {
  let body = "";
  req.on("data", (chunk) => { body += chunk; if (body.length > 20 * 1024 * 1024) req.destroy(); });
  req.on("end", () => cb(body));
}

function userFilePath(username) {
  // 用户名限定安全字符，避免路径穿越
  const safe = String(username).replace(/[^A-Za-z0-9_.\-一-龥]/g, "_");
  return path.join(DATA_DIR, safe + ".json");
}

function readUserState(username) {
  try {
    if (fs.existsSync(userFilePath(username))) return fs.readFileSync(userFilePath(username), "utf8");
  } catch (e) { /* ignore */ }
  return "{}";
}

// ---------- HTTP ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf"
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    let pathname = decodeURIComponent(url.pathname);
    const method = req.method;
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const username = verifyToken(token);

    // ---- API ----
    if (pathname === "/api/health") { json(res, 200, { ok: true, multiUser: true }); return; }

    if (pathname === "/api/register" && method === "POST") {
      readBody(req, (body) => {
        try {
          const d = JSON.parse(body || "{}");
          const u = String(d.username || "").trim();
          const pw = String(d.password || "");
          const key = String(d.key || "").trim();
          const display = String(d.displayName || "").trim() || u;
          if (!u || !pw) { json(res, 400, { error: "用户名和密码不能为空" }); return; }
          if (key !== REGISTER_KEY) { json(res, 403, { error: "注册邀请码不正确" }); return; }
          if (pw.length < 4) { json(res, 400, { error: "密码至少 4 位" }); return; }
          if (!/^[A-Za-z0-9_.一-龥-]+$/.test(u)) { json(res, 400, { error: "用户名只能包含字母、数字、下划线、点、横杠或中文" }); return; }
          const users = loadUsers();
          if (users[u]) { json(res, 409, { error: "用户名已存在" }); return; }
          // 首个注册用户自动成为管理员；也支持 ADMIN_USERNAME 环境变量指定管理员
          const isFirst = Object.keys(users).length === 0;
          const adminEnv = String(process.env.ADMIN_USERNAME || "").split(",").map((s) => s.trim()).filter(Boolean);
          const role = (isFirst || adminEnv.includes(u)) ? "admin" : "user";
          const salt = crypto.randomBytes(8).toString("hex");
          users[u] = { salt, hash: hashPassword(pw, salt), displayName: display, createdAt: new Date().toISOString(), role };
          saveUsers(users);
          json(res, 200, { ok: true, role });
        } catch (e) { json(res, 500, { error: "注册失败" }); }
      });
      return;
    }

    if (pathname === "/api/login" && method === "POST") {
      readBody(req, (body) => {
        try {
          const d = JSON.parse(body || "{}");
          const u = String(d.username || "").trim();
          const pw = String(d.password || "");
          const users = loadUsers();
          const user = users[u];
          if (!user || user.hash !== hashPassword(pw, user.salt)) { json(res, 401, { error: "用户名或密码错误" }); return; }
          json(res, 200, { ok: true, token: signToken(u), username: u, displayName: user.displayName || u, role: user.role || "user" });
        } catch (e) { json(res, 500, { error: "登录失败" }); }
      });
      return;
    }

    if (pathname === "/api/logout" && method === "POST") { json(res, 200, { ok: true }); return; }

    if (pathname === "/api/me") {
      if (!username) { json(res, 401, { error: "未登录" }); return; }
      const users = loadUsers();
      const u = users[username] || {};
      json(res, 200, { username, displayName: u.displayName || username, role: u.role || "user" });
      return;
    }

    // ---- 用户管理（仅管理员） ----
    if (pathname === "/api/users" && method === "GET") {
      if (!username || !isAdmin(username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      const users = loadUsers();
      const list = Object.keys(users).map((n) => ({ username: n, displayName: users[n].displayName || n, role: users[n].role || "user", createdAt: users[n].createdAt || "" }));
      json(res, 200, { users: list });
      return;
    }

    if (pathname === "/api/users/reset" && method === "POST") {
      if (!username || !isAdmin(username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      readBody(req, (body) => {
        try {
          const d = JSON.parse(body || "{}");
          const target = String(d.username || "").trim();
          const pw = String(d.password || "");
          const users = loadUsers();
          if (!users[target]) { json(res, 404, { error: "用户不存在" }); return; }
          if (pw.length < 4) { json(res, 400, { error: "新密码至少 4 位" }); return; }
          users[target].salt = crypto.randomBytes(8).toString("hex");
          users[target].hash = hashPassword(pw, users[target].salt);
          saveUsers(users);
          json(res, 200, { ok: true });
        } catch (e) { json(res, 500, { error: "重置失败" }); }
      });
      return;
    }

    if (pathname === "/api/users/delete" && method === "POST") {
      if (!username || !isAdmin(username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      readBody(req, (body) => {
        try {
          const d = JSON.parse(body || "{}");
          const target = String(d.username || "").trim();
          const users = loadUsers();
          if (!users[target]) { json(res, 404, { error: "用户不存在" }); return; }
          if (target === username) { json(res, 400, { error: "不能删除当前登录账号" }); return; }
          if (users[target].role === "admin" && Object.values(users).filter((u) => u.role === "admin").length <= 1) { json(res, 400, { error: "不能删除最后一名管理员" }); return; }
          delete users[target];
          saveUsers(users);
          try { fs.unlinkSync(userFilePath(target)); } catch (e) { /* 数据文件可能不存在 */ }
          json(res, 200, { ok: true });
        } catch (e) { json(res, 500, { error: "删除失败" }); }
      });
      return;
    }

    if (pathname === "/api/users/role" && method === "POST") {
      if (!username || !isAdmin(username)) { json(res, 403, { error: "需要管理员权限" }); return; }
      readBody(req, (body) => {
        try {
          const d = JSON.parse(body || "{}");
          const target = String(d.username || "").trim();
          const role = String(d.role || "").trim();
          if (role !== "admin" && role !== "user") { json(res, 400, { error: "角色只能是 admin 或 user" }); return; }
          const users = loadUsers();
          if (!users[target]) { json(res, 404, { error: "用户不存在" }); return; }
          if (target === username && role !== "admin") { json(res, 400, { error: "不能取消自己的管理员权限" }); return; }
          if (role !== "admin" && users[target].role === "admin" && Object.values(users).filter((u) => u.role === "admin").length <= 1) { json(res, 400, { error: "不能取消最后一名管理员" }); return; }
          users[target].role = role;
          saveUsers(users);
          json(res, 200, { ok: true });
        } catch (e) { json(res, 500, { error: "操作失败" }); }
      });
      return;
    }

    if (pathname === "/api/state") {
      if (!username) { json(res, 401, { error: "未登录" }); return; }
      if (method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(readUserState(username));
        return;
      }
      if (method === "POST") {
        readBody(req, (body) => {
          fs.writeFile(userFilePath(username), body, (err) => {
            if (err) { json(res, 500, { error: "保存失败" }); return; }
            json(res, 200, { ok: true });
          });
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
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden");
      return;
    }
    fs.stat(filePath, (statErr, stat) => {
      if (!statErr && stat.isDirectory()) filePath = path.join(filePath, "index.html");
      fs.readFile(filePath, (readErr, data) => {
        if (readErr) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not Found");
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          "Content-Type": MIME[ext] || "application/octet-stream",
          "Cache-Control": "no-cache"
        });
        res.end(data);
      });
    });
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Server Error");
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Trade Toolbox running at http://localhost:${PORT}`);
  console.log(`LAN access: http://<server-ip>:${PORT}`);
  console.log(`Serving: ${ROOT}`);
  const admins = Object.keys(loadUsers()).filter((n) => loadUsers()[n].role === "admin");
  console.log(`Multi-user: ON  |  data dir: ${DATA_DIR}  |  register key: ${REGISTER_KEY}`);
  console.log(`Admin: ${admins.length ? admins.join(", ") : "(暂无，首个注册用户将自动成为管理员)"}`);
  // 便携版：AUTO_OPEN=1 时自动打开浏览器
  if (process.env.AUTO_OPEN === "1") {
    try {
      require("child_process").exec(`start http://localhost:${PORT}`);
    } catch (e) { /* 忽略 */ }
  }
});

function shutdown() {
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
