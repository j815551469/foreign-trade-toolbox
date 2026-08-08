// license.js — 授权与试用模块（ECDSA P-256 签名验证 + 首次运行试用）
// 产品侧只内置公钥用于校验；签发私钥在 tools/private.pem（仅授权方持有，绝不随产品分发）。
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// 内置公钥：对应 tools/private.pem（tools/gen-keys.js 可重新生成）
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEEt181cHXri4GlxBYNEPXX6dOP6WG
5/UyzeIhwG+WVcj+iENX2XvoMo+ionViq/e6m7mtXK9E6NSV94UeyxuDGg==
-----END PUBLIC KEY-----`;

function trialInt(name, def, floor, ceil) {
  const v = Number(process.env[name]);
  if (!Number.isFinite(v)) return def;
  return Math.min(Math.max(Math.floor(v), floor), ceil || Infinity);
}
const TRIAL_DAYS = trialInt("TRIAL_DAYS", 14, 1, 3650); // 试用天数
const TRIAL_SEATS = trialInt("TRIAL_SEATS", 3, 1, 10000); // 试用席位上限
const LICENSE_FILENAME = "license.txt"; // 激活后的授权码（存 data/ 下）
const INSTALL_FILENAME = ".install"; // 首次运行时间戳（试用起点）

// 本机唯一标识：Windows 用注册表 MachineGuid；兜底主机名+网卡 MAC。
// 结果按进程缓存 —— 每次请求都 spawn reg.exe 会阻塞事件循环（LAN DoS 面）。
let _machineId = null;
function machineId() {
  if (_machineId) return _machineId;
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
      { encoding: "utf8", timeout: 5000, windowsHide: true }
    );
    const m = String(out).match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{20,})/i);
    if (m) { _machineId = "win:" + m[1].toLowerCase(); return _machineId; }
  } catch (e) { /* 非 Windows 或无权读取注册表 */ }
  try {
    const macs = Object.values(os.networkInterfaces())
      .flat()
      .filter((x) => x && !x.internal && x.mac && x.mac !== "00:00:00:00:00:00")
      .map((x) => x.mac)
      .sort();
    _machineId = (os.hostname() || "host") + ":" + (macs[0] || "nomac");
  } catch (e) { /* ignore */ }
  return (_machineId = _machineId || os.hostname() || "unknown");
}

// 解析并验证授权码 → payload；无效/签名不符返回 null
// 授权码格式：base64url(JSON payload) + "." + base64url(ECDSA-SHA256 签名)
function parseLicenseKey(key) {
  const s = String(key || "").trim();
  const dot = s.indexOf(".");
  if (dot <= 0) return null;
  const payload = s.slice(0, dot);
  const sig = s.slice(dot + 1);
  if (!payload || !sig) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const verifier = crypto.createVerify("sha256");
    verifier.update(payload);
    if (!verifier.verify(PUBLIC_KEY, Buffer.from(sig, "base64url"))) return null;
    return data;
  } catch (e) { return null; }
}

function licenseFilePath(dataDir) { return path.join(dataDir, LICENSE_FILENAME); }
function installFilePath(dataDir) { return path.join(dataDir, INSTALL_FILENAME); }

function readInstall(dataDir) {
  try { return JSON.parse(fs.readFileSync(installFilePath(dataDir), "utf8")); }
  catch (e) { return null; }
}

function ensureInstall(dataDir) {
  let inst = readInstall(dataDir);
  if (!inst) {
    inst = { installedAt: Date.now() };
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(installFilePath(dataDir), JSON.stringify(inst));
    } catch (e) { /* 只读目录则退化为每次即时起算 */ }
  }
  return inst;
}

// 授权/试用状态。dataDir: 服务器数据目录。
// 返回 { mode: 'licensed'|'trial'|'expired', ... }
function status(dataDir) {
  const inst = ensureInstall(dataDir);

  // 1) 已激活授权（签名有效 + 绑定本机 + 未过期）
  try {
    const raw = fs.readFileSync(licenseFilePath(dataDir), "utf8").trim();
    const lic = parseLicenseKey(raw);
    if (lic && lic.machine && lic.machine === machineId()) {
      const expires = lic.expires ? Date.parse(lic.expires) : null;
      if (!expires || expires >= Date.now()) {
        return {
          mode: "licensed",
          company: String(lic.company || ""),
          seats: Math.max(1, Number(lic.seats) || 1),
          expires: lic.expires || null,
          machine: machineId(),
        };
      }
      // 授权过期 → 继续走试用判断
    }
  } catch (e) { /* 尚无授权文件 */ }

  // 2) 试用（首次运行起 N 天）
  const installedAt = (inst && inst.installedAt) || Date.now();
  const endsAt = installedAt + TRIAL_DAYS * 24 * 3600 * 1000;
  const daysLeft = Math.ceil((endsAt - Date.now()) / (24 * 3600 * 1000));
  if (daysLeft > 0) {
    return { mode: "trial", installedAt, trialEndsAt: endsAt, daysLeft, seats: TRIAL_SEATS, machine: machineId() };
  }
  return { mode: "expired", installedAt, trialEndsAt: endsAt, daysLeft: 0, seats: TRIAL_SEATS, machine: machineId() };
}

function isLicensed(dataDir) { return status(dataDir).mode === "licensed"; }

// 激活：校验授权码并写入 data/license.txt
function activate(dataDir, key) {
  const lic = parseLicenseKey(key);
  if (!lic) return { ok: false, error: "授权码无效" };
  if (!lic.machine || lic.machine !== machineId()) return { ok: false, error: "授权码与本机不匹配，请使用本机机器码签发" };
  const expires = lic.expires ? Date.parse(lic.expires) : null;
  if (expires && expires < Date.now()) return { ok: false, error: "授权码已过期" };
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(licenseFilePath(dataDir), String(key).trim());
    return { ok: true, ...status(dataDir) };
  } catch (e) {
    return { ok: false, error: "授权文件写入失败" };
  }
}

// 取消授权：删除已激活授权码，回到试用模式
function cancel(dataDir) {
  try {
    const file = path.join(dataDir, LICENSE_FILENAME);
    if (fs.existsSync(file)) fs.rmSync(file);
    return { ok: true, ...status(dataDir) };
  } catch (e) {
    return { ok: false, error: "取消失败" };
  }
}

module.exports = { machineId, parseLicenseKey, status, isLicensed, activate, cancel, TRIAL_DAYS, TRIAL_SEATS, PUBLIC_KEY };
