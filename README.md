# AutoCheck

AutoCheck 是一个基于 New API 模板的多站点账号运维面板，当前用于统一管理额度监控、今日用量同步、批量签到和账号导入。项目采用前后端一体化结构：前端提供登录页和监控控制台，后端负责账号文件读取、登录态维护、站点请求、签到队列、用量同步与自动签到调度。

默认路由会按登录状态自动跳转：

- 未登录跳转到 `/login`
- 已登录跳转到 `/quota-monitor`

## 当前支持站点

- `MUYUAN`
- `XEM8K5`
- `DGBMC`
- `JIUUIJ`
- `ANYROUTER`

这些站点都走统一的 New API 模板接入层，但可以分别配置站点地址、账号文件、冷却时间、自动签到时区和用量同步节奏。

## 功能概览

- 管理员密码登录与 Cookie 会话
- 多站点切换与独立账号文件管理
- 多账号额度总览、余额、剩余额度、今日用量与签到收益统计
- 单账号签到与一键签到
- 失败账号重试队列与 429 冷却自动续跑
- 今日用量后台同步与状态可视化
- 自动签到调度、补跑与失败重试
- 账号 `txt/json` 合并导入、同名更新与自动备份
- 7 日签到收益 / 用量趋势图
- 登录态失效自动回到登录页
- 深色 / 浅色主题切换

## 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind CSS v4
- 状态与请求：TanStack React Query、Axios
- 动效与图表：Framer Motion、Recharts
- UI：Radix Slot、自定义组件
- 后端：Node.js、Express、Axios、dotenv
- 部署：Nginx、systemd、Cloudflare

## 目录结构

```text
.
├─ deploy/
│  ├─ install-ubuntu.sh
│  ├─ auto-cw.service
│  ├─ autocw.ccwu.cc.nginx.conf
│  ├─ .env.production.example
│  ├─ setup-swap.sh
│  └─ DEPLOY_UBUNTU_CLOUDFLARE.md
├─ public/
├─ scripts/
│  ├─ prepare-release.js
│  └─ start-dev.js
├─ server/
│  ├─ api/
│  │  ├─ auth.js
│  │  └─ quota.js
│  ├─ utils/
│  │  ├─ accountLoader.js
│  │  ├─ auth.js
│  │  ├─ caowo.js
│  │  └─ siteProviders.js
│  └─ index.js
├─ src/
│  ├─ components/
│  ├─ features/
│  ├─ lib/
│  ├─ pages/
│  ├─ services/
│  ├─ types/
│  ├─ main.tsx
│  └─ router.tsx
├─ .env.example
├─ accounts.txt
├─ package.json
└─ README.md
```

## 本地运行

环境要求：

- Node.js 20+
- npm 10+

安装依赖：

```bash
npm ci
```

准备环境变量：

```bash
cp .env.example .env
```

至少修改 `.env` 中的登录密码和会话密钥：

```env
APP_LOGIN_USERNAME=admin
APP_LOGIN_PASSWORD=your-password
APP_LOGIN_SESSION_SECRET=your-session-secret
```

启动前后端：

```bash
npm run dev
```

默认访问地址：

```text
http://localhost:5183/login
```

如果 `3000` 或 `5183` 端口已被占用，启动脚本会自动向后寻找可用端口，并在控制台输出实际地址。

## 常用命令

```bash
npm run dev
npm run server
npm run client
npm run build
npm run build:release
npm run preview
```

健康检查：

```bash
curl http://127.0.0.1:3000/api/health
```

## 环境变量

### 基础服务

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Express 监听地址 |
| `PORT` | `3000` | Express 监听端口 |
| `TRUST_PROXY` | 空 | 反向代理场景可设为 `1` |
| `CORS_ORIGIN` | 空 | 允许跨域来源，多个值用英文逗号分隔 |
| `VITE_API_BASE_URL` | 空 | 前端 API 基础地址 |

### 登录认证

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_LOGIN_USERNAME` | `admin` | 登录页展示的用户名 |
| `APP_LOGIN_PASSWORD` | `change-this-login-password` | 登录密码 |
| `APP_LOGIN_SESSION_SECRET` | `change-this-session-secret` | Cookie 签名密钥 |
| `APP_LOGIN_SESSION_TTL_MS` | `604800000` | 登录态有效期，默认 7 天 |

生产环境下必须替换默认密码和默认会话密钥。

### 站点模板变量

每个站点都支持同一套变量，只是前缀不同：

- `MUYUAN_*`
- `XEM8K5_*`
- `DGBMC_*`
- `JIUUIJ_*`
- `ANYROUTER_*`

常用字段如下：

| 变量后缀 | 说明 |
| --- | --- |
| `BASE_URL` | 站点基础地址 |
| `ACCOUNTS_FILE` | 当前站点账号文件路径 |
| `CACHE_TTL_MS` | 看板缓存时间 |
| `RATE_LIMIT_COOLDOWN_MS` | 429 冷却时间 |
| `USAGE_SYNC_DELAY_MS` | 用量同步间隔 |
| `TIMEOUT_MS` | 上游请求超时 |
| `CURRENCY_SYMBOL_OVERRIDE` | 货币符号覆盖 |
| `CHECKIN_ENDPOINT` | 签到接口路径，默认 `/api/user/checkin` |
| `CHECKIN_STATS_ENDPOINT` | 签到统计接口路径，支持 `{month}` 占位；设为空可关闭远程统计预读 |
| `WEB_ACCESS_PATHS` | 签到前需要访问的网页路径，逗号分隔 |
| `REQUIRES_NUMERIC_USER_ID` | 是否要求 `New-API-User` 为数字 |
| `DERIVE_TRAILING_NUMERIC_USER_ID` | 是否从账号名尾部数字推导 `userId` |
| `AUTO_CHECKIN_ENABLED` | 是否启用自动签到 |
| `AUTO_CHECKIN_TIME` | 自动签到触发时间，格式 `HH:mm` |
| `AUTO_CHECKIN_TZ` | 自动签到时区 |
| `AUTO_CHECKIN_CATCH_UP` | 错过时间点后是否补跑 |
| `AUTO_CHECKIN_RETRY_MINUTES` | 自动签到失败后的重试间隔 |
| `DEBUG` | 设为 `1` 输出调试日志 |

示例：

```env
MUYUAN_BASE_URL=https://muyuan.do/
MUYUAN_ACCOUNTS_FILE=./accounts.txt

XEM8K5_BASE_URL=http://new.xem8k5.top:3000/
XEM8K5_ACCOUNTS_FILE=./accounts.xem8k5.txt

DGBMC_BASE_URL=https://freeapi.dgbmc.top/
DGBMC_ACCOUNTS_FILE=./accounts.dgbmc.txt

JIUUIJ_BASE_URL=https://jiuuij.de5.net/
JIUUIJ_ACCOUNTS_FILE=./accounts.jiuuij.txt

ANYROUTER_BASE_URL=https://anyrouter.top/
ANYROUTER_ACCOUNTS_FILE=./accounts.anyrouter.txt
ANYROUTER_CHECKIN_ENDPOINT=/api/user/sign_in
ANYROUTER_CHECKIN_STATS_ENDPOINT=
ANYROUTER_WEB_ACCESS_PATHS=/,/console
ANYROUTER_REQUIRES_NUMERIC_USER_ID=1
ANYROUTER_DERIVE_TRAILING_NUMERIC_USER_ID=1
```

兼容说明：后端仍兼容读取旧的 `CAOWO_*` 环境变量，便于老配置平滑迁移，但新部署应使用站点前缀变量。

## 账号文件与导入

默认账号文件：

- `MUYUAN`: `./accounts.txt`
- `XEM8K5`: `./accounts.xem8k5.txt`
- `DGBMC`: `./accounts.dgbmc.txt`
- `JIUUIJ`: `./accounts.jiuuij.txt`
- `ANYROUTER`: `./accounts.anyrouter.txt`

可通过环境变量覆盖，例如：

```env
JIUUIJ_ACCOUNTS_FILE=/absolute/path/to/accounts.jiuuij.txt
```

当前导入支持：

```text
username,password
user_a,pass_a
user_b,pass_b
```

```text
username;password
账号：user_a，密码：pass_a
username: user_b, password: pass_b
user_c pass_c
```

```text
username,token=your_new_api_token
username,cookie=your_cookie
username,token=your_new_api_token,cookie=your_cookie
linuxdo_123456,token=your_anyrouter_token,cookie=your_cookie
```

```json
[
  { "username": "user_a", "password": "pass_a" },
  { "username": "user_b", "token": "new_api_token" },
  { "username": "user_c", "cookie": "session_cookie=value" },
  { "username": "user_d", "token": "new_api_token", "cookie": "session_cookie=value" },
  { "username": "linuxdo_123456", "userId": "123456", "token": "new_api_token", "cookie": "session_cookie=value" }
]
```

也可以在浏览器手动登录对应站点，例如 `muyuan.do` 或 `anyrouter.top`，然后把 localStorage 里的 `user` JSON 粘贴进来；只要里面包含 `username`、`token`、`cookie` 或 `userId`，AutoCheck 就会直接使用这个登录态调用签到和统计接口。Any Router 需要数字 `userId`，`linuxdo_123456` 这类账号名会自动推导为 `123456`。

解析规则：

- 自动兼容英文逗号、中文逗号、分号、制表符和空格分隔
- 自动跳过标题行，如 `username,password`
- 支持 `username,password`、`username,token=xxx`、`username,cookie=xxx`、`userId=数字`
- 按 `username` 去重，保留首个有效账号
- 导入保存时会合并到当前站点账号文件，同名账号更新，不同名账号保留；保存前会自动生成 `*.backup-时间戳` 备份
- 账号文件以 JSON 数组保存，避免 token/cookie 被分隔符破坏
- JSON 同时支持 `{ "accounts": [...] }` 和 `{ "data": [...] }`

## 页面与接口

页面：

- `/login`
- `/quota-monitor`

接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/auth/config` | 获取登录配置 |
| `GET` | `/api/auth/session` | 获取当前会话 |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/quota-monitor/providers` | 获取站点列表 |
| `GET` | `/api/quota-monitor` | 获取看板数据 |
| `POST` | `/api/quota-monitor/accounts/:username/checkin` | 单账号签到 |
| `POST` | `/api/quota-monitor/checkin-all` | 批量签到 |
| `POST` | `/api/quota-monitor/accounts/import` | 合并导入当前站点账号 |

统一返回结构：

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

## 生产部署

仓库已提供 `Ubuntu + Nginx + systemd + Cloudflare` 的部署资产，目录位于 `deploy/`。

本地生成运行包：

```bash
npm ci
npm run build:release
```

运行包输出到：

```text
.release/app
```

上传到服务器的 `/opt/auto-cw/app` 后，执行：

```bash
bash deploy/install-ubuntu.sh
```

更完整的生产部署说明见 `deploy/DEPLOY_UBUNTU_CLOUDFLARE.md`。

## 运行时文件

以下内容属于本地或线上运行数据，不建议提交到仓库：

- `.env`
- `accounts*.txt`
- `.cache/*.json`
- `dist/`

## 使用提醒

- 不要把真实账号、密码、`.env`、账号文件提交到公共仓库
- 账号导入会合并保存并自动备份当前站点账号文件
- 这个项目当前定位是 New API 模板的多站点运维面板，新增站点时优先复用 `server/utils/siteProviders.js` 和现有接入层
