# TT-Music 本地补丁镜像
# 基线复用上游镜像（已内置 node、ffmpeg、node_modules），仓库只提供源码层覆盖
# 上游 penhaijun/lx-music-server 为 amd64 + arm64 双架构（alpine 3.24.1）
FROM penhaijun/lx-music-server:latest@sha256:225e06e7ebdc77c8636f840b65ec8cc680e6773e3c87315e8949048f7da28cce
# 固定到 2026-08-09 的多架构索引 digest，避免 latest 漂移导致补丁与基线失配。
# 用索引（而非单架构 manifest）才能让 Docker 按宿主机架构自动选层：
#   amd64 manifest: sha256:a87ef82738a8b8aaa90285bf925b4f54909be8505cb2efad301789e531612c87
#   arm64 manifest: sha256:bfe33126ca96a69579d7e4cc4f4540b5405b50352a6262fc39d7bb81b765ee66
# 升级上游时请重新核对 digest，并回归 README 的「本地补丁清单」。

WORKDIR /server

# 后端编译产物 + 前端静态资源，覆盖镜像内同名文件；node_modules 保留自上游镜像
COPY server/ ./server/
COPY public/ ./public/
COPY index.js ./
COPY package.json ./

# 【关键】覆盖上游镜像自带的 /server/config.js（内含 123456 / tt01 等默认凭据）。
# COPY 是叠加不删除，.dockerignore 也管不到镜像里已有的文件，只能显式覆盖。
COPY config.clean.js ./config.js

# 上游 public/ 残留 4 个 macOS .DS_Store，COPY 叠加不会删除它们。
# 用空文件覆盖其内容（纯 COPY、无 RUN，保持跨平台构建能力）。
COPY docker/empty ./public/.DS_Store
COPY docker/empty ./public/music/.DS_Store
COPY docker/empty ./public/music/images/.DS_Store
COPY docker/empty ./public/music/images/about/.DS_Store

# 运行时配置由数据卷 / 环境变量提供；仓库内不携带任何明文密码。
# LOG_PATH 继承自上游镜像（=/server/data/logs），日志落在数据卷内，无需重复声明。
ENV NODE_ENV=production \
    PORT=9527 \
    BIND_IP=0.0.0.0 \
    TZ=Asia/Shanghai \
    DATA_PATH=/server/data \
    CONFIG_PATH=/server/data/config.js \
    DOWNLOAD_PATH=/server/music/download \
    CACHE_PATH=/server/music/cache

EXPOSE 9527
VOLUME ["/server/data", "/server/music"]

# 注意：本 Dockerfile 刻意不含任何 RUN 指令，因此纯 COPY 可跨平台构建
#（在 x86 上指定 --platform linux/arm64/v8 时无需 qemu）。新增 RUN 会破坏这一点。
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||9527)+'/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "index.js"]
