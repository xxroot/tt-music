<div align="center">

# tt-music

**洛雪音乐助手服务端 · 本地补丁版**

基于上游 [XCQ0607/lxserver](https://github.com/XCQ0607/lxserver) v1.21.0（镜像 `penhaijun/lx-music-server`，Alpine 3.24.1）的运行时编译产物，叠加本地定制补丁；提供 amd64 + arm64 双架构镜像，也可用仓库内 Dockerfile 自行构建。

[![Docker Hub](https://img.shields.io/badge/Docker_Hub-cjroot%2Ftt--music-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/cjroot/tt-music)
[![Platform](https://img.shields.io/badge/arch-amd64%20%7C%20arm64%2Fv8-2EA043)](#架构与依赖说明)
[![Upstream](https://img.shields.io/badge/upstream-lxserver_v1.21.0-6F42C1)](https://github.com/XCQ0607/lxserver)
[![Base](https://img.shields.io/badge/base-Alpine_3.24.1-0D597F)](#架构与依赖说明)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./public/LICENSE)

</div>

---

## 这个版本改了什么

上游镜像内置了一组固定弱口令，功能上也有几处限制。本补丁版在保留上游运行时产物的前提下做了这些调整：

| | 补丁 | 效果 |
|:--:|---|---|
| 01 | **去除固定密码** | 首次部署打开网页，由你自己设置**管理后台密码**和 **Web 播放器访问密码**；不再有 `123456` / `tt01` 之类的默认凭据 |
| 02 | **下载音质可选** | 下载、缓存歌曲时可选 Hi-Res / 无损 / 320k / 128k，按偏好自动降级取可用音质 |
| 03 | **修复不自动下一曲** | 修正音频 Range 请求越界造成的流中断，播放结束正常触发下一曲 |
| 04 | **其它优化** | 双架构 CI 发布、数据目录可自定义、初始化接口安全加固、配置项白名单补全、上游残留凭据清理 |

> 逐文件说明见 [本地补丁清单](#本地补丁清单)。

---

## 快速开始

设备端只需要一份 `docker-compose.yml`，下面是推荐配置（NAS 图形界面请先看下方的变量说明）：

```yaml
services:
  tt-music:
    image: ${DOCKER_IMAGE:-cjroot/tt-music:latest}
    container_name: tt-music
    restart: unless-stopped
    network_mode: host          # DLNA / AirPlay 局域网发现需要主机网络
    volumes:
      # 账号、数据库、配置、日志  /  下载、缓存、本地音乐库
      - "/vol1/1000/音乐/data:/server/data"
      - "/vol1/1000/音乐/music:/server/music"
    environment:
      # 三项留空 = 首次打开网页进入 /setup 向导，自己设置密码
      - "FRONTEND_PASSWORD=${ADMIN_PASSWORD:-}"
      - "WEBPLAYER_PASSWORD=${PLAYER_PASSWORD:-}"
      # LX_USER_<用户名> 中的用户名即同步账号；留空则不创建同步用户
      - "LX_USER_admin=${SYNC_PASSWORD:-}"
```

```bash
mkdir -p "/vol1/1000/音乐/data" "/vol1/1000/音乐/music"
docker compose up -d
```

浏览器打开 `http://<设备IP>:9527/`，首次自动进入初始化向导，设好密码即可使用。升级只需 `docker compose pull && docker compose up -d`。

| `.env` 变量 | 对应 | 留空时 |
|---|---|---|
| `ADMIN_PASSWORD` | 管理后台密码 | 走 `/setup` 向导，由用户自设 |
| `PLAYER_PASSWORD` | Web 播放器访问密码 | 鉴权与密码由向导决定 |
| `SYNC_PASSWORD` | 同步账号 `admin` 的连接密码 | 不创建同步用户，可稍后在后台「用户管理」添加 |

> 部分 NAS 的图形化编排编辑器**不解析 `${...}` 变量**，遇到报错请改用仓库内的 `docker-compose.nas.yml`（已写成字面值），或把变量替换为实际值。`network_mode: host` 下端口固定 `9527`；Windows Docker Desktop 需 4.34+ 并启用 host networking。

## 公共音源（一次配置，全员可用）

后台 `http://<设备IP>:9527/admin` → 侧栏「公共音源」，上传 `.js` 音源脚本或从 URL 导入，勾选「添加后立即启用」即可生效，所有用户不必再各自配置。音源保存在数据卷 `users/source/_open/`，服务端加载后对全部用户放行；列表中的启用 / 禁用 / 删除会影响所有人。用户仍可在播放器里单独关闭某个公共源，或用同名私有源覆盖。

> 音源脚本是可执行代码，请只导入可信来源；检测到需要原生 VM 模式时会二次确认。
