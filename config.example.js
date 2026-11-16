// 可选的高级配置模板：需要自定义功能开关时，复制为 data/config.js。
//
// 密码和同步账号一律在 .env 中设置（见 .env.example），由环境变量注入；
// 这些 ENV 在 server/index.js:171-259 中最后应用，优先级高于本文件。
// 服务自身的登录密码不要在 config.js 里写；webdav.password 是第三方存储凭据，
// 属于例外，可按需填写（data/config.js 已被 .gitignore 排除，不会入库）。
//
// 注意：server/index.js 的 margeConfig 只合并 server/defaultConfig.js 中已存在的键，
// 未列入 defaultConfig 的键会被静默忽略。下面每一项都有对应的 defaultConfig 键。
module.exports = {
  "serverName": "TT-Music",
  // AirPlay 排障开关: true 时透传 node-airplay-sender 库 debug 日志
  "airplayDebug": false,
  "proxy.enabled": false,
  "proxy.header": "x-real-ip",
  "user.enablePath": true,
  "user.enableRoot": false,
  "user.enablePublicRestriction": true,
  "maxSnapshotNum": 10,
  "list.addMusicLocationType": "top",
  "webdav.url": "",
  "webdav.username": "",
  "webdav.password": "",
  "sync.interval": 60,
  "proxy.all.enabled": false,
  "proxy.all.address": "",
  "admin.path": "/admin",
  "player.path": "/music",
  "subsonic.enable": true,
  "subsonic.path": "/rest",
  "localLibrary.enableScraping": true,
  "radio.proxy.enabled": false,
  "radio.proxy.address": ""
}
