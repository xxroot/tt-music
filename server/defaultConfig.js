"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config = {
    serverName: 'TT-Music', // 同步服务名称
    'proxy.enabled': false, // 是否使用代理转发请求到本服务器
    'proxy.header': 'x-real-ip', // 代理转发的请求头 原始IP
    bindIP: '0.0.0.0', // 绑定IP
    port: 9527, // 端口
    'user.enablePath': true, // 是否开启用户路径
    'user.enableRoot': false, // 是否开启根路径
    'user.enablePublicRestriction': true, // 是否启用公开用户权限限制
    maxSnapshotNum: 10, // 公共最大备份快照数
    'list.addMusicLocationType': 'top', // 公共添加歌曲到我的列表时的位置 top | bottom，参考客户端的「设置 → 列表设置 → 添加歌曲到列表时的位置」
    disableTelemetry: true, // 是否禁用数据收集（默认已禁用）
    // 以下三项必须存在于 defaultConfig：server/index.js 的 margeConfig 只按
    // Object.keys(defaultConfig) 白名单合并 config.js，否则配置模板里的值会被静默丢弃
    airplayDebug: false, // 是否透传 node-airplay-sender 库 debug 日志
    'radio.proxy.enabled': false, // 在线电台是否启用代理
    'radio.proxy.address': '', // 在线电台代理地址
    users: [
    // 用户配置例子
    // {
    //   name: 'user1', // 用户名，必须，不能与其他用户名重复
    //   password: '123.def', // 是连接密码，必须，不能与其他用户密码重复，若在外网，务必增加密码复杂度
    //   maxSnapshotNum: 10, // 可选，最大备份快照数
    //   'list.addMusicLocationType': 'top', // 可选，添加歌曲到我的列表时的位置 top | bottom，参考客户端的「设置 → 列表设置 → 添加歌曲到列表时的位置」
    // },
    ],
    'frontend.password': '123456',
    // WebDAV 配置
    'webdav.url': '',
    'webdav.username': '',
    'webdav.password': '',
    'sync.interval': 60, // 同步间隔（分钟）默认1小时
    // Web播放器配置
    'player.enableAuth': false,
    'player.password': '123456',
    // 代理配置
    'proxy.all.enabled': false,
    'proxy.all.address': '',
    // 访问路径配置
    'admin.path': '', // 后台管理路径，默认为根路径 /
    'player.path': '/music', // 播放器路径
    'subsonic.enable': true, // 是否启用 Subsonic 服务
    'subsonic.path': '/rest', // Subsonic 访问路径
    // 本地库配置
    'localLibrary.enabled': true, // 是否启用本地库功能
    'localLibrary.autoWatchGlobal': true, // 全局自动监听开关
    'localLibrary.maxConcurrentScans': 2, // 最大并发扫描数
    'localLibrary.scanDebounceDefault': 3000, // 默认监听防抖延迟 (ms)
    'localLibrary.enableScraping': true, // 是否启用 Acoustid+MusicBrainz 自动刮削
};
exports.default = config;
