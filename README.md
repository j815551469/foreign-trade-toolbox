# 外贸业务员工具箱 · Foreign Trade Toolbox

一个无需安装、可局域网多人使用的本地外贸工作台。纯前端 + Node 内置模块服务器，**零 npm 依赖**，覆盖外贸业务员日常高频工作。

## 功能模块

- **工作台**：客户、报价、待跟进、订单交期、待催报价提醒、全球时间、汇率速览
- **报价计算器**：EXW / FOB / CFR / CIF 成本核算、四条款成本利润对比、目标价反推、多币种报价
- **产品资料**：型号、中英文名、成本、包装、MOQ、价格阶梯、供应商，一键带入报价
- **物流与装柜**：多货物清单、装柜方案、集装箱利用率、空运/快递计费重、运费对比
- **汇率换算**：常用币种速查、在线更新、本地编辑
- **客户管理**：客户档案、跟进日期、状态管理、CSV 导入导出
- **报价记录**：ERP 式逐行录入、一键转订单、英文报价单 PDF、利润快照
- **订单管理**：PO 编号、全流程状态、成本毛利核算、交期倒计时
- **颜色字典**：独立于产品的颜色库（中文 + 英文）
- **邮件模板**：19 个专业英文邮件模板（开发信/报价/催款/发货/售后等），支持从客户/报价/订单一键带入变量
- **单证清单**：海运/空运/快递单据核对，PI / CI / PL / SA / CO / BL / AWB / BC **专业英文 PDF 模板**（含全英文校验、产品英文名自动带入）
- **HS 编码**：内置《中华人民共和国进出口税则》全量中文税号 10769 条
- **贸易术语 / 国家市场 / 外贸英语 / 单位换算 / 时区助手**：速查工具

## 快速开始（需要 Node.js ≥ 18）

```bash
# 1. 安装依赖（无第三方包，仅为占位）
npm install
# 2. 启动服务器
npm start
# 或直接：node server.js
```

浏览器打开 `http://localhost:8080`。

**首次使用**：点「注册新账号」，邀请码默认 `trade123`，**第一个注册的账号自动成为管理员**，可在「设置与数据 → 用户管理」管理用户（重置密码 / 删除 / 设管理员）。

## 局域网多人使用

1. 服务器电脑放行端口（Windows：`netsh advfirewall firewall add rule name="TradeToolbox" dir=in action=allow protocol=TCP localport=8080`，需管理员）。
2. 其他电脑浏览器访问 `http://服务器IP:8080`，各自注册账号，数据相互独立（`data/<用户名>.json`）。

## 免安装离线部署包

需要"拷贝即用、无需安装 Node.js"的部署包时，可构建离线版：把 Node.js 运行时的 `node.exe` 复制到本目录，配合 `start-server.bat` 使用（见下方"构建离线包"）。完整离线包通常作为分发 zip 提供。

## 目录结构

```
├── public/            # 前端（index.html / app.js / data.js / hs-full.js / vendor/）
├── server.js          # 局域网多用户服务器（仅 Node 内置模块）
├── package.json
├── start-server.bat   # Windows 一键启动
└── start-server.ps1   # PowerShell 启动脚本
```

## 数据与安全

- 用户数据独立保存在 `data/<用户名>.json`；账号存 `users.json`，密码为 **PBKDF2 加盐哈希**，登录令牌 HMAC 签名 7 天。
- `data/`、`users.json`、`.secret` 均在 `.gitignore` 中，**不会上传**。
- **建议**：首次部署后通过环境变量修改注册邀请码 `REGISTER_KEY`，并尽快修改默认管理员密码。

## 更新

版本号在 `public/app.js` 顶部 `APP_VERSION`。增量升级：替换 `public/` 与 `server.js`（**不要覆盖 data/、users.json**），重启服务器即可。

## 技术说明

- 纯前端，无构建步骤，浏览器直接打开 `public/index.html` 亦可（本机模式，不登录）。
- 服务器仅用 Node 内置模块（`http/fs/path/crypto`），零第三方依赖。
