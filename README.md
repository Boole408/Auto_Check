# Auto_CW

Auto_CW 是一个面向多账号运维场景的 CAOWO 配额监控与签到面板。项目采用前后端一体化结构：前端提供登录页和监控控制台，后端负责账号读取、登录态维护、签到队列、用量同步、自动签到调度和生产部署。

默认路由会按登录状态自动跳转：

- 未登录跳转到 `/login`
- 已登录跳转到 `/quota-monitor`

## 当前能力

- 内置密码登录与 Cookie 会话
- 多账号配额总览、余额、剩余额度、签到收益统计
- 单账号签到与一键签到
- 失败账号重试队列、429 冷却自动续跑
- 当日用量后台同步与状态可视化
- 自动签到调度、补跑与失败重试
- 账号 `txt/json` 导入并覆盖保存
- 7 日签到收益 / 用量趋势图
- 登录态失效自动回跳登录页
- 深色 / 浅色主题切换
- Ubuntu 22.04 / 24.04 一键部署脚本

## 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind CSS v4
- 状态与请求：TanStack React Query、Axios
- 动效与图表：Framer Motion、Recharts
- UI：Radix Slot、自定义组件
- 后端：Node.js、Express、Axios、dotenv
- 部署：PM2、Nginx、Certbot、Docker

## 页面与路由

- `/login`：登录页，只输入密码，用户名由服务端配置返回
- `/quota-monitor`：主控制台
- `/api/health`：健康检查
- `/api/auth/*`：登录、登出、会话、登录配置
- `/api/quota-monitor/*`：看板、签到、账号导入

## 主要目录

```text
.
├─ deploy/
│  ├─ install-linux.sh               # Ubuntu 一键安装入口
│  ├─ setup-ubuntu.sh                # 系统依赖安装 helper
│  ├─ setup-swap.sh                  # 2G swap helper
│  ├─ configure-pm2-logrotate.sh     # PM2 日志轮转配置
│  ├─ pm2.ecosystem.config.cjs       # PM2 配置
│  ├─ cw-ops.nginx.conf              # Nginx HTTPS 模板
│  ├─ .env.production.example        # 生产环境模板
│  ├─ UBUNTU_DEPLOY.md               # Ubuntu 部署说明
│  └─ Dockerfile                     # Docker 镜像构建
├─ public/
├─ scripts/
│  └─ start-dev.js                   # 一键启动前后端并自动找空闲端口
├─ server/
│  ├─ api/
│  │  ├─ auth.js                     # 认证接口
│  │  └─ quota.js                    # 看板、签到、导入接口
│  ├─ utils/
│  │  ├─ accountLoader.js            # 账号文件解析与保存
│  │  ├─ auth.js                     # 登录态与 Cookie
│  │  └─ caowo.js                    # 站点交互、缓存、队列、自动签到
│  └─ index.js                       # Express 入口
├─ src/
│  ├─ components/
│  │  ├─ AccountImportModal.tsx
│  │  ├─ CountdownTimer.tsx
│  │  └─ ui/
│  ├─ features/
│  │  └─ quota-monitor/
│  │     ├─ components/
│  │     ├─ context/
│  │     └─ hooks/
│  ├─ lib/
│  ├─ pages/
│  │  ├─ LoginPage.tsx
│  │  └─ QuotaMonitorPage.tsx
│  ├─ services/
│  ├─ types/
│  ├─ router.tsx
│  └─ main.tsx
├─ .env.example
├─ accounts.txt                      # 本地默认账号文件，已忽略提交
├─ package.json
└─ README.md
```

## 本地开发

### 环境要求

- Node.js 20+
- npm 10+

### 安装依赖

```bash
npm install
```

PowerShell 如遇执行策略限制，可改用：

```powershell
npm.cmd install
```

### 准备环境变量

复制 `.env.example` 为 `.env`，至少补齐登录密码和 Session Secret：

```env
HOST=127.0.0.1
PORT=3000
CORS_ORIGIN=http://127.0.0.1:5183
APP_LOGIN_USERNAME=admin
APP_LOGIN_PASSWORD=your-password
APP_LOGIN_SESSION_SECRET=your-random-secret
CAOWO_BASE_URL=https://caowo.xin
CAOWO_ACCOUNTS_FILE=./accounts.txt
CAOWO_CACHE_TTL_MS=10000
CAOWO_RATE_LIMIT_COOLDOWN_MS=180000
CAOWO_USAGE_SYNC_DELAY_MS=4000
CAOWO_TIMEOUT_MS=15000
CAOWO_AUTO_CHECKIN_ENABLED=1
CAOWO_AUTO_CHECKIN_TIME=00:01
CAOWO_AUTO_CHECKIN_TZ=Asia/Shanghai
CAOWO_AUTO_CHECKIN_CATCH_UP=1
CAOWO_AUTO_CHECKIN_RETRY_MINUTES=10
CAOWO_DEBUG=0
VITE_API_BASE_URL=
```

### 启动前后端

```bash
npm run dev
```

或：

```bash
npm run start:oneclick
```

`scripts/start-dev.js` 会：

- 在 `node_modules` 缺失时自动执行 `npm install`
- 自动寻找可用后端端口，默认从 `3000` 开始
- 自动寻找可用前端端口，默认从 `5183` 开始
- 自动注入 `VITE_API_BASE_URL`

默认访问地址：

- 登录页：[http://127.0.0.1:5183/login](http://127.0.0.1:5183/login)
- 控制台：[http://127.0.0.1:5183/quota-monitor](http://127.0.0.1:5183/quota-monitor)
- 健康检查：[http://127.0.0.1:3000/api/health](http://127.0.0.1:3000/api/health)

如果端口被占用，启动脚本会自动顺延到下一个可用端口。

### 分开启动

只启动后端：

```bash
npm run server
```

只启动前端：

```bash
npm run client
```

PowerShell 可写成：

```powershell
npm.cmd run server
npm.cmd run client
```

## 生产构建

```bash
npm run build
```

构建命令实际执行：

- `tsc --noEmit`
- `vite build`

构建完成后，Node 服务会同时提供 API 和 `dist/` 静态资源。

## 环境变量

以下变量是当前工程里已经实际使用的配置项。

### 基础服务

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `NODE_ENV` | `development` | 生产环境建议显式设为 `production` |
| `HOST` | `127.0.0.1` | Node 服务监听地址 |
| `PORT` | `3000` | Node 服务端口 |
| `CORS_ORIGIN` | 空 | 允许跨域来源，多个值可用英文逗号分隔 |
| `VITE_API_BASE_URL` | 空 | 前端 API 基础地址，留空时本地开发走代理 |
| `VITE_HOST` | `127.0.0.1` | Vite 开发服务器 Host |
| `VITE_PORT` | `5183` | Vite 开发服务器端口 |

### 登录认证

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_LOGIN_USERNAME` | `admin` | 登录页展示的用户名 |
| `APP_LOGIN_PASSWORD` | `yuqiaa` | 登录密码；生产环境必须改成强密码 |
| `APP_LOGIN_SESSION_SECRET` | `auto-cw-session-secret` | Cookie 签名密钥；生产环境必须替换 |
| `APP_LOGIN_SESSION_TTL_MS` | `604800000` | 登录态有效期，默认 7 天 |

### 目标站点与运行策略

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `CAOWO_BASE_URL` | `https://caowo.xin` | 目标站点地址 |
| `CAOWO_ACCOUNTS_FILE` | `./accounts.txt` | 账号文件路径 |
| `CAOWO_CACHE_TTL_MS` | `10000` | 看板缓存时间，毫秒 |
| `CAOWO_RATE_LIMIT_COOLDOWN_MS` | `180000` | 429 冷却时间，毫秒 |
| `CAOWO_USAGE_SYNC_DELAY_MS` | `4000` | 账号用量同步间隔，毫秒 |
| `CAOWO_TIMEOUT_MS` | `15000` | 上游请求超时，毫秒 |
| `CAOWO_DEBUG` | `0` | 为 `1` 时输出调试日志 |

### 自动签到

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `CAOWO_AUTO_CHECKIN_ENABLED` | `1` | 是否启用自动签到 |
| `CAOWO_AUTO_CHECKIN_TIME` | `00:01` | 每日触发时间，格式 `HH:mm` |
| `CAOWO_AUTO_CHECKIN_TZ` | `Asia/Shanghai` | 自动签到时区 |
| `CAOWO_AUTO_CHECKIN_CATCH_UP` | `1` | 错过时间点后是否当天补跑 |
| `CAOWO_AUTO_CHECKIN_RETRY_MINUTES` | `10` | 自动触发失败后的重试间隔，分钟 |

## 账号文件

默认账号文件为：

```text
./accounts.txt
```

也可以通过环境变量指定：

```env
CAOWO_ACCOUNTS_FILE=/absolute/path/to/accounts.txt
```

支持以下文本格式：

```text
username,password
user_a,pass_a
user_b,pass_b
```

也支持带字段名的格式：

```text
账号：user_a，密码：pass_a
username: user_b, password: pass_b
```

也支持 JSON：

```json
[
  { "username": "user_a", "password": "pass_a" },
  { "username": "user_b", "password": "pass_b" }
]
```

解析规则：

- 自动去重，按 `username` 保留首个有效账号
- 导入保存时会覆盖当前账号文件
- 支持从 `{ accounts: [...] }` 或 `{ data: [...] }` 结构解析

## API 概览

接口统一返回：

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

### 无需登录

- `GET /api/health`
- `GET /api/auth/config`
- `GET /api/auth/session`
- `POST /api/auth/login`
- `POST /api/auth/logout`

### 需要登录

- `GET /api/quota-monitor`
- `GET /api/quota-monitor?force=1`
- `GET /api/quota-monitor?selected=<username>`
- `POST /api/quota-monitor/accounts/:username/checkin`
- `POST /api/quota-monitor/checkin-all`
- `POST /api/quota-monitor/accounts/import`

批量签到请求体：

```json
{ "scope": "all" }
```

失败账号重试：

```json
{ "scope": "failed" }
```

账号导入请求体：

```json
{
  "content": "user1,password1\nuser2,password2",
  "format": "txt"
}
```

或：

```json
{
  "content": "[{\"username\":\"user1\",\"password\":\"pass1\"}]",
  "format": "json"
}
```

## 看板数据说明

前端每 30 秒自动刷新一次看板数据，并支持手动强制刷新。当前返回数据主要包括：

- `summary`：总余额、今日收益、今日用量、剩余额度、账号数量
- `accounts`：每个账号的签到状态、余额、用量、剩余额度、数据来源
- `alerts`：429、登录失效、同步超时等告警
- `trend`：最近 7 天签到收益 / 用量趋势
- `sync`：签到队列、用量同步队列、自动签到状态
- `accountFile`：当前账号文件实际路径

其中用量状态使用以下语义：

- `exact`：精确值
- `stale`：缓存值
- `pending`：等待后台同步
- `unavailable`：当前不可用

## 运行时缓存

以下内容属于运行时数据，不建议提交到仓库：

- `.cache/caowo-sessions.json`：账号会话缓存
- `.cache/caowo-auto-checkin.json`：自动签到状态缓存
- `dist/`：前端构建产物
- `.env`：本地环境变量
- `accounts.txt`：本地账号文件

`.gitignore` 已默认忽略这些文件。

## Docker

构建镜像：

```bash
docker build -f deploy/Dockerfile -t auto-cw .
```

运行示例：

```bash
docker run -d \
  --name auto-cw \
  -p 3000:3000 \
  --env-file .env \
  -v auto-cw-cache:/app/.cache \
  -v auto-cw-data:/app/data \
  auto-cw
```

镜像默认：

- 使用 `node:20-alpine`
- 容器内监听 `0.0.0.0:3000`
- 账号文件路径为 `/app/data/accounts.txt`
- 挂载 `/app/.cache` 与 `/app/data`

## Ubuntu 一键部署

推荐在 Ubuntu 22.04 / 24.04 服务器上使用仓库自带脚本：

```bash
bash deploy/install-linux.sh
```

安装脚本会在当前仓库目录中完成：

- 系统依赖安装
- `npm ci` 与 `npm run build`
- 发布到 `/opt/auto-cw/app`
- 生成或复用 `/opt/auto-cw/app/.env`
- 创建并保留 `/opt/auto-cw/data/accounts.txt`
- PM2 启动与持久化
- Nginx 站点配置
- Certbot 证书申请
- 健康检查与最终汇总

更多细节见 [deploy/UBUNTU_DEPLOY.md](deploy/UBUNTU_DEPLOY.md)。

## 常用命令

```bash
npm run dev
npm run build
npm run server
curl http://127.0.0.1:3000/api/health
```

生产环境：

```bash
pm2 status
pm2 logs auto-cw --lines 50
```

## 注意事项

- 生产环境必须修改 `APP_LOGIN_PASSWORD` 和 `APP_LOGIN_SESSION_SECRET`
- `NODE_ENV=production` 时，后端会校验上述两项是否仍为默认占位值
- 登录态使用 Cookie，生产环境会自动启用 `secure` Cookie
- 账号导入保存会覆盖当前账号文件，部署前请先备份真实数据
- 一键部署脚本会启用 UFW 并放行 `OpenSSH`、`80/tcp`、`443/tcp`

## 许可与使用提醒

- 本项目更接近私有运维工具，默认假设配置和账号由部署者自行维护
- 请不要把真实账号、密码、`.env`、`accounts.txt` 提交到公共仓库
