// 审计 hs-detail.js：唯一性 + 格式检查
const fs = require('fs');
const file = process.argv[2] || '../public/hs-detail.js';
const txt = fs.readFileSync(file, 'utf8');
const marker = 'const HS_DETAIL = ';
const idx = txt.indexOf(marker);
let start = idx + marker.length;
while (/\s/.test(txt[start])) start++;
let depth = 0, inStr = false, esc = false, end = start;
for (let i = start; i < txt.length; i++) {
  const c = txt[i];
  if (inStr) {
    if (esc) esc = false;
    else if (c === '\\') esc = true;
    else if (c === '"') inStr = false;
  } else if (c === '"') inStr = true;
  else if (c === '[') depth++;
  else if (c === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
}
const arr = JSON.parse(txt.slice(start, end).replace(/,\s*\]\s*$/, ']'));
console.log('文件:', file);
console.log('总条数:', arr.length);
const codes = arr.map((e) => e.code);
const uniq = new Set(codes);
console.log('唯一编码数:', uniq.size);
if (codes.length !== uniq.size) {
  const seen = new Set(), dups = [];
  for (const c of codes) { if (seen.has(c)) dups.push(c); seen.add(c); }
  console.log('重复编码:', dups.length, '个 →', dups.slice(0, 20));
} else {
  console.log('✓ 无重复编码');
}
const bad = arr.filter((e) => !/^\d{10}$/.test(e.code));
console.log('非10位数字编码:', bad.length, bad.slice(0, 5).map((b) => b.code));
// 空品名
const noName = arr.filter((e) => !e.name);
console.log('空品名:', noName.length);
