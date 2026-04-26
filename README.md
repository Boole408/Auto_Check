# Auto_CW

Auto_CW 是一个面向多账号运维场景的 CAOWO 配额监控与签到面板。项目采用前后端一体化结构：前端负责登录页和监控控制台，后端负责账号读取、登录态维护、签到队列、用量同步和自动签到调度。

默认路由会按登录状态自动跳转：

- 未登录跳转到 `/login`
- 已登录跳转到 `/quota-monitor`

## 功能

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
│  ├─ install-ubuntu.sh             # Ubuntu 服务器安装脚本
│  ├─ auto-cw.service               # systemd 服务单元
│  ├─ autocw.ccwu.cc.nginx.conf     # Nginx 站点配置
│  ├─ .env.production.example       # 生产环境变量模板
│  ├─ setup-swap.sh                 # 低内存主机 swap helper
│  └─ DEPLOY_UBUNTU_CLOUDFLARE.md   # 生产部署说明
├─ public/
├─ scripts/
│  ├─ prepare-release.js             # 生成本地部署运行包
│  └─ start-dev.js                   # 同时启动前后端并自动寻找可用端口
├─ server/
│  ├─ api/
│  │  ├─ auth.js                     # 登录、登出、会话、登录配置接口
│  │  └─ quota.js                    # 看板、签到、账号导入接口
│  ├─ utils/
│  │  ├─ accountLoader.js            # 账号文件解析与保存
│  │  ├─ auth.js                     # 登录态与 Cookie
│  │  └─ caowo.js                    # 站点交互、缓存、队列、自动签到
│  └─ index.js                       # Express 入口
├─ src/
│  ├─ components/
│  ├─ features/
│  │  └─ quota-monitor/
│  ├─ lib/
│  ├─ pages/
│  │  ├─ LoginPage.tsx
│  │  └─ QuotaMonitorPage.tsx
│  ├─ services/
│  ├─ types/
│  ├─ router.tsx
│  └─ main.tsx
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
npm run dev       # 同时启动前后端
npm run server    # 只启动 Express 后端
npm run client    # 只启动 Vite 前端
npm run build     # 类型检查并构建前端产物
npm run build:release  # 构建并生成 .release/app 运行包
npm run preview   # 预览前端构建产物
```

健康检查：

```bash
curl http://127.0.0.1:3000/api/health
```

## 生产部署

当前仓库已经提供了面向 `Ubuntu + Nginx + systemd + Cloudflare` 的部署资产，适合将服务发布到单台公网服务器。

生产形态：

- 应用进程监听 `127.0.0.1:3000`
- Nginx 反代页面和 `/api/*`
- 浏览器统一访问同一个 HTTPS 域名
- 账号文件建议放在独立数据目录
- 前端构建在本地完成，服务器只安装运行时依赖

部署相关文件位于 `deploy/`：

- `deploy/install-ubuntu.sh`
- `deploy/auto-cw.service`
- `deploy/autocw.ccwu.cc.nginx.conf`
- `deploy/.env.production.example`
- `deploy/DEPLOY_UBUNTU_CLOUDFLARE.md`

本地先生成运行包：

```bash
npm ci
npm run build:release
```

运行包会出现在：

```text
.release/app
```

把 `.release/app` 上传到服务器的 `/opt/auto-cw/app` 后，如果你的目标环境就是 `autocw.ccwu.cc`，可以直接参考部署说明：

```bash
scp -r .release/app/. deployer@38.55.146.171:/opt/auto-cw/app/
```

然后在服务器执行：

```bash
bash deploy/install-ubuntu.sh
```

## 环境变量

### 基础服务

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Express 监听地址 |
| `PORT` | `3000` | Express 监听端口 |
| `TRUST_PROXY` | 空 | 反向代理场景下可设为 `1`，让 Express 信任上一跳代理 |
| `CORS_ORIGIN` | 空 | 允许跨域来源，多个值用英文逗号分隔 |
| `VITE_API_BASE_URL` | 空 | 前端 API 基础地址，留空时本地开发走启动脚本注入 |

### 登录认证

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `APP_LOGIN_USERNAME` | `admin` | 登录页展示的用户名 |
| `APP_LOGIN_PASSWORD` | `change-this-login-password` | 登录密码，请改成自己的强密码 |
| `APP_LOGIN_SESSION_SECRET` | `change-this-session-secret` | Cookie 签名密钥，请改成随机长字符串 |
| `APP_LOGIN_SESSION_TTL_MS` | `604800000` | 登录态有效期，默认 7 天 |

当 `NODE_ENV=production` 时，后端会拒绝使用默认密码或默认会话密钥。

### CAOWO 配置

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `CAOWO_BASE_URL` | `https://caowo.xin` | CAOWO 站点地址 |
| `CAOWO_ACCOUNTS_FILE` | `./accounts.txt` | 账号文件路径 |
| `CAOWO_CACHE_TTL_MS` | `10000` | 看板缓存时间，单位毫秒 |
| `CAOWO_RATE_LIMIT_COOLDOWN_MS` | `180000` | 429 冷却时间，单位毫秒 |
| `CAOWO_USAGE_SYNC_DELAY_MS` | `4000` | 账号用量同步间隔，单位毫秒 |
| `CAOWO_TIMEOUT_MS` | `15000` | 上游请求超时，单位毫秒 |
| `CAOWO_DEBUG` | `0` | 设置为 `1` 时输出调试日志 |

### 自动签到

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `CAOWO_AUTO_CHECKIN_ENABLED` | `1` | 是否启用自动签到 |
| `CAOWO_AUTO_CHECKIN_TIME` | `00:01` | 每日触发时间，格式 `HH:mm` |
| `CAOWO_AUTO_CHECKIN_TZ` | `Asia/Shanghai` | 自动签到时区 |
| `CAOWO_AUTO_CHECKIN_CATCH_UP` | `1` | 错过时间点后是否当天补跑 |
| `CAOWO_AUTO_CHECKIN_RETRY_MINUTES` | `10` | 自动触发失败后的重试间隔，单位分钟 |

## 账号文件

默认账号文件：

```text
./accounts.txt
```

也可以通过环境变量指定：

```env
CAOWO_ACCOUNTS_FILE=/absolute/path/to/accounts.txt
```

支持普通文本格式：

```text
username,password
user_a,pass_a
user_b,pass_b
```

支持带字段名的文本格式：

```text
账号：user_a，密码：pass_a
username: user_b, password: pass_b
```

支持 JSON：

```json
[
  { "username": "user_a", "password": "pass_a" },
  { "username": "user_b", "password": "pass_b" }
]
```

解析规则：

- 按 `username` 自动去重，保留首个有效账号
- 导入保存时会覆盖当前账号文件
- JSON 同时支持 `{ "accounts": [...] }` 和 `{ "data": [...] }`

## 页面与接口

页面：

- `/login`：登录页
- `/quota-monitor`：主控制台

接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `GET` | `/api/auth/config` | 获取登录页配置 |
| `GET` | `/api/auth/session` | 获取当前会话 |
| `POST` | `/api/auth/login` | 登录 |
| `POST` | `/api/auth/logout` | 登出 |
| `GET` | `/api/quota-monitor/dashboard` | 获取看板数据 |
| `POST` | `/api/quota-monitor/accounts/:username/checkin` | 单账号签到 |
| `POST` | `/api/quota-monitor/checkin-all` | 批量签到 |
| `POST` | `/api/quota-monitor/accounts/import` | 导入账号 |

接口返回结构统一为：

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

## 运行时文件

以下内容属于本地运行数据，不建议提交到仓库：

- `.env`：本地环境变量
- `accounts.txt`：本地账号文件
- `.cache/caowo-sessions.json`：账号会话缓存
- `.cache/caowo-auto-checkin.json`：自动签到状态缓存
- `dist/`：前端构建产物

`.gitignore` 已默认忽略这些文件。

## 使用提醒

- 请不要把真实账号、密码、`.env`、`accounts.txt` 提交到公共仓库
- 账号导入保存会覆盖当前账号文件，导入前请先备份真实数据
- 本项目更接近私有运维工具，默认假设配置和账号由使用者自行维护
