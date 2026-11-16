# tt-music（本地补丁版）

基于上游 [XCQ0607/lxserver](https://github.com/XCQ0607/lxserver) v1.21.0（镜像 `penhaijun/lx-music-server`，**amd64 + arm64 双架构**，alpine 3.24.1）的运行时编译产物，叠加本地定制补丁，并提供 Dockerfile 可自行构建镜像。

> 本仓库保存的是容器内**编译后的 CommonJS 运行产物**，不是上游 TypeScript 源码树，不能直接 `npm run build` 重新编译（仓库内没有 `tsconfig.json` / `src/` / `package-lock.json`）。

**首次部署无需准备任何密码**：起容器后打开网页，会进入初始化向导，由你自己设置管理员密码。

## 目录结构

```
tt-music-docker/
├── .github/workflows/
│   └── docker-publish.yml  # CI：buildx 构建 amd64+arm64 双架构并推送 Docker Hub
├── Dockerfile              # 基于上游镜像叠加源码层（纯 COPY、无 RUN）
├── docker-compose.yml      # 生产编排：从 Docker Hub 拉镜像
├── docker-compose.local.yml# 本地构建用的覆盖文件（加回 build 段）
├── .env.example            # 可选：预置密码 / 镜像地址（复制为 .env）
├── config.clean.js         # 覆盖上游镜像自带 /server/config.js 的空凭据配置
├── config.example.js       # 可选的高级配置模板（复制为 data/config.js）
├── index.js                # 容器入口
├── package.json            # 依赖与元信息
├── docker/empty            # 空文件，用于覆盖上游 public/ 里残留的 .DS_Store
├── public/
│   ├── setup.html          # 【补丁】首次部署初始化向导页面
│   └── ...                 # 前端静态资源
└── server/
    ├── server/setup.js     # 【补丁】初始化守卫 + /api/setup/* 接口
    └── ...                 # 后端编译产物
```

## 发布链路：GitHub → Docker Hub → 各设备

仓库推到 GitHub 后，`.github/workflows/docker-publish.yml` 会自动用 buildx 构建 **amd64 + arm64 双架构**镜像，以同一个 tag 推到 Docker Hub（manifest list）。各设备只负责拉镜像，不本地编译，也不用关心自己是什么架构。

### 首次配置（只需做一次）

1. 在 Docker Hub 建一个仓库 `tt-music`（与工作流里的 `IMAGE_NAME` 一致），公开仓库即可免登录 pull。
2. Docker Hub → Account Settings → **Personal access tokens**，建一个 **Read & Write** 权限的 token。
3. GitHub 仓库 → Settings → Secrets and variables → Actions，添加两个 Repository secrets：
   - `DOCKERHUB_USERNAME`：你的 Docker Hub 用户名
   - `DOCKERHUB_TOKEN`：上一步的 token（**不是账号登录密码**）
4. 把 `docker-compose.yml` 里的 `CHANGE_ME` 改成你的 Docker Hub 用户名，提交并 push。**只有这一行影响实际运行**，所有设备共用同一份配置；README 其它示例命令里的 `CHANGE_ME` 只是示意，手动执行时同样换成你的用户名即可。

> 默认分支若不叫 `main`/`master`，把工作流 `on.push.branches` 改成对应名字；也可以随时在 Actions 页面手动 `Run workflow` 触发。

push 到 `main`/`master` → 产出 `:latest` 和 `:sha-xxxxxx`；打 `v1.2.3` 这类 tag → 额外产出 `:1.2.3`、`:1.2`。也可在 Actions 页面手动 `Run workflow` 重跑。工作流最后一步会打印 `docker buildx imagetools inspect` 结果，确认推上去确实有两个平台。

> GitHub 托管 runner 是 x86，所以**必须**由工作流做 `platforms: linux/amd64,linux/arm64/v8` 的多架构构建；在 runner 上普通 `docker build` 只会产出 amd64 单架构镜像，arm64 设备拉下来会 `exec format error`。因为本 Dockerfile 不含 `RUN`，两种架构的构建都不需要 qemu（工作流里仍保留 QEMU 步骤，以防将来新增 RUN）。

### 部署到任意设备（x86 / arm64 通用）

```bash
mkdir -p data music
docker compose up -d          # 自动拉取匹配本机架构的层，不需要 --build
docker compose ps            # 观察 HEALTHCHECK 状态
# 浏览器打开 http://<设备IP>:9527/ → 自动进入 /setup 设置管理员密码
```

升级：`docker compose pull && docker compose up -d`。设备端只需要 `docker-compose.yml`（外加可选的 `.env`），**不需要整个源码仓库**。

只有在需要**预置密码 / 无人值守部署**时才填 `.env` 的三个密码项——填了 `ADMIN_PASSWORD` 就会跳过初始化向导。

### 备选：本地自行构建

不想走 Docker Hub 时，用覆盖文件加回 `build:` 段：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

产出 `tt-music:local`，不影响默认的拉取行为。注意本地构建只会产出**当前机器**的架构，把它 `docker save` / `docker load` 到另一种架构的设备会 `exec format error`（上游镜像内置原生模块，不能跨架构拷贝）。

### 备选：纯 Docker（不用 compose）

```bash
docker pull CHANGE_ME/tt-music:latest     # 或本地 docker build -t tt-music:patched .
docker run -d --name tt-music \
  --network host \
  --restart unless-stopped \
  -v "$PWD/data:/server/data" \
  -v "$PWD/music:/server/music" \
  CHANGE_ME/tt-music:latest

# 打开 http://127.0.0.1:9527/ 完成首次设置
# 如需预置密码（跳过向导），追加：
#   -e FRONTEND_PASSWORD='后台密码' -e WEBPLAYER_PASSWORD='播放器密码' -e LX_USER_admin='同步密码'
```

> `docker run` 的 `-v` 源必须是**绝对路径或卷名**，不能写 `./data`；只有 compose 支持相对路径。

服务端口 `9527`。`network_mode: host` 用于 DLNA（SSDP 多播）和 AirPlay（mDNS）在局域网内被发现；此模式下 `EXPOSE` 不生效（无害）。**Windows Docker Desktop 需 4.34+ 且在设置中启用 host networking**，否则本地验证请改用 `-p 9527:9527`。

## 首次打开：设置管理员密码

判定条件很简单：**`frontend.password` 为空 = 未初始化**。镜像内的 `config.clean.js` 在没预置 `FRONTEND_PASSWORD` 时给出空密码，于是首次访问触发向导；设置结果写回数据卷 `data/config.js`，重启后自动加载，不会重复引导。

| 行为 | 说明 |
|---|---|
| 访问任意页面 | 302 跳转到 `/setup`；所有 `/api/*`（除 setup 接口）返回 `503 SETUP_REQUIRED`，避免无密码状态下被访问 |
| `GET /api/setup/status` | 返回 `{ "required": true/false }` |
| `POST /api/setup/init` | 设置管理员密码；可勾选「同时为 Web 播放器设置密码」（密码留空则与管理员密码相同） |
| 设置完成后 | 密码写入 `data/config.js` 并同步到内存，页面跳到 `/admin`；`/setup` 与 `/api/setup/*` 随即永久关闭（302 回后台） |

安全约束：

- 密码需 **8–128 位、至少两类字符**，拦截纯数字 / 重复字符 / 常见弱口令；服务端与页面使用同一套规则。
- 初始化接口**默认只允许本机与私有地址**（`127.*`、`10.*`、`172.16-31.*`、`192.168.*`、IPv6 私有段）调用，并有每 IP 5 分钟 10 次的限速、并发锁与重复提交检查。若必须经公网完成初始化，可加 `-e SETUP_ALLOW_PUBLIC=true`，但请尽快完成。
- 密码写入前会**回读校验**，若数据卷不可写会直接报错，不会出现"提示成功但重启丢失"。
- 同步账号（洛雪音乐 PC/移动端连接用）不在向导里创建，请到管理后台「用户管理」添加，或在 `.env` 里设 `SYNC_PASSWORD`。

如遗忘管理员密码：停止容器 → 编辑 `data/config.js`，把 `frontend.password` 改为空字符串 → 重启后会重新进入向导。**请只在可信网络内这样操作**，因为清空期间服务处于未初始化状态。

## 配置与凭据

| 来源 | 用途 | 优先级 |
|---|---|---|
| `.env` → `FRONTEND_PASSWORD` / `WEBPLAYER_PASSWORD` / `LX_USER_*` | 预置密码、跳过向导（可选） | **最高**，`server/index.js:171-259` 最后应用 |
| `/setup` 向导 → `data/config.js`（由 `CONFIG_PATH` 指定） | 管理员密码、播放器密码/鉴权开关、高级功能 | 中，启动时加载 |
| `config.clean.js` → 镜像内 `/server/config.js` | 清除上游默认凭据，并决定是否需要初始化 | 基础层 |
| `server/defaultConfig.js` | 内置默认值 | 最低 |

- **不要在 `config.js` 里手写服务登录密码**（向导会管理）。`webdav.password` 属于第三方存储凭据，是例外。`.env`、`data/`、`music/` 均已被 `.gitignore` / `.dockerignore` 排除。
- 注意：预置的环境变量优先级高于 `data/config.js`，**一旦填了 `ADMIN_PASSWORD`，就会覆盖向导曾经设置过的密码**。
- 上游镜像自带 `/server/config.js`，内含 `frontend.password` / `player.password` = `123456`、`player.enableAuth=false`、同步用户 `tt01/123456`，以及硬编码的内网代理地址。`.dockerignore` 删不掉镜像里已有的文件，因此 Dockerfile 用 `config.clean.js` 显式覆盖它。
- `server/index.js:142-153` 在 `CONFIG_PATH` 文件不存在时会自动写出 `data/config.js`；因为 `config.clean.js` 读取 `process.env`，预置模式下写出的也是真实密码，不会把上游弱口令固化进数据卷。
- `LOG_PATH` 由上游镜像提供（`/server/data/logs`），日志随数据卷持久化。
- `margeConfig` 只合并 `server/defaultConfig.js` 中已存在的键；`airplayDebug`、`radio.proxy.enabled`、`radio.proxy.address` 已补进 `defaultConfig.js`，模板里这几项现在能正常生效。

## 本地补丁清单

### 1. 下载音质放开（下载时可选 Hi-Res / 无损 / 320k / 128k，不再只允许无损）

| 容器路径 | 说明 |
|---|---|
| `/server/public/music/js/quality.js` | 音质优先级放开为 flac24bit / flac / 320k / 128k，按偏好降级 |
| `/server/public/music/js/single_song_ops.js` | 单曲/批量缓存到服务器增加音质选择，逐首降级取音质 |
| `/server/public/music/js/album-complete.js` | 专辑补全不再过滤非无损歌曲，统一音质选择 |
| `/server/public/music/js/download_manager.js` | 跳过提示改为“无可用音质” |
| `/server/public/app.js` | 老后台批量下载弹窗增加音质下拉，请求体携带 quality |
| `/server/server/server/server.js` | 批量下载接口不再写死 `flac`，改用请求传入的音质 |

### 2. 修复播放结束不自动切歌

| 容器路径 | 说明 |
|---|---|
| `/server/server/server/fileCache.js` | Range 请求越界校验：钳制 start/end，越界返回 416，支持 `bytes=-N`，监听流 error |
| `/server/server/server/localLib/localSong.js` | 本地库文件服务同上的 Range 越界修复 |

根因：播放器尾部续播请求的 `start` 等于文件长度，旧代码未校验直接交给 `createReadStream`，抛出 `ERR_OUT_OF_RANGE`，音频流中断、`ended` 不触发，导致不切下一首。

### 3. 首次部署初始化向导

| 容器路径 | 说明 |
|---|---|
| `/server/server/server/setup.js` | 未初始化守卫、状态查询与初始化接口、密码强度校验、配置持久化回读校验 |
| `/server/public/setup.html` | 自包含的初始化页面（不依赖其它静态资源，因为未初始化时它们会被拦截） |
| `/server/server/server/server.js` | 在 pathname 解析后插入守卫：`if (await handleSetup(req, res, pathname)) return;` |
| `/server/config.js`（由 `config.clean.js` 覆盖） | 空管理员密码 = 触发向导；写入 `data/config.js` 后重启不再触发 |

## 架构与依赖说明

**统一靠 Docker Hub 的双架构 manifest，不靠设备本地构建。** 工作流在 x86 runner 上一次产出两种平台的层并推到同一个 tag，各设备 `docker compose pull` 时由 Docker 自动选层：

| 设备 | 自动选到的平台 | 需要改配置吗 |
|---|---|---|
| 64 位 x86（PC / 服务器 / x86 NAS） | `linux/amd64` | 不需要 |
| ARM64（NAS / 树莓派 / 开发板） | `linux/arm64/v8` | 不需要 |

可在任意机器上验证推上去的确实是双架构：

```bash
docker buildx imagetools inspect CHANGE_ME/tt-music:latest
```

输出里应同时出现 `linux/amd64` 和 `linux/arm64/v8` 两个条目。上游镜像只有这两种架构，32 位 x86（`linux/386`）不受支持。`docker-compose.yml` 里没有也不该有 `platform` 字段——写死反而会破坏自动选层。

### 依赖与叠层注意事项

- 上游 `latest` 实测为 **amd64 + arm64 双架构**。Dockerfile 固定在 2026-08-09 的多架构索引 digest `sha256:225e06e7…`，避免基线漂移；两个架构的 manifest digest 记录在 Dockerfile 注释里。
- `node_modules`（含 `music-tag-native`、`ffmpeg-static`、`bufferutil` 等原生模块）由上游镜像内置，本仓库不携带，**不能跨架构拷贝**；双架构 manifest 已保证各设备拉到匹配的层，但本地构建出的单架构镜像不能跨设备分发。
- 本 Dockerfile **不含任何 RUN 指令**，是纯 COPY 叠加。若以后新增 RUN，跨平台构建就需要 binfmt/qemu。
- COPY 是**叠加不删除**：上游新增/改名/删除的文件不会自动同步，升级上游 digest 时必须回归上面的补丁清单。上游 `public/` 里的 4 个 `.DS_Store` 已用 `docker/empty` 覆盖内容（Express static 默认忽略点文件，本就不会对外提供，此举只是清掉元数据）。
- `LOCAL_LIB_PATH` 在本份编译产物中没有任何读取点，已从 ENV 中移除；启动时 `ensureMusicDirectories()` 只创建 `download`、`cache`，如需 `local_lib` 请自行在 `music/` 下创建。

### 备选：脱离上游镜像自建（不推荐，需自行处理原生依赖）

```dockerfile
FROM alpine:3.24
RUN apk add --no-cache nodejs npm ffmpeg tzdata python3 make g++ \
    && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
WORKDIR /server
COPY package.json ./
# 本仓库没有 package-lock.json，不能用 npm ci
RUN npm install --omit=dev
COPY config.clean.js ./config.js
COPY public/ ./public/
COPY server/ ./server/
COPY index.js ./
ENV LOG_PATH=/server/data/logs \
    CONFIG_PATH=/server/data/config.js \
    DATA_PATH=/server/data
CMD ["node", "index.js"]
```

该方式必须在**目标同架构**上编译原生模块，缺构建工具链会失败；同样支持 `/setup` 向导（不注入 `FRONTEND_PASSWORD` 即可）。

## 不入库 / 不进镜像的内容

`node_modules/`（基线镜像内置）、`data/`（管理员密码、账号、数据库、日志）、`music/`（音乐、缓存、下载）、`.env`、日志与临时文件，均已在 `.gitignore` / `.dockerignore` 排除；`.github/` 也被排除出构建上下文。`.env.example` 不含真实密码，特意保留在仓库中。**`DOCKERHUB_TOKEN` 只能放在 GitHub Repository secrets 里，绝不能写进仓库任何文件**（含 workflow、compose、Dockerfile）。

上游许可证：Apache-2.0。
