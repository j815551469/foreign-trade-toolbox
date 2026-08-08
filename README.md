<div align="center">

# 🌍 外贸业务员工具箱 · Foreign Trade Toolbox

**开箱即用的外贸业务员工作台** —— 报价计算、客户/订单管理、专业英文单证 PDF、英文邮件模板、HS 编码查询……

纯前端 + Node 内置模块服务器，**零 npm 依赖**，局域网多人登录、数据相互独立。

![工作台](docs/screenshots/dashboard.png)

</div>

---

## ✨ 功能亮点

### 💰 报价计算器

EXW / FOB / CFR / CIF 四条款成本利润对比、目标价反推、多币种报价、一键保存为报价记录并生成英文报价单 PDF。产品从产品库点选，自动带出成本、价格阶梯与英文名。

![报价计算器](docs/screenshots/quote.png)

### 📄 专业英文单证 PDF

海运 / 空运 / 快递单据核对，内置 **PI / CI / PL / SA / CO / BL / AWB / BC** 8 种专业英文单证模板：公司信头、收发货人、货物表、金额大写、条款、签章一应俱全；**全英文校验**（含非英文内容会拦截提醒），货物描述自动取产品管理里的英文名。

![单证 PDF 预览](docs/screenshots/docs-pdf.png)

![单证清单](docs/screenshots/docs.png)

### ✉️ 英文邮件模板

19 个专业英文邮件模板（首次开发信、询盘回复、报价跟进、催款、发货通知、售后、展会邀约……），每条带专业主题行；从客户/报价/订单一键带入变量，直接用邮件客户端发送。

![邮件模板](docs/screenshots/email.png)

### 👥 多用户与用户管理

局域网内每位业务员注册自己的账号，数据独立隔离。**首个注册账号自动成为管理员**，可在设置页管理用户：重置密码、删除用户、设置/取消管理员。

![用户管理](docs/screenshots/user-manage.png)

### 📦 更多模块

| | |
|---|---|
| **产品资料** — 型号/中英文名/成本/价格阶梯/MOQ/供应商，ERP 式逐行录入 ![产品资料](docs/screenshots/products.png) | **订单管理** — PO 编号、成本毛利核算、交期倒计时 ![订单管理](docs/screenshots/orders.png) |
| **客户管理** — 客户档案、状态跟进、CSV 导入导出 ![客户管理](docs/screenshots/clients.png) | **更多** — HS 编码（内置税则 10769 条）、汇率换算、颜色字典、贸易术语、国家市场、外贸英语、单位换算、时区助手 |

---

## 🚀 快速开始（需要 Node.js ≥ 18）

```bash
# 无需安装任何依赖，直接启动
node server.js
# 或：npm start
```

浏览器打开 `http://localhost:8080`：

1. 点「注册新账号」，邀请码默认 `trade123`；
2. **第一个注册的账号自动成为管理员**；
3. 登录后即可使用，数据自动保存。

> 也可以直接双击 `public/index.html` 以**本机模式**打开（不登录，数据仅存本机浏览器）。

## 🌐 局域网多人使用

1. 服务器电脑放行端口（Windows 管理员执行）：
   ```bat
   netsh advfirewall firewall add rule name="TradeToolbox" dir=in action=allow protocol=TCP localport=8080
   ```
2. 其他电脑浏览器访问 `http://服务器IP:8080`；
3. 每人注册一个账号，数据独立保存在 `data/<用户名>.json`，互不可见。

## 📦 免安装离线部署包

需要"拷过去双击即用、目标电脑无需安装 Node.js"时，可构建**免安装版**：

1. 从 [nodejs.org](https://nodejs.org) 下载 Windows 64 位 Node.js，解压取出其中的 `node.exe`（约 90MB，可直接运行）；
2. 把 `node.exe` 放到本目录，双击 `start-server.bat`（脚本自动使用内置 node.exe，并打开浏览器）。

## 🗂 目录结构

```
├── public/            # 前端（index.html / app.js / data.js / hs-full.js / vendor/）
├── server.js          # 局域网多用户服务器（仅 Node 内置模块）
├── package.json
├── start-server.bat   # Windows 一键启动（可配合内置 node.exe 免安装）
├── start-server.ps1   # PowerShell 启动脚本
└── docs/screenshots/  # 本文档截图
```

## 🛠 技术栈

- **前端**：原生 JavaScript + HTML/CSS，无框架、无构建步骤
- **服务器**：Node.js 内置模块（`http / fs / path / crypto`），**零 npm 依赖**
- **PDF**：jsPDF 生成 + pdf.js 预览
- **安全**：PBKDF2 加盐哈希存密码、HMAC 签名登录令牌（7 天）、按用户数据隔离

## 🔒 数据与安全

- 用户数据独立保存在 `data/<用户名>.json`；账号存 `users.json`；
- 密码为 **PBKDF2 加盐哈希**，不存明文；登录令牌 HMAC 签名 7 天有效；
- `data/`、`users.json`、`.secret` 均在 `.gitignore` 中，**不会上传到仓库**；
- 建议部署后通过环境变量修改注册邀请码 `REGISTER_KEY`，并尽快修改默认管理员密码。

## 🔄 更新

版本号在 `public/app.js` 顶部 `APP_VERSION`。增量升级只需替换 `public/` 与 `server.js`（**不要覆盖 data/、users.json**），重启服务器即可。
