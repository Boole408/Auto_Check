# CW-Ops 账户管理系统

`CW-Ops` 是一个面向草窝多账号运维场景的额度监控与签到管理看板。项目提供前后端一体的本地运行方案，覆盖账号导入、额度汇总、签到队列、自动签到、用量同步和趋势分析。

## 功能概览

- 多账号额度看板：总额度、剩余额度、今日已用、签到收益一屏查看
- 单账号详情面板：状态、刷新时间、用量同步状态、更多诊断字段
- 批量签到队列：支持全量执行、失败账号重试、限流冷却与恢复
- 自动签到：后端按计划时间每日触发，支持跨天补跑与失败退避
- 账号导入：支持页面导入 `txt/json`，并写回本地账号文件
- 数据分析：账号额度对比、签到趋势、用量趋势图表

## 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind CSS v4、Framer Motion、Recharts
- 组件：Radix UI、定制化 `shadcn/ui`
- 后端：Node.js、Express、Axios

## 目录结构

```text
.
├── accounts.txt              # 默认账号文件（运行时读取）
├── deploy/                   # Docker / Nginx / 系统部署辅助文件
├── public/                   # 静态资源（如 favicon）
├── scripts/start-dev.js      # 一键启动脚本
├── server/                   # Express API 与草窝逻辑
├── src/                      # React 页面与前端服务
├── .env.example              # 环境变量示例
├── index.html
├── package.json
└── README.md
```

## 启动方式

安装依赖：

```bash
npm install
```

启动前后端开发环境：

```bash
npm run dev
```

或使用一键启动：

```bash
npm run start:oneclick
```

说明：

- `npm run dev` 和 `npm run start:oneclick` 当前都指向 `scripts/start-dev.js`
- 启动脚本会自动选择可用端口，并在终端输出真实访问地址
- 默认优先地址：
  - 前端：`http://localhost:5183/quota-monitor`
  - 后端健康检查：`http://localhost:3000/api/health`

Windows PowerShell 如果拦截 `npm.ps1`，可改用：

```powershell
npm.cmd install
npm.cmd run dev
```

## 账号文件

默认账号文件路径：

```text
./accounts.txt
```

也可以通过环境变量指定：

```env
CAOWO_ACCOUNTS_FILE=/absolute/path/to/accounts.txt
```

支持的账号格式：

```text
username,password
账号：your_username，密码：your_password
```

也支持通过页面或接口导入 JSON：

```json
[
  { "username": "user1", "password": "pass1" },
  { "username": "user2", "password": "pass2" }
]
```

## 环境变量

基础变量：

```env
PORT=3000
CAOWO_BASE_URL=https://caowo.xin
CAOWO_ACCOUNTS_FILE=./accounts.txt
CAOWO_CACHE_TTL_MS=10000
CAOWO_RATE_LIMIT_COOLDOWN_MS=180000
CAOWO_USAGE_SYNC_DELAY_MS=4000
CAOWO_TIMEOUT_MS=15000
VITE_API_BASE_URL=
```

自动签到相关可选变量：

```env
CAOWO_AUTO_CHECKIN_ENABLED=1
CAOWO_AUTO_CHECKIN_TIME=00:01
CAOWO_AUTO_CHECKIN_TZ=Asia/Shanghai
CAOWO_AUTO_CHECKIN_CATCH_UP=1
CAOWO_AUTO_CHECKIN_RETRY_MINUTES=10
CAOWO_DEBUG=0
```

说明：

- `CAOWO_AUTO_CHECKIN_TIME` 使用 `HH:mm` 格式
- `CAOWO_AUTO_CHECKIN_TZ` 默认 `Asia/Shanghai`
- `CAOWO_AUTO_CHECKIN_CATCH_UP=1` 表示服务错过计划时间后，当天恢复时会自动补跑
- `VITE_API_BASE_URL` 在前后端分离部署时可显式指定前端请求地址

## API

健康检查：

- `GET /api/health`

额度看板：

- `GET /api/quota-monitor`
- `GET /api/quota-monitor?force=1`
- `GET /api/quota-monitor?selected=Boole`

签到：

- `POST /api/quota-monitor/accounts/:username/checkin`
- `POST /api/quota-monitor/checkin-all`
- `POST /api/quota-monitor/checkin-all` with body `{"scope":"failed"}`

账号导入：

- `POST /api/quota-monitor/accounts/import`

示例：

```bash
curl -X POST http://localhost:3000/api/quota-monitor/accounts/import \
  -H "Content-Type: application/json" \
  -d '{"content":"user1,password1\nuser2,password2","format":"txt"}'
```

## 构建与生产运行

构建前端：

```bash
npm run build
```

启动生产服务：

```bash
npm run server
```

说明：

- 后端会静态托管 `dist/` 目录
- 生产环境启动前需要先执行 `npm run build`
- `deploy/` 目录中包含 Docker、Nginx 和 swap 辅助文件，可按需调整

## 清理说明

以下内容属于运行缓存或构建产物，不应作为源码长期保留：

- `.cache/`
- `dist/`

它们已经被 `.gitignore` 忽略，重新运行构建或服务时会自动生成。
