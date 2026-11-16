// 覆盖上游镜像自带的 /server/config.js。
//
// 上游那份配置含 frontend.password / player.password = "123456"、
// player.enableAuth = false、同步用户 tt01/123456，以及硬编码的内网代理地址。
// server/index.js:137 会优先加载 /server/config.js，且当 CONFIG_PATH 指向的文件
// 不存在时（第 142-153 行）会把内存配置自动写出到 /server/data/config.js，
// 导致这些默认凭据被固化进数据卷。
//
// .dockerignore 只能排除构建上下文，删不掉镜像里已存在的文件，
// 因此 Dockerfile 必须显式 COPY 本文件覆盖它。
//
// 这里不保留任何默认账号/密码。两种初始化方式：
//   1) 默认（未设置 FRONTEND_PASSWORD）：密码为空 → server/server/setup.js 判定
//      「未初始化」，首次访问进入 /setup 引导，由用户自行设置并写回 data/config.js。
//   2) 在 .env 预置了 FRONTEND_PASSWORD：视为已初始化，跳过向导（兼容无人值守部署）。
// 读取 process.env 是为了让「首次启动自动生成 data/config.js」时写出的
// 也是 .env 里的真实密码，而不是上游弱口令。
// 注意：环境变量在 server/index.js:171-259 中最后应用，优先级高于 data/config.js；
// 一旦预置了 ADMIN_PASSWORD，就会覆盖向导设置过的密码。
module.exports = {
  'frontend.password': process.env.FRONTEND_PASSWORD || '',
  'player.password': process.env.WEBPLAYER_PASSWORD || '',
  users: [],
}
