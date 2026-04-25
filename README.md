# CW-Ops 配额监控与签到面板

CW-Ops 是一个面向多账号运维场景的配额监控与签到管理系统。项目采用前后端一体化结构：

- 前端使用 React 19 + TypeScript + Vite 构建运营面板
- 后端使用 Express 提供健康检查、配额看板、签到和账号导入接口
- 支持批量签到、失败重试、自动签到、用量同步、账号导入和趋势分析

默认前端入口为 `/quota-monitor`，访问根路径 `/` 时会自动跳转到该页面。

## 主要功能

- 多账号看板总览：展示今日签到收益、总余额、今日用量、剩余额度
- 账号列表与详情联动：支持筛选、选中账号查看详细状态与来源
- 单账号签到与一键签到：支持全量签到和仅重试失败账号
- 自动签到调度：支持每日定时触发、补跑策略、失败重试和状态展示
- 用量同步队列：后台逐个同步账号当日用量，并展示进度和冷却状态
- 告警聚合：聚合限流、认证失败、同步超时等异常信息
- 账号导入：支持页面或接口导入 `txt/json`，保存后覆盖账号文件
- 数据分析：支持账号额度对比、签到趋势、用量趋势图表
- 明暗主题切换：前端支持浅色 / 深色主题

## 技术栈

- 前端：React 19、TypeScript、Vite、Tailwind CSS v4、Framer Motion、Recharts
- 数据层：TanStack React Query、Axios
- 组件：Radix UI、自定义 UI 组件
- 后端：Node.js、Express、Axios、dotenv

## 目录结构

```text
.
├─ deploy/                               # Docker、Nginx、低内存服务器辅助脚本
├─ public/                               # 静态资源
├─ scripts/
│  └─ start-dev.js                       # 一键启动脚本
├─ server/
│  ├─ api/
│  │  └─ quota.js                        # 配额监控与签到相关接口
│  ├─ utils/
│  │  ├─ accountLoader.js                # 账号文件读取、解析、保存
│  │  └─ caowo.js                        # 站点交互、缓存、队列、自动签到核心逻辑
│  └─ index.js                           # Express 服务入口
├─ src/
│  ├─ components/                        # 通用组件与账号导入弹窗
│  ├─ features/
│  │  └─ quota-monitor/
│  │     ├─ components/                  # 总览、列表、详情、分析面板
│  │     ├─ context/                     # 看板操作上下文
│  │     └─ hooks/                       # 配额查询与签到 hooks
│  ├─ lib/                               # Axios 封装、格式化工具
│  ├─ pages/
│  │  └─ QuotaMonitorPage.tsx            # 页面组合层
│  ├─ services/
│  │  ├─ account.ts                      # 账号相关请求
│  │  └─ quota.ts                        # 配额与批量签到请求
│  ├─ router.tsx                         # 轻量前端路由
│  └─ types/                             # 前后端共享类型
├─ accounts.txt                          # 默认账号文件，本地使用，不纳入 git
├─ .env.example                          # 环境变量示例
├─ package.json
└─ README.md
```

## 快速开始

### 1. 环境要求

- Node.js 20+
- npm 10+

### 2. 安装依赖

```bash
npm install
```

如果你在 Windows PowerShell 中遇到 `npm.ps1` 被执行策略拦截，可以改用：

```powershell
npm.cmd install
```

### 3. 一键启动前后端

```bash
npm run dev
```

或：

```bash
npm run start:oneclick
```

说明：

- 两个脚本当前都指向 `scripts/start-dev.js`
- 若 `node_modules` 不存在，启动脚本会先自动执行安装
- 启动脚本会自动寻找可用端口，并在终端输出最终访问地址
- 默认优先端口为后端 `3000`、前端 `5183`
- 默认前端 Host 为 `127.0.0.1`

默认访问地址：

- 前端：[http://127.0.0.1:5183/quota-monitor](http://127.0.0.1:5183/quota-monitor)
- 健康检查：[http://localhost:3000/api/health](http://localhost:3000/api/health)

如果 PowerShell 里直接执行 `npm` 被拦截，可以用：

```powershell
npm.cmd run dev
```

### 4. 分开启动

只启动后端：

```bash
npm run server
```

只启动前端：

```bash
npm run client
```

Windows PowerShell 下可写成：

```powershell
npm.cmd run server
npm.cmd run client
```

## 构建与运行

### 生产构建

```bash
npm run build
```

### 生产运行

```bash
npm run server
```

说明：

- `server/index.js` 会同时提供 API 和 `dist/` 静态资源服务
- 生产环境运行前应先执行 `npm run build`
- 如果只运行后端但没有构建前端，API 仍可工作，但页面静态资源不会完整提供

## 环境变量

以下是当前代码中实际支持的主要环境变量。

### 基础变量

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端服务端口 |
| `CORS_ORIGIN` | 空 | 允许的跨域来源，多个值可用英文逗号分隔 |
| `CAOWO_BASE_URL` | `https://caowo.xin` | 目标站点基础地址 |
| `CAOWO_ACCOUNTS_FILE` | `./accounts.txt` | 账号文件路径 |
| `CAOWO_CACHE_TTL_MS` | `10000` | 看板缓存时间，单位毫秒 |
| `CAOWO_RATE_LIMIT_COOLDOWN_MS` | `180000` | 限流冷却时间，单位毫秒 |
| `CAOWO_USAGE_SYNC_DELAY_MS` | `4000` | 账号用量同步间隔，单位毫秒 |
| `CAOWO_TIMEOUT_MS` | `15000` | 请求超时，单位毫秒 |
| `CAOWO_DEBUG` | `0` | 是否输出调试日志，`1` 为开启 |

### 自动签到相关

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `CAOWO_AUTO_CHECKIN_ENABLED` | `1` | 是否启用自动签到 |
| `CAOWO_AUTO_CHECKIN_TIME` | `00:01` | 每日自动签到时间，格式 `HH:mm` |
| `CAOWO_AUTO_CHECKIN_TZ` | `Asia/Shanghai` | 自动签到时区 |
| `CAOWO_AUTO_CHECKIN_CATCH_UP` | `1` | 错过触发时点后是否当天补跑 |
| `CAOWO_AUTO_CHECKIN_RETRY_MINUTES` | `10` | 自动签到失败后的重试间隔，单位分钟 |

### 前端相关

| 变量名 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | 空 | 前端请求 API 的基础地址，留空时走同源或本地代理 |
| `VITE_HOST` | `127.0.0.1` | Vite 开发服务器 Host |
| `VITE_PORT` | `5183` | Vite 开发服务器端口 |

示例：

```env
PORT=3000
CORS_ORIGIN=http://localhost:5183
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
VITE_HOST=127.0.0.1
VITE_PORT=5183
VITE_API_BASE_URL=
```

说明：

- 使用一键启动脚本时，`PORT` 和 `VITE_PORT` 会被当作“优先起始端口”，如果端口已占用，脚本会自动顺延寻找可用端口
- 分离部署前后端时，建议显式设置 `VITE_API_BASE_URL`

## 账号文件格式

默认账号文件路径为：

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

也支持带键名的写法：

```text
账号：user_a，密码：pass_a
username: user_b, password: pass_b
```

前端导入弹窗和导入接口还支持 JSON：

```json
[
  { "username": "user_a", "password": "pass_a" },
  { "username": "user_b", "password": "pass_b" }
]
```

说明：

- 系统会按 `username` 去重
- 页面导入保存时会覆盖当前账号文件内容
- `accounts.txt` 已被 `.gitignore` 忽略，适合本地或服务器私有配置

## API 概览

接口统一返回如下结构：

```json
{
  "success": true,
  "message": "ok",
  "data": {}
}
```

### 健康检查

- `GET /api/health`

### 配额看板

- `GET /api/quota-monitor`
- `GET /api/quota-monitor?force=1`
- `GET /api/quota-monitor?selected=<username>`

`/api/quota-monitor` 返回的核心数据包括：

- `summary`：总览汇总
- `accounts`：账号列表
- `alerts`：聚合告警
- `trend`：趋势图数据
- `accountFile`：当前账号文件路径
- `sync`：签到队列、用量同步、自动签到状态

### 单账号签到

- `POST /api/quota-monitor/accounts/:username/checkin`

### 批量签到

- `POST /api/quota-monitor/checkin-all`

请求体示例：

```json
{ "scope": "all" }
```

或仅重试失败账号：

```json
{ "scope": "failed" }
```

### 账号导入

- `POST /api/quota-monitor/accounts/import`

请求体示例：

```json
{
  "content": "user1,password1\nuser2,password2",
  "format": "txt"
}
```

也可以导入 JSON：

```json
{
  "content": "[{\"username\":\"user1\",\"password\":\"pass1\"}]",
  "format": "json"
}
```

## 前端页面结构

当前看板页面由以下模块组成：

- `OverviewPanel`：总览指标、任务完成度、自动签到状态
- `AccountListPanel`：账号列表、筛选、失败重试、单账号签到
- `AccountDetailPanel`：当前账号详细指标、状态与同步信息
- `QuotaAnalysisPanel`：额度对比、签到趋势、用量趋势图
- `AccountImportModal`：账号文件导入弹窗

前端数据层使用 React Query：

- 看板数据默认每 30 秒自动刷新一次
- 手动刷新会触发强制拉取并刷新缓存
- 签到和导入成功后会自动失效并重新拉取看板数据

## 部署资源

仓库已提供基础部署辅助文件：

- `deploy/Dockerfile`：容器化构建与运行
- `deploy/cw-ops.nginx.conf`：Nginx 反向代理示例
- `deploy/setup-swap.sh`：低内存 Linux 服务器增加 swap 的辅助脚本

如果使用 Docker，可从仓库根目录执行类似命令：

```bash
docker build -f deploy/Dockerfile -t cw-ops .
```

项目中的 Dockerfile 使用 `pnpm` 进行镜像内安装与构建；本地开发仍以 `npm` 脚本为主。

## 运行期文件

以下目录或文件属于运行时产物或本地私有配置，默认不应提交到仓库：

- `.cache/`：会话缓存和自动签到状态缓存
- `dist/`：前端构建产物
- `.env`：本地环境变量
- `accounts.txt`：本地账号文件

## 常见问题

### 1. PowerShell 里执行 `npm` 报脚本被禁止

优先使用：

```powershell
npm.cmd run dev
```

或：

```powershell
npm.cmd run server
```

### 2. 前端打不开或接口连不上

检查以下几点：

- 后端健康检查是否可访问：`/api/health`
- 当前实际端口是否被一键启动脚本自动顺延
- `VITE_API_BASE_URL` 是否配置正确
- `PORT`、`VITE_PORT` 是否和现有服务冲突

### 3. 看板没有账号数据

检查以下几点：

- `accounts.txt` 是否存在
- `CAOWO_ACCOUNTS_FILE` 是否指向正确路径
- 账号文件内容是否符合支持格式
- 是否误用了空文件覆盖了账号文件

## 许可与注意事项

- 当前仓库更偏向私有运维工具形态，默认假设账号和环境变量由你本地维护
- 请不要把真实账号、密码、`.env` 和 `accounts.txt` 提交到公共仓库
