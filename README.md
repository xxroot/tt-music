# tt-music（本地补丁版）

基于上游 [XCQ0607/lxserver](https://github.com/XCQ0607/lxserver) v1.21.0（镜像 `penhaijun/lx-music-server`，**amd64 + arm64 双架构**，alpine 3.24.1）的运行时编译产物，叠加本地定制补丁，并提供 Dockerfile 可自行构建镜像。

1：去除固定密码，部署好之后，自定义设置后台密码及
2：增加下载时音质选择。
3：修复不会自动下一曲的问题
4：其它优化项
