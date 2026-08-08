// crawler.js — 纯 Node 零依赖的 hsbianma.com 海关编码爬虫。
// 从 Python 版（hscode 项目）移植，HTML 用正则 + 平衡 div 扫描解析。
// 修复了 Python 版 parse_base_info 的索引 bug（原版把「更新时间」错存成「正常」）。
'use strict';
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { URL } = require('url');

const BASE_URL = 'https://www.hsbianma.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---- 基础 HTTP ----
async function httpGet(url, timeoutMs) {
  await throttle();
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(e); }
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,*/*;q=0.8' },
      timeout: timeoutMs || 10000,
    }, (res) => {
      const status = res.statusCode || 0;
      if (status === 404) { res.resume(); return resolve(''); }
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        const next = res.headers.location.indexOf('http') === 0 ? res.headers.location : BASE_URL + res.headers.location;
        return resolve(httpGet(next, timeoutMs));
      }
      if (status !== 200) { res.resume(); return resolve(''); }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '');
        if (enc.indexOf('gzip') !== -1) {
          zlib.gunzip(buf, (err, out) => resolve(err ? '' : out.toString('utf8')));
        } else {
          resolve(buf.toString('utf8'));
        }
      });
      res.on('error', () => resolve(''));
    });
    req.on('timeout', () => { req.destroy(); });
    req.on('error', () => reject(new Error('network')));
  });
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- 全局请求限速器 ----
// hsbianma.com 按窗口限速（可持续约 2-3 req/s）；突发请求会触发封禁返回空页。
// 串行化所有请求：任意两个请求之间至少间隔 MIN_REQ_INTERVAL，防止爆请求。
let lastReqAt = 0;
const MIN_REQ_INTERVAL = Number(process.env.HS_REQ_INTERVAL) || 350; // ms ≈ 2.8 req/s
async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, MIN_REQ_INTERVAL - (now - lastReqAt));
  if (wait > 0) await sleep(wait);
  lastReqAt = Date.now();
}

// ---- HTML 工具 ----
function stripTags(s) { return String(s || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '); }
// 紧凑清理：去标签/去空白/去 [?]（用于品名、申报要素、CIQ 名）
function cleanTight(s) {
  return stripTags(s).replace(/\[\?\]/g, '').replace(/[\s ]+/g, '');
}
// 值清理：去标签、折叠空白、去 [?]（用于税率值）
function cleanValue(s) {
  return stripTags(s).replace(/\[\?\]/g, '').replace(/\s+/g, ' ').trim();
}

// 从 openPos 起找配对的闭合 </div>（indexOf 扫描，处理嵌套 div）
function findBalancedDivClose(html, openPos) {
  let depth = 0;
  let i = openPos;
  while (i < html.length) {
    const open = html.indexOf('<div', i);
    const close = html.indexOf('</div>', i);
    if (close === -1) return html.length;
    if (open !== -1 && open < close) { depth++; i = open + 4; }
    else { depth--; if (depth === 0) return close; i = close + 6; }
  }
  return html.length;
}

// 提取 #code-info 内所有 <div class="cbox"> 的内容（不含开闭标签本身）
function extractCboxes(html) {
  const idPos = html.indexOf('id="code-info"');
  if (idPos === -1) return null;
  const divStart = html.lastIndexOf('<div', idPos);
  const section = html.slice(divStart);
  const cboxes = [];
  for (const m of section.matchAll(/<div\s+class="cbox"[^>]*>/g)) {
    const close = findBalancedDivClose(section, m.index);
    cboxes.push(section.slice(m.index + m[0].length, close));
  }
  return cboxes;
}

// 提取一个 cbox 内的 label→value 对（row 里 td-label / td-txt）
function extractPairs(cboxHtml) {
  const pairs = [];
  for (const m of cboxHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const labels = [...row.matchAll(/class="td-label"[^>]*>([\s\S]*?)<\/td>/g)].map((x) => cleanValue(x[1]));
    const txts = [...row.matchAll(/class="td-txt"[^>]*>([\s\S]*?)<\/td>/g)].map((x) => cleanValue(x[1]));
    if (labels.length) {
      pairs.push({ label: labels[0], value: txts.length ? txts[txts.length - 1] : '' });
    }
  }
  return pairs;
}

// 解析 Search 页的 result-grid 行 → 10 位编码列表（剔除过期）
function parseChapterCodes(html) {
  const codes = [];
  for (const m of html.matchAll(/<tr\s+class="result-grid">([\s\S]*?)<\/tr>/g)) {
    if (/\[过期\]/.test(m[1])) continue;
    const td = m[1].match(/<td[^>]*>([\s\S]*?)<\/td>/);
    if (!td) continue;
    const digits = stripTags(td[1]).replace(/[^\d]/g, '');
    if (digits.length === 10) codes.push(digits);
  }
  return codes;
}

// 解析编码详情页 → 结构化数据
function parseCodeDetail(code, html) {
  const cboxes = extractCboxes(html);
  if (!cboxes || cboxes.length < 9) return null;

  // [0] 基础信息：按标签取值（修复 Python 版索引 bug）
  const byLabel = {};
  extractPairs(cboxes[0]).forEach((p) => { byLabel[p.label] = p.value; });
  const name = byLabel['商品名称'] || '';
  const outdated = byLabel['商品状态'] === '过期';
  const update_time = byLabel['更新时间'] || '';

  // [1] 税率信息
  const tax = {};
  extractPairs(cboxes[1]).forEach((p) => {
    tax[p.label] = (p.value === '-' || p.value === '/') ? '' : p.value;
  });
  const tax_info = {
    unit: tax['计量单位'] || '',
    export: tax['出口税率'] || '',
    ex_rebate: tax['出口退税税率'] || '',
    ex_provisional: tax['出口暂定税率'] || '',
    vat: tax['增值税率'] || '',
    preferential: tax['进口优惠税率'] || '',
    im_provisional: tax['进口暂定税率'] || '',
    import: tax['进口普通税率'] || '',
    consumption: tax['消费税率'] || '',
  };

  // [2] 申报要素
  const declarations = extractPairs(cboxes[2]).map((p) => cleanTight(p.value)).filter((v) => v);
  // [3] 监管条件
  const supervisions = extractPairs(cboxes[3]).map((p) => p.label).filter((v) => v && v !== '无');
  // [4] 检验检疫
  const quarantines = extractPairs(cboxes[4]).map((p) => p.label).filter((v) => v && v !== '无');
  // [8] CIQ 编码
  const ciq_codes = {};
  extractPairs(cboxes[8]).forEach((p) => { if (p.label && p.value) ciq_codes[p.label] = cleanTight(p.value); });

  return { code, name, outdated, update_time, tax_info, declarations, supervisions, quarantines, ciq_codes };
}

// 分页收集一章的编码（按编码去重，保证唯一性）
async function fetchChapterCodes(chapter, maxCodes) {
  const codes = [];
  const seen = new Set();
  let page = 1;
  while (true) {
    let html = '';
    try { html = await httpGet(BASE_URL + '/Search/' + page + '?keywords=' + chapter); } catch (e) { html = ''; }
    if (!html) {
      if (codes.length === 0) {
        // 冷启动空页 → 退避重试
        let got = false;
        for (const backoff of [3000, 8000, 20000]) {
          await sleep(backoff);
          try { html = await httpGet(BASE_URL + '/Search/' + page + '?keywords=' + chapter); } catch (e) { html = ''; }
          if (html) { got = true; break; }
        }
        if (!got) break;
      } else {
        break; // 已有数据后首个空页 = 结果结束
      }
    }
    const pageCodes = parseChapterCodes(html);
    for (const c of pageCodes) {
      if (seen.has(c)) continue;
      seen.add(c);
      codes.push(c);
      if (maxCodes && codes.length >= maxCodes) return codes;
    }
    if (pageCodes.length === 0) break;
    page++;
  }
  return codes;
}

// 抓取单个编码详情（带重试）
async function fetchCodeDetail(code) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const html = await httpGet(BASE_URL + '/Code/' + code + '.html');
      if (html) {
        const detail = parseCodeDetail(code, html);
        if (detail) return detail;
      }
    } catch (e) { /* retry */ }
    if (attempt < 2) await sleep([3000, 8000][attempt]);
  }
  return null;
}

module.exports = { httpGet, parseChapterCodes, parseCodeDetail, fetchChapterCodes, fetchCodeDetail, cleanTight, cleanValue };
