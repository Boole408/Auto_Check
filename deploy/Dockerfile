# 使用轻量级的 Node Alpine 作为基础镜像
FROM node:20-alpine AS builder

# 安装 pnpm (比 npm 快，且省内存)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# 先只拷贝依赖配置文件，利用 Docker 缓存加速
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# 拷贝全部源码
COPY . .

# 在镜像内打包前端 (如果 2G 内存报错，这步要在本地做，见下方说明)
RUN pnpm run build

# ==========================================
# 生产环境运行镜像 (仅包含必要文件，极大减小体积)
FROM node:20-alpine AS runner

WORKDIR /app

# 设置时区为亚洲/上海，解决定时签到时间错乱问题
ENV TZ=Asia/Shanghai
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

# 只安装生产环境所需的依赖
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --prod --frozen-lockfile

# 从 builder 阶段拷贝打好的前端和后端代码
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/accounts.txt ./accounts.txt

# 设置生产环境变量
ENV NODE_ENV=production
ENV PORT=3000

# 暴露后端端口 (容器内部)
EXPOSE 3000

# 启动服务
CMD ["node", "server/index.js"]