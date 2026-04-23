# CW-Ops 账户管理系统

`CW-Ops` 是一个面向草窝多账号的额度监控与签到运维看板。

- 前端：React 19 + TypeScript + Vite + Tailwind CSS v4 + shadcn/ui + Recharts + Framer Motion
- 后端：Node.js + Express
- 敏感信息只保存在服务端，前端不会暴露账号密码

## 启动

```bash
npm install
npm run dev
```

如果 PowerShell 拦截 `npm.ps1`，请改用：

```powershell
npm.cmd install
npm.cmd run dev
```

默认地址：

- 前端：`http://localhost:5173/quota-monitor`
- 后端：`http://localhost:3000/api/health`

## 账号文件

默认读取：

```text
D:\Coding Project\Auto_CW\accounts.txt
```

也支持通过 `.env` 的 `CAOWO_ACCOUNTS_FILE` 指定。支持两种格式：

```text
username,password
账号：your_username，密码：your_password
```

## 本轮改造重点

- 批量签到改为“启动/恢复后台队列”，接口立即返回队列状态
- 签到采用自适应串行快路径，并在 429 时自动冷却续跑
- `todayUsed` 只使用当日日志统计接口，不再回退累计消耗
- 无法拿到精确值时显示 `待同步 / 不可用`
- 页面增加进度、冷却、筛选、失败重试、来源徽标和同步覆盖率

## API

- `GET /api/quota-monitor`
- `GET /api/quota-monitor?force=1`
- `GET /api/quota-monitor?selected=Boole`
- `POST /api/quota-monitor/accounts/:username/checkin`
- `POST /api/quota-monitor/checkin-all`
- `POST /api/quota-monitor/checkin-all` with body `{ "scope": "failed" }`

## 环境变量

```env
PORT=3000
CAOWO_BASE_URL=https://caowo.xin
CAOWO_ACCOUNTS_FILE=D:\Coding Project\Auto_CW\accounts.txt
CAOWO_CACHE_TTL_MS=10000
CAOWO_RATE_LIMIT_COOLDOWN_MS=180000
CAOWO_USAGE_SYNC_DELAY_MS=4000
CAOWO_TIMEOUT_MS=15000
VITE_API_BASE_URL=
```

## 构建

```bash
npm run build
npm run server
```

生产模式下后端会托管 `dist` 目录，可直接部署到 Node.js 环境。
