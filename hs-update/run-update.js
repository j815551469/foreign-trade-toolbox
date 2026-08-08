// run-update.js — HS 编码在线更新编排（纯 Node，替代原 Python 管线）。
// 流程：抓取（断点续传）→ 聚合 → 对比合并（新增/更新/保留）→ 发布 → last-update.json。
//
// stdout 标记协议（server.js 逐行解析）：
//   ===HS_UPDATE_START===
//   ===HS_UPDATE_FETCH {totalChapters}===
//   PROGRESS {done}/{total} chapter={ch} entries={n}
//   ===HS_UPDATE_AGGREGATE===
//   ===HS_UPDATE_BUILD===
//   ===HS_UPDATE_DONE {count} {added} {updated} {kept} {lastUpdate}===
//   ===HS_UPDATE_ERROR {message}===
//
// 对比合并语义：merged = 旧数据 ∪ 新数据（新覆盖旧）；旧数据里这次没抓到的编码保留（不丢数据）。
'use strict';
const fs = require('fs');
const path = require('path');
const crawler = require('./crawler');

const HERE = __dirname;
const OUT_DIR = path.join(HERE, 'out');
const INCOMPLETE = path.join(OUT_DIR, '.incomplete');
const LAST_UPDATE = path.join(HERE, 'last-update.json');
const MAX_WORKERS = 2;
const INTER_CHAPTER_SLEEP = 2000;
const RETRY_BACKOFFS = [3000, 8000, 20000];
const DEFAULT_CHAPTERS = Array.from({ length: 99 }, (_, i) => String(i + 1).padStart(2, '0'));
const CATEGORY = '海关编码（hsbianma.com）';
const LEGEND = {
  supervision: {
    A: '进出境动植物及其产品检疫（须办检疫审批单）', B: '出境动植物及其产品检疫',
    D: '直通放行', E: '须接受检验检疫', F: '濒危物种允许出口证明',
    G: '两用物项和技术出口许可证', H: '黄金及其制品进出口许可证',
    I: '有毒化学品进出口环境管理放行通知单', J: '农药进出口进出口登记管理放行通知单',
    K: '放射性物品进出口审批', L: '药品进出口准许证', N: '出口商品检验',
    O: '自动进口许可证', P: '进口废物原料国内收货人注册',
    Q: '化学品进出口环境管理登记', T: 'CCC 强制认证', U: '濒危物种允许进口证明',
  },
  quarantine: {
    L: '出境动物及动物产品检疫', M: '进境动物及动物产品检疫',
    N: '出境植物及植物产品检疫', P: '进境植物及植物产品检疫',
    Q: '动植物及其产品检疫（进境综合）', R: '进口食品卫生监督检验', S: '出口食品卫生监督检验',
  },
};

function emit(msg) { console.log(msg); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function now() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseArgs(argv) {
  const a = { out: path.join(HERE, 'hs-detail.js'), chapters: '01..99', maxPerChapter: 100000 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--chapters') a.chapters = argv[++i];
    else if (argv[i] === '--max-per-chapter') a.maxPerChapter = Number(argv[++i]);
  }
  return a;
}
function chapterList(spec) {
  if (spec === '01..99') return DEFAULT_CHAPTERS;
  return spec.split(',').map((s) => s.trim().padStart(2, '0')).filter(Boolean);
}
function clearOut() {
  if (!fs.existsSync(OUT_DIR)) return;
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (/^\d{2}\.json$/.test(name)) { try { fs.unlinkSync(path.join(OUT_DIR, name)); } catch (e) { /* ignore */ } }
  }
}

// 抓取一章：优先读缓存（断点续传），否则爬取后落盘
async function runChapter(chapter, maxPerChapter) {
  const outPath = path.join(OUT_DIR, chapter + '.json');
  if (fs.existsSync(outPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (Array.isArray(cached) && cached.length > 0) {
        emit(`[INFO] Chapter ${chapter}: cache hit (${cached.length} entries) -- skipping`);
        return cached.length;
      }
    } catch (e) { /* 缓存损坏 → 重抓 */ }
  }
  emit(`[INFO] Chapter ${chapter}: discovering codes (cap=${maxPerChapter})`);
  let codes = [];
  try { codes = await crawler.fetchChapterCodes(chapter, maxPerChapter); } catch (e) { codes = []; }
  if (!codes.length) {
    emit(`[WARN] Chapter ${chapter}: no codes found, writing empty array`);
    try { fs.writeFileSync(outPath, '[]'); } catch (e) { /* ignore */ }
    return 0;
  }
  emit(`[INFO] Chapter ${chapter}: ${codes.length} codes queued`);
  const results = {};
  let processed = 0;
  const total = codes.length;
  const queue = codes.slice();
  async function workerLoop() {
    while (queue.length) {
      const code = queue.shift();
      let ok = false;
      for (let attempt = 0; attempt < RETRY_BACKOFFS.length; attempt++) {
        const detail = await crawler.fetchCodeDetail(code);
        if (detail) { results[code] = detail; ok = true; break; }
        if (attempt < RETRY_BACKOFFS.length - 1) await sleep(RETRY_BACKOFFS[attempt]);
      }
      processed++;
      emit(`Chapter ${chapter}: ${processed}/${total} codes (${Math.round(processed * 100 / total)}%)`);
      if (!ok) emit(`[WARN] ${code} failed after retries`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_WORKERS, total) }, workerLoop));
  // 按编码去重后写盘（唯一性保证）
  const ordered = [];
  const seenCode = new Set();
  for (const c of codes) {
    if (!results[c] || seenCode.has(c)) continue;
    seenCode.add(c);
    ordered.push(results[c]);
  }
  try { fs.writeFileSync(outPath, JSON.stringify(ordered, null, 2)); } catch (e) { /* ignore */ }
  emit(`[INFO] Chapter ${chapter}: wrote ${ordered.length}/${total} entries`);
  return ordered.length;
}

// 聚合 out/*.json → 按 code 去重排序
function aggregate() {
  const byCode = new Map();
  const rollup = {};
  if (fs.existsSync(OUT_DIR)) {
    for (const name of fs.readdirSync(OUT_DIR)) {
      if (!/^\d{2}\.json$/.test(name)) continue;
      const ch = name.slice(0, 2);
      try {
        const data = JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8'));
        if (!Array.isArray(data)) continue;
        rollup[ch] = data.length;
        for (const e of data) {
          if (e && e.code) { if (!e.chapter) e.chapter = ch; byCode.set(e.code, e); }
        }
      } catch (e) { /* 跳过坏文件 */ }
    }
  }
  const list = [...byCode.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  return { list, rollup };
}

// 从目标 hs-detail.js 提取旧 HS_DETAIL 数组（JSON 感知扫描，正确处理字符串内的 ]）
function extractOldArray(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const txt = fs.readFileSync(filePath, 'utf8');
  const marker = 'const HS_DETAIL = ';
  const idx = txt.indexOf(marker);
  if (idx === -1) return [];
  let start = idx + marker.length;
  while (start < txt.length && /\s/.test(txt[start])) start++;
  if (txt[start] !== '[') return [];
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < txt.length; i++) {
    const c = txt[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        try {
          // 兼容旧版生成的尾逗号（JS 合法、JSON 不合法）
          const arrText = txt.slice(start, i + 1).replace(/,\s*\]\s*$/, ']');
          const arr = JSON.parse(arrText);
          return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
      }
    }
  }
  return [];
}

// 对比：固定字段顺序（JSON.stringify 对键顺序敏感，避免字段顺序差异造成误报「已更新」）
function canonical(e) {
  return JSON.stringify({
    code: e.code,
    chapter: e.chapter || String(e.code || '').slice(0, 2),
    name: e.name || '',
    outdated: !!e.outdated,
    update_time: e.update_time || '',
    tax_info: e.tax_info || {},
    declarations: e.declarations || [],
    supervisions: e.supervisions || [],
    quarantines: e.quarantines || [],
    ciq_codes: e.ciq_codes || {},
  });
}
function compareAndMerge(oldList, newList) {
  const oldMap = new Map(oldList.map((e) => [e.code, e]));
  const newMap = new Map(newList.map((e) => [e.code, e]));
  let added = 0, updated = 0, kept = 0;
  const merged = new Map(oldMap); // 先复制旧数据
  for (const [code, entry] of newMap) {
    if (!oldMap.has(code)) added++;
    else if (canonical(oldMap.get(code)) !== canonical(entry)) updated++;
    merged.set(code, entry); // 新数据覆盖旧数据
  }
  for (const [code] of oldMap) if (!newMap.has(code)) kept++; // 旧编码这次没抓到 → 保留
  const list = [...merged.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
  return { list, added, updated, kept };
}

function atomicWrite(filePath, text) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}

// 生成与 Python 版一致的 hs-detail.js
function buildJs(entries, rollup) {
  const lines = [];
  lines.push('// 海关编码（hsbianma.com 抓取，按 10 位编码）');
  lines.push(`// 共 ${entries.length} 条；按章节组织；每个条目含完整税率、申报要素、监管条件、检验检疫、CIQ`);
  lines.push('// 来源：https://www.hsbianma.com/  (海关参考数据，非官方发布)');
  lines.push(`const HS_BUILD_TIME = ${JSON.stringify(now())};`);
  lines.push(`const HS_SOURCE_COUNT = ${entries.length};`);
  lines.push('const HS_DETAIL = [');
  entries.forEach((e, i) => {
    const obj = {
      code: e.code,
      chapter: e.chapter || String(e.code).slice(0, 2),
      name: e.name || '',
      outdated: !!e.outdated,
      update_time: e.update_time || '',
      tax_info: e.tax_info || {},
      declarations: e.declarations || [],
      supervisions: e.supervisions || [],
      quarantines: e.quarantines || [],
      ciq_codes: e.ciq_codes || {},
      category: CATEGORY,
    };
    lines.push('  ' + JSON.stringify(obj) + (i < entries.length - 1 ? ',' : ''));
  });
  lines.push('];');
  lines.push('');
  lines.push('// 章节汇总（用于导航）');
  lines.push('const HS_CHAPTERS = ' + JSON.stringify(
    [...Object.entries(rollup)].map(([code, count]) => ({ code, count })).sort((a, b) => (a.code < b.code ? -1 : 1)),
    null, 2,
  ) + ';');
  lines.push('');
  lines.push('// 监管条件/检疫类别字母释义');
  lines.push('const HS_LEGEND = ' + JSON.stringify(LEGEND, null, 2) + ';');
  return lines.join('\n') + '\n';
}

// 统计 out/ 里已有数据的章节数（覆盖率）
function countOkChapters() {
  if (!fs.existsSync(OUT_DIR)) return 0;
  let ok = 0;
  for (const name of fs.readdirSync(OUT_DIR)) {
    if (!/^\d{2}\.json$/.test(name)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(OUT_DIR, name), 'utf8'));
      if (Array.isArray(d) && d.length > 0) ok++;
    } catch (e) { /* ignore */ }
  }
  return ok;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const chapters = chapterList(args.chapters);
  try {
    emit('===HS_UPDATE_START===');
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    const wasResume = fs.existsSync(INCOMPLETE);
    if (wasResume) emit('RESUME 上次更新未完成，从断点续传');
    else clearOut();
    fs.writeFileSync(INCOMPLETE, '');

    emit(`===HS_UPDATE_FETCH ${chapters.length}===`);
    // 多轮补齐：首轮 + 最多 MAX_PASSES-1 轮重试空章节（限速冷却后补抓）
    let pending = chapters.slice();
    let pass = 0;
    const MAX_PASSES = 3;
    const PASS_COOLDOWN_S = 30;
    while (pending.length && pass < MAX_PASSES) {
      if (pass > 0) {
        emit(`[INFO] 第 ${pass + 1} 轮：重试 ${pending.length} 个空章节（冷却 ${PASS_COOLDOWN_S}s，避开限速）`);
        await sleep(PASS_COOLDOWN_S * 1000);
      }
      const nextPending = [];
      for (let i = 0; i < pending.length; i++) {
        const ch = pending[i];
        const entries = await runChapter(ch, args.maxPerChapter);
        const okChapters = countOkChapters();
        emit(`PROGRESS ${okChapters}/${chapters.length} chapter=${ch} entries=${entries}`);
        if (entries === 0) nextPending.push(ch);
        if (i + 1 < pending.length) await sleep(INTER_CHAPTER_SLEEP);
      }
      pending = nextPending;
      pass++;
    }

    emit('===HS_UPDATE_AGGREGATE===');
    const { list: newList, rollup } = aggregate();
    // 旁路产物（generate_excel.py 等开发工具复用）
    atomicWrite(path.join(OUT_DIR, '_all.json'), JSON.stringify(newList, null, 2));
    atomicWrite(path.join(OUT_DIR, '_rollup.json'), JSON.stringify(rollup, null, 2));

    emit('===HS_UPDATE_BUILD===');
    if (!newList.length) {
      emit('===HS_UPDATE_ERROR 未获取到任何数据，未更新===');
      return 1;
    }
    const oldList = extractOldArray(args.out);
    const { list: merged, added, updated, kept } = compareAndMerge(oldList, newList);

    // 唯一性最终保证：合并结果按 code 去重（正常不会触发，双保险）
    const finalMap = new Map(merged.map((e) => [e.code, e]));
    const finalList = [...finalMap.values()].sort((a, b) => (a.code < b.code ? -1 : 1));
    if (finalList.length !== merged.length) {
      emit(`[WARN] 去重合并：${merged.length} → ${finalList.length}（发现重复编码，已清理）`);
    }

    // 覆盖率判定：预期章节 = 现有数据里已覆盖的章节（62/77/99 等站方永久缺失的不计入）。
    // 抓齐全部预期章节即视为完整，避免「96/99」永远部分成功、反复触发续传。
    const expected = new Set(oldList.map((e) => e.chapter || String(e.code).slice(0, 2)));
    if (!expected.size) {
      // 首次部署（无现有数据）→ 以全部章节为预期
      for (const ch of chapters) expected.add(ch);
    }
    const chapterHas = (ch) => {
      try {
        const d = JSON.parse(fs.readFileSync(path.join(OUT_DIR, ch + '.json'), 'utf8'));
        return Array.isArray(d) && d.length > 0;
      } catch (e) { return false; }
    };
    const okChapters = countOkChapters();
    const missingExpected = [...expected].filter((ch) => !chapterHas(ch));
    const totalChapters = expected.size || chapters.length;
    const complete = missingExpected.length === 0;
    if (complete) {
      // 覆盖全部预期章节 → 完整，清除续传标记
      try { fs.unlinkSync(INCOMPLETE); } catch (e) { /* ignore */ }
      emit(`[INFO] 完成 ${okChapters}/${totalChapters} 章，更新完整`);
    } else {
      emit(`[INFO] 完成 ${okChapters}/${totalChapters} 章，缺 ${missingExpected.join(',')}（限速或站方无数据），可再次点击「在线更新」续传`);
    }
    const t = now();
    // 持久化更新概况（meta 端点返回 → 刷新后「上次更新」标签也能显示概况）
    atomicWrite(LAST_UPDATE, JSON.stringify({
      lastUpdate: t, count: finalList.length,
      added, updated, kept, okChapters, totalChapters,
      complete, missing: missingExpected.join(','),
    }));
    atomicWrite(args.out, buildJs(finalList, rollup));
    // 唯一性校验（发布前最后确认，出现在更新日志中）
    emit(`[INFO] 唯一性校验：${finalList.length} 条，唯一编码 ${new Set(finalList.map((e) => e.code)).size} 条`);
    const missingCsv = missingExpected.length ? missingExpected.join(',') : '-';
    emit(`===HS_UPDATE_DONE ${finalList.length} ${added} ${updated} ${kept} ${okChapters} ${totalChapters} ${missingCsv} ${t}===`);
    return 0;
  } catch (err) {
    const msg = String((err && err.message) || err).replace(/=/g, ' ').replace(/[\r\n]+/g, ' ');
    emit(`===HS_UPDATE_ERROR ${msg.slice(0, 400)}===`);
    return 1;
  }
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1); });
