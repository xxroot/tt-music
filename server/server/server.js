"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeDevice = exports.getDevices = exports.getStatus = exports.startServer = void 0;
const node_http_1 = __importDefault(require("node:http"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const ws_1 = require("ws");
const sync_1 = require("./sync");
const auth_1 = require("./auth");
const tools_1 = require("../utils/tools");
const commonUtils_1 = require("../server/commonUtils");
const log4js_1 = require("../utils/log4js");
const constants_1 = require("../constants");
const setup_1 = require("./setup");
const user_1 = require("../user");
const message2call_1 = require("message2call");
const elfinderConnector_1 = require("./elfinderConnector");
const formidable_1 = __importDefault(require("formidable"));
// @ts-ignore
const index_js_1 = __importDefault(require("../modules/utils/musicSdk/index.js"));
const musicSdk = index_js_1.default;
const userApi_1 = require("./userApi");
const customSourceHandlers = __importStar(require("./customSourceHandlers"));
const fileCache = __importStar(require("./fileCache"));
const pathUtil_1 = require("../utils/pathUtil");
const dlnaDmc = __importStar(require("./dlna/dlnaDmc"));
const dlnaWs = __importStar(require("./dlna/dlnaWs"));
const mdnsAdvertise_1 = require("./mdnsAdvertise");
const dlnaService = __importStar(require("./dlna/dlnaService"));
const dlnaDms = __importStar(require("./dlna/dlnaDms"));
const airplayService = __importStar(require("./airplay/airplayService"));
const airplayWs = __importStar(require("./airplay/airplayWs"));
const localPlayerService = __importStar(require("./localLib/localPlayerService"));
const webdavService = __importStar(require("./webdavService"));
const { broadcastToSSEClients } = webdavService;
// 导入重构后的功能模块
const musicSearch = __importStar(require("./musicSearch"));
const localSong = __importStar(require("./localLib/localSong"));
const localLyric = __importStar(require("./localLib/localLyric"));
const songList = __importStar(require("./songList"));
const acoustidScrape = __importStar(require("./localLib/acoustidScrape"));
const localLibrary = __importStar(require("./localLibrary"));
const radio = __importStar(require("./radio"));
const onlineRadio = __importStar(require("./online-radio"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const needle_1 = __importDefault(require("needle"));
const MusicTagUtil = __importStar(require("../utils/MusicTagUtil"));
// ===== Player Session Store =====
const playerSessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24小时
const SESSION_COOKIE_NAME = 'lx_player_session';
const singerSyncTasks = new Map();
/** 生成随机 sessionId */
const generateSessionId = () => node_crypto_1.default.randomBytes(32).toString('hex');
/** 解析 Cookie 字符串 */
const parseCookies = (cookieHeader) => {
    if (!cookieHeader)
        return {};
    return Object.fromEntries(cookieHeader.split(';').map(c => {
        const [k, ...v] = c.trim().split('=');
        return [k.trim(), decodeURIComponent(v.join('='))];
    }));
};
/** 检查请求是否携带有效的 Player Session Cookie */
const checkPlayerAuth = (req) => {
    if (!global.lx.config['player.enableAuth'])
        return true; // 未开启认证，直接放行
    const cookies = parseCookies(req.headers['cookie']);
    const sessionId = cookies[SESSION_COOKIE_NAME];
    if (!sessionId)
        return false;
    const session = playerSessions.get(sessionId);
    if (!session)
        return false;
    if (Date.now() - session.createdAt > SESSION_TTL) {
        playerSessions.delete(sessionId);
        return false;
    }
    return true;
};
/** 定期清理过期 Session（每小时） */
setInterval(() => {
    const now = Date.now();
    for (const [id, session] of playerSessions) {
        if (now - session.createdAt > SESSION_TTL)
            playerSessions.delete(id);
    }
}, 60 * 60 * 1000);
/** 用户 Token 存储：token → { username, createdAt } */
const userSessions = new Map();
const USER_SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7天
/** 持久化 Token 快速查找缓存：token → username */
const persistentTokens = new Map();
/** 持久化 Token 元数据缓存：token → token 对象（含 disabled/expiresAt/lastUsed）*/
const persistentTokenMeta = new Map();
/** lastUsed 防抖写盘队列：username → debounce timer */
const persistentTokenSaveQueue = new Map();
/** 触发防抖写盘，10s 内的高频更新只写一次 */
const scheduleSaveTokenConfig = (username) => {
    if (persistentTokenSaveQueue.has(username))
        clearTimeout(persistentTokenSaveQueue.get(username));
    const timer = setTimeout(() => {
        persistentTokenSaveQueue.delete(username);
        // 从内存重建完整 config 并写盘
        const tokens = [];
        for (const [, meta] of persistentTokenMeta) {
            if (persistentTokens.get(meta.token) === username) {
                tokens.push({ ...meta });
            }
        }
        // 同时保留已过期/禁用的 token（从文件读取合并）
        const existing = getUserTokenConfig(username);
        const existingNonActive = existing.tokens.filter(t => !persistentTokenMeta.has(t.token));
        const merged = [...existingNonActive, ...tokens];
        const config = { ...existing, tokens: merged };
        const userDirname = (0, user_1.getUserDirname)(username);
        const userPath = node_path_1.default.join(global.lx.userPath, userDirname);
        const tokenPath = node_path_1.default.join(userPath, constants_1.File.userTokensJSON);
        if (!node_fs_1.default.existsSync(userPath))
            node_fs_1.default.mkdirSync(userPath, { recursive: true });
        node_fs_1.default.writeFile(tokenPath, JSON.stringify(config, null, 2), 'utf8', (err) => {
            if (err)
                console.error('[Token] 写盘失败:', err);
        });
    }, 10_000);
    persistentTokenSaveQueue.set(username, timer);
};
const getUserTokenConfig = (username) => {
    const userDirname = (0, user_1.getUserDirname)(username);
    const userPath = node_path_1.default.join(global.lx.userPath, userDirname);
    const tokenPath = node_path_1.default.join(userPath, constants_1.File.userTokensJSON);
    if (node_fs_1.default.existsSync(tokenPath)) {
        try {
            return JSON.parse(node_fs_1.default.readFileSync(tokenPath, 'utf8'));
        }
        catch (e) {
            return { enabled: false, tokens: [] };
        }
    }
    return { enabled: false, tokens: [] };
};
const saveUserTokenConfig = (username, config) => {
    const userDirname = (0, user_1.getUserDirname)(username);
    const userPath = node_path_1.default.join(global.lx.userPath, userDirname);
    const tokenPath = node_path_1.default.join(userPath, constants_1.File.userTokensJSON);
    if (!node_fs_1.default.existsSync(userPath))
        node_fs_1.default.mkdirSync(userPath, { recursive: true });
    node_fs_1.default.writeFileSync(tokenPath, JSON.stringify(config, null, 2), 'utf8');
    // 更新内存缓存（清理该用户旧条目）
    for (const [tk, name] of persistentTokens.entries()) {
        if (name === username) {
            persistentTokens.delete(tk);
            persistentTokenMeta.delete(tk);
        }
    }
    // 写入新的有效 token
    if (config.enabled) {
        for (const t of config.tokens) {
            if (!t.expiresAt || t.expiresAt > Date.now()) {
                persistentTokens.set(t.token, username);
                persistentTokenMeta.set(t.token, {
                    name: t.name,
                    token: t.token,
                    disabled: t.disabled ?? false,
                    expiresAt: t.expiresAt ?? undefined,
                    lastUsed: t.lastUsed,
                });
            }
        }
    }
};
// 初始化加载所有用户的持久化 Token
setTimeout(() => {
    if (global.lx.config && global.lx.config.users) {
        global.lx.config.users.forEach((u) => saveUserTokenConfig(u.name, getUserTokenConfig(u.name)));
    }
}, 5000);
/**
 * 验证请求中的用户 Token（x-user-token header）。
 * 1. 优先验证内存 Session Token（网页登陆产生）
 * 2. 其次验证持久化 API Token（管理面板产生，需开启账户 Token 功能）
 * 返回已验证的用户名，或 null 表示未认证。
 */
const verifyUserAuth = (req) => {
    const token = req.headers['x-user-token'];
    if (token) {
        // 1. Session Token 验证
        const session = userSessions.get(token);
        if (session && Date.now() - session.createdAt <= USER_SESSION_TTL) {
            return session.username;
        }
        // 2. 持久化 API Token 验证（全程走内存，不读磁盘）
        const persistentUsername = persistentTokens.get(token);
        if (persistentUsername) {
            const meta = persistentTokenMeta.get(token);
            if (meta) {
                // 检查是否被禁用
                if (meta.disabled) {
                    log4js_1.tokenLog.warn(`User ${persistentUsername} attempted to use DISABLED token: ${meta.name}`);
                    return null;
                }
                // 检查有效期
                if (!meta.expiresAt || meta.expiresAt > Date.now()) {
                    // 仅更新内存中的 lastUsed，通过防抖延迟批量写盘
                    meta.lastUsed = Date.now();
                    scheduleSaveTokenConfig(persistentUsername);
                    // 记录 Token 日志
                    const ip = (0, tools_1.getIP)(req);
                    const masked = `${meta.token.slice(0, 6)}...${meta.token.slice(-4)}`;
                    log4js_1.tokenLog.info(`API Token [${meta.name}] (${masked}) used by ${persistentUsername} from ${ip} to access ${req.url}`);
                    return persistentUsername;
                }
                else {
                    // 已过期，从内存缓存移除
                    persistentTokens.delete(token);
                    persistentTokenMeta.delete(token);
                }
            }
        }
        return null; // Token 存在但无效/过期
    }
    // 后端所有用户名密码明文校验逻辑
    /*
    const username = req.headers['x-user-name'] as string
    const password = req.headers['x-user-password'] as string
    if (username && password) {
      const user = global.lx.config.users.find((u: any) => u.name === username && u.password === password)
      if (user) return username
    }
    */
    return null;
};
/** 定期清理过期用户 Token（每小时） */
setInterval(() => {
    const now = Date.now();
    // 清理内存 Session
    for (const [token, session] of userSessions) {
        if (now - session.createdAt > USER_SESSION_TTL)
            userSessions.delete(token);
    }
    // 清理加载到内存的过期 API Token（直接走内存 meta，不读磁盘）
    for (const [token, meta] of persistentTokenMeta) {
        if (meta.expiresAt && meta.expiresAt <= now) {
            persistentTokens.delete(token);
            persistentTokenMeta.delete(token);
        }
    }
}, 60 * 60 * 1000);
// ===== End User Session Token Store =====
const getMime = (filename) => {
    const ext = node_path_1.default.extname(filename).toLowerCase();
    const mimeTypes = {
        '.txt': 'text/plain',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.html': 'text/html',
        '.css': 'text/css',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.pdf': 'application/pdf',
        '.zip': 'application/zip',
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
    };
    return mimeTypes[ext] || 'application/octet-stream';
};
/**
 * 规范化歌曲信息，确保收藏列表中的 meta 属性在根节点也可用
 * 解决 SDK 无法识别收藏歌曲音质的问题
 */
const normalizeSongInfo = (songInfo) => {
    if (!songInfo)
        return songInfo;
    const meta = songInfo.meta || {};
    // 1. 处理音质信息 (types / _types)
    if (!songInfo.types && meta) {
        songInfo.types = meta.qualitys || meta.types;
    }
    if (!songInfo._types && meta) {
        songInfo._types = meta._qualitys || meta._types;
    }
    // 2. 处理基础字段备用根节点映射
    if (!songInfo.albumName && meta.albumName)
        songInfo.albumName = meta.albumName;
    if (!songInfo.albumId && meta.albumId)
        songInfo.albumId = meta.albumId;
    if (!songInfo.img && meta.picUrl)
        songInfo.img = meta.picUrl;
    if (!songInfo.name && meta.name)
        songInfo.name = meta.name;
    if (!songInfo.singer && meta.singer)
        songInfo.singer = meta.singer;
    if (!songInfo.source && meta.source)
        songInfo.source = meta.source;
    if (!songInfo.interval && meta.interval)
        songInfo.interval = meta.interval;
    // 3. 处理通用 ID 转换 (id -> songmid)
    if (!songInfo.songmid) {
        if (meta.songId) {
            songInfo.songmid = meta.songId;
        }
        else if (songInfo.id) {
            const sourcePrefix = `${songInfo.source}_`;
            if (typeof songInfo.id === 'string' && songInfo.id.startsWith(sourcePrefix)) {
                songInfo.songmid = songInfo.id.slice(sourcePrefix.length);
            }
            else {
                songInfo.songmid = songInfo.id;
            }
        }
    }
    // 4. 针对各平台 SDK 所需的特定字段进行补全
    switch (songInfo.source) {
        case 'wy': // 网易
            if (!songInfo.id && meta.songId)
                songInfo.id = Number(meta.songId);
            if (!songInfo.songmid && songInfo.id)
                songInfo.songmid = String(songInfo.id);
            break;
        case 'kg': // 酷狗
            if (!songInfo.hash && meta.hash)
                songInfo.hash = meta.hash;
            // 兼容某些 SDK 可能需要的 songmid 格式 (数字_哈希 或 仅哈Hash)
            break;
        case 'tx': // 腾讯
            if (!songInfo.strMediaMid && meta.strMediaMid)
                songInfo.strMediaMid = meta.strMediaMid;
            if (!songInfo.albumMid && meta.albumMid)
                songInfo.albumMid = meta.albumMid;
            // 只有当 meta 中的 songId 是纯数字时才回填至 root.songId，否则保持 undefined 触发 SDK 自动获取
            const metaSongId = String(meta.songId || '');
            if (/^\d+$/.test(metaSongId)) {
                songInfo.songId = metaSongId;
            }
            break;
        case 'mg': // 咪咕
            if (!songInfo.copyrightId && meta.copyrightId)
                songInfo.copyrightId = meta.copyrightId;
            if (!songInfo.lrcUrl && meta.lrcUrl)
                songInfo.lrcUrl = meta.lrcUrl;
            if (!songInfo.songId)
                songInfo.songId = songInfo.songmid;
            break;
        case 'kw': // 酷我
            // 已在步骤 3 中通用处理
            break;
    }
    // 5. 规范化 singers 数组为统一 {id, name, img} 格式
    if (songInfo.singers != null) {
        if (Array.isArray(songInfo.singers)) {
            songInfo.singers = songInfo.singers
                .filter((s) => s && typeof s === 'object')
                .map((s) => {
                const img = s.img || s.picUrl
                    || (typeof s.sizable_avatar === 'string' ? s.sizable_avatar.replace('{size}', '800') : null)
                    || s.avatar || null;
                return {
                    id: String(s.id ?? s.mid ?? s.author_id ?? s.singer_id ?? ''),
                    name: String(s.name ?? s.author_name ?? s.singerName ?? ''),
                    img: img || null,
                };
            })
                .filter((s) => s.name); // 过滤无 name 的无效项
        }
        else if (typeof songInfo.singers === 'string' && songInfo.singers.trim()) {
            // 字符串格式 (如 wy 的 item.pc.ar: "歌手A/歌手B")
            songInfo.singers = songInfo.singers
                .split(/[；;,、\/＆&]/)
                .map((s) => s.trim())
                .filter((s) => s)
                .map((name) => ({ id: '', name, img: null }));
        }
        else {
            songInfo.singers = [];
        }
    }
    return songInfo;
};
let status = {
    status: false,
    message: '',
    address: [],
    // code: '',
    devices: [],
};
let host = 'http://localhost';
// 音乐解析进度 SSE 专属通道: requestId -> response
const musicProgressClients = new Map();
// const codeTools: {
//   timeout: NodeJS.Timer | null
//   start: () => void
//   stop: () => void
// } = {
//   timeout: null,
//   start() {
//     this.stop()
//     this.timeout = setInterval(() => {
//       void generateCode()
//     }, 60 * 3 * 1000)
//   },
//   stop() {
//     if (!this.timeout) return
//     clearInterval(this.timeout)
//     this.timeout = null
//   },
// }
const checkDuplicateClient = (newSocket) => {
    for (const client of [...wss.clients]) {
        if (client === newSocket || client.keyInfo.clientId != newSocket.keyInfo.clientId)
            continue;
        log4js_1.syncLog.info('duplicate client', client.userInfo.name, client.keyInfo.deviceName);
        client.isReady = false;
        for (const name of Object.keys(client.moduleReadys)) {
            client.moduleReadys[name] = false;
        }
        client.close(constants_1.SYNC_CLOSE_CODE.normal);
    }
};
const handleConnection = async (socket, request) => {
    const queryData = new URL(request.url, host).searchParams;
    const clientId = queryData.get('i');
    //   // if (typeof socket.handshake.query.i != 'string') return socket.disconnect(true)
    const userName = (0, user_1.getUserName)(clientId);
    if (!userName) {
        socket.close(constants_1.SYNC_CLOSE_CODE.failed);
        return;
    }
    const userSpace = (0, user_1.getUserSpace)(userName);
    const keyInfo = userSpace.dataManage.getClientKeyInfo(clientId);
    if (!keyInfo) {
        socket.close(constants_1.SYNC_CLOSE_CODE.failed);
        return;
    }
    const user = global.lx.config.users.find(u => u.name == userName);
    if (!user) {
        socket.close(constants_1.SYNC_CLOSE_CODE.failed);
        return;
    }
    keyInfo.lastConnectDate = Date.now();
    userSpace.dataManage.saveClientKeyInfo(keyInfo);
    //   // socket.lx_keyInfo = keyInfo
    socket.keyInfo = keyInfo;
    socket.userInfo = user;
    checkDuplicateClient(socket);
    try {
        await (0, sync_1.sync)(socket);
    }
    catch (err) {
        // console.log(err)
        log4js_1.syncLog.warn(err);
        socket.close(constants_1.SYNC_CLOSE_CODE.failed);
        return;
    }
    status.devices.push(keyInfo);
    // handleConnection(io, socket)
    (0, tools_1.sendStatus)(status);
    socket.onClose(() => {
        status.devices.splice(status.devices.findIndex(k => k.clientId == keyInfo.clientId), 1);
        (0, tools_1.sendStatus)(status);
    });
    // console.log('connection', keyInfo.deviceName)
    log4js_1.accessLog.info('connection', user.name, keyInfo.deviceName);
    // console.log(socket.handshake.query)
    socket.isReady = true;
};
const handleUnconnection = (userName) => {
    // console.log('unconnection')
    (0, user_1.releaseUserSpace)(userName);
};
const authConnection = (req, callback) => {
    // console.log(req.headers)
    // // console.log(req.auth)
    // console.log(req._query.authCode)
    (0, auth_1.authConnect)(req).then(() => {
        callback(null, true);
    }).catch(err => {
        // console.log('WebSocket auth failed:', err.message)
        callback(null, false); // <--- 修改为传递 null, false
    });
};
let wss;
function noop() { }
function onSocketError(err) {
    console.error(err);
}
const saveUsers = () => {
    const usersJsonPath = node_path_1.default.join(global.lx.dataPath, 'users.json');
    try {
        node_fs_1.default.writeFileSync(usersJsonPath, JSON.stringify(global.lx.config.users.map(u => ({
            name: u.name,
            password: u.password,
            maxSnapshotNum: u.maxSnapshotNum,
            'list.addMusicLocationType': u['list.addMusicLocationType'],
        })), null, 2));
        return true;
    }
    catch (err) {
        console.error('Failed to save users.json', err);
        return false;
    }
};
/** [新增] 服务器内部热重载数据 */
const reloadServerData = async () => {
    log4js_1.startupLog.info('Hot-reloading server data (users and config)...');
    // 1. 重新加载 config.js (必须先加载基础配置)
    const configPath = process.env.CONFIG_PATH || node_path_1.default.join(process.cwd(), 'config.js');
    if (node_fs_1.default.existsSync(configPath)) {
        try {
            delete require.cache[require.resolve(configPath)];
            const rootConfig = require(configPath);
            // 合并除 users 以外的配置项
            for (const key of Object.keys(rootConfig)) {
                if (key !== 'users') {
                    global.lx.config[key] = rootConfig[key];
                }
            }
            // 如果有 WebDAV 同步实例，手动同步其配置
            if (global.lx.webdavSync) {
                global.lx.webdavSync.updateConfig({
                    url: global.lx.config['webdav.url'],
                    username: global.lx.config['webdav.username'],
                    password: global.lx.config['webdav.password'],
                    interval: global.lx.config['sync.interval'],
                });
            }
            log4js_1.startupLog.info('Config.js re-loaded and merged.');
        }
        catch (err) {
            log4js_1.startupLog.error('Failed to reload config.js:', err.message);
        }
    }
    // 2. 重新加载 users.json (users.json 权重更高，会覆盖 config.js 中的 users)
    const usersJsonPath = node_path_1.default.join(global.lx.dataPath, 'users.json');
    if (node_fs_1.default.existsSync(usersJsonPath)) {
        try {
            const usersRaw = node_fs_1.default.readFileSync(usersJsonPath, 'utf-8');
            const users = JSON.parse(usersRaw);
            if (Array.isArray(users)) {
                global.lx.config.users = users.map(u => ({
                    ...u,
                    dataPath: node_path_1.default.join(global.lx.userPath, (0, user_1.getUserDirname)(u.name))
                }));
                // 确保新加载的所有用户目录存在
                for (const user of global.lx.config.users) {
                    if (!node_fs_1.default.existsSync(user.dataPath)) {
                        node_fs_1.default.mkdirSync(user.dataPath, { recursive: true });
                    }
                }
                log4js_1.startupLog.info(`Reloaded ${global.lx.config.users.length} users from users.json`);
            }
        }
        catch (err) {
            log4js_1.startupLog.error('Failed to reload users.json:', err.message);
        }
    }
    // 3. 重新初始化 User APIs (解决脚本源实时生效问题)
    try {
        await (0, userApi_1.initUserApis)();
        log4js_1.startupLog.info('User APIs re-initialized.');
    }
    catch (err) {
        log4js_1.startupLog.error('Failed to re-init user APIs:', err.message);
    }
    return true;
};
const checkAndCreateDir = (p) => {
    try {
        if (!node_fs_1.default.existsSync(p)) {
            node_fs_1.default.mkdirSync(p, { recursive: true });
        }
    }
    catch (e) {
        if (e.code !== 'EEXIST') {
            console.error(`Could not create directory ${p}:`, e.message);
        }
    }
};
const readBody = async (req) => await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => { chunks.push(chunk); });
    req.on('end', () => {
        resolve(Buffer.concat(chunks).toString('utf-8'));
    });
    req.on('error', reject);
});
const serveStatic = (req, res, filePath) => {
    const contentType = getMime(filePath);
    try {
        const stats = node_fs_1.default.statSync(filePath);
        const mtime = stats.mtime.getTime();
        const etag = `W/"${stats.size}-${mtime}"`;
        const lastModified = stats.mtime.toUTCString();
        // Check Cache Validity (Conditional Requests)
        if (req.headers['if-none-match'] === etag || req.headers['if-modified-since'] === lastModified) {
            res.writeHead(304);
            res.end();
            return;
        }
        node_fs_1.default.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404);
                    res.end('Not Found');
                }
                else {
                    res.writeHead(500);
                    res.end('Server Error');
                }
            }
            else {
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'ETag': etag,
                    'Last-Modified': lastModified,
                    'Cache-Control': 'no-cache, must-revalidate', // Force browser to revalidate every time
                    'Pragma': 'no-cache',
                    'Expires': '0',
                });
                res.end(content, 'utf-8');
            }
        });
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            res.writeHead(404);
            res.end('Not Found');
        }
        else {
            res.writeHead(500);
            res.end('Server Error');
        }
    }
};
const handleStartServer = async (port = 9527, ip = '127.0.0.1') => await new Promise((resolve, reject) => {
    // Expose readBody & verifyUserAuth to global scope for commonUtils.ts / localLib modules
    ;
    global.readBody = readBody;
    global.verifyUserAuth = verifyUserAuth;
    const httpServer = node_http_1.default.createServer(async (req, res) => {
        // CORS 跨域处理
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        const ip = (0, tools_1.getIP)(req);
        log4js_1.accessLog.info(`${req.method} ${req.url} from ${ip}`);
        // console.log(req.url)
        const urlObj = new URL(req.url ?? '', `http://${req.headers.host}`);
        const pathname = urlObj.pathname;
        // [首次部署初始化向导] 未设置管理员密码时，除 /setup 与 /api/setup/* 外全部拦截
        if (await (0, setup_1.handleSetup)(req, res, pathname))
            return;
        // 读取路径配置（每次请求都重新读取，保存后立刻生效）
        const normalizePath = (p) => (p || '').replace(/\/+$/, '');
        const playerPath = global.lx.config['player.path'] || '/music';
        const adminPath = global.lx.config['admin.path'] || '';
        // 映射播放器逻辑 (无论是自定义路径还是前端硬编码的 /music/)
        const isPlayerRequest = pathname.startsWith(playerPath + '/') || pathname === playerPath;
        // 修复：只兼容旧版硬编码引用的静态资源，不再兼容打开 /music 页面本身，这样/music就无法作为网页直接打开了
        const isLegacyPlayerAsset = playerPath !== '/music' && (pathname.startsWith('/music/assets/') ||
            pathname.startsWith('/music/css/') ||
            pathname.startsWith('/music/js/') ||
            pathname.startsWith('/music/fonts/') ||
            pathname.startsWith('/music/img/') ||
            pathname === '/music/manifest.json' ||
            pathname === '/music/sw.js');
        if (isPlayerRequest || isLegacyPlayerAsset) {
            const activePrefix = isPlayerRequest ? playerPath : '/music';
            // 白名单：登录页、静态资源无需认证
            const isLoginPage = pathname === `${activePrefix}/login` || pathname === `${activePrefix}/login.html`;
            const isPublicAsset = pathname.startsWith(`${activePrefix}/assets/`) ||
                pathname.startsWith(`${activePrefix}/css/`) ||
                pathname.startsWith(`${activePrefix}/js/`) ||
                pathname.startsWith(`${activePrefix}/fonts/`) ||
                pathname.startsWith(`${activePrefix}/img/`) ||
                pathname.startsWith(`${activePrefix}/images/about/`) ||
                pathname === `${activePrefix}/about.html` ||
                pathname === `${activePrefix}/manifest.json` ||
                pathname === `${activePrefix}/sw.js` ||
                isLegacyPlayerAsset;
            // 认证检查
            if (!isLoginPage && !isPublicAsset && global.lx.config['player.enableAuth']) {
                if (!checkPlayerAuth(req)) {
                    res.writeHead(302, { 'Location': `${playerPath}/login` });
                    res.end();
                    return;
                }
            }
            // 规范化物理路径
            let targetPath = pathname;
            // 将请求路径中的前缀映射到真实的 /music 物理目录
            const subPath = pathname.slice(activePrefix.length);
            if (subPath === '' || subPath === '/') {
                targetPath = '/music/index.html';
            }
            else if (isLoginPage) {
                targetPath = '/music/login.html';
            }
            else {
                targetPath = '/music' + subPath;
            }
            const filePath = node_path_1.default.join(global.lx.staticPath, targetPath);
            if (node_fs_1.default.existsSync(filePath) && node_fs_1.default.statSync(filePath).isFile()) {
                serveStatic(req, res, filePath);
                return;
            }
        }
        // [动态配置注入] 优先拦截 /js/config.js 请求，确保后端配置能注入到前端 window.CONFIG
        if (pathname === '/js/config.js') {
            // 从静态文件读取版本号和构建哈希
            const staticConfigPath = node_path_1.default.join(global.lx.staticPath, 'js', 'config.js');
            let version = 'v1.0.0';
            let buildHash = 'unknown';
            try {
                const content = node_fs_1.default.readFileSync(staticConfigPath, 'utf-8');
                const matchVersion = content.match(/version:\s*['"]([^'"]+)['"]/);
                if (matchVersion)
                    version = matchVersion[1];
                const matchHash = content.match(/buildHash:\s*['"]([^'"]+)['"]/);
                if (matchHash)
                    buildHash = matchHash[1];
            }
            catch { }
            // 构造前端配置 暴露给前端
            const frontendConfig = {
                version,
                buildHash,
                serverName: global.lx.config.serverName,
                disableTelemetry: global.lx.config.disableTelemetry || false,
                'proxy.enabled': global.lx.config['proxy.enabled'],
                'user.enablePath': global.lx.config['user.enablePath'],
                'user.enableRoot': global.lx.config['user.enableRoot'],
                'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'] || false,
                maxSnapshotNum: global.lx.config.maxSnapshotNum,
                'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
                'player.enableAuth': global.lx.config['player.enableAuth'] || false,
                port: global.lx.config.port,
                bindIP: global.lx.config.bindIP,
                'admin.path': global.lx.config['admin.path'] ?? '',
                'player.path': global.lx.config['player.path'] ?? '/music',
            };
            const configJs = `window.CONFIG = ${JSON.stringify(frontendConfig, null, 2)};`;
            res.writeHead(200, {
                'Content-Type': 'application/javascript; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            });
            res.end(configJs);
            return;
        }
        // [管理界面]
        const effectiveAdminPath = adminPath || '/admin';
        // 根路径重定向到播放器页面（仅当管理后台不在根路径时）
        if ((pathname === '/' || pathname === '/index.html') && effectiveAdminPath !== '/') {
            res.writeHead(302, { 'Location': playerPath });
            res.end();
            return;
        }
        const isAdminPath = (pathname === effectiveAdminPath || pathname === effectiveAdminPath + '/' || pathname === effectiveAdminPath + '/index.html');
        if (isAdminPath) {
            const rootHtmlPath = node_path_1.default.join(global.lx.staticPath, 'index.html');
            if (node_fs_1.default.existsSync(rootHtmlPath)) {
                serveStatic(req, res, rootHtmlPath);
                return;
            }
        }
        // 注意：如果设置了 adminPath，则不允许通过 / 直接访问后台资源文件，除非它是公共资源
        if (!pathname.startsWith('/api/')) {
            const generalFilePath = node_path_1.default.join(global.lx.staticPath, pathname);
            // 根路径已由上方重定向逻辑处理，此处作为安全兜底
            if (pathname === '/' || pathname === '/index.html') {
                if (adminPath !== '') {
                    res.writeHead(302, { 'Location': playerPath });
                    res.end();
                    return;
                }
            }
            if (node_fs_1.default.existsSync(generalFilePath) && node_fs_1.default.statSync(generalFilePath).isFile()) {
                serveStatic(req, res, generalFilePath);
                return;
            }
        }
        // [Subsonic API]
        const subsonicEnable = global.lx.config['subsonic.enable'];
        const subsonicPath = normalizePath(global.lx.config['subsonic.path'] || '/rest');
        if (subsonicEnable && (pathname.startsWith(subsonicPath + '/') || pathname === subsonicPath)) {
            const { subsonicHandler } = require('./subsonic');
            return subsonicHandler.handleRequest(req, res, urlObj);
        }
        // ===== Radio API =====
        if (pathname.startsWith('/api/radio/')) {
            // Cover images are loaded via <img> tags which can't send custom headers,
            // so allow token via query parameter for cover GET requests
            const isCoverGet = pathname.startsWith('/api/radio/cover/') && req.method === 'GET';
            let username = null;
            if (isCoverGet) {
                const queryToken = urlObj.searchParams.get('token');
                if (queryToken) {
                    // Temporarily inject token into headers for verifyUserAuth
                    const origToken = req.headers['x-user-token'];
                    req.headers['x-user-token'] = queryToken;
                    username = verifyUserAuth(req);
                    if (!username)
                        req.headers['x-user-token'] = origToken;
                }
            }
            if (!username) {
                username = verifyUserAuth(req);
            }
            if (!username) {
                res.writeHead(401, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: '需要用户认证' }));
                return;
            }
            return radio.handleRequest(req, res, urlObj, pathname, username);
        }
        // ===== Online Radio API (在线电台) =====
        if (pathname.startsWith('/api/online-radio/')) {
            const username = verifyUserAuth(req) || '_open';
            return onlineRadio.handleRequest(req, res, urlObj, pathname, username);
        }
        if (pathname.startsWith('/api/')) {
            if (pathname === '/api/login' && req.method === 'POST') {
                void readBody(req).then(body => {
                    try {
                        const { password } = JSON.parse(body);
                        if (password === global.lx.config['frontend.password']) {
                            log4js_1.loginLog.info(`Admin login success from ${ip}`);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        }
                        else {
                            log4js_1.loginLog.warn(`Admin login failed from ${ip}`);
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false }));
                        }
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end('Bad Request');
                    }
                });
                return;
            }
            // [新增] 服务器发现端点 (免认证，供 Android App 自动发现)
            // GET /api/discovery → { service, name, version, port, serverId }
            if (pathname === '/api/discovery' && req.method === 'GET') {
                const version = (() => {
                    try {
                        const pkgPath = node_path_1.default.join(__dirname, '..', 'package.json');
                        if (node_fs_1.default.existsSync(pkgPath)) {
                            return JSON.parse(node_fs_1.default.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
                        }
                    }
                    catch { }
                    return '0.0.0';
                })();
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({
                    service: 'lx-music-server',
                    // 与 mDNS 广播名保持一致 (含主机名)，避免 Android 端 SUBNET/NSD 发现显示不一致
                    name: (0, mdnsAdvertise_1.getMdnsServiceName)(global.lx.config.serverName),
                    version,
                    port: global.lx.config.port,
                    serverId: (0, user_1.getServerId)(),
                }));
                return;
            }
            // [新增] 获取服务器状态
            if (pathname === '/api/status' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                const totalMem = node_os_1.default.totalmem();
                const freeMem = node_os_1.default.freemem();
                // 重新实现更准确的 CPU 使用率计算（支持 Windows）
                const getSystemCpuUsage = () => {
                    const cpus = node_os_1.default.cpus();
                    let idle = 0;
                    let total = 0;
                    cpus.forEach(cpu => {
                        for (const type in cpu.times) {
                            total += cpu.times[type];
                        }
                        idle += cpu.times.idle;
                    });
                    const last = global.lx.lastCpuSample || { idle: 0, total: 0 };
                    const deltaIdle = idle - last.idle;
                    const deltaTotal = total - last.total;
                    global.lx.lastCpuSample = { idle, total };
                    if (deltaTotal === 0)
                        return '0.00';
                    return (100 * (1 - deltaIdle / deltaTotal)).toFixed(2);
                };
                const getProcessCpuUsage = () => {
                    const currentUsage = process.cpuUsage();
                    const currentTime = Date.now();
                    const last = global.lx.lastProcessSample || { cpu: process.cpuUsage(), time: Date.now() - 100 };
                    const deltaUsage = {
                        user: currentUsage.user - last.cpu.user,
                        system: currentUsage.system - last.cpu.system,
                    };
                    const deltaTime = (currentTime - last.time) * 1000; // microseconds
                    global.lx.lastProcessSample = { cpu: currentUsage, time: currentTime };
                    if (deltaTime === 0)
                        return '0.00';
                    return ((deltaUsage.user + deltaUsage.system) / deltaTime / node_os_1.default.cpus().length * 100).toFixed(2);
                };
                const status = {
                    users: global.lx.config.users.length,
                    devices: wss?.clients.size ?? 0,
                    uptime: process.uptime(),
                    memory: process.memoryUsage().rss,
                    totalMemory: totalMem,
                    freeMemory: freeMem,
                    systemMemoryUsage: ((totalMem - freeMem) / totalMem * 100).toFixed(2),
                    processMemoryUsage: (process.memoryUsage().rss / totalMem * 100).toFixed(2),
                    cpuUsage: getSystemCpuUsage(),
                    processCpuUsage: getProcessCpuUsage(),
                    osUptime: node_os_1.default.uptime(),
                    cpus: node_os_1.default.cpus().length,
                    cpuModel: node_os_1.default.cpus()[0]?.model || 'Unknown',
                    cpuSpeed: node_os_1.default.cpus()[0]?.speed || 0,
                    isWebDAVConfigured: !!(global.lx.config['webdav.url'] && global.lx.config['webdav.username']),
                };
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                });
                res.end(JSON.stringify(status));
                return;
            }
            if (pathname === '/api/users') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                if (req.method === 'GET') {
                    // 修改：返回包含密码的用户列表
                    const users = global.lx.config.users.map(u => ({ name: u.name, password: u.password }));
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify(users));
                    return;
                }
                if (req.method === 'POST') {
                    void readBody(req).then(body => {
                        try {
                            const { name, password } = JSON.parse(body);
                            if (!name || !password) {
                                res.writeHead(400);
                                res.end('Missing name or password');
                                return;
                            }
                            if (global.lx.config.users.some(u => u.name === name)) {
                                res.writeHead(409);
                                res.end('User already exists');
                                return;
                            }
                            // eslint-disable-next-line @typescript-eslint/no-var-requires
                            const { getUserDirname } = require('../user');
                            const dataPath = node_path_1.default.join(global.lx.userPath, getUserDirname(name));
                            checkAndCreateDir(dataPath);
                            global.lx.config.users.push({
                                name,
                                password,
                                dataPath,
                            });
                            saveUsers();
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true }));
                        }
                        catch (e) {
                            res.writeHead(500);
                            res.end('Server Error');
                        }
                    });
                    return;
                }
                if (req.method === 'PUT') {
                    void readBody(req).then(body => {
                        try {
                            const { name, password } = JSON.parse(body);
                            if (!name || !password) {
                                res.writeHead(400);
                                res.end('Missing name or password');
                                return;
                            }
                            const user = global.lx.config.users.find(u => u.name === name);
                            if (!user) {
                                res.writeHead(404);
                                res.end('User not found');
                                return;
                            }
                            // 更新密码
                            user.password = password;
                            saveUsers();
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true }));
                        }
                        catch (e) {
                            res.writeHead(500);
                            res.end('Server Error');
                        }
                    });
                    return;
                }
                if (req.method === 'DELETE') {
                    void readBody(req).then(body => {
                        try {
                            // 修改：同时支持单个 name 和批量 names，以及 deleteData 参数
                            const { name, names, deleteData } = JSON.parse(body);
                            const targets = names || (name ? [name] : []);
                            if (targets.length === 0) {
                                res.writeHead(400);
                                res.end('Missing name or names');
                                return;
                            }
                            let deletedCount = 0;
                            const deletedUsers = [];
                            for (const targetName of targets) {
                                const idx = global.lx.config.users.findIndex(u => u.name === targetName);
                                if (idx !== -1) {
                                    const user = global.lx.config.users[idx];
                                    // 保存用户数据路径（如果需要删除）
                                    console.log(`[DeleteUser] deleteData: ${deleteData}, user.dataPath: ${user.dataPath}`);
                                    if (deleteData && user.dataPath) {
                                        deletedUsers.push({ name: targetName, dataPath: user.dataPath });
                                    }
                                    else {
                                        console.log(`[DeleteUser] Skipping data deletion for ${targetName}. deleteData=${deleteData}, hasDataPath=${!!user.dataPath}`);
                                    }
                                    // 断开该用户的连接
                                    if (wss) {
                                        for (const client of wss.clients) {
                                            if (client.userInfo?.name === targetName)
                                                client.close(constants_1.SYNC_CLOSE_CODE.normal);
                                        }
                                    }
                                    global.lx.config.users.splice(idx, 1);
                                    deletedCount++;
                                }
                            }
                            if (deletedCount > 0) {
                                saveUsers();
                                // 如果需要删除数据文件夹
                                if (deleteData && deletedUsers.length > 0) {
                                    console.log(`[DeleteUser] Processing ${deletedUsers.length} data folders deletion...`);
                                    for (const user of deletedUsers) {
                                        try {
                                            console.log(`[DeleteUser] Checking path: ${user.dataPath}`);
                                            if (node_fs_1.default.existsSync(user.dataPath)) {
                                                node_fs_1.default.rmSync(user.dataPath, { recursive: true, force: true });
                                                console.log(`Deleted user data folder: ${user.dataPath}`);
                                            }
                                            else {
                                                console.log(`[DeleteUser] Path not found: ${user.dataPath}`);
                                            }
                                        }
                                        catch (err) {
                                            console.error(`Failed to delete user data folder for ${user.name}:`, err);
                                            // 继续删除其他用户，不中断流程
                                        }
                                    }
                                }
                                else {
                                    console.log('[DeleteUser] No data folders to delete (or deleteData is false)');
                                }
                                res.writeHead(200);
                                res.end(JSON.stringify({ success: true, deletedCount }));
                            }
                            else {
                                res.writeHead(404);
                                res.end('User not found');
                            }
                        }
                        catch (e) {
                            res.writeHead(500);
                            res.end('Server Error');
                        }
                    });
                    return;
                }
            }
            if (pathname === '/api/data' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                const isAdminAuth = auth === global.lx.config['frontend.password'];
                const userParam = urlObj.searchParams.get('user');
                if (!userParam) {
                    res.writeHead(400);
                    res.end('Missing user param');
                    return;
                }
                // 鉴权逻辑：管理员 或 公共用户 或 具名用户(需 Token)
                let verifiedUser = null;
                if (isAdminAuth) {
                    verifiedUser = userParam; // 管理员信任 userParam
                }
                else if (userParam === 'default' || userParam === '_open') {
                    verifiedUser = '_open';
                }
                else {
                    verifiedUser = verifyUserAuth(req);
                    if (!verifiedUser || verifiedUser !== userParam) {
                        res.writeHead(403);
                        res.end('Forbidden: User mismatch or unauthorized');
                        return;
                    }
                }
                const userSpace = (0, user_1.getUserSpace)(verifiedUser);
                void userSpace.listManage.getListData().then(data => {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify(data));
                }).catch(err => {
                    res.writeHead(500);
                    res.end(err.message);
                });
                return;
            }
            // 获取快照列表
            if (pathname === '/api/data/snapshots' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                const isAdminAuth = auth === global.lx.config['frontend.password'];
                const userParam = urlObj.searchParams.get('user');
                if (!userParam) {
                    res.writeHead(400);
                    res.end('Missing user param');
                    return;
                }
                // 鉴权逻辑
                let verifiedUser = null;
                if (isAdminAuth) {
                    verifiedUser = userParam;
                }
                else if (userParam === 'default' || userParam === '_open') {
                    verifiedUser = '_open';
                }
                else {
                    verifiedUser = verifyUserAuth(req);
                    if (!verifiedUser || verifiedUser !== userParam) {
                        res.writeHead(403);
                        res.end('Forbidden');
                        return;
                    }
                }
                const userSpace = (0, user_1.getUserSpace)(verifiedUser);
                try {
                    const list = await userSpace.listManage.getSnapshotList();
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify(list));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(err.message);
                }
                return;
            }
            // 下载快照数据
            if (pathname === '/api/data/snapshot' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                const isAdminAuth = auth === global.lx.config['frontend.password'];
                const userParam = urlObj.searchParams.get('user');
                if (!userParam) {
                    res.writeHead(400);
                    res.end('Missing user param');
                    return;
                }
                let verifiedUser = null;
                if (isAdminAuth) {
                    verifiedUser = userParam;
                }
                else if (userParam === 'default' || userParam === '_open') {
                    verifiedUser = '_open';
                }
                else {
                    verifiedUser = verifyUserAuth(req);
                    if (!verifiedUser || verifiedUser !== userParam) {
                        res.writeHead(403);
                        res.end('Forbidden');
                        return;
                    }
                }
                const userSpace = (0, user_1.getUserSpace)(verifiedUser);
                const id = urlObj.searchParams.get('id');
                if (!id) {
                    res.writeHead(400);
                    res.end('Missing id');
                    return;
                }
                try {
                    const data = await userSpace.listManage.getSnapshot(id);
                    if (!data) {
                        res.writeHead(404);
                        res.end('Not Found');
                        return;
                    }
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify(data));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(err.message);
                }
                return;
            }
            // 恢复快照
            if (pathname === '/api/data/restore-snapshot' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                const isAdminAuth = auth === global.lx.config['frontend.password'];
                const userParam = urlObj.searchParams.get('user');
                if (!userParam) {
                    res.writeHead(400);
                    res.end('Missing user param');
                    return;
                }
                let verifiedUser = null;
                if (isAdminAuth) {
                    verifiedUser = userParam;
                }
                else if (userParam === 'default' || userParam === '_open') {
                    verifiedUser = '_open';
                }
                else {
                    verifiedUser = verifyUserAuth(req);
                    if (!verifiedUser || verifiedUser !== userParam) {
                        res.writeHead(403);
                        res.end('Forbidden');
                        return;
                    }
                }
                const userSpace = (0, user_1.getUserSpace)(verifiedUser);
                try {
                    const body = await readBody(req);
                    const { id } = JSON.parse(body);
                    if (!id)
                        throw new Error('Missing id');
                    await userSpace.listManage.restoreSnapshot(id);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(err.message);
                }
                return;
            }
            // [新增] Batch Remove Songs from List (User Auth)
            if (pathname === '/api/music/user/list/remove' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '需要用户认证' }));
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { listId, songIds } = JSON.parse(body);
                        if (!listId || !Array.isArray(songIds)) {
                            res.writeHead(400);
                            res.end('参数错误:需要listId和songIds数组');
                            return;
                        }
                        console.log(`[UserAPI] 批量删除请求: 用户=${username}, 列表=${listId}, 删除歌曲数=${songIds.length}`);
                        console.log(`[UserAPI] 待删除歌曲ID:`, songIds);
                        const userSpace = (0, user_1.getUserSpace)(username);
                        // Get list before deletion
                        const listBefore = await userSpace.listManage.listDataManage.getListMusics(listId);
                        console.log(`[UserAPI] 删除前列表歌曲数: ${listBefore.length}`);
                        // Remove songs from the list
                        const affectedLists = await userSpace.listManage.listDataManage.listMusicRemove(listId, songIds);
                        console.log(`[UserAPI] 受影响的列表:`, affectedLists);
                        // Get list after deletion
                        const listAfter = await userSpace.listManage.listDataManage.getListMusics(listId);
                        console.log(`[UserAPI] 删除后列表歌曲数: ${listAfter.length}`);
                        // Create new snapshot to persist changes
                        const newSnapshotKey = await userSpace.listManage.createSnapshot();
                        console.log(`[UserAPI] 批量删除成功,已创建新快照: ${newSnapshotKey}`);
                        res.writeHead(200);
                        res.end('删除成功');
                    }
                    catch (err) {
                        console.error('[UserAPI] 批量删除失败:', err);
                        res.writeHead(500);
                        res.end(err.message || '删除失败');
                    }
                });
                return;
            }
            // [新增] Batch Add Songs to List (User Auth)
            if (pathname === '/api/music/user/list/add' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: '需要用户认证' }));
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { listId, musicInfos, location = 'bottom' } = JSON.parse(body);
                        if (!listId || !Array.isArray(musicInfos)) {
                            res.writeHead(400);
                            res.end('参数错误:需要listId和musicInfos数组');
                            return;
                        }
                        console.log(`[UserAPI] 批量添加请求: 用户=${username}, 列表=${listId}, 添加歌曲数=${musicInfos.length}`);
                        const userSpace = (0, user_1.getUserSpace)(username);
                        // Add songs to the list
                        await userSpace.listManage.listDataManage.listMusicAdd(listId, musicInfos, location);
                        // Create new snapshot to persist changes
                        const newSnapshotKey = await userSpace.listManage.createSnapshot();
                        console.log(`[UserAPI] 批量添加成功,已创建新快照: ${newSnapshotKey}`);
                        res.writeHead(200);
                        res.end('添加成功');
                    }
                    catch (err) {
                        console.error('[UserAPI] 批量添加失败:', err);
                        res.writeHead(500);
                        res.end(err.message || '添加失败');
                    }
                });
                return;
            }
            // [新增] 删除快照 API
            if (pathname === '/api/data/delete-snapshot' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                const isAdminAuth = auth === global.lx.config['frontend.password'];
                const userParam = urlObj.searchParams.get('user');
                if (!userParam) {
                    res.writeHead(400);
                    res.end('Missing user param');
                    return;
                }
                let verifiedUser = null;
                if (isAdminAuth) {
                    verifiedUser = userParam;
                }
                else if (userParam === 'default' || userParam === '_open') {
                    verifiedUser = '_open';
                }
                else {
                    verifiedUser = verifyUserAuth(req);
                    if (!verifiedUser || verifiedUser !== userParam) {
                        res.writeHead(403);
                        res.end('Forbidden');
                        return;
                    }
                }
                const userSpace = (0, user_1.getUserSpace)(verifiedUser);
                try {
                    const body = await readBody(req);
                    const { id } = JSON.parse(body);
                    if (!id)
                        throw new Error('Missing id');
                    // 调用刚刚在 ListManage 中添加的方法
                    await userSpace.listManage.removeSnapshot(id);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(err.message);
                }
                return;
            }
            // [新增] 上传快照 API
            if (pathname === '/api/data/upload-snapshot' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                const isAdminAuth = auth === global.lx.config['frontend.password'];
                const userParam = urlObj.searchParams.get('user');
                const time = parseInt(urlObj.searchParams.get('time') || '0');
                const filename = urlObj.searchParams.get('filename');
                if (!userParam) {
                    res.writeHead(400);
                    res.end('Missing user param');
                    return;
                }
                let verifiedUser = null;
                if (isAdminAuth) {
                    verifiedUser = userParam;
                }
                else if (userParam === 'default' || userParam === '_open') {
                    verifiedUser = '_open';
                }
                else {
                    verifiedUser = verifyUserAuth(req);
                    if (!verifiedUser || verifiedUser !== userParam) {
                        res.writeHead(403);
                        res.end('Forbidden');
                        return;
                    }
                }
                if (!filename) {
                    res.writeHead(400);
                    res.end('Missing filename param');
                    return;
                }
                const userSpace = (0, user_1.getUserSpace)(verifiedUser);
                try {
                    const body = await readBody(req);
                    let finalData = body;
                    // [核心兼容性修复] 检测是否为落雪音乐离线备份格式 (playList_v2)
                    try {
                        const jsonData = JSON.parse(body);
                        if (jsonData && jsonData.type === 'playList_v2' && Array.isArray(jsonData.data)) {
                            log4js_1.startupLog.info(`[Snapshot] Detected LX Music backup format for user ${verifiedUser}, converting back to internal format...`);
                            // 寻找默认列表
                            const defaultList = jsonData.data.find((l) => l.id === 'default')?.list || [];
                            // 寻找收藏列表
                            const loveList = jsonData.data.find((l) => l.id === 'love')?.list || [];
                            // 其他所有列表均作为用户列表
                            const userList = jsonData.data.filter((l) => l.id !== 'default' && l.id !== 'love');
                            // 拼装为服务器内部快照格式
                            const internalFormat = {
                                defaultList,
                                loveList,
                                userList
                            };
                            // 压缩为单行 JSON 以节省磁盘空间并保持与原生快照一致的大小
                            finalData = JSON.stringify(internalFormat);
                            log4js_1.startupLog.info(`[Snapshot] Conversion complete for user ${verifiedUser}.`);
                        }
                    }
                    catch (parseErr) {
                        // 解析失败说明不是标准的 JSON 格式或已经是原始快照，保持原样即可
                    }
                    // 处理文件名：如果以 snapshot_ 开头，则去掉（因为 saveSnapshotWithTime 会自动加）
                    // 如果不以 snapshot_ 开头，则保持原样（saveSnapshotWithTime 会自动加 snapshot_ 前缀）
                    let name = filename;
                    if (name.startsWith('snapshot_')) {
                        name = name.substring(9);
                    }
                    // 调用 ListManage 中的 saveSnapshotWithTime 方法
                    await userSpace.listManage.saveSnapshotWithTime(name, finalData, time);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true }));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(err.message);
                }
                return;
            }
            // [新增] User Login Verification
            if (pathname === '/api/user/verify' && req.method === 'POST') {
                void readBody(req).then(body => {
                    try {
                        const { username, password } = JSON.parse(body);
                        if (!username || !password) {
                            res.writeHead(400);
                            res.end('Missing username or password');
                            return;
                        }
                        const user = global.lx.config.users.find(u => u.name === username && u.password === password);
                        if (user) {
                            log4js_1.loginLog.info(`User login success: ${username} from ${ip}`);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        }
                        else {
                            log4js_1.loginLog.warn(`User login failed: ${username} from ${ip}`);
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
                        }
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end('Bad Request');
                    }
                });
                return;
            }
            // [新增] 用户登录 - 颁发 Token（替代明文密码传输）
            if (pathname === '/api/user/login' && req.method === 'POST') {
                void readBody(req).then(body => {
                    try {
                        const { username, password } = JSON.parse(body);
                        if (!username || !password) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Missing username or password' }));
                            return;
                        }
                        const user = global.lx.config.users.find((u) => u.name === username && u.password === password);
                        if (user) {
                            const token = generateSessionId();
                            userSessions.set(token, { username, createdAt: Date.now() });
                            log4js_1.loginLog.info(`User token issued: ${username} from ${ip}`);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, token, username }));
                        }
                        else {
                            log4js_1.loginLog.warn(`User login failed: ${username} from ${ip}`);
                            res.writeHead(401, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Invalid credentials' }));
                        }
                    }
                    catch (e) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Bad Request' }));
                    }
                });
                return;
            }
            // [新增] 用户登出 - 注销 Token
            if (pathname === '/api/user/logout' && req.method === 'POST') {
                const token = req.headers['x-user-token'];
                if (token)
                    userSessions.delete(token);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            // [新增] Token 有效性检查
            if (pathname === '/api/user/auth/verify' && req.method === 'GET') {
                const token = req.headers['x-user-token'];
                if (!token) {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ valid: false }));
                    return;
                }
                const session = userSessions.get(token);
                const valid = !!(session && Date.now() - session.createdAt <= USER_SESSION_TTL);
                if (!valid && session)
                    userSessions.delete(token); // 清理过期
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid, username: valid ? session.username : null }));
                return;
            }
            // [新增] Get User List (User Auth)
            if (pathname === '/api/user/list' && req.method === 'GET') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                const userSpace = (0, user_1.getUserSpace)(username);
                void userSpace.listManage.getListData().then(data => {
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify(data));
                }).catch(err => {
                    res.writeHead(500);
                    res.end(err.message);
                });
                return;
            }
            // [新增] Update User List (User Auth) - Full Restore/Overwrite
            if (pathname === '/api/user/list' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const listData = JSON.parse(body);
                        const userSpace = (0, user_1.getUserSpace)(username);
                        // Restore ensures consistency with the provided snapshot
                        await userSpace.listManage.listDataManage.restore(listData);
                        // Create a snapshot after update
                        await userSpace.listManage.createSnapshot();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // [新增] Get User Settings (User Auth)
            if (pathname === '/api/user/settings' && req.method === 'GET') {
                const reqUsername = req.headers['x-user-name'];
                const isPublic = !reqUsername || reqUsername === 'default';
                let resolvedUsername = null;
                if (isPublic && global.lx.config['user.enablePublicRestriction']) {
                    resolvedUsername = '_open'; // 公开受限用户允许访问 _open 空间
                }
                else {
                    resolvedUsername = verifyUserAuth(req);
                    if (!resolvedUsername) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                }
                const userSpace = (0, user_1.getUserSpace)(resolvedUsername);
                const settingsPath = node_path_1.default.join(userSpace.dataManage.userDir, constants_1.File.userSettingsJSON);
                if (node_fs_1.default.existsSync(settingsPath)) {
                    const settingsData = node_fs_1.default.readFileSync(settingsPath, 'utf8');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(settingsData);
                }
                else {
                    // Return empty object instead of 404 to avoid console error on fresh installs
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{}');
                }
                return;
            }
            // [新增] Update User Settings (User Auth)
            if (pathname === '/api/user/settings' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'];
                const isPublic = !reqUsername || reqUsername === 'default';
                let resolvedUsername = null;
                if (isPublic) {
                    // 公开用户：若开启了限制，需要管理员密码
                    if (global.lx.config['user.enablePublicRestriction']) {
                        const auth = req.headers['x-frontend-auth'];
                        if (auth !== global.lx.config['frontend.password']) {
                            res.writeHead(403, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, error: '权限不足：公共用户保存设置受限，请先验证管理员身份。' }));
                            return;
                        }
                    }
                    resolvedUsername = '_open';
                }
                else {
                    resolvedUsername = verifyUserAuth(req);
                    if (!resolvedUsername) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                }
                void readBody(req).then(body => {
                    try {
                        const userSpace = (0, user_1.getUserSpace)(resolvedUsername);
                        const settingsPath = node_path_1.default.join(userSpace.dataManage.userDir, constants_1.File.userSettingsJSON);
                        let settings = JSON.parse(body);
                        // [核心逻辑] 如果是受限的公开用户，仅允许保存特定的 3 项设置
                        if (resolvedUsername === '_open' && global.lx.config['user.enablePublicRestriction']) {
                            const restrictedSettings = {};
                            const allowedKeys = ['enableServerCache', 'enableServerLyricCache'];
                            allowedKeys.forEach(key => {
                                if (settings[key] !== undefined)
                                    restrictedSettings[key] = settings[key];
                            });
                            settings = restrictedSettings;
                        }
                        node_fs_1.default.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(400);
                        res.end('Invalid JSON data');
                    }
                });
                return;
            }
            // [核心路由记录] Token 管理相关 API
            // 1. 获取/更新 Token 配置 (开启状态及列表)
            if (pathname === '/api/user/token/config') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                if (req.method === 'GET') {
                    const config = getUserTokenConfig(username);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        config: {
                            enabled: config.enabled,
                            tokens: config.tokens
                        }
                    }));
                }
                else if (req.method === 'POST') {
                    void readBody(req).then(body => {
                        try {
                            const { enabled } = JSON.parse(body);
                            const config = getUserTokenConfig(username);
                            const newEnabled = !!enabled;
                            // 只有状态发生物理改变（从 True 到 False 或反之）时才处理
                            if (config.enabled !== newEnabled) {
                                config.enabled = newEnabled;
                                saveUserTokenConfig(username, config); // 这里内部会自动更新内存缓存逻辑
                                log4js_1.tokenLog.info(`User ${username} ${newEnabled ? 'enabled' : 'disabled'} persistent token auth`);
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        }
                        catch (e) {
                            res.writeHead(400);
                            res.end('Invalid Body');
                        }
                    });
                }
                return;
            }
            // 3. 生成新 Token
            if (pathname === '/api/user/token/add' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const { name, expireDays, expiresAt } = JSON.parse(body);
                        const config = getUserTokenConfig(username);
                        const newTokenValue = `lx_tk_${node_crypto_1.default.randomBytes(16).toString('hex')}`;
                        const newToken = {
                            name: name || '未命名 Token',
                            token: newTokenValue,
                            createdAt: Date.now(),
                            expiresAt: (expiresAt !== undefined && expiresAt !== null) ? expiresAt : (expireDays ? Date.now() + (expireDays * 24 * 60 * 60 * 1000) : null),
                            lastUsed: undefined
                        };
                        config.tokens.push(newToken);
                        saveUserTokenConfig(username, config);
                        log4js_1.tokenLog.info(`User ${username} generated a new token: ${name}`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, token: newTokenValue }));
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end(e.message);
                    }
                });
                return;
            }
            // 3. 删除 Token
            if (pathname === '/api/user/token/remove' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const { token, tokenMasked } = JSON.parse(body);
                        // 优先使用完整 Token 删除，兼容旧的 tokenMasked
                        const target = token || tokenMasked;
                        if (!target) {
                            res.writeHead(400);
                            res.end('Missing token identifier');
                            return;
                        }
                        const config = getUserTokenConfig(username);
                        const initialCount = config.tokens.length;
                        config.tokens = config.tokens.filter(t => {
                            if (target.startsWith('lx_tk_')) {
                                return t.token !== target;
                            }
                            // 回退：使用脱敏串匹配
                            const m = `${t.token.slice(0, 6)}...${t.token.slice(-4)}`;
                            return m !== target;
                        });
                        if (config.tokens.length !== initialCount) {
                            saveUserTokenConfig(username, config);
                            log4js_1.tokenLog.info(`User ${username} removed a token identifier: ${target.length > 20 ? target.slice(0, 10) + '...' : target}`);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        }
                        else {
                            // 注意：这里返回 404 表明没找到，前端会显示删除失败
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Token not found' }));
                        }
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end(e.message);
                    }
                });
                return;
            }
            // 4. 更新 Token 信息 (名称/有效期)
            if (pathname === '/api/user/token/update' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const { tokenMasked, name, expireDays, expiresAt } = JSON.parse(body);
                        const config = getUserTokenConfig(username);
                        const tokenItem = config.tokens.find(t => {
                            const masked = `${t.token.slice(0, 6)}...${t.token.slice(-4)}`;
                            return masked === tokenMasked;
                        });
                        if (tokenItem) {
                            if (name !== undefined)
                                tokenItem.name = name;
                            if (expiresAt !== undefined) {
                                tokenItem.expiresAt = expiresAt;
                            }
                            else if (expireDays !== undefined) {
                                tokenItem.expiresAt = expireDays ? Date.now() + (expireDays * 24 * 60 * 60 * 1000) : null;
                            }
                            saveUserTokenConfig(username, config);
                            log4js_1.tokenLog.info(`User ${username} updated token config: ${tokenMasked}`);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        }
                        else {
                            res.writeHead(404);
                            res.end('Token not found');
                        }
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end(e.message);
                    }
                });
                return;
            }
            // 5. 切换 Token 启用/禁用状态
            if (pathname === '/api/user/token/toggle' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const { tokenMasked, disabled } = JSON.parse(body);
                        const config = getUserTokenConfig(username);
                        const tokenItem = config.tokens.find(t => {
                            const masked = `${t.token.slice(0, 6)}...${t.token.slice(-4)}`;
                            return masked === tokenMasked;
                        });
                        if (tokenItem) {
                            tokenItem.disabled = !!disabled;
                            saveUserTokenConfig(username, config);
                            log4js_1.tokenLog.info(`User ${username} ${disabled ? 'disabled' : 'enabled'} token: ${tokenMasked}`);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true }));
                        }
                        else {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Token not found' }));
                        }
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end(e.message);
                    }
                });
                return;
            }
            // 5. 获取特定 Token 的审计日志
            if (pathname === '/api/user/token/logs' && req.method === 'GET') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                const tokenMaskedRaw = urlObj.searchParams.get('tokenMasked');
                const tokenMasked = tokenMaskedRaw ? decodeURIComponent(tokenMaskedRaw).trim() : '';
                if (!tokenMasked) {
                    res.writeHead(400);
                    res.end('Missing tokenMasked');
                    return;
                }
                try {
                    // [路径修正] 直接指向根目录 logs/token.log (不依赖 global.lx.dataPath 下的 logs)
                    const logPath = node_path_1.default.join(process.cwd(), 'logs', 'token.log');
                    let logs = [];
                    if (node_fs_1.default.existsSync(logPath)) {
                        const content = node_fs_1.default.readFileSync(logPath, 'utf8');
                        logs = content.split('\n')
                            .filter(line => line.trim().includes(tokenMasked))
                            .reverse()
                            .slice(0, 50);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, logs }));
                }
                catch (e) {
                    res.writeHead(500);
                    res.end('Error reading logs');
                }
                return;
            }
            // [新增] Get User Sound Effects (User Auth)
            if (pathname === '/api/user/sound-effects' && req.method === 'GET') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                const userSpace = (0, user_1.getUserSpace)(username);
                const soundEffectsPath = node_path_1.default.join(userSpace.dataManage.userDir, constants_1.File.userSoundEffectsJSON);
                if (node_fs_1.default.existsSync(soundEffectsPath)) {
                    const soundEffectsData = node_fs_1.default.readFileSync(soundEffectsPath, 'utf8');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(soundEffectsData);
                }
                else {
                    // Return empty object instead of 404 to avoid console error on fresh installs
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end('{}');
                }
                return;
            }
            // [新增] Update User Sound Effects (User Auth)
            if (pathname === '/api/user/sound-effects' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const userSpace = (0, user_1.getUserSpace)(username);
                        const soundEffectsPath = node_path_1.default.join(userSpace.dataManage.userDir, constants_1.File.userSoundEffectsJSON);
                        // Validate JSON
                        JSON.parse(body);
                        node_fs_1.default.writeFileSync(soundEffectsPath, body, 'utf8');
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(400);
                        res.end('Invalid JSON data');
                    }
                });
                return;
            }
            // 2. Check Cache (已迁移到 localSong.ts，支持 GET 和 POST)
            if (pathname === '/api/music/file/check' && (req.method === 'GET' || req.method === 'POST')) {
                return localSong.handleCheckCache(req, res, urlObj);
            }
            // [Optimized] /api/music/cache/status → 转发到 localSong.handleCheckDownloadStatus (复用实现)
            if (pathname === '/api/music/cache/status' && req.method === 'POST') {
                return localSong.handleCheckDownloadStatus(req, res);
            }
            // 2b. Enrich metadata from audio file tags and update DB (已迁移到 localSong.ts)
            if (pathname === '/api/music/cache/enrich-meta' && req.method === 'POST') {
                return localSong.handleEnrichMeta(req, res);
            }
            // === Acoustid 音频指纹刮削路由 ===
            // 单文件刮削: POST /api/music/acoustid/scrape
            if (pathname === '/api/music/acoustid/scrape' && req.method === 'POST') {
                return acoustidScrape.handleAcoustidScrape(req, res);
            }
            // 批量刮削: POST /api/music/acoustid/scrape-batch
            if (pathname === '/api/music/acoustid/scrape-batch' && req.method === 'POST') {
                return acoustidScrape.handleAcoustidScrapeBatch(req, res);
            }
            // 快速测试: GET /api/music/acoustid/test?path=...
            if (pathname === '/api/music/acoustid/test' && req.method === 'GET') {
                return acoustidScrape.handleAcoustidTest(req, res, urlObj);
            }
            // 3. Trigger Download (已迁移到 localSong.ts)
            if (pathname === '/api/music/cache/download' && req.method === 'POST') {
                return localSong.handleDownload(req, res);
            }
            // [New] Stop Cache Task (已迁移到 localSong.ts)
            if (pathname === '/api/music/cache/stop' && req.method === 'POST') {
                return localSong.handleStopDownload(req, res);
            }
            // 4. Serve Cached File (已迁移到 localSong.ts)
            if (pathname.startsWith('/api/music/cache/file/')) {
                return localSong.handleServeCacheFile(req, res, pathname);
            }
            // 5. Get Cache Statistics (已迁移到 localSong.ts)
            if (pathname === '/api/music/cache/stats' && req.method === 'GET') {
                return localSong.handleCacheStats(req, res);
            }
            // Clear all cache (已迁移到 localSong.ts)
            if (pathname === '/api/music/cache/clear' && req.method === 'POST') {
                return localSong.handleClearCache(req, res);
            }
            // Clear lyric cache (已迁移到 localSong.ts)
            if (pathname === '/api/music/cache/lyric/clear' && req.method === 'POST') {
                return localSong.handleClearLyricCache(req, res);
            }
            // [New] Move all cache files to music directory (已迁移到 localSong.ts)
            if (pathname === '/api/music/cache/move-to-music' && req.method === 'POST') {
                return localSong.handleMoveCacheToMusic(req, res);
            }
            // ==================== 本地库路由 (Local Library Routes) ====================
            // GET /api/music/local/libraries — 获取库列表 (兼容旧接口)
            if (pathname === '/api/music/local/libraries' && req.method === 'GET') {
                return localLibrary.handleGetLibraries(req, res);
            }
            // GET /api/music/local/library/status — 获取本地库状态
            if (pathname === '/api/music/local/library/status' && req.method === 'GET') {
                return localLibrary.handleGetLibraryStatus(req, res);
            }
            // POST /api/music/local/libraries — 启用本地库
            if (pathname === '/api/music/local/libraries' && req.method === 'POST') {
                return localLibrary.handleAddLibrary(req, res);
            }
            // DELETE /api/music/local/libraries/:id — 禁用本地库
            if (pathname.startsWith('/api/music/local/libraries/') && req.method === 'DELETE') {
                return localLibrary.handleDeleteLibrary(req, res, urlObj);
            }
            // GET /api/music/local/browse — 浏览服务器目录 (保留兼容性)
            if (pathname === '/api/music/local/browse' && req.method === 'GET') {
                return localLibrary.handleBrowse(req, res, urlObj);
            }
            // GET /api/music/local/folder-songs — 文件夹歌曲分页查询
            if (pathname === '/api/music/local/folder-songs' && req.method === 'GET') {
                return localLibrary.handleFolderSongs(req, res, urlObj);
            }
            // POST /api/music/local/scan — 启动扫描
            if (pathname === '/api/music/local/scan' && req.method === 'POST') {
                return localLibrary.handleStartScan(req, res);
            }
            // POST /api/music/local/scan-folder — 扫描指定子目录
            if (pathname === '/api/music/local/scan-folder' && req.method === 'POST') {
                return localLibrary.handleScanFolder(req, res);
            }
            // GET /api/music/local/scan/events — 扫描进度 SSE 推送
            if (pathname === '/api/music/local/scan/events' && req.method === 'GET') {
                return localLibrary.handleScanEvents(req, res);
            }
            // GET /api/music/local/scan/status/:scanId — 查询扫描进度
            if (pathname.startsWith('/api/music/local/scan/status/') && req.method === 'GET') {
                return localLibrary.handleScanStatus(req, res, urlObj);
            }
            // POST /api/music/local/scan/cancel/:scanId — 取消扫描
            if (pathname.startsWith('/api/music/local/scan/cancel/') && req.method === 'POST') {
                return localLibrary.handleCancelScan(req, res, urlObj);
            }
            // GET /api/music/local/scan/errors/:scanId — 获取扫描错误列表
            if (pathname.startsWith('/api/music/local/scan/errors/') && req.method === 'GET') {
                return localLibrary.handleScanErrors(req, res, urlObj);
            }
            // GET /api/music/local/sources — 获取可用来源列表
            if (pathname === '/api/music/local/sources' && req.method === 'GET') {
                return localLibrary.handleGetSources(req, res);
            }
            // POST /api/music/local/watch/start — 开启自动监听
            if (pathname === '/api/music/local/watch/start' && req.method === 'POST') {
                return localLibrary.handleWatchStart(req, res);
            }
            // POST /api/music/local/watch/stop — 关闭自动监听
            if (pathname === '/api/music/local/watch/stop' && req.method === 'POST') {
                return localLibrary.handleWatchStop(req, res);
            }
            // GET /api/music/local/watch/status/:libraryId — 查询监听状态
            if (pathname.startsWith('/api/music/local/watch/status/') && req.method === 'GET') {
                return localLibrary.handleWatchStatus(req, res, urlObj);
            }
            // POST /api/music/local/watch/debounce — 设置防抖延迟
            if (pathname === '/api/music/local/watch/debounce' && req.method === 'POST') {
                return localLibrary.handleWatchDebounce(req, res);
            }
            // POST /api/music/local/scraping — 切换刮削开关
            if (pathname === '/api/music/local/scraping' && req.method === 'POST') {
                return localLibrary.handleUpdateScraping(req, res);
            }
            // ==================== 本地库路由结束 ====================
            // 7. Get Cache Progress (支持 rawId 查询，自动匹配 source_rawId 复合格式)
            if (pathname === '/api/music/cache/progress' && req.method === 'GET') {
                const ids = urlObj.searchParams.get('ids')?.split(',') || [];
                const progress = {};
                ids.forEach(id => {
                    // 1. 精确匹配
                    if (fileCache.cacheProgress.has(id)) {
                        progress[id] = fileCache.cacheProgress.get(id);
                    }
                    else {
                        // 2. 模糊匹配: 查找 *_rawId 格式的 key (source_rawId 或 server_source_rawId)
                        const suffix = '_' + id;
                        for (const [key, value] of fileCache.cacheProgress) {
                            if (key.endsWith(suffix)) {
                                progress[id] = value;
                                break;
                            }
                        }
                    }
                });
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, data: progress }));
                return;
            }
            // [New] Update song duration in DB (called by frontend when audio.duration is available)
            if (pathname === '/api/music/cache/update-duration' && req.method === 'POST') {
                void readBody(req).then(body => {
                    try {
                        const { songId, duration } = JSON.parse(body);
                        if (!songId || !duration || !Number.isFinite(duration) || duration <= 0) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Missing or invalid songId/duration' }));
                            return;
                        }
                        const { updateMusicLibMeta } = require('../utils/db');
                        const durationSec = Math.round(duration); // audio.duration is float seconds, DB stores integer seconds
                        // songId 格式为 "source_songId", 需要拆分
                        const underscoreIdx = String(songId).indexOf('_');
                        const source = underscoreIdx > 0 ? String(songId).substring(0, underscoreIdx) : 'unknown';
                        const rawSongId = underscoreIdx > 0 ? String(songId).substring(underscoreIdx + 1) : String(songId);
                        updateMusicLibMeta(source, rawSongId, { duration: durationSec });
                        console.log(`[DurationFix] Updated duration for ${songId}: ${durationSec}s`);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, duration: durationSec }));
                    }
                    catch (err) {
                        console.error('[DurationFix] Failed:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // [New] Sync: scan disk files and write missing DB records
            if (pathname === '/api/music/db/sync' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                try {
                    const { getAllDownloadRecords, upsertDownloadRecord } = require('../utils/db');
                    // 1. Get all existing DB records (build a Set of file_path for quick lookup)
                    const allRecords = getAllDownloadRecords();
                    const existingPaths = new Set();
                    const existingSongIds = new Set();
                    allRecords.forEach((r) => {
                        if (r.file_path)
                            existingPaths.add(r.file_path);
                        if (r.song_id)
                            existingSongIds.add(r.song_id);
                    });
                    // 2. Scan all audio files from both cache and music directories
                    const roots = ['cache', 'download'];
                    let syncedCount = 0;
                    const skippedNoSongId = [];
                    for (const folder of roots) {
                        const baseDir = folder === 'download' ? (0, pathUtil_1.getDownloadDir)() : (0, pathUtil_1.getCacheDir)();
                        if (!node_fs_1.default.existsSync(baseDir))
                            continue;
                        const scanDir = (dir) => {
                            if (!node_fs_1.default.existsSync(dir))
                                return;
                            const items = node_fs_1.default.readdirSync(dir);
                            const AUDIO_EXTS = ['.mp3', '.flac', '.m4a', '.ogg', '.wav'];
                            for (const item of items) {
                                const itemPath = node_path_1.default.join(dir, item);
                                try {
                                    const stats = node_fs_1.default.statSync(itemPath);
                                    if (stats.isDirectory()) {
                                        scanDir(itemPath);
                                    }
                                    else if (stats.isFile()) {
                                        const ext = node_path_1.default.extname(item).toLowerCase();
                                        if (!AUDIO_EXTS.includes(ext))
                                            continue;
                                        // Skip temp/incomplete files (typically ~4KB header-only artifacts)
                                        const MIN_AUDIO_FILE_SIZE = 10240; // 10KB
                                        if (stats.size < MIN_AUDIO_FILE_SIZE)
                                            continue;
                                        // Skip if this file path already has a DB record
                                        if (existingPaths.has(itemPath))
                                            continue;
                                        // Extract singer/album/name from path
                                        // New format: album/name(singer).ext
                                        // Old format: singer/album/name.ext
                                        const relativePath = node_path_1.default.relative(baseDir, itemPath);
                                        const pathParts = relativePath.split(node_path_1.default.sep);
                                        const songNameRaw = node_path_1.default.basename(item, ext);
                                        let songName = songNameRaw.replace(/^\.+/, '');
                                        let album = 'Unknown';
                                        let singer = 'Unknown';
                                        if (pathParts.length >= 3) {
                                            // Old format: singer/album/name.ext
                                            singer = pathParts[pathParts.length - 3];
                                            album = pathParts[pathParts.length - 2];
                                        }
                                        else if (pathParts.length === 2) {
                                            // New format: album/name(singer).ext
                                            album = pathParts[pathParts.length - 2];
                                            const parenMatch = songNameRaw.match(/^(.+)\(([^)]+)\)$/);
                                            if (parenMatch) {
                                                songName = parenMatch[1];
                                                singer = parenMatch[2];
                                            }
                                        }
                                        else {
                                            // Single level: name(singer).ext or name.ext
                                            const parenMatch = songNameRaw.match(/^(.+)\(([^)]+)\)$/);
                                            if (parenMatch) {
                                                songName = parenMatch[1];
                                                singer = parenMatch[2];
                                            }
                                        }
                                        // Generate a deterministic song_id from file identity
                                        const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
                                        const songId = `file_${sanitize(singer)}_${sanitize(album)}_${sanitize(songName)}`;
                                        // Skip if song_id already in DB
                                        if (existingSongIds.has(songId))
                                            continue;
                                        // Write new DB record
                                        upsertDownloadRecord({
                                            song_id: songId,
                                            song_name: songName,
                                            singer: singer,
                                            album: album,
                                            source: '',
                                            quality: ext.replace('.', ''),
                                            file_path: itemPath,
                                            file_size: stats.size,
                                            status: 'finished',
                                            relative_path: relativePath,
                                            ext: ext,
                                            mtime: stats.mtime.toISOString(),
                                        });
                                        // Track to avoid duplicate within this scan
                                        existingPaths.add(itemPath);
                                        existingSongIds.add(songId);
                                        syncedCount++;
                                    }
                                }
                                catch (e) {
                                    // Skip files with errors
                                }
                            }
                        };
                        scanDir(baseDir);
                    }
                    console.log(`[DBSync] Synced ${syncedCount} file(s) to DB`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, synced: syncedCount }));
                }
                catch (err) {
                    console.error('[DBSync] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
                return;
            }
            // [ML-14] 删除失效音乐 - 清理DB中文件不存在的记录 (Cleanup stale DB records)
            if (pathname === '/api/music/db/cleanup' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                }
                try {
                    const dbMod = require('../utils/db');
                    const staleRecords = dbMod.getStaleRecords();
                    const totalStale = staleRecords.length;
                    if (totalStale === 0) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, deletedCount: 0, total: 0, message: '没有发现失效记录' }));
                        return;
                    }
                    const deletedCount = dbMod.deleteStaleRecords();
                    console.log(`[DBCleanup] Deleted ${deletedCount} stale record(s)`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, deletedCount, total: totalStale }));
                }
                catch (err) {
                    console.error('[DBCleanup] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
                return;
            }
            // [ML-14 扩展] 删除重复记录 - 按 album+singer+song_name 判断，保留 wy_ 前缀
            if (pathname === '/api/music/db/deduplicate' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                }
                try {
                    const dbMod = require('../utils/db');
                    const duplicateGroups = dbMod.getDuplicateRecords();
                    const totalGroups = duplicateGroups.length;
                    if (totalGroups === 0) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, deletedCount: 0, totalGroups: 0, message: '没有发现重复记录' }));
                        return;
                    }
                    const deletedCount = dbMod.deleteDuplicateRecords();
                    console.log(`[DBDeduplicate] Deleted ${deletedCount} duplicate record(s) from ${totalGroups} group(s)`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, deletedCount, totalGroups }));
                }
                catch (err) {
                    console.error('[DBDeduplicate] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
                return;
            }
            // [ML-15] 补齐缺失数据 - 从本地文件读取元数据并补充到DB + 下载歌词/封面 (Enrich missing metadata)
            // 补齐缺失数据 (ML-15) - SSE 流式响应 + 并发处理
            if (pathname === '/api/music/db/enrich' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                }
                // 设置 SSE 响应头
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'X-Accel-Buffering': 'no', // Nginx 兼容
                });
                /** 发送 SSE 事件 */
                const sendSSE = (event, data) => {
                    try {
                        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
                    }
                    catch (e) { /* 连接已关闭 */ }
                };
                try {
                    const dbMod = require('../utils/db');
                    const records = dbMod.getRecordsNeedingEnrichment();
                    const total = records.length;
                    if (total === 0) {
                        sendSSE('complete', { success: true, enrichedCount: 0, total: 0, lyricsDownloaded: 0, coversEmbedded: 0, message: '没有需要补充元数据的记录' });
                        res.end();
                        return;
                    }
                    sendSSE('start', { total });
                    let enrichedCount = 0;
                    let lyricsDownloaded = 0;
                    let coversEmbedded = 0;
                    const CONCURRENCY = 3; // 并发处理数
                    let completedInBatch = 0;
                    /** 处理单条记录 */
                    const processRecord = async (record) => {
                        if (!record.file_path || !node_fs_1.default.existsSync(record.file_path)) {
                            try {
                                dbMod.updateMusicLibMeta(record.source || 'unknown', record.song_id, { meta_enriched: 1 });
                            }
                            catch (e) { }
                            return { enriched: false, lyric: false, cover: false };
                        }
                        const updates = {};
                        let gotLyric = false;
                        let gotCover = false;
                        try {
                            // --- Step 1 & 2: Read tags + check/embed cover using MusicTagUtil ---
                            MusicTagUtil.withTaggerSave(record.file_path, (tagger, createMetaPicture) => {
                                if (tagger.genre)
                                    updates.genre = tagger.genre;
                                if (tagger.year)
                                    updates.year = tagger.year;
                                if (tagger.sampleRate)
                                    updates.sample_rate = tagger.sampleRate;
                                if (tagger.bitDepth)
                                    updates.bit_depth = tagger.bitDepth;
                                if (tagger.channels)
                                    updates.channels = tagger.channels;
                                if (tagger.bitRate)
                                    updates.bit_rate = tagger.bitRate;
                                if (tagger.trackNumber)
                                    updates.track_number = tagger.trackNumber;
                                if (tagger.albumArtist)
                                    updates.album_artist = tagger.albumArtist;
                                if (tagger.composer)
                                    updates.composer = tagger.composer;
                                if (tagger.duration)
                                    updates.duration = Math.round(tagger.duration / 1000);
                                if (!record.has_cover) {
                                    const pics = tagger.pictures;
                                    if (pics && pics.length > 0) {
                                        updates.has_cover = true;
                                        gotCover = true;
                                    }
                                    else {
                                        if (record.relative_path) {
                                            try {
                                                const existingCover = fileCache.getCacheCover(record.relative_path);
                                                if (existingCover && existingCover.data) {
                                                    const pic = createMetaPicture(existingCover.mime || 'image/jpeg', existingCover.data);
                                                    tagger.pictures = [pic];
                                                    updates.has_cover = true;
                                                    gotCover = true;
                                                }
                                            }
                                            catch (coverErr) {
                                                console.warn(`[DBEnrich] Cover embedding failed for ${record.song_id}: ${coverErr.message}`);
                                            }
                                        }
                                    }
                                }
                            });
                        }
                        catch (tagErr) {
                            console.warn(`[DBEnrich] Failed to read tags for ${record.song_id}: ${tagErr.message}`);
                        }
                        // --- Step 3: Download lyric if missing ---
                        if (!record.has_lyric) {
                            try {
                                const name = record.song_name || '';
                                const singer = record.singer || '';
                                const albumName = record.album || '';
                                if (name) {
                                    const matches = await musicSdk.findMusic({ name, singer, albumName, interval: '', source: '' });
                                    if (matches && matches.length > 0) {
                                        for (const match of matches) {
                                            try {
                                                if (!musicSdk[match.source] || !musicSdk[match.source].getLyric)
                                                    continue;
                                                const songInfo = {
                                                    songmid: match.songmid || match.songId || '',
                                                    name: match.name || name,
                                                    singer: match.singer || singer,
                                                    hash: match.hash || '',
                                                    interval: match.interval || '',
                                                    copyrightId: match.copyrightId || '',
                                                    albumId: match.albumId || '',
                                                    lrcUrl: match.lrcUrl || '',
                                                    mrcUrl: match.mrcUrl || '',
                                                    trcUrl: match.trcUrl || '',
                                                };
                                                const requestObj = musicSdk[match.source].getLyric(songInfo);
                                                const lyricInfo = await requestObj.promise;
                                                if (lyricInfo && (lyricInfo.lyric || lyricInfo.lrc)) {
                                                    const songForCache = {
                                                        name,
                                                        singer: singer || 'Unknown',
                                                        albumName: albumName || 'Unknown',
                                                        source: match.source,
                                                        songmid: match.songmid || match.songId || '',
                                                        relativePath: record.relative_path,
                                                    };
                                                    fileCache.saveLyricCache(songForCache, lyricInfo);
                                                    updates.has_lyric = true;
                                                    gotLyric = true;
                                                    break;
                                                }
                                            }
                                            catch (lyricErr) {
                                                continue;
                                            }
                                        }
                                    }
                                }
                            }
                            catch (lyricSearchErr) {
                                console.warn(`[DBEnrich] Lyric search failed for ${record.song_id}: ${lyricSearchErr.message}`);
                            }
                        }
                        // Mark as enriched
                        updates.meta_enriched = 1;
                        if (Object.keys(updates).length > 1) {
                            dbMod.updateMusicLibMeta(record.source || 'unknown', record.song_id, updates);
                        }
                        else {
                            dbMod.updateMusicLibMeta(record.source || 'unknown', record.song_id, { meta_enriched: 1 });
                        }
                        return { enriched: true, lyric: gotLyric, cover: gotCover };
                    };
                    // 并发分批处理
                    const processBatch = async (batchStart) => {
                        if (batchStart >= total) {
                            // 全部完成
                            console.log(`[DBEnrich] Enriched ${enrichedCount}/${total} record(s), lyrics: ${lyricsDownloaded}, covers: ${coversEmbedded}`);
                            sendSSE('complete', { success: true, enrichedCount, total, lyricsDownloaded, coversEmbedded });
                            res.end();
                            return;
                        }
                        const batchEnd = Math.min(batchStart + CONCURRENCY, total);
                        const batch = records.slice(batchStart, batchEnd);
                        const results = await Promise.all(batch.map(r => processRecord(r)));
                        for (const r of results) {
                            if (r.enriched)
                                enrichedCount++;
                            if (r.lyric)
                                lyricsDownloaded++;
                            if (r.cover)
                                coversEmbedded++;
                        }
                        completedInBatch = batchEnd;
                        // 推送进度事件
                        sendSSE('progress', { completed: completedInBatch, total, enrichedCount, lyricsDownloaded, coversEmbedded });
                        // 处理下一批
                        processBatch(batchEnd);
                    };
                    // 启动处理
                    processBatch(0);
                }
                catch (err) {
                    console.error('[DBEnrich] Failed:', err.message);
                    sendSSE('complete', { success: false, message: err.message, enrichedCount: 0, total: 0, lyricsDownloaded: 0, coversEmbedded: 0 });
                    res.end();
                }
                return;
            }
            // 7. Get Detailed Cache List (from DB or scan cache/ directory)
            if (pathname === '/api/music/cache/list' && req.method === 'GET') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                // 扫描 cache/ 目录返回文件列表 (Scan cache/ directory when type=dir)
                const listType = urlObj.searchParams.get('type');
                if (listType === 'dir') {
                    try {
                        const data = fileCache.scanCacheDirectory();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, data, source: 'dir' }));
                    }
                    catch (e) {
                        console.error('[CacheList] Dir scan failed:', e.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, data: [], message: e.message }));
                    }
                    return;
                }
                // Check if album filter is requested
                const albumName = urlObj.searchParams.get('album');
                const singerName = urlObj.searchParams.get('singer');
                const listSource = urlObj.searchParams.get('source') || '';
                // Only read from DB (no directory scanning, no MusicTagger)
                try {
                    const { getMusicLibListFromDB, getSongsByAlbumName, getSingerDownloadRecords } = require('../utils/db');
                    let data;
                    if (albumName !== null && albumName.trim() === '') {
                        // album 参数为空字符串时返回空列表，防止回退到全量查询
                        data = [];
                    }
                    else if (singerName !== null && singerName.trim() === '') {
                        // singer 参数为空字符串时返回空列表，防止回退到全量查询
                        data = [];
                    }
                    else if (albumName) {
                        // Query by album name (optimized for album detail refresh)
                        data = getSongsByAlbumName(albumName);
                    }
                    else if (singerName) {
                        // Query by singer name (optimized for singer detail, supports multi-singer separator matching)
                        data = getSingerDownloadRecords(singerName);
                    }
                    else {
                        // Get all music library (with optional source filter)
                        data = getMusicLibListFromDB(listSource || undefined);
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, data, source: 'db' }));
                }
                catch (e) {
                    console.error('[CacheList] DB read failed:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, data: [], message: e.message }));
                }
                return;
            }
            // 单曲分页列表 (Paginated singles list)
            if (pathname === '/api/music/db/page' && req.method === 'GET') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                try {
                    const { getMusicLibPageFromDB } = require('../utils/db');
                    const page = parseInt(urlObj.searchParams.get('page') || '1') || 1;
                    const pageSize = parseInt(urlObj.searchParams.get('pageSize') || '30') || 30;
                    const sort = urlObj.searchParams.get('sort') || 'mtime';
                    const order = urlObj.searchParams.get('order') || 'desc';
                    const search = urlObj.searchParams.get('search') || '';
                    const pageSource = urlObj.searchParams.get('source') || '';
                    const result = getMusicLibPageFromDB({ page, pageSize, sort, order, search, source: pageSource });
                    // 异步补充缺失的音频元数据 (Async backfill missing audio metadata)
                    (async () => {
                        fileCache.backfillMissingMetadata(result.data, { logLabel: '[DBPage]' });
                    })();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, ...result }));
                }
                catch (e) {
                    console.error('[DBPage] Paginated query failed:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, data: [], total: 0, message: e.message }));
                }
                return;
            }
            // 专辑分页列表 (Paginated album list from v_album_info)
            if (pathname === '/api/music/album/page' && req.method === 'GET') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                try {
                    const { getAlbumPageFromDB } = require('../utils/db');
                    const page = parseInt(urlObj.searchParams.get('page') || '1') || 1;
                    const pageSize = parseInt(urlObj.searchParams.get('pageSize') || '24') || 24;
                    const sort = urlObj.searchParams.get('sort') || 'album';
                    const order = urlObj.searchParams.get('order') || 'asc';
                    const search = urlObj.searchParams.get('search') || '';
                    const source = urlObj.searchParams.get('source') || '';
                    const result = getAlbumPageFromDB({ page, pageSize, sort, order, search, source });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, ...result }));
                }
                catch (e) {
                    console.error('[AlbumPage] Paginated query failed:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: false, data: [], total: 0, page: 1, pageSize: 24,
                        totalPages: 0, message: e.message
                    }));
                }
                return;
            }
            // 首页统计 (Home page stats: artist/album/song counts)
            if (pathname === '/api/music/home/stats' && req.method === 'GET') {
                try {
                    const { getHomeStats } = require('../utils/db');
                    const stats = getHomeStats();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, data: stats }));
                }
                catch (e) {
                    console.error('[HomeStats] Failed:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: e.message }));
                }
                return;
            }
            // 首页最近添加专辑 (Home page recently added albums)
            if (pathname === '/api/music/home/recent-added' && req.method === 'GET') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                }
                try {
                    const { getAlbumPageFromDB } = require('../utils/db');
                    const limit = parseInt(urlObj.searchParams.get('limit') || '15') || 15;
                    const result = getAlbumPageFromDB({ page: 1, pageSize: limit, sort: 'mtime', order: 'desc' });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, data: result.data, total: result.total }));
                }
                catch (e) {
                    console.error('[HomeRecentAdded] Failed:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: e.message }));
                }
                return;
            }
            // 首页"随心听"歌单 (Home mix: random local library + favorite list songs)
            if (pathname === '/api/music/home/mix' && req.method === 'GET') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                try {
                    const { getRandomSongsFromDB } = require('../utils/db');
                    const limit = Math.min(parseInt(urlObj.searchParams.get('limit') || '200') || 200, 200);
                    // 1. 本地库随机歌曲 (Random songs from music library)
                    const libSongs = getRandomSongsFromDB(limit).map((s) => ({ ...s, mixType: 'local' }));
                    // 2. 收藏歌单歌曲 (Songs from loveList + userLists)
                    const userSpace = (0, user_1.getUserSpace)(username);
                    const listData = await userSpace.listManage.getListData();
                    const favSongs = [];
                    const seen = new Set();
                    const pushFavSong = (song) => {
                        if (!song || !song.id || seen.has(String(song.id)))
                            return;
                        seen.add(String(song.id));
                        favSongs.push({ ...song, mixType: 'list' });
                    };
                    (listData.loveList || []).forEach(pushFavSong);
                    (listData.userList || []).forEach((ul) => (ul.list || []).forEach(pushFavSong));
                    // 3. 合并去重 + Fisher-Yates 洗牌 + 截断 (Merge, dedupe, shuffle, truncate)
                    const dedupKeys = new Set(libSongs.map(s => String(s.id)));
                    const mixed = [...libSongs, ...favSongs.filter(s => !dedupKeys.has(String(s.id)))];
                    for (let i = mixed.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
                    }
                    const data = mixed.slice(0, limit);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, data, total: data.length }));
                }
                catch (e) {
                    console.error('[HomeMix] Failed:', e.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: e.message }));
                }
                return;
            }
            // 8b. Update Album Name
            if (pathname === '/api/music/cache/update-album-name' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                void readBody(req).then(body => {
                    try {
                        const { oldName, newName } = JSON.parse(body);
                        if (!oldName || !newName) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Missing oldName or newName' }));
                            return;
                        }
                        const { updateAlbumNameInDB } = require('../utils/db');
                        updateAlbumNameInDB(oldName, newName);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Album name updated successfully' }));
                    }
                    catch (err) {
                        console.error('[UpdateAlbumName] Failed:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // ===== 专辑编辑器 API (Album Editor APIs) =====
            // 图片扩展名常量 + MIME 映射
            const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
            const MIME_MAP = {
                '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
            };
            /** 根据 source 解析专辑根目录绝对路径 */
            const resolveAlbumDir = (source) => {
                if (source === 'local') {
                    const lib = localLibrary.getLibraryBySource(source);
                    return lib ? lib.path : null;
                }
                return fileCache.getCacheDir(true); // download/ 目录
            };
            // 3a. 列出专辑所有来源的图片 (List album images by source)
            if (pathname === '/api/music/album/images' && req.method === 'GET') {
                const albumName = urlObj.searchParams.get('albumName') || '';
                if (!albumName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing albumName' }));
                    return;
                }
                try {
                    const { getSongsByAlbumName } = require('../utils/db');
                    const songs = getSongsByAlbumName(albumName);
                    // 按 source 分组
                    const sourceMap = new Map();
                    for (const song of songs) {
                        if (!sourceMap.has(song.source)) {
                            sourceMap.set(song.source, song.source);
                        }
                    }
                    const sources = [];
                    const visited = new Set();
                    for (const [source] of sourceMap) {
                        const rootDir = resolveAlbumDir(source);
                        if (!rootDir)
                            continue;
                        const albumDir = node_path_1.default.join(rootDir, fileCache.sanitizePath(albumName));
                        // 避免重复扫描同一目录
                        if (visited.has(albumDir))
                            continue;
                        visited.add(albumDir);
                        const images = [];
                        if (node_fs_1.default.existsSync(albumDir)) {
                            const files = node_fs_1.default.readdirSync(albumDir);
                            for (const f of files) {
                                const ext = node_path_1.default.extname(f).toLowerCase();
                                if (IMAGE_EXTS.includes(ext)) {
                                    const stats = node_fs_1.default.statSync(node_path_1.default.join(albumDir, f));
                                    images.push({ name: f, size: stats.size });
                                }
                            }
                        }
                        sources.push({ source, dirName: albumDir, images });
                    }
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, sources }));
                }
                catch (err) {
                    console.error('[AlbumImages] List failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
                return;
            }
            // 3b. 获取单张专辑图片 (Get single album image)
            if (pathname === '/api/music/album/image' && req.method === 'GET') {
                const albumName = urlObj.searchParams.get('albumName') || '';
                const fileName = urlObj.searchParams.get('fileName') || '';
                const source = urlObj.searchParams.get('source') || '';
                if (!albumName || !fileName || !source) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing albumName/fileName/source' }));
                    return;
                }
                try {
                    const rootDir = resolveAlbumDir(source);
                    if (!rootDir) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Source directory not found' }));
                        return;
                    }
                    const safeName = node_path_1.default.basename(fileName);
                    const imgPath = node_path_1.default.join(rootDir, fileCache.sanitizePath(albumName), safeName);
                    if (!node_fs_1.default.existsSync(imgPath)) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Image not found' }));
                        return;
                    }
                    const ext = node_path_1.default.extname(imgPath).toLowerCase();
                    const mime = MIME_MAP[ext] || 'image/jpeg';
                    const data = node_fs_1.default.readFileSync(imgPath);
                    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
                    res.end(data);
                }
                catch (err) {
                    console.error('[AlbumImage] Get failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
                return;
            }
            // 3c. 上传专辑图片 (Upload album images)
            if (pathname === '/api/music/album/images/upload' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                const form = (0, formidable_1.default)({ multiples: true, uploadDir: node_os_1.default.tmpdir(), maxFileSize: 10 * 1024 * 1024 });
                form.parse(req, (err, fields, files) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Upload error: ' + err.message }));
                        return;
                    }
                    const albumName = Array.isArray(fields.albumName) ? fields.albumName[0] : fields.albumName;
                    const source = Array.isArray(fields.source) ? fields.source[0] : fields.source;
                    if (!albumName || !source) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Missing albumName or source' }));
                        return;
                    }
                    try {
                        const rootDir = resolveAlbumDir(source);
                        if (!rootDir) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Source directory not found' }));
                            return;
                        }
                        const albumDir = node_path_1.default.join(rootDir, fileCache.sanitizePath(albumName));
                        node_fs_1.default.mkdirSync(albumDir, { recursive: true });
                        // formidable v3 多文件：files.images 是数组或单个
                        const rawFiles = files.images || files.image || Object.values(files);
                        const fileArr = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
                        let savedCount = 0;
                        for (const f of fileArr) {
                            if (!f || !f.filepath)
                                continue;
                            const origName = f.originalFilename || f.newFilename;
                            if (!origName)
                                continue;
                            const ext = node_path_1.default.extname(origName).toLowerCase();
                            if (!IMAGE_EXTS.includes(ext))
                                continue;
                            const safeName = node_path_1.default.basename(origName);
                            const destPath = node_path_1.default.join(albumDir, safeName);
                            node_fs_1.default.copyFileSync(f.filepath, destPath);
                            try {
                                node_fs_1.default.unlinkSync(f.filepath);
                            }
                            catch { }
                            savedCount++;
                        }
                        // 图片变更后清空封面缓存
                        fileCache.clearCoverCache();
                        localLibrary.clearCoverCache();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, saved: savedCount }));
                    }
                    catch (err) {
                        console.error('[AlbumImage] Upload failed:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // 3d. 删除专辑图片 (Delete album image)
            if (pathname === '/api/music/album/images/delete' && req.method === 'DELETE') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const { albumName, fileName, source } = JSON.parse(body);
                        if (!albumName || !fileName || !source) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Missing albumName/fileName/source' }));
                            return;
                        }
                        const rootDir = resolveAlbumDir(source);
                        if (!rootDir) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Source directory not found' }));
                            return;
                        }
                        const safeName = node_path_1.default.basename(fileName);
                        const imgPath = node_path_1.default.join(rootDir, fileCache.sanitizePath(albumName), safeName);
                        if (!node_fs_1.default.existsSync(imgPath)) {
                            res.writeHead(404, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Image not found' }));
                            return;
                        }
                        node_fs_1.default.unlinkSync(imgPath);
                        // 图片变更后清空封面缓存
                        fileCache.clearCoverCache();
                        localLibrary.clearCoverCache();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        console.error('[AlbumImage] Delete failed:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // 3e. 批量更新专辑元数据 (Batch update album metadata)
            if (pathname === '/api/music/album/metadata' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { oldAlbumName, newAlbumName, singer, year, discNumber, discTotal, albumArtist, genre, composer } = JSON.parse(body);
                        if (!oldAlbumName) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Missing oldAlbumName' }));
                            return;
                        }
                        const { updateAlbumMetadataInDB, getSongsByAlbumName, updateSongFullTags } = require('../utils/db');
                        // 1. DB 批量更新
                        const dbUpdates = {};
                        if (newAlbumName !== undefined && newAlbumName !== oldAlbumName)
                            dbUpdates.album = newAlbumName;
                        if (singer !== undefined)
                            dbUpdates.singer = singer || '';
                        if (year !== undefined)
                            dbUpdates.year = year || null;
                        if (discNumber !== undefined)
                            dbUpdates.disc_number = discNumber || null;
                        if (discTotal !== undefined)
                            dbUpdates.disc_total = discTotal || null;
                        if (albumArtist !== undefined)
                            dbUpdates.album_artist = albumArtist || '';
                        if (genre !== undefined)
                            dbUpdates.genre = genre || '';
                        if (composer !== undefined)
                            dbUpdates.composer = composer || '';
                        const albumRenamed = newAlbumName !== undefined && newAlbumName !== oldAlbumName;
                        const updatedCount = updateAlbumMetadataInDB(oldAlbumName, dbUpdates);
                        // 2. 目录重命名 (仅当专辑名变更时)
                        if (albumRenamed) {
                            const songs = getSongsByAlbumName(newAlbumName);
                            // 按 source 分组处理目录重命名
                            const sourceDirs = new Set();
                            for (const song of songs) {
                                sourceDirs.add(song.source);
                            }
                            for (const source of sourceDirs) {
                                const rootDir = resolveAlbumDir(source);
                                if (!rootDir)
                                    continue;
                                const oldDir = node_path_1.default.join(rootDir, fileCache.sanitizePath(oldAlbumName));
                                const newDir = node_path_1.default.join(rootDir, fileCache.sanitizePath(newAlbumName));
                                if (node_fs_1.default.existsSync(oldDir) && !node_fs_1.default.existsSync(newDir)) {
                                    try {
                                        node_fs_1.default.renameSync(oldDir, newDir);
                                        console.log(`[AlbumMeta] Renamed dir: ${oldDir} -> ${newDir}`);
                                    }
                                    catch (renameErr) {
                                        console.warn(`[AlbumMeta] Dir rename failed: ${renameErr.message}`);
                                    }
                                }
                            }
                            // 更新所有受影响歌曲的 file_path 和 relative_path
                            for (const song of songs) {
                                if (song.file_path && song.relative_path) {
                                    const oldSeg = fileCache.sanitizePath(oldAlbumName);
                                    const newSeg = fileCache.sanitizePath(newAlbumName);
                                    const newFilePath = song.file_path.replace(oldSeg, newSeg);
                                    const newRelativePath = song.relative_path.replace(oldSeg, newSeg);
                                    if (newFilePath !== song.file_path) {
                                        updateSongFullTags(song.source, song.songId, {
                                            file_path: newFilePath,
                                            relative_path: newRelativePath,
                                        });
                                    }
                                }
                            }
                        }
                        // 3. TAG 写入
                        const WRITABLE_EXTS = ['.mp3', '.flac', '.wav', '.ape', '.dsf', '.m4a', '.ogg'];
                        const CONCURRENCY = 3;
                        // 重新查询获取更新后的歌曲列表
                        const songs = getSongsByAlbumName(albumRenamed ? newAlbumName : oldAlbumName);
                        let tagWriteCount = 0;
                        let tagSkipCount = 0;
                        // 并发控制
                        const processOne = async (song) => {
                            if (!song.filePath || !node_fs_1.default.existsSync(song.filePath)) {
                                tagSkipCount++;
                                return;
                            }
                            const ext = node_path_1.default.extname(song.filePath).toLowerCase();
                            if (!WRITABLE_EXTS.includes(ext)) {
                                tagSkipCount++;
                                return;
                            }
                            try {
                                const opts = {};
                                if (newAlbumName !== undefined)
                                    opts.album = newAlbumName || oldAlbumName;
                                if (singer !== undefined)
                                    opts.artist = singer || undefined;
                                if (year !== undefined)
                                    opts.year = year || undefined;
                                if (genre !== undefined)
                                    opts.genre = genre || undefined;
                                if (discNumber !== undefined)
                                    opts.discNumber = discNumber || undefined;
                                if (discTotal !== undefined)
                                    opts.discTotal = discTotal || undefined;
                                if (albumArtist !== undefined)
                                    opts.albumArtist = albumArtist || undefined;
                                if (composer !== undefined)
                                    opts.composer = composer || undefined;
                                const ok = MusicTagUtil.writeAllTags(song.filePath, opts);
                                if (ok)
                                    tagWriteCount++;
                                else
                                    tagSkipCount++;
                            }
                            catch (e) {
                                console.warn(`[AlbumMeta] Tag write failed for ${song.songId}: ${e.message}`);
                                tagSkipCount++;
                            }
                        };
                        for (let i = 0; i < songs.length; i += CONCURRENCY) {
                            const batch = songs.slice(i, i + CONCURRENCY);
                            await Promise.all(batch.map(processOne));
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({
                            success: true,
                            updatedCount,
                            albumRenamed,
                            tagWriteCount,
                            tagSkipCount,
                        }));
                    }
                    catch (err) {
                        console.error('[AlbumMeta] Update failed:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // ===== 歌手信息 API (Singer Info APIs) =====
            // 9a. 歌手列表 (Singer list)
            if (pathname === '/api/music/singer/list' && req.method === 'GET') {
                const source = urlObj.searchParams.get('source') || '';
                const keyword = urlObj.searchParams.get('keyword') || '';
                const page = parseInt(urlObj.searchParams.get('page') || '1');
                const limit = parseInt(urlObj.searchParams.get('limit') || '24');
                const sort = urlObj.searchParams.get('sort') || 'name';
                const order = urlObj.searchParams.get('order') || 'asc';
                try {
                    const { getAllSingerInfo } = require('../utils/db');
                    const result = getAllSingerInfo({ source, keyword, page, limit, sort, order });
                    // camelCase 转换
                    const list = result.list.map(s => ({
                        singerId: s.singer_id,
                        source: s.source,
                        name: s.name,
                        avatar: s.avatar || '',
                        desc: s.desc || '',
                        gender: s.gender || '',
                        musicCount: s.music_count || 0,
                        albumCount: s.album_count || 0,
                        createdAt: s.created_at || '',
                        updatedAt: s.updated_at || '',
                    }));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: { list, total: result.total, page, limit } }));
                }
                catch (err) {
                    console.error('[SingerList] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: err.message }));
                }
                return;
            }
            // 9b. 同步歌手信息 - 启动异步任务 (Singer sync - start async task)
            if (pathname === '/api/music/singer/sync' && req.method === 'POST') {
                void readBody(req).then(async (body) => {
                    // 解析用户选择的同步阶段，默认两阶段都执行
                    let selectedPhases = [1, 2];
                    try {
                        const parsed = JSON.parse(body);
                        if (Array.isArray(parsed.phases) && parsed.phases.length > 0) {
                            selectedPhases = parsed.phases;
                        }
                    }
                    catch { }
                    const taskId = `singer_sync_${Date.now()}`;
                    // 初始化进度对象
                    const progress = {
                        total: 0, processed: 0, synced: 0, skipped: 0, failed: 0,
                        status: 'running', errors: [],
                        phase: selectedPhases[0] || 1, phase1Total: 0, phase2Total: 0,
                        selectedPhases,
                    };
                    singerSyncTasks.set(taskId, progress);
                    // 立即返回 taskId，后台异步处理
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: { taskId } }));
                    // 后台异步执行同步逻辑（按选择阶段执行）
                    try {
                        const { getUnsyncedSingersWithDetails, getIncompleteSingerInfo, upsertSingerInfo, } = require('../utils/db');
                        let phase1Items = [];
                        let incompleteRecords = [];
                        // ── Phase 1 准备: 新增缺失歌手 ──
                        if (selectedPhases.includes(1)) {
                            const unsyncedRows = getUnsyncedSingersWithDetails();
                            // 按 name 去重（优先级：wy+singer_id > tx+singer_id > 有singer_id > 无singer_id）
                            const dedupMap = new Map();
                            for (const row of unsyncedRows) {
                                const existing = dedupMap.get(row.name);
                                if (!existing) {
                                    dedupMap.set(row.name, row);
                                    continue;
                                }
                                // 评分：有 singer_id +10，wy +2，tx +1
                                const scoreRow = (r) => (r.singer_id ? 10 : 0) + (r.source === 'wy' ? 2 : r.source === 'tx' ? 1 : 0);
                                if (scoreRow(row) > scoreRow(existing))
                                    dedupMap.set(row.name, row);
                            }
                            phase1Items = Array.from(dedupMap.values());
                            progress.phase1Total = phase1Items.length;
                        }
                        // ── Phase 2 准备: 补全不完整记录 ──
                        if (selectedPhases.includes(2)) {
                            incompleteRecords = getIncompleteSingerInfo();
                            progress.phase2Total = incompleteRecords.length;
                        }
                        progress.total = progress.phase1Total + progress.phase2Total;
                        // ── 执行 Phase 1: 新增缺失歌手 ──
                        if (selectedPhases.includes(1)) {
                            progress.phase = 1;
                            for (const item of phase1Items) {
                                try {
                                    let info = null;
                                    // 优先使用 singer_id 直接调用 SDK（仅需 1 次 API 调用）
                                    if (item.singer_id && (item.source === 'tx' || item.source === 'wy')) {
                                        try {
                                            if (musicSdk[item.source]?.extendDetail?.getArtistDetail) {
                                                const detail = await musicSdk[item.source].extendDetail.getArtistDetail(item.singer_id);
                                                if (detail) {
                                                    info = {
                                                        source: detail.source || item.source,
                                                        singerId: String(detail.id),
                                                        name: detail.name || item.name,
                                                        avatar: detail.avatar || '',
                                                        desc: detail.desc || '',
                                                        gender: detail.gender || '',
                                                        musicCount: detail.musicSize || 0,
                                                        albumCount: detail.albumSize || 0,
                                                    };
                                                }
                                            }
                                        }
                                        catch (directErr) {
                                            // SDK 直接调用失败，降级到名字搜索
                                        }
                                    }
                                    // 降级：名字搜索（需要 2-4 次 API 调用）
                                    if (!info) {
                                        info = await musicSdk.searchSingerInfoStrict(item.name);
                                    }
                                    if (info) {
                                        upsertSingerInfo({
                                            singer_id: info.singerId,
                                            source: info.source,
                                            name: info.name || item.name,
                                            avatar: info.avatar,
                                            desc: info.desc,
                                            gender: info.gender,
                                            music_count: info.musicCount,
                                            album_count: info.albumCount,
                                        });
                                        progress.synced++;
                                    }
                                    else {
                                        progress.failed++;
                                        progress.errors.push(`${item.name}: 所有方式查询失败`);
                                    }
                                }
                                catch (err) {
                                    progress.failed++;
                                    progress.errors.push(`${item.name}: ${err.message}`);
                                }
                                progress.processed++;
                            }
                        }
                        // ── 执行 Phase 2: 补全不完整记录 ──
                        if (selectedPhases.includes(2)) {
                            progress.phase = 2;
                            for (const record of incompleteRecords) {
                                try {
                                    if (musicSdk[record.source]?.extendDetail?.getArtistDetail) {
                                        const detail = await musicSdk[record.source].extendDetail.getArtistDetail(record.singer_id);
                                        if (detail) {
                                            upsertSingerInfo({
                                                singer_id: String(detail.id) || record.singer_id,
                                                source: detail.source || record.source,
                                                name: detail.name || record.name,
                                                avatar: detail.avatar || '',
                                                desc: detail.desc || '',
                                                gender: detail.gender || '',
                                                music_count: detail.musicSize || 0,
                                                album_count: detail.albumSize || 0,
                                            });
                                            progress.synced++;
                                        }
                                        else {
                                            progress.failed++;
                                            progress.errors.push(`${record.name}(${record.source}): Phase2 查询返回空`);
                                        }
                                    }
                                    else {
                                        progress.failed++;
                                        progress.errors.push(`${record.name}(${record.source}): SDK 不支持`);
                                    }
                                }
                                catch (err) {
                                    progress.failed++;
                                    progress.errors.push(`${record.name}(${record.source}): Phase2 ${err.message}`);
                                }
                                progress.processed++;
                            }
                        }
                        progress.status = 'done';
                    }
                    catch (err) {
                        console.error('[SingerSync] Task failed:', err.message);
                        progress.status = 'error';
                        progress.errors.push(`Task error: ${err.message}`);
                    }
                });
                return;
            }
            // 9c. 同步进度轮询 (Singer sync progress polling)
            if (pathname === '/api/music/singer/sync-progress' && req.method === 'GET') {
                const taskId = urlObj.searchParams.get('taskId') || '';
                const progress = singerSyncTasks.get(taskId);
                if (!progress) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: 'Task not found' }));
                    return;
                }
                // 任务完成后，延迟清理 (保留 30 秒供客户端读取最终结果)
                if (progress.status === 'done' || progress.status === 'error') {
                    setTimeout(() => singerSyncTasks.delete(taskId), 30000);
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ code: 0, data: progress }));
                return;
            }
            // 9d. 歌手关联专辑 (Singer's albums)
            if (pathname === '/api/music/singer/albums' && req.method === 'GET') {
                const singerName = urlObj.searchParams.get('singerName') || '';
                if (!singerName) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: 'Missing singerName parameter' }));
                    return;
                }
                try {
                    const { getSingerDownloadRecords } = require('../utils/db');
                    const songs = getSingerDownloadRecords(singerName);
                    // 按 album 分组
                    const albumMap = new Map();
                    for (const song of songs) {
                        const albumName = song.album || '未知专辑';
                        if (!albumMap.has(albumName)) {
                            albumMap.set(albumName, {
                                name: albumName,
                                singer: song.singer,
                                songs: [],
                                cover: `/api/music/cache/cover?filename=${encodeURIComponent(song.relativePath)}&source=${song.source}`,
                                latestMtime: song.mtime || '',
                                img: song.img,
                                source: song.source,
                            });
                        }
                        const album = albumMap.get(albumName);
                        album.songs.push(song);
                        // 更新封面和最新时间
                        /*   if (song.hasCover && !album.cover) {
                             album.cover = `/api/music/cache/cover?filename=${encodeURIComponent(song.filename)}`
                           }*/
                        if (song.mtime && song.mtime > album.latestMtime) {
                            album.latestMtime = song.mtime;
                        }
                    }
                    const albums = Array.from(albumMap.values()).sort((a, b) => b.latestMtime.localeCompare(a.latestMtime));
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: albums, singerName }));
                }
                catch (err) {
                    console.error('[SingerAlbums] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: err.message }));
                }
                return;
            }
            // 9e. 删除歌手信息 (Delete singer info)
            if (pathname === '/api/music/singer' && req.method === 'DELETE') {
                try {
                    const rawBody = await readBody(req);
                    const { singerName, source, singerId, deleteSongs } = JSON.parse(rawBody);
                    if (!singerName || !source) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ code: -1, msg: 'Missing singerName or source' }));
                        return;
                    }
                    const { deleteSingerInfo, getSingerDownloadRecords } = require('../utils/db');
                    // 先查询关联歌曲（用于后续删除文件和 DB 记录）
                    let deletedSongs = 0;
                    if (deleteSongs) {
                        const songs = getSingerDownloadRecords(singerName);
                        deletedSongs = songs.length;
                        // 删除磁盘文件
                        for (const song of songs) {
                            if (song.filePath) {
                                try {
                                    const musicDir = node_path_1.default.join(process.cwd(), 'music');
                                    const fullPath = node_path_1.default.join(musicDir, song.filePath);
                                    if (node_fs_1.default.existsSync(fullPath)) {
                                        node_fs_1.default.unlinkSync(fullPath);
                                        console.log('[SingerDelete] Deleted file:', fullPath);
                                    }
                                }
                                catch (fileErr) {
                                    console.error('[SingerDelete] Failed to delete file:', fileErr.message);
                                }
                            }
                        }
                        // 删除 download_records 中的记录（使用 singerName 精确匹配 + LIKE 多歌手匹配）
                        const db = require('../utils/db-core').getDbInstance();
                        if (db) {
                            db.run(`
                DELETE FROM download_records
                WHERE status = 'finished'
                  AND (singer = ? OR singer LIKE ? OR singer LIKE ? OR singer LIKE ?)
              `, [singerName, `${singerName}、%`, `%、${singerName}`, `%、${singerName}、%`]);
                            require('../utils/db-core').saveDatabase();
                        }
                    }
                    // 删除 singer_info 记录（按 name 删除）
                    const success = deleteSingerInfo(singerName || '');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: { deletedSinger: success, deletedSongs } }));
                }
                catch (err) {
                    console.error('[SingerDelete] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: err.message }));
                }
                return;
            }
            // 9f. 手动编辑歌手信息 (Manual edit singer info)
            if (pathname === '/api/music/singer' && req.method === 'PUT') {
                try {
                    const rawBody = await readBody(req);
                    const { singerName, source, singerId, fields } = JSON.parse(rawBody);
                    if (!singerName || !source || !fields) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ code: -1, msg: 'Missing required parameters' }));
                        return;
                    }
                    const { updateSingerFieldsByName, getSingerInfoByName } = require('../utils/db');
                    const existingList = getSingerInfoByName(singerName);
                    const existing = existingList[0];
                    if (!existing) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ code: -1, msg: 'Singer not found' }));
                        return;
                    }
                    // 手动编辑：直接写入用户提交值（空值即清空，不保留原值）
                    updateSingerFieldsByName(singerName, {
                        name: fields.name || existing.name,
                        source: source,
                        singer_id: singerId !== undefined ? singerId : (existing.singer_id || ''),
                        avatar: fields.avatar || '',
                        desc: fields.desc !== undefined ? fields.desc : (existing.desc || ''),
                        gender: fields.gender !== undefined ? fields.gender : (existing.gender || ''),
                        music_count: fields.musicCount !== undefined ? fields.musicCount : (existing.music_count || 0),
                        album_count: fields.albumCount !== undefined ? fields.albumCount : (existing.album_count || 0),
                    });
                    // 返回更新后的信息
                    const updatedList = getSingerInfoByName(singerName);
                    const updated = updatedList[0];
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: {
                            singer: updated ? {
                                singerId: updated.singer_id,
                                source: updated.source,
                                name: updated.name,
                                avatar: updated.avatar || '',
                                desc: updated.desc || '',
                                gender: updated.gender || '',
                                musicCount: updated.music_count || 0,
                                albumCount: updated.album_count || 0,
                            } : null
                        } }));
                }
                catch (err) {
                    console.error('[SingerEdit] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: err.message }));
                }
                return;
            }
            // 9g. SDK 更新歌手信息 (Update singer via SDK for tx/wy sources)
            if (pathname === '/api/music/singer/update' && req.method === 'POST') {
                try {
                    const rawBody = await readBody(req);
                    const { singerName, source, singerId } = JSON.parse(rawBody);
                    if (!singerName || !source || !singerId) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ code: -1, msg: 'Missing required parameters' }));
                        return;
                    }
                    if (source !== 'tx' && source !== 'wy') {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ code: -1, msg: 'Source must be tx or wy' }));
                        return;
                    }
                    // 使用 SDK 获取最新歌手信息
                    let detail = null;
                    try {
                        if (musicSdk[source] && musicSdk[source].extendDetail && musicSdk[source].extendDetail.getArtistDetail) {
                            detail = await musicSdk[source].extendDetail.getArtistDetail(singerId);
                        }
                    }
                    catch (sdkErr) {
                        console.error(`[SingerUpdate] SDK call failed for ${source}:`, sdkErr.message);
                    }
                    if (!detail) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ code: -1, msg: `Failed to get artist detail from ${source}` }));
                        return;
                    }
                    const { upsertSingerInfo } = require('../utils/db');
                    upsertSingerInfo({
                        singer_id: String(detail.id || singerId),
                        source: source,
                        name: detail.name || singerName,
                        avatar: detail.avatar || '',
                        desc: detail.desc || '',
                        gender: detail.gender || '',
                        music_count: detail.musicSize || 0,
                        album_count: detail.albumSize || 0,
                    });
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: {
                            singer: {
                                singerId: String(detail.id || singerId),
                                source,
                                name: detail.name || singerName,
                                avatar: detail.avatar || '',
                                desc: detail.desc || '',
                                gender: detail.gender || '',
                                musicCount: detail.musicSize || 0,
                                albumCount: detail.albumSize || 0,
                            }
                        } }));
                }
                catch (err) {
                    console.error('[SingerUpdate] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: err.message }));
                }
                return;
            }
            // 9h. 跨源搜索歌手 (Cross-source singer search)
            if (pathname === '/api/music/singer/search-external' && req.method === 'GET') {
                const name = urlObj.searchParams.get('name') || '';
                if (!name) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: 'Missing name parameter' }));
                    return;
                }
                try {
                    const results = [];
                    // 并行搜索 WY 和 TX
                    const searchTasks = [];
                    const sources = ['wy', 'tx'];
                    for (const src of sources) {
                        searchTasks.push((async () => {
                            try {
                                if (musicSdk[src] && musicSdk[src].extendSearch && musicSdk[src].extendSearch.searchSinger) {
                                    const result = await musicSdk[src].extendSearch.searchSinger(name, 1, 10);
                                    if (result && result.list && result.list.length > 0) {
                                        for (const item of result.list) {
                                            results.push({
                                                id: String(item.id || ''),
                                                name: item.name || '',
                                                picUrl: item.picUrl || '',
                                                albumSize: item.albumSize || 0,
                                                source: src,
                                            });
                                        }
                                    }
                                }
                            }
                            catch (srcErr) {
                                console.error(`[SingerSearchExternal] ${src.toUpperCase()} search failed:`, srcErr.message);
                            }
                        })());
                    }
                    await Promise.all(searchTasks);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: 0, data: { list: results } }));
                }
                catch (err) {
                    console.error('[SingerSearchExternal] Failed:', err.message);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ code: -1, msg: err.message }));
                }
                return;
            }
            // 8c. Update Song Name
            if (pathname === '/api/music/cache/update-song-name' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                void readBody(req).then(body => {
                    try {
                        const { songId, newName } = JSON.parse(body);
                        if (!songId || !newName) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false, message: 'Missing songId or newName' }));
                            return;
                        }
                        const { updateSongNameInDB } = require('../utils/db');
                        // songId 格式为 "source_songId", 需要拆分
                        const songIdStr = String(songId);
                        const underscoreIdx = songIdStr.indexOf('_');
                        const source = underscoreIdx > 0 ? songIdStr.substring(0, underscoreIdx) : 'unknown';
                        const rawSongId = underscoreIdx > 0 ? songIdStr.substring(underscoreIdx + 1) : songIdStr;
                        updateSongNameInDB(source, rawSongId, newName);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Song name updated successfully' }));
                    }
                    catch (err) {
                        console.error('[UpdateSongName] Failed:', err.message);
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // 8. Get Cache Cover
            if (pathname === '/api/music/cache/cover' && req.method === 'GET') {
                const reqUsername = req.headers['x-user-name'] || urlObj.searchParams.get('user') || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    // <img src> 无法携带自定义请求头，允许从 URL ?token= 参数读取 Token 作为补偿
                    const urlToken = urlObj.searchParams.get('token');
                    if (urlToken && !req.headers['x-user-token']) {
                        req.headers['x-user-token'] = urlToken;
                    }
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401);
                        res.end('Unauthorized');
                        return;
                    }
                    username = verified;
                }
                const filename = urlObj.searchParams.get('filename');
                if (!filename) {
                    res.writeHead(400);
                    res.end('Missing filename');
                    return;
                }
                // 本地库封面: 从专辑目录查找
                const source = urlObj.searchParams.get('source') || '';
                const relativePath = urlObj.searchParams.get('relativePath') || '';
                if (source === 'local' && relativePath) {
                    try {
                        const localCover = localLibrary.findAlbumCoverForSong(source, relativePath);
                        if (localCover && localCover.data) {
                            res.writeHead(200, {
                                'Content-Type': localCover.mime || 'image/jpeg',
                                'Cache-Control': 'public, max-age=86400'
                            });
                            res.end(localCover.data);
                            return;
                        }
                    }
                    catch (e) {
                        // 本地封面查找失败，降级到默认逻辑
                    }
                }
                const cover = fileCache.getCacheCover(filename);
                if (cover && cover.data) {
                    res.writeHead(200, {
                        'Content-Type': cover.mime || 'image/jpeg',
                        'Cache-Control': 'public, max-age=86400'
                    });
                    res.end(cover.data);
                }
                else {
                    // Fallback to default logo when no cover found
                    try {
                        const defaultCoverPath = node_path_1.default.join(__dirname, '../../public/music/assets/logo.svg');
                        const defaultCover = node_fs_1.default.readFileSync(defaultCoverPath);
                        res.writeHead(200, {
                            'Content-Type': 'image/svg+xml',
                            'Cache-Control': 'public, max-age=86400'
                        });
                        res.end(defaultCover);
                    }
                    catch (e) {
                        // If default logo also fails, return 404
                        res.writeHead(404);
                        res.end('Not Found');
                    }
                }
                return;
            }
            // ===== TAG 编辑 API (Tag Editor API) =====
            // 读取歌曲TAG (Read song TAG from audio file)
            if (pathname === '/api/music/tag/read' && req.method === 'GET') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                const relativePath = urlObj.searchParams.get('relativePath') || '';
                if (!relativePath) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing relativePath' }));
                    return;
                }
                const { getDownloadRecordByRelativePath } = require('../utils/db');
                const record = getDownloadRecordByRelativePath(relativePath);
                if (!record || !record.file_path) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Record not found' }));
                    return;
                }
                const filePath = record.file_path;
                if (!node_fs_1.default.existsSync(filePath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'File not found on disk' }));
                    return;
                }
                try {
                    const tags = MusicTagUtil.readExtendedTags(filePath);
                    const hasCover = MusicTagUtil.hasEmbeddedCover(filePath);
                    const ext = node_path_1.default.extname(filePath).toLowerCase();
                    const WRITABLE_EXTS = ['.mp3', '.flac', '.wav', '.ape', '.dsf', '.m4a', '.ogg'];
                    const writable = WRITABLE_EXTS.includes(ext);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        data: {
                            title: tags.title || '',
                            artist: tags.artist || '',
                            album: tags.album || '',
                            year: tags.year || null,
                            genre: tags.genre || '',
                            trackNumber: tags.trackNumber || null,
                            discNumber: tags.discNumber || null,
                            discTotal: tags.discTotal || null,
                            audioQuality: tags.audioQuality || '',
                            albumArtist: tags.albumArtist || '',
                            composer: tags.composer || '',
                            duration: tags.duration || null,
                            sampleRate: tags.sampleRate || null,
                            bitDepth: tags.bitDepth || null,
                            channels: tags.channels || null,
                            bitRate: tags.bitRate || null,
                            hasCover,
                            writable,
                        }
                    }));
                }
                catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
                return;
            }
            // 写入歌曲TAG (Write song TAG to audio file and update DB)
            if (pathname === '/api/music/tag/write' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                let body;
                try {
                    body = JSON.parse(await readBody(req));
                }
                catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Invalid JSON' }));
                    return;
                }
                const { relativePath, source, tags, renameFile } = body;
                if (!relativePath) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Missing relativePath' }));
                    return;
                }
                const { getDownloadRecordByRelativePath, updateSongFullTags } = require('../utils/db');
                const record = getDownloadRecordByRelativePath(relativePath);
                if (!record || !record.file_path) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Record not found' }));
                    return;
                }
                const filePath = record.file_path;
                if (!node_fs_1.default.existsSync(filePath)) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'File not found on disk' }));
                    return;
                }
                const ext = node_path_1.default.extname(filePath).toLowerCase();
                const WRITABLE_EXTS = ['.mp3', '.flac', '.wav', '.ape', '.dsf', '.m4a', '.ogg'];
                if (!WRITABLE_EXTS.includes(ext)) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: `Format ${ext} does not support tag writing` }));
                    return;
                }
                try {
                    // 写入音频文件标签
                    const writeOk = MusicTagUtil.writeAllTags(filePath, tags || {});
                    if (!writeOk) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Failed to write tags to audio file' }));
                        return;
                    }
                    // 更新 DB
                    const dbUpdates = {};
                    if (tags) {
                        if (tags.title !== undefined)
                            dbUpdates.song_name = tags.title;
                        if (tags.artist !== undefined)
                            dbUpdates.singer = tags.artist;
                        if (tags.album !== undefined)
                            dbUpdates.album = tags.album;
                        if (tags.year !== undefined)
                            dbUpdates.year = tags.year ? parseInt(String(tags.year)) : null;
                        if (tags.genre !== undefined)
                            dbUpdates.genre = tags.genre;
                        if (tags.trackNumber !== undefined)
                            dbUpdates.track_number = tags.trackNumber ? parseInt(String(tags.trackNumber)) : null;
                        if (tags.discNumber !== undefined)
                            dbUpdates.disc_number = tags.discNumber ? parseInt(String(tags.discNumber)) : null;
                        if (tags.discTotal !== undefined)
                            dbUpdates.disc_total = tags.discTotal ? parseInt(String(tags.discTotal)) : null;
                        if (tags.audioQuality !== undefined)
                            dbUpdates.audio_quality = tags.audioQuality;
                        if (tags.albumArtist !== undefined)
                            dbUpdates.album_artist = tags.albumArtist;
                        if (tags.composer !== undefined)
                            dbUpdates.composer = tags.composer;
                    }
                    // 文件重命名逻辑
                    let newRelativePath = relativePath;
                    let newFilePath = filePath;
                    if (renameFile && tags) {
                        const oldName = record.song_name || '';
                        const oldSinger = record.singer || '';
                        const oldAlbum = record.album || '';
                        const newName = tags.title !== undefined ? tags.title : oldName;
                        const newSinger = tags.artist !== undefined ? tags.artist : oldSinger;
                        const newAlbum = tags.album !== undefined ? tags.album : oldAlbum;
                        if (newName !== oldName || newSinger !== oldSinger || newAlbum !== oldAlbum) {
                            const sanitize = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '_').trim().replace(/^\.+/, '');
                            const sName = sanitize(newName || 'Unknown');
                            const sSinger = sanitize(newSinger || 'Unknown');
                            const sAlbum = sanitize(newAlbum || 'Unknown');
                            // 构建新文件名: name(singer).ext 或 name.ext
                            const newFileName = (sSinger && sSinger !== '群星' && sSinger !== 'Unknown')
                                ? `${sName}(${sSinger})${ext}`
                                : `${sName}${ext}`;
                            // 解析旧文件所在的 music 根目录
                            const oldRelPath = node_path_1.default.dirname(relativePath);
                            const oldAlbumDir = oldRelPath.split('/')[0] || '';
                            const musicBaseDir = filePath.substring(0, filePath.indexOf(node_path_1.default.sep + oldAlbumDir + node_path_1.default.sep));
                            const newAlbumDir = sAlbum;
                            const newDir = node_path_1.default.join(musicBaseDir, newAlbumDir);
                            newFilePath = node_path_1.default.join(newDir, newFileName);
                            newRelativePath = node_path_1.default.join(newAlbumDir, newFileName).replace(/\\/g, '/');
                            if (newFilePath !== filePath) {
                                try {
                                    node_fs_1.default.mkdirSync(newDir, { recursive: true });
                                    if (node_fs_1.default.existsSync(newFilePath) && newFilePath !== filePath) {
                                        // 目标文件已存在且不等于当前文件
                                        res.writeHead(409, { 'Content-Type': 'application/json' });
                                        res.end(JSON.stringify({ success: false, message: 'Target file already exists' }));
                                        return;
                                    }
                                    node_fs_1.default.renameSync(filePath, newFilePath);
                                    dbUpdates.file_path = newFilePath;
                                    dbUpdates.relative_path = newRelativePath;
                                    // 清理旧目录（如果为空）
                                    const oldDir = node_path_1.default.dirname(filePath);
                                    try {
                                        if (node_fs_1.default.existsSync(oldDir) && node_fs_1.default.readdirSync(oldDir).length === 0) {
                                            node_fs_1.default.rmdirSync(oldDir);
                                        }
                                    }
                                    catch { }
                                }
                                catch (renameErr) {
                                    // 回滚：移回原位
                                    try {
                                        node_fs_1.default.renameSync(newFilePath, filePath);
                                    }
                                    catch { }
                                    res.writeHead(500, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: false, message: `File rename failed: ${renameErr.message}` }));
                                    return;
                                }
                            }
                        }
                    }
                    updateSongFullTags(record.source || 'unknown', record.song_id, dbUpdates);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        success: true,
                        data: {
                            oldRelativePath: relativePath,
                            newRelativePath,
                            renamed: newRelativePath !== relativePath,
                        }
                    }));
                }
                catch (err) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: err.message }));
                }
                return;
            }
            // 上传封面 (Upload cover image to audio file)
            if (pathname === '/api/music/tag/cover' && req.method === 'POST') {
                const username = verifyUserAuth(req);
                if (!username) {
                    res.writeHead(401, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                    return;
                }
                const form = (0, formidable_1.default)({ multiples: false, uploadDir: node_os_1.default.tmpdir(), maxFileSize: 5 * 1024 * 1024 });
                form.parse(req, async (err, fields, files) => {
                    if (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Upload error: ' + err.message }));
                        return;
                    }
                    // formidable v3 返回的值可能是数组
                    const relativePath = Array.isArray(fields.relativePath) ? fields.relativePath[0] : fields.relativePath;
                    if (!relativePath) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Missing relativePath' }));
                        return;
                    }
                    // formidable v3 返回的值是数组
                    const rawCoverFile = files.cover || Object.values(files)[0];
                    const coverFile = Array.isArray(rawCoverFile) ? rawCoverFile[0] : rawCoverFile;
                    if (!coverFile) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Missing cover file' }));
                        return;
                    }
                    const { getDownloadRecordByRelativePath, updateSongFullTags } = require('../utils/db');
                    const record = getDownloadRecordByRelativePath(relativePath);
                    if (!record || !record.file_path) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Record not found' }));
                        return;
                    }
                    const filePath = record.file_path;
                    if (!node_fs_1.default.existsSync(filePath)) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'File not found on disk' }));
                        return;
                    }
                    try {
                        const coverData = node_fs_1.default.readFileSync(coverFile.filepath);
                        const mime = coverFile.mimetype || 'image/jpeg';
                        MusicTagUtil.withTaggerSave(filePath, (tagger, createMetaPicture) => {
                            tagger.pictures = [createMetaPicture(mime, coverData)];
                        });
                        // 更新 DB has_cover 标记
                        updateSongFullTags(record.source || 'unknown', record.song_id, { has_cover: true });
                        // 清理临时文件
                        try {
                            node_fs_1.default.unlinkSync(coverFile.filepath);
                        }
                        catch { }
                        // 封面变更后清空封面缓存
                        fileCache.clearCoverCache();
                        localLibrary.clearCoverCache();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, message: 'Cover updated successfully' }));
                    }
                    catch (err) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // ===== UPNP/DLNA API =====
            // GENA NOTIFY 回调端点 — DMR 主动推送事件到此处
            // 此端点不需要认证（DMR 无法携带 token）
            if (pathname === '/api/upnp/event' && req.method === 'NOTIFY') {
                return dlnaService.handleGenaEvent(req, res);
            }
            // Scan for UPNP MediaRenderer devices
            if (pathname === '/api/upnp/scan' && req.method === 'POST') {
                return dlnaService.handleScanDevices(req, res);
            }
            // Get cached UPNP devices (no scan, instant)
            if (pathname === '/api/upnp/devices' && req.method === 'GET') {
                return dlnaService.handleGetDevices(req, res);
            }
            // ===== CAST STATE API (cross-client persistence) =====
            // Get current cast connection state
            if (pathname === '/api/cast/state' && req.method === 'GET') {
                return dlnaService.handleCastState(req, res);
            }
            // ===== END CAST STATE API =====
            // UPNP Play: Set URI and start playback on a device
            if (pathname === '/api/upnp/play' && req.method === 'POST') {
                return dlnaService.handleUpnpPlay(req, res);
            }
            // UPNP Pause
            if (pathname === '/api/upnp/pause' && req.method === 'POST') {
                return dlnaService.handleUpnpPause(req, res);
            }
            // UPNP Resume (Play after pause)
            if (pathname === '/api/upnp/resume' && req.method === 'POST') {
                return dlnaService.handleUpnpResume(req, res);
            }
            // UPNP Stop
            if (pathname === '/api/upnp/stop' && req.method === 'POST') {
                return dlnaService.handleUpnpStop(req, res);
            }
            // UPNP Seek
            if (pathname === '/api/upnp/seek' && req.method === 'POST') {
                return dlnaService.handleUpnpSeek(req, res);
            }
            // UPNP Set Volume
            if (pathname === '/api/upnp/volume' && req.method === 'POST') {
                return dlnaService.handleUpnpSetVolume(req, res);
            }
            // UPNP Get Volume
            if (pathname === '/api/upnp/volume' && req.method === 'GET') {
                return dlnaService.handleUpnpGetVolume(req, res, urlObj);
            }
            // UPNP Get Transport Status (play state + position)
            if (pathname === '/api/upnp/status' && req.method === 'GET') {
                return dlnaService.handleUpnpStatus(req, res, urlObj);
            }
            // UPNP Set Next Track (preload for seamless transition / device Next button)
            if (pathname === '/api/upnp/setNext' && req.method === 'POST') {
                return dlnaService.handleUpnpSetNext(req, res);
            }
            // UPNP Next Track
            if (pathname === '/api/upnp/next' && req.method === 'POST') {
                return dlnaService.handleUpnpNext(req, res);
            }
            // UPNP Previous Track
            if (pathname === '/api/upnp/previous' && req.method === 'POST') {
                return dlnaService.handleUpnpPrevious(req, res);
            }
            // ===== END UPNP API =====
            // ===== DLNA DMS (Media Server) 浏览 API =====
            // 扫描局域网 DMS 设备 (Scan for DLNA Media Server devices)
            if (pathname === '/api/dms/scan' && req.method === 'POST') {
                return void (0, commonUtils_1.safeAsync)(res, async () => {
                    const devices = await dlnaDms.scanDmsDevices();
                    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices });
                }, 'DMS Scan');
            }
            // 获取已发现的 DMS 设备列表 (Get cached DMS devices)
            if (pathname === '/api/dms/devices' && req.method === 'GET') {
                const devices = dlnaDms.getCachedDmsDevices();
                return (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices });
            }
            // 浏览 DMS 容器内容 (Browse DMS container)
            if (pathname === '/api/dms/browse' && req.method === 'GET') {
                return void (0, commonUtils_1.safeAsync)(res, async () => {
                    const deviceId = urlObj.searchParams.get('deviceId') || '';
                    const objectId = urlObj.searchParams.get('objectId') || '0';
                    const start = parseInt(urlObj.searchParams.get('start') || '0', 10);
                    const count = parseInt(urlObj.searchParams.get('count') || '100', 10);
                    if (!deviceId) {
                        return (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: '缺少 deviceId 参数' });
                    }
                    const result = await dlnaDms.browseContainer(deviceId, objectId, start, count);
                    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, ...result });
                }, 'DMS Browse');
            }
            // 获取 DMS 顶层分类 (Get DMS top-level categories)
            if (pathname === '/api/dms/categories' && req.method === 'GET') {
                return void (0, commonUtils_1.safeAsync)(res, async () => {
                    const deviceId = urlObj.searchParams.get('deviceId') || '';
                    if (!deviceId) {
                        return (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: '缺少 deviceId 参数' });
                    }
                    const categories = await dlnaDms.getBrowseCategories(deviceId);
                    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, categories });
                }, 'DMS Categories');
            }
            // 搜索 DMS 内容 (Search DMS content)
            if (pathname === '/api/dms/search' && req.method === 'GET') {
                return void (0, commonUtils_1.safeAsync)(res, async () => {
                    const deviceId = urlObj.searchParams.get('deviceId') || '';
                    const keyword = urlObj.searchParams.get('keyword') || '';
                    const start = parseInt(urlObj.searchParams.get('start') || '0', 10);
                    const count = parseInt(urlObj.searchParams.get('count') || '100', 10);
                    if (!deviceId) {
                        return (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: '缺少 deviceId 参数' });
                    }
                    if (!keyword) {
                        return (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: '缺少 keyword 参数' });
                    }
                    const result = await dlnaDms.searchDms(deviceId, keyword, start, count);
                    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, ...result });
                }, 'DMS Search');
            }
            // DMS 媒体代理 (Proxy DMS media stream through server for browser playback)
            if (pathname === '/api/dms/media-proxy' && req.method === 'GET') {
                const targetUrl = urlObj.searchParams.get('url') || '';
                if (!targetUrl) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Missing url parameter');
                    return;
                }
                // 安全校验: 仅允许 http/https 协议
                if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid URL protocol');
                    return;
                }
                try {
                    const parsedTarget = new URL(targetUrl);
                    const isHttps = parsedTarget.protocol === 'https:';
                    const httpModule = isHttps ? require('node:https') : node_http_1.default;
                    // 转发 Range 头以支持断点续传/拖动进度条
                    const proxyHeaders = {};
                    if (req.headers.range) {
                        proxyHeaders['Range'] = req.headers.range;
                    }
                    const proxyReq = httpModule.get({
                        hostname: parsedTarget.hostname,
                        port: parsedTarget.port || (isHttps ? 443 : 80),
                        path: parsedTarget.pathname + parsedTarget.search,
                        headers: proxyHeaders,
                        timeout: 30000,
                    }, (proxyRes) => {
                        // 透传响应头和状态码 (200 或 206 Partial Content)
                        const responseHeaders = {};
                        const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
                        for (const h of passHeaders) {
                            if (proxyRes.headers[h]) {
                                responseHeaders[h] = String(proxyRes.headers[h]);
                            }
                        }
                        // 确保浏览器可以跨域访问
                        responseHeaders['Access-Control-Allow-Origin'] = '*';
                        responseHeaders['Accept-Ranges'] = 'bytes';
                        res.writeHead(proxyRes.statusCode || 200, responseHeaders);
                        proxyRes.pipe(res);
                    });
                    proxyReq.on('error', (err) => {
                        console.error('[DMS Proxy] 请求失败:', targetUrl, err.message);
                        if (!res.headersSent) {
                            res.writeHead(502, { 'Content-Type': 'text/plain' });
                            res.end(`DMS proxy error: ${err.message}`);
                        }
                    });
                    proxyReq.on('timeout', () => {
                        proxyReq.destroy();
                        if (!res.headersSent) {
                            res.writeHead(504, { 'Content-Type': 'text/plain' });
                            res.end('DMS proxy timeout');
                        }
                    });
                    // 客户端断开时终止代理请求
                    req.on('close', () => {
                        proxyReq.destroy();
                    });
                }
                catch (err) {
                    console.error('[DMS Proxy] URL 解析失败:', targetUrl, err.message);
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end('Invalid URL');
                }
                return;
            }
            // ===== END DLNA DMS API =====
            // ===== DLNA DMC HTTP API (WS 的 HTTP 降级) =====
            // 连接 DMR 设备
            if (pathname === '/api/dlna/connect' && req.method === 'POST') {
                return dlnaService.handleDlnaConnect(req, res);
            }
            // 断开 DMR 设备
            if (pathname === '/api/dlna/disconnect' && req.method === 'POST') {
                return dlnaService.handleDlnaDisconnect(req, res);
            }
            // 获取 DMC 完整状态
            if (pathname === '/api/dlna/state' && req.method === 'GET') {
                return dlnaService.handleDlnaState(req, res);
            }
            // DMC 播放歌曲
            if (pathname === '/api/dlna/play' && req.method === 'POST') {
                return dlnaService.handleDlnaPlay(req, res);
            }
            // DMC 暂停
            if (pathname === '/api/dlna/pause' && req.method === 'POST') {
                return dlnaService.handleDlnaPause(req, res);
            }
            // DMC 恢复
            if (pathname === '/api/dlna/resume' && req.method === 'POST') {
                return dlnaService.handleDlnaResume(req, res);
            }
            // DMC 停止
            if (pathname === '/api/dlna/stop' && req.method === 'POST') {
                return dlnaService.handleDlnaStop(req, res);
            }
            // DMC 跳转进度
            if (pathname === '/api/dlna/seek' && req.method === 'POST') {
                return dlnaService.handleDlnaSeek(req, res);
            }
            // DMC 设置音量
            if (pathname === '/api/dlna/volume' && req.method === 'POST') {
                return dlnaService.handleDlnaVolume(req, res);
            }
            // DMC 下一首
            if (pathname === '/api/dlna/next' && req.method === 'POST') {
                return dlnaService.handleDlnaNext(req, res);
            }
            // DMC 上一首
            if (pathname === '/api/dlna/previous' && req.method === 'POST') {
                return dlnaService.handleDlnaPrevious(req, res);
            }
            // DMC 设置播放列表
            if (pathname === '/api/dlna/playlist' && req.method === 'POST') {
                return dlnaService.handleDlnaPlaylist(req, res);
            }
            // DMC 音频代理（将在线 URL 代理给 DMR，确保局域网可达）
            if (pathname.startsWith('/api/dlna/proxy') && req.method === 'GET') {
                return dlnaService.handleDlnaProxy(req, res, urlObj);
            }
            // ===== END DLNA DMC HTTP API =====
            // ===== AirPlay HTTP API =====
            // 扫描 AirPlay 设备 (mDNS)
            if (pathname === '/api/airplay/scan' && req.method === 'POST') {
                return airplayService.handleScanDevices(req, res);
            }
            // 获取缓存的 AirPlay 设备
            if (pathname === '/api/airplay/devices' && req.method === 'GET') {
                return airplayService.handleGetDevices(req, res);
            }
            // 连接 AirPlay 设备
            if (pathname === '/api/airplay/connect' && req.method === 'POST') {
                return airplayService.handleConnect(req, res);
            }
            // 断开 AirPlay 设备
            if (pathname === '/api/airplay/disconnect' && req.method === 'POST') {
                return airplayService.handleDisconnect(req, res);
            }
            // 获取 AirPlay DMC 完整状态
            if (pathname === '/api/airplay/state' && req.method === 'GET') {
                return airplayService.handleState(req, res);
            }
            // AirPlay 播放歌曲
            if (pathname === '/api/airplay/play' && req.method === 'POST') {
                return airplayService.handlePlay(req, res);
            }
            // AirPlay 暂停
            if (pathname === '/api/airplay/pause' && req.method === 'POST') {
                return airplayService.handlePause(req, res);
            }
            // AirPlay 恢复播放
            if (pathname === '/api/airplay/resume' && req.method === 'POST') {
                return airplayService.handleResume(req, res);
            }
            // AirPlay 停止
            if (pathname === '/api/airplay/stop' && req.method === 'POST') {
                return airplayService.handleStop(req, res);
            }
            // AirPlay 跳转进度
            if (pathname === '/api/airplay/seek' && req.method === 'POST') {
                return airplayService.handleSeek(req, res);
            }
            // AirPlay 设置音量
            if (pathname === '/api/airplay/volume' && req.method === 'POST') {
                return airplayService.handleVolume(req, res);
            }
            // AirPlay 下一首
            if (pathname === '/api/airplay/next' && req.method === 'POST') {
                return airplayService.handleNext(req, res);
            }
            // AirPlay 上一首
            if (pathname === '/api/airplay/previous' && req.method === 'POST') {
                return airplayService.handlePrevious(req, res);
            }
            // AirPlay 设置播放列表
            if (pathname === '/api/airplay/playlist' && req.method === 'POST') {
                return airplayService.handlePlaylist(req, res);
            }
            // AirPlay 设置播放模式
            if (pathname === '/api/airplay/playMode' && req.method === 'POST') {
                return airplayService.handlePlayMode(req, res);
            }
            // ===== END AirPlay HTTP API =====
            // ===== LOCAL PLAYER API (server-side audio playback) =====
            // Get server-side audio devices
            if (pathname === '/api/local/devices' && req.method === 'GET') {
                return localPlayerService.handleGetDevices(req, res);
            }
            // Get cached devices (no scan)
            if (pathname === '/api/local/devices/cached' && req.method === 'GET') {
                return localPlayerService.handleGetCachedDevices(req, res);
            }
            // Local Player: Play
            if (pathname === '/api/local/play' && req.method === 'POST') {
                return localPlayerService.handlePlay(req, res);
            }
            // Local Player: Pause
            if (pathname === '/api/local/pause' && req.method === 'POST') {
                return localPlayerService.handlePause(req, res);
            }
            // Local Player: Resume
            if (pathname === '/api/local/resume' && req.method === 'POST') {
                return localPlayerService.handleResume(req, res);
            }
            // Local Player: Stop
            if (pathname === '/api/local/stop' && req.method === 'POST') {
                return localPlayerService.handleStop(req, res);
            }
            // Local Player: Seek
            if (pathname === '/api/local/seek' && req.method === 'POST') {
                return localPlayerService.handleSeek(req, res);
            }
            // Local Player: Set Volume
            if (pathname === '/api/local/volume' && req.method === 'POST') {
                return localPlayerService.handleSetVolume(req, res);
            }
            // Local Player: Get Volume
            if (pathname === '/api/local/volume' && req.method === 'GET') {
                return localPlayerService.handleGetVolume(req, res);
            }
            // Local Player: Get Status
            if (pathname === '/api/local/status' && req.method === 'GET') {
                return localPlayerService.handleGetStatus(req, res);
            }
            // Local Player: Get Player Info
            if (pathname === '/api/local/info' && req.method === 'GET') {
                return localPlayerService.handleGetInfo(req, res);
            }
            // ===== END LOCAL PLAYER API =====
            // 9. Remove Cache File (Single or Batch)
            if (pathname === '/api/music/cache/remove' && req.method === 'POST') {
                const reqUsername = req.headers['x-user-name'] || '';
                const isPublic = !reqUsername || reqUsername === 'default';
                let username = '_open';
                if (!isPublic) {
                    const verified = verifyUserAuth(req);
                    if (!verified) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    username = verified;
                }
                void readBody(req).then(body => {
                    try {
                        const { filenames, dir } = JSON.parse(body);
                        if (!filenames)
                            throw new Error('Missing filenames');
                        const fileList = Array.isArray(filenames) ? filenames : [filenames];
                        let deletedCount = 0;
                        // dir=cache: 仅从 cache/ 目录删除，不操作 DB (Delete from cache/ only, no DB)
                        if (dir === 'cache') {
                            for (const f of fileList) {
                                if (fileCache.removeCacheDirFile(f)) {
                                    deletedCount++;
                                }
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: true, deletedCount }));
                            return;
                        }
                        // 默认行为: 同时删除文件和 DB 记录 (Default: delete file + DB record)
                        const fsMod = require('fs');
                        const dbMod = require('../utils/db');
                        for (const f of fileList) {
                            let fileDeleted = false;
                            let dbDeleted = false;
                            // Step 1: Look up DB record by relative_path to get song_id and file_path
                            const dbRecord = dbMod.getDownloadRecordByRelativePath(f);
                            // Step 2: Delete the actual file (best effort)
                            // 2a: Try fileCache.removeCacheFile with relative path
                            if (fileCache.removeCacheFile(f)) {
                                fileDeleted = true;
                            }
                            // 2b: If file still not deleted, try using absolute file_path from DB record
                            if (!fileDeleted && dbRecord && dbRecord.file_path && fsMod.existsSync(dbRecord.file_path)) {
                                try {
                                    fsMod.unlinkSync(dbRecord.file_path);
                                    // Also delete associated lyric file
                                    const lrcPath = dbRecord.file_path.substring(0, dbRecord.file_path.lastIndexOf('.')) + '.lrc';
                                    if (fsMod.existsSync(lrcPath))
                                        fsMod.unlinkSync(lrcPath);
                                    fileDeleted = true;
                                    console.log(`[CacheRemove] Deleted by absolute path: ${dbRecord.file_path}`);
                                }
                                catch (e) {
                                    console.warn(`[CacheRemove] Failed to delete by abs path: ${e.message}`);
                                }
                            }
                            // Step 3: Delete DB record by relative_path (unique identifier)
                            dbDeleted = dbMod.deleteDownloadRecordByPath(f);
                            if (fileDeleted || dbDeleted) {
                                deletedCount++;
                            }
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, deletedCount }));
                    }
                    catch (e) {
                        res.writeHead(400);
                        res.end(e.message);
                    }
                });
                return;
            }
            // [New] Fetch Lyrics (GET) (已迁移到 localLyric.ts) 在线获取
            if (pathname === '/api/music/lyric' && req.method === 'GET') {
                return localLyric.handleGetLyric(req, res, urlObj);
            }
            // [新增] File Cache Lyric APIs (GET) (已迁移到 localLyric.ts)
            if (pathname === '/api/music/cache/lyric' && req.method === 'GET') {
                return localLyric.handleGetCachedLyric(req, res, urlObj);
            }
            // [新增] File Cache Lyric APIs (POST) (已迁移到 localLyric.ts)
            if (pathname === '/api/music/cache/lyric' && req.method === 'POST') {
                return localLyric.handleSaveCachedLyric(req, res);
            }
            // [新增] Download Proxy API
            if (pathname === '/api/music/download' && req.method === 'GET') {
                const urlStr = urlObj.searchParams.get('url');
                const filename = urlObj.searchParams.get('filename') || 'download.mp3';
                const isInline = urlObj.searchParams.get('inline') === '1';
                if (!urlStr) {
                    res.writeHead(400);
                    res.end('Missing url param');
                    return;
                }
                try {
                    const isTaggingMode = urlObj.searchParams.get('tag') === '1';
                    const taskId = urlObj.searchParams.get('taskId');
                    console.log(`[DownloadProxy] Fetching: ${urlStr} (Tagging: ${isTaggingMode}, TaskId: ${taskId})`);
                    // 使用原生 http/https 模块以获得最高的流媒体转发性能
                    const http = require('http');
                    const https = require('https');
                    // Manual redirect handling for maximum control and stability
                    const doFetch = (targetUrl, attempt) => {
                        if (attempt > 5) {
                            console.error('[DownloadProxy] Too many redirects');
                            if (!res.headersSent) {
                                res.writeHead(502);
                                res.end('Too Many Redirects');
                            }
                            return;
                        }
                        try {
                            const parsedUrl = new URL(targetUrl);
                            const options = {
                                method: 'GET',
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                    'Referer': parsedUrl.origin
                                }
                            };
                            // 转发 Range 请求头，以支持播放器的快进和拖拽
                            if (req.headers['range']) {
                                options.headers['Range'] = req.headers['range'];
                            }
                            const lib = parsedUrl.protocol === 'https:' ? https : http;
                            const proxyReq = lib.request(targetUrl, options, (proxyRes) => {
                                // 处理重定向
                                if ([301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
                                    const location = proxyRes.headers.location;
                                    if (location) {
                                        const nextUrl = location.startsWith('http') ? location : new URL(location, targetUrl).href;
                                        doFetch(nextUrl, attempt + 1);
                                        return;
                                    }
                                }
                                // 处理最终响应
                                let contentType = proxyRes.headers['content-type'] || 'application/octet-stream';
                                if (contentType.includes('audio/') || contentType.includes('video/')) {
                                    contentType = contentType.split(';')[0].trim();
                                }
                                const headers = {
                                    'Content-Type': contentType,
                                    'Access-Control-Allow-Origin': '*',
                                };
                                if (proxyRes.headers['content-length'])
                                    headers['Content-Length'] = proxyRes.headers['content-length'];
                                if (proxyRes.headers['accept-ranges'])
                                    headers['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
                                if (proxyRes.headers['content-range'])
                                    headers['Content-Range'] = proxyRes.headers['content-range'];
                                if (!isInline) {
                                    headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(filename)}"`;
                                }
                                // [Unified metadata] Tagging support for browser download
                                // NOTE: Local fetch from browser often sends Range: bytes=0- for full download
                                const rangeHeader = req.headers['range'];
                                const isFullRange = rangeHeader === 'bytes=0-';
                                if (isTaggingMode && (!rangeHeader || isFullRange)) {
                                    const songName = urlObj.searchParams.get('name') || '';
                                    const artist = urlObj.searchParams.get('singer') || '';
                                    const album = urlObj.searchParams.get('album') || '';
                                    const imageUrl = urlObj.searchParams.get('pic') || '';
                                    const chunks = [];
                                    let received = 0;
                                    const total = parseInt(proxyRes.headers['content-length'] || '0', 10);
                                    if (taskId) {
                                        fileCache.cacheProgress.set(taskId, { progress: 0, status: 'downloading', total, received: 0 });
                                    }
                                    proxyRes.on('data', (c) => {
                                        chunks.push(c);
                                        if (taskId) {
                                            received += c.length;
                                            const progress = total > 0 ? Math.round((received / total) * 100) : 0;
                                            fileCache.cacheProgress.set(taskId, { progress, status: 'downloading', total, received });
                                        }
                                    });
                                    proxyRes.on('end', async () => {
                                        if (taskId) {
                                            fileCache.cacheProgress.set(taskId, { progress: 100, status: 'tagging', total, received: total });
                                        }
                                        try {
                                            const buffer = Buffer.concat(chunks);
                                            if (buffer.length < 100)
                                                throw new Error('File too small, possibly invalid');
                                            // Use filename extension for temp file so tag library can identify container format
                                            const ext = node_path_1.default.extname(filename) || '.mp3';
                                            const tempPath = node_path_1.default.join(node_os_1.default.tmpdir(), `lx_tag_${Date.now()}${ext}`);
                                            node_fs_1.default.writeFileSync(tempPath, new Uint8Array(buffer));
                                            // 获取封面数据 (Fetch cover image data)
                                            let coverData;
                                            if (imageUrl) {
                                                try {
                                                    let imgBuf = null;
                                                    if (imageUrl.startsWith('http')) {
                                                        const imgResp = await global.fetch(imageUrl);
                                                        if (imgResp.ok)
                                                            imgBuf = Buffer.from(await imgResp.arrayBuffer());
                                                    }
                                                    else if (imageUrl.startsWith('/api')) {
                                                        // 内部 API 请求，使用请求头中的 host
                                                        const hostLabel = req.headers.host || '127.0.0.1:2026';
                                                        const internalUrl = `http://${hostLabel}${imageUrl}`;
                                                        const imgResp = await global.fetch(internalUrl);
                                                        if (imgResp.ok)
                                                            imgBuf = Buffer.from(await imgResp.arrayBuffer());
                                                    }
                                                    if (imgBuf && imgBuf.length > 0) {
                                                        coverData = { data: imgBuf, mime: 'image/jpeg' };
                                                    }
                                                }
                                                catch (e) {
                                                    console.warn('[DownloadProxy] Picture fetch failed:', imageUrl, e.message);
                                                }
                                            }
                                            // 使用 MusicTagUtil 统一写入标签 (Write tags using MusicTagUtil)
                                            const tagWriteOk = MusicTagUtil.writeBasicTags(tempPath, {
                                                title: songName || undefined,
                                                artist: artist || undefined,
                                                album: album || undefined,
                                                cover: coverData,
                                            });
                                            console.log('[DownloadProxy] Metadata saved successfully for:', songName, tagWriteOk ? '' : '(failed)');
                                            if (taskId) {
                                                fileCache.cacheProgress.set(taskId, { progress: 100, status: 'finished', total, received: total });
                                                setTimeout(() => fileCache.cacheProgress.delete(taskId), 30000);
                                            }
                                            const tagged = node_fs_1.default.readFileSync(tempPath);
                                            node_fs_1.default.unlink(tempPath, () => { });
                                            headers['Content-Length'] = tagged.length.toString();
                                            if (!res.headersSent) {
                                                res.writeHead(200, headers);
                                                res.end(tagged);
                                            }
                                        }
                                        catch (e) {
                                            if (!res.headersSent) {
                                                res.writeHead(200, headers);
                                                res.end(Buffer.concat(chunks));
                                            }
                                        }
                                    });
                                    return;
                                }
                                if (!res.headersSent) {
                                    res.writeHead(proxyRes.statusCode || 200, headers);
                                    proxyRes.pipe(res);
                                }
                            });
                            proxyReq.on('error', (err) => {
                                console.error('[DownloadProxy] Request Error:', err);
                                if (!res.headersSent) {
                                    res.writeHead(502);
                                    res.end('Request Error');
                                }
                            });
                            // 如果客户端（浏览器）中止了请求（例如：用户拖拽进度条、切换歌曲等），应该立刻销毁上游的下载请求，防止持续占用服务器下行带宽
                            req.on('close', () => {
                                if (!proxyReq.destroyed) {
                                    proxyReq.destroy();
                                }
                            });
                            proxyReq.end();
                        }
                        catch (err) {
                            console.error('[DownloadProxy] Try Error:', err);
                            if (!res.headersSent) {
                                res.writeHead(500);
                                res.end('Internal Server Error');
                            }
                        }
                    };
                    // Start the fetch process
                    doFetch(urlStr, 0);
                }
                catch (err) {
                    console.error('[DownloadProxy] Error:', err);
                    res.writeHead(500);
                    res.end('Server Error');
                }
                return;
            }
            if (pathname === '/api/data/delete-playlist' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { username, playlistId } = JSON.parse(body);
                        // 检查用户是否存在
                        if (!global.lx.config.users.some(u => u.name === username)) {
                            res.writeHead(404);
                            res.end('User not found');
                            return;
                        }
                        const userSpace = (0, user_1.getUserSpace)(username);
                        const listManage = userSpace.listManage;
                        // 删除歌单
                        await listManage.listDataManage.userListsRemove([playlistId]);
                        // 创建快照
                        await listManage.createSnapshot();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // 删除歌曲
            if (pathname === '/api/data/delete-song' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { username, playlistId, songIndex } = JSON.parse(body);
                        // 检查用户是否存在
                        if (!global.lx.config.users.some(u => u.name === username)) {
                            res.writeHead(404);
                            res.end('User not found');
                            return;
                        }
                        const userSpace = (0, user_1.getUserSpace)(username);
                        const listManage = userSpace.listManage;
                        const listData = await listManage.getListData();
                        // 获取歌单
                        const playlist = listData.userList.find((list) => list.id === playlistId);
                        if (!playlist) {
                            res.writeHead(404);
                            res.end('Playlist not found');
                            return;
                        }
                        if (!playlist.list || songIndex >= playlist.list.length) {
                            res.writeHead(404);
                            res.end('Song not found');
                            return;
                        }
                        const songInfo = playlist.list[songIndex];
                        // 从歌单中删除歌曲
                        await listManage.listDataManage.listMusicRemove(playlistId, [songInfo.id]);
                        // 创建快照
                        await listManage.createSnapshot();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // 重命名歌单
            if (pathname === '/api/data/rename-playlist' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { username, playlistId, newName } = JSON.parse(body);
                        // 检查用户是否存在
                        if (!global.lx.config.users.some(u => u.name === username)) {
                            res.writeHead(404);
                            res.end('User not found');
                            return;
                        }
                        const userSpace = (0, user_1.getUserSpace)(username);
                        const listManage = userSpace.listManage;
                        const listData = await listManage.getListData();
                        // 查找歌单
                        const playlist = listData.userList.find((list) => list.id === playlistId);
                        if (!playlist) {
                            res.writeHead(404);
                            res.end('Playlist not found');
                            return;
                        }
                        // 更新歌单信息
                        await listManage.listDataManage.userListsUpdate([{
                                id: playlist.id,
                                name: newName,
                                source: playlist.source,
                                sourceListId: playlist.sourceListId,
                                locationUpdateTime: playlist.locationUpdateTime
                            }]);
                        // 创建快照
                        await listManage.createSnapshot();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // 批量删除歌曲
            if (pathname === '/api/data/batch-delete-songs' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { username, playlistId, songIndices } = JSON.parse(body);
                        // 检查用户是否存在
                        if (!global.lx.config.users.some(u => u.name === username)) {
                            res.writeHead(404);
                            res.end('User not found');
                            return;
                        }
                        const userSpace = (0, user_1.getUserSpace)(username);
                        const listManage = userSpace.listManage;
                        const listData = await listManage.getListData();
                        // 获取歌单
                        const playlist = listData.userList.find((list) => list.id === playlistId);
                        if (!playlist) {
                            res.writeHead(404);
                            res.end('Playlist not found');
                            return;
                        }
                        // 获取要删除的歌曲ID列表
                        const songIds = songIndices.map((index) => {
                            if (playlist.list && playlist.list[index]) {
                                const id = playlist.list[index].id;
                                return id;
                            }
                            return null;
                        }).filter((id) => id !== null);
                        if (songIds.length === 0) {
                            res.writeHead(400);
                            res.end('No valid songs selected');
                            return;
                        }
                        // 批量删除
                        await listManage.listDataManage.listMusicRemove(playlistId, songIds);
                        // 创建快照
                        await listManage.createSnapshot();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // 批量下载歌曲
            if (pathname === '/api/music/batch-download' && req.method === 'POST') {
                void readBody(req).then(async (body) => {
                    try {
                        const { username, songs, quality: requestedQuality } = JSON.parse(body);
                        if (!songs || !Array.isArray(songs) || songs.length === 0) {
                            res.writeHead(400);
                            res.end('No songs provided');
                            return;
                        }
                        // 按选定音质获取下载 URL 并加入下载队列（未传音质时回退 flac）
                        let downloaded = 0;
                        let failed = 0;
                        for (const song of songs) {
                            try {
                                const songId = song.id || song.songmid;
                                const source = song.source;
                                const quality = requestedQuality || 'flac';
                                const urlInfo = await (0, userApi_1.callUserApiGetMusicUrl)(source, song, quality, username);
                                if (urlInfo?.url) {
                                    // 触发下载: 使用 downloadMusic 保存到 music/ + DB
                                    const { downloadMusic } = await import('../server/fileCache.js');
                                    await downloadMusic({ ...song, id: songId }, urlInfo.url, true, quality);
                                    downloaded++;
                                }
                                else {
                                    failed++;
                                }
                            }
                            catch (e) {
                                failed++;
                                console.warn(`[BatchDownload] Failed to download ${song.name}:`, e);
                            }
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, downloaded, failed }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // 批量收藏歌曲
            if (pathname === '/api/data/batch-favorite' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { username, songs } = JSON.parse(body);
                        if (!songs || !Array.isArray(songs) || songs.length === 0) {
                            res.writeHead(400);
                            res.end('No songs provided');
                            return;
                        }
                        // 检查用户是否存在
                        if (!global.lx.config.users.some(u => u.name === username)) {
                            res.writeHead(404);
                            res.end('User not found');
                            return;
                        }
                        const userSpace = (0, user_1.getUserSpace)(username);
                        const listManage = userSpace.listManage;
                        // 添加到收藏列表 (loveList)
                        for (const song of songs) {
                            try {
                                await listManage.listDataManage.listMusicAdd('love', [song], 'bottom');
                            }
                            catch (e) {
                                console.warn(`[BatchFavorite] Failed to favorite ${song.name}:`, e);
                            }
                        }
                        // 创建快照
                        await listManage.createSnapshot();
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true, count: songs.length }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // [新增] Web播放器公共配置 API (无需鉴权)
            if (pathname === '/api/music/config' && req.method === 'GET') {
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache'
                });
                res.end(JSON.stringify({
                    'player.enableAuth': global.lx.config['player.enableAuth'] || false,
                    'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'] || false
                }));
                return;
            }
            // [新增] Web播放器认证 API（颁发 HttpOnly Cookie Session）
            if (pathname === '/api/music/auth' && req.method === 'POST') {
                void readBody(req).then(body => {
                    try {
                        const { password } = JSON.parse(body);
                        const correctPassword = global.lx.config['player.password'] || '';
                        if (password === correctPassword) {
                            const sessionId = generateSessionId();
                            playerSessions.set(sessionId, { createdAt: Date.now() });
                            log4js_1.loginLog.info(`Player login success from ${ip}`);
                            res.writeHead(200, {
                                'Content-Type': 'application/json',
                                'Set-Cookie': `${SESSION_COOKIE_NAME}=${sessionId}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`
                            });
                            res.end(JSON.stringify({ success: true }));
                        }
                        else {
                            log4js_1.loginLog.warn(`Player login failed from ${ip}`);
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ success: false }));
                        }
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ success: false, error: err.message }));
                    }
                });
                return;
            }
            // [新增] Web播放器登出 API（清除 Session Cookie）
            if (pathname === '/api/music/auth/logout' && req.method === 'POST') {
                const cookies = parseCookies(req.headers['cookie']);
                const sessionId = cookies[SESSION_COOKIE_NAME];
                if (sessionId)
                    playerSessions.delete(sessionId);
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Set-Cookie': `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0`
                });
                res.end(JSON.stringify({ success: true }));
                return;
            }
            // [新增] Web播放器认证状态检查 API
            if (pathname === '/api/music/auth/verify' && req.method === 'GET') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ valid: checkPlayerAuth(req) }));
                return;
            }
            // [新增] 音乐搜索 API (已迁移到 musicSearch.ts)
            if (pathname === '/api/music/search' && req.method === 'GET') {
                return musicSearch.handleMusicSearch(req, res, urlObj);
            }
            // [新增] 搜索提示 (TipSearch) API (已迁移到 musicSearch.ts)
            if (pathname === '/api/music/tipSearch' && req.method === 'GET') {
                return musicSearch.handleTipSearch(req, res, urlObj);
            }
            // 在线专辑详情 (Online Album Detail)
            if (pathname === '/api/music/online/album/detail' && req.method === 'GET') {
                return musicSearch.handleOnlineAlbumDetail(req, res, urlObj);
            }
            // 在线歌手详情 (Online Singer Detail - 专辑+热门歌曲)
            if (pathname === '/api/music/online/singer/detail' && req.method === 'GET') {
                return musicSearch.handleOnlineSingerDetail(req, res, urlObj);
            }
            // [新增] 获取歌手详情 API
            if (pathname === '/api/music/artistDetail' && req.method === 'GET') {
                return musicSearch.handleArtistInfo(req, res, urlObj);
            }
            // [新增] 获取歌手专辑列表 API
            if (pathname === '/api/music/artistAlbums' && req.method === 'GET') {
                return musicSearch.handleArtistAlbums(req, res, urlObj);
            }
            // [新增] 获取歌手歌曲 API（循环拉取全部，前端分页）
            if (pathname === '/api/music/artistSongs' && req.method === 'GET') {
                return musicSearch.handleArtistSongs(req, res, urlObj);
            }
            // [新增] 获取专辑歌曲 API
            if (pathname === '/api/music/albumSongs' && req.method === 'GET') {
                return musicSearch.handleAlbumSongs(req, res, urlObj);
            }
            // [新增] 音乐解析进度 SSE 端点 (无需登录, 用 requestId 区分)
            if (pathname === '/api/music/progress' && req.method === 'GET') {
                const reqId = urlObj.searchParams.get('reqId');
                if (!reqId) {
                    res.writeHead(400);
                    res.end('Missing reqId');
                    return;
                }
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*',
                });
                res.write('retry: 3000\n\n');
                musicProgressClients.set(reqId, res);
                req.on('close', () => {
                    musicProgressClients.delete(reqId);
                });
                return;
            }
            // [新增] 音乐 URL API
            if (pathname === '/api/music/url' && req.method === 'POST') {
                const clientUsername = req.headers['x-user-name'];
                // 鉴权逻辑：如果提供了具名用户，必须通过 Token 或密码验证
                let verifiedUsername = 'open'; // userApi 中公开用户标识为 'open'
                if (clientUsername && clientUsername !== 'default' && clientUsername !== 'open' && clientUsername !== '_open') {
                    const verified = verifyUserAuth(req);
                    if (!verified || verified !== clientUsername) {
                        res.writeHead(401, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
                        return;
                    }
                    verifiedUsername = verified;
                }
                const clientId = req.headers['x-client-id'];
                const reqId = req.headers['x-req-id'];
                void readBody(req).then(async (body) => {
                    // 辅助：通过 SSE 推送进度（内置竞态重试，最多等 600ms 让 SSE 连接就绪）
                    const pushProgress = async (attempt, retries = 3) => {
                        if (reqId && musicProgressClients.has(reqId)) {
                            musicProgressClients.get(reqId).write(`data: ${JSON.stringify(attempt)}\n\n`);
                            return;
                        }
                        if (retries > 0) {
                            await new Promise(r => setTimeout(r, 200));
                            await pushProgress(attempt, retries - 1);
                        }
                        else if (reqId) {
                            console.warn(`[SSE] ReqId ${reqId} not found after retries (${musicProgressClients.size} clients registered)`);
                        }
                    };
                    try {
                        let { songInfo, quality } = JSON.parse(body);
                        songInfo = normalizeSongInfo(songInfo);
                        // console.log('[MusicUrl] Song Info:', JSON.stringify(songInfo, null, 2))
                        if (!songInfo || !songInfo.source) {
                            throw new Error('Invalid songInfo');
                        }
                        const source = songInfo.source;
                        let result;
                        let customSourceError = null;
                        let attempts = [];
                        if ((0, userApi_1.isSourceSupported)(source, verifiedUsername)) {
                            try {
                                console.log(`[MusicUrl] Using custom source for: ${source} (ReqId: ${reqId || 'None'}, User: ${verifiedUsername})`);
                                const userApiResult = await (0, userApi_1.callUserApiGetMusicUrl)(source, songInfo, quality || 'flac', verifiedUsername, (attempt) => pushProgress(attempt));
                                result = userApiResult;
                                attempts = userApiResult.attempts || [];
                            }
                            catch (userApiError) {
                                console.error(`[MusicUrl] Custom source failed:`, userApiError.message);
                                customSourceError = userApiError.message;
                                attempts = userApiError.attempts || [];
                                // 不抛出错误，继续尝试内置源
                            }
                        }
                        else {
                            // isSourceSupported = false: 无任何自定义源支持此平台，立即通知前端
                            await pushProgress({ name: '系统', status: 'fail', message: `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源` });
                        }
                        // 自定义源失败则直接报错（内置 SDK 无独立解析能力，回退无意义）
                        if (!result) {
                            const errMsg = customSourceError || `未找到支持 ${source} 平台的自定义源，请在设置中添加或启用相关源`;
                            const err = new Error(errMsg);
                            err.attempts = attempts;
                            throw err;
                        }
                        // 合并解析尝试记录到响应（前端可用于诊断）
                        if (attempts.length > 0)
                            result.attempts = attempts;
                        // [Fix] Server-side Mixed Content handling & Redirect Resolution
                        // If the upstream URL is HTTP, rewrite it to use our secure proxy OR resolve it if it's a redirect
                        if (result && result.url) {
                            // 1. Resolve Redirects (301, 302, 307, etc.) to get direct link
                            try {
                                // Only try to resolve if it looks like a remote URL and is not already resolved
                                if (result.url.startsWith('http')) {
                                    // console.log(`[MusicUrl] Resolving redirects for: ${songInfo.name} (${quality})`);
                                    const checkRedirect = async (u, depth = 0) => {
                                        if (depth > 3)
                                            return { url: u, contentType: null, isVerified: false }; // Max depth 3
                                        try {
                                            const resp = await (0, needle_1.default)('head', u, null, {
                                                follow_max: 0,
                                                response_timeout: 4000, // Increase timeout slightly
                                                read_timeout: 4000,
                                                headers: {
                                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                                    'Referer': new URL(u).origin
                                                }
                                            });
                                            if (resp.statusCode && [301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
                                                let nextUrl = resp.headers.location;
                                                if (!nextUrl.startsWith('http')) {
                                                    try {
                                                        nextUrl = new URL(nextUrl, u).href;
                                                    }
                                                    catch (e) { }
                                                }
                                                // console.log(`[MusicUrl] Resolve redirect [${resp.statusCode}]: ${u.substring(0, 50)}... -> ${nextUrl.substring(0, 50)}...`)
                                                return checkRedirect(nextUrl, depth + 1);
                                            }
                                            // [Fix] HEAD 请求返回 404 时，有些 CDN/服务器不支持 HEAD 方法但 GET 正常
                                            // 尝试用 GET + Range 仅请求 1 字节来验证 URL 是否真正可用
                                            if (resp.statusCode === 404 || resp.statusCode === 405) {
                                                console.warn(`[MusicUrl] HEAD returned ${resp.statusCode}, trying GET with Range for verification...`);
                                                try {
                                                    const getResp = await (0, needle_1.default)('get', u, null, {
                                                        follow_max: 5,
                                                        response_timeout: 5000,
                                                        read_timeout: 5000,
                                                        headers: {
                                                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                                                            'Referer': new URL(u).origin,
                                                            'Range': 'bytes=0-1'
                                                        }
                                                    });
                                                    // 206 = Range 请求成功, 200 = 忽略 Range 返回全部
                                                    if (getResp.statusCode === 206 || getResp.statusCode === 200) {
                                                        // GET 请求成功，但可能发生了重定向，需要用最终 URL
                                                        // needle 的 uri 属性不在类型定义中，用 redirect 跟随后的方式获取
                                                        const finalUrl = getResp.uri ? String(getResp.uri) : u;
                                                        const contentType = getResp.headers['content-type'] || null;
                                                        console.log(`[MusicUrl] GET verification succeeded${finalUrl !== u ? ' (redirect resolved)' : ''}, status: ${getResp.statusCode}`);
                                                        return { url: finalUrl, contentType, isVerified: true };
                                                    }
                                                    console.warn(`[MusicUrl] GET verification also failed with status ${getResp.statusCode}, URL may be invalid`);
                                                }
                                                catch (getErr) {
                                                    console.warn(`[MusicUrl] GET verification failed: ${getErr.message}`);
                                                }
                                                // HEAD 和 GET 都失败，返回原始 URL 但标记为未验证
                                                // 不直接抛错，让前端/下载阶段自行处理，避免误杀可播放链接
                                                return { url: u, contentType: null, isVerified: false };
                                            }
                                            // If error status but not redirect, return original
                                            if (resp.statusCode !== undefined && resp.statusCode >= 400) {
                                                console.warn(`[MusicUrl] Redirect check failed with status ${resp.statusCode}, using original URL`);
                                                return { url: u, contentType: null, isVerified: false };
                                            }
                                            // Return the final URL with its Content-Type
                                            const contentType = resp.headers['content-type'] || null;
                                            return { url: u, contentType, isVerified: true };
                                        }
                                        catch (e) {
                                            console.warn(`[MusicUrl] head check failed: ${e.message}`);
                                        }
                                        return { url: u, contentType: null, isVerified: false };
                                    };
                                    const resolveResult = await checkRedirect(result.url);
                                    if (resolveResult.url !== result.url) {
                                        result.url = resolveResult.url;
                                    }
                                    // 2. [新增] 验证实际音质是否匹配请求的无损音质
                                    // 注意：Content-Type 不可靠，仅作参考（有些服务器会错误地返回 audio/mpeg）
                                    // 真正的验证在下载完成后通过文件魔数进行
                                    // 无损格式 Content-Type 列表（仅供参考，不强制校验）
                                    // const losslessContentTypes = [
                                    //   'audio/flac', 'audio/x-flac',
                                    //   'audio/wav', 'audio/x-wav', 'audio/wave',
                                    //   'audio/aiff', 'audio/x-aiff',
                                    //   'audio/ogg', // OGG 容器可能是 FLAC
                                    //   'application/ogg'
                                    // ]
                                    // 将实际检测到的音质信息附加到结果中（便于前端诊断）
                                    if (resolveResult.contentType) {
                                        result.detectedContentType = resolveResult.contentType;
                                    }
                                    // [4.5] 从重定向后的 URL 和 Content-Type 检测实际音质
                                    // 自定义源脚本可能返回 type=mp3 的 URL，但 result.type 被设为请求的无损音质
                                    // 重定向解析后可获得最终 URL 和 Content-Type，用于更准确的音质检测
                                    const detectedQualityFromRedirect = (0, userApi_1.detectActualQualityFromUrl)(result.url, resolveResult.contentType);
                                    if (detectedQualityFromRedirect && detectedQualityFromRedirect !== result.type) {
                                        console.log(`[MusicUrl] 实际音质 ${detectedQualityFromRedirect} 与请求音质 ${result.type} 不一致（重定向检测），使用实际音质`);
                                        result.type = detectedQualityFromRedirect;
                                    }
                                    // console.log(`[MusicUrl] Final Resolved URL: ${result.url.substring(0, 100)}...`);
                                }
                            }
                            catch (e) {
                                console.error('[MusicUrl] Resolve Error:', e);
                                throw e;
                            }
                            // 3. Mixed Content Handling (Optional Proxy) implementation details handled by frontend now
                            // But we can keep the log for debugging
                            if (result.url.startsWith('http://')) {
                                // console.log(`[MusicUrl] Note: URL is HTTP, frontend might proxy if enabled: ${result.url}`)
                            }
                        }
                        // 异步检查并更新 singer_info（仅UPDATE，不阻塞响应）
                        if (Array.isArray(songInfo.singers) && songInfo.singers.length > 0) {
                            const { updateSingerInfoIfIncomplete } = require('../utils/db');
                            setImmediate(() => {
                                try {
                                    updateSingerInfoIfIncomplete(songInfo.singers, source);
                                }
                                catch (e) {
                                    console.error('[MusicUrl] Failed to update singer info:', e);
                                }
                            });
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(result));
                    }
                    catch (err) {
                        console.error('[MusicUrl] Error:', err.message);
                        // [Fix] Return 500 but with specific error JSON to let frontend show detailed toast
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: err.message, code: 500, attempts: err.attempts }));
                    }
                });
                return;
            }
            // [新增] 歌词 API
            if (pathname === '/api/music/lyric' && req.method === 'POST') {
                void readBody(req).then(async (body) => {
                    try {
                        let { songInfo } = JSON.parse(body);
                        songInfo = normalizeSongInfo(songInfo);
                        if (!songInfo || !songInfo.source) {
                            throw new Error('Invalid songInfo');
                        }
                        const source = songInfo.source;
                        if (!musicSdk[source] || !musicSdk[source].getLyric) {
                            throw new Error(`Source ${source} not supported`);
                        }
                        const requestObj = musicSdk[source].getLyric(songInfo);
                        const result = await requestObj.promise;
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(result));
                    }
                    catch (err) {
                        console.error(err);
                        res.writeHead(500);
                        res.end(err.message);
                    }
                });
                return;
            }
            // [新增] 热搜 API
            if (pathname === '/api/music/hotSearch' && req.method === 'GET') {
                const source = urlObj.searchParams.get('source') || 'mg';
                try {
                    // 检查是否支持热搜
                    if (!musicSdk[source] || !musicSdk[source].hotSearch) {
                        res.writeHead(404, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: '该音源不支持热搜功能' }));
                        return;
                    }
                    // console.log(`[HotSearch] 获取热搜: source=${source}`)
                    const result = await musicSdk[source].hotSearch.getList();
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'public, max-age=300' // 5分钟缓存
                    });
                    res.end(JSON.stringify(result));
                }
                catch (err) {
                    console.error('[HotSearch] Error:', err.message);
                    // Return empty array instead of 500 to keep UI stable
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify([]));
                }
                return;
            }
            // [新增] 歌单分类标签 API (已迁移到 songList.ts)
            if (pathname === '/api/music/songList/tags' && req.method === 'GET') {
                return songList.handleSongListTags(req, res, urlObj);
            }
            // [新增] 歌单列表 API (已迁移到 songList.ts)
            if (pathname === '/api/music/songList/list' && req.method === 'GET') {
                return songList.handleSongListList(req, res, urlObj);
            }
            // [新增] 歌单详情 API (已迁移到 songList.ts)
            if (pathname === '/api/music/songList/detail' && req.method === 'GET') {
                return songList.handleSongListDetail(req, res, urlObj);
            }
            // [新增] 歌单搜索 API (已迁移到 songList.ts)
            if (pathname === '/api/music/songList/search' && req.method === 'GET') {
                return songList.handleSongListSearch(req, res, urlObj);
            }
            // [新增] 排行榜 - 获取榜单列表 API (已迁移到 songList.ts)
            if (pathname === '/api/music/leaderboard/boards' && req.method === 'GET') {
                return songList.handleLeaderboardBoards(req, res, urlObj);
            }
            // [新增] 排行榜 - 获取榜单内歌曲 API (已迁移到 songList.ts)
            if (pathname === '/api/music/leaderboard/list' && req.method === 'GET') {
                return songList.handleLeaderboardList(req, res, urlObj);
            }
            // [新增] 评论 API (已迁移到 songList.ts)
            if (pathname === '/api/music/comment' && req.method === 'POST') {
                return songList.handleComment(req, res);
            }
            // [新增] 封面 API (备用)
            // [新增] 自定义源管理 API
            // 注：此处不再进行全局强制鉴权，鉴权逻辑已下放到 customSourceHandlers 中，
            // 以便根据请求体中的 username 字段判断是否需要校验管理员密码。
            if (pathname === '/api/custom-source/validate' && req.method === 'POST') {
                return customSourceHandlers.handleValidate(req, res);
            }
            if (pathname === '/api/custom-source/import' && req.method === 'POST') {
                return customSourceHandlers.handleImport(req, res);
            }
            if (pathname === '/api/custom-source/upload' && req.method === 'POST') {
                return customSourceHandlers.handleUpload(req, res);
            }
            if (pathname === '/api/custom-source/list' && req.method === 'GET') {
                const username = urlObj.searchParams.get('username') || 'default';
                return customSourceHandlers.handleList(req, res, username);
            }
            if (pathname === '/api/custom-source/toggle' && req.method === 'POST') {
                return customSourceHandlers.handleToggle(req, res);
            }
            if (pathname === '/api/custom-source/delete' && req.method === 'POST') {
                return customSourceHandlers.handleDelete(req, res);
            }
            if (pathname === '/api/custom-source/reorder' && req.method === 'POST') {
                return customSourceHandlers.handleReorder(req, res);
            }
            // elFinder 文件管理器连接器
            if (pathname === '/api/elfinder/connector') {
                // [修改] 优先从 Header 获取，如果没有则尝试从 URL 参数获取 (用于支持下载和预览)
                const auth = req.headers['x-frontend-auth'] || urlObj.searchParams.get('auth');
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                // 处理GET请求
                if (req.method === 'GET') {
                    void (async () => {
                        try {
                            const params = {};
                            const url = new URL(req.url || '', `http://${req.headers.host}`);
                            url.searchParams.forEach((value, key) => {
                                params[key] = value;
                            });
                            const connector = new elfinderConnector_1.ElFinderConnector((0, elfinderConnector_1.getSystemRoot)());
                            const cmd = params.cmd || 'open';
                            const result = await connector.handle(cmd, params);
                            // [新增] 处理文件下载 (file) 和 打包下载 (zipdl)
                            if ((cmd === 'file' || cmd === 'zipdl') && result.path && !result.error) {
                                if (node_fs_1.default.existsSync(result.path)) {
                                    const mime = getMime(result.path);
                                    const headers = { 'Content-Type': mime };
                                    // 如果是下载请求，或者是打包下载，强制添加附件头
                                    if (params.download === '1' || cmd === 'zipdl') {
                                        headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(node_path_1.default.basename(result.path))}"`;
                                    }
                                    res.writeHead(200, headers);
                                    node_fs_1.default.createReadStream(result.path).pipe(res);
                                    return;
                                }
                                else {
                                    res.writeHead(404);
                                    res.end('Not Found');
                                    return;
                                }
                            }
                            res.writeHead(200, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify(result));
                        }
                        catch (err) {
                            res.writeHead(500);
                            res.end(JSON.stringify({ error: [err.message] }));
                        }
                    })();
                    return;
                }
                // 处理POST请求
                if (req.method === 'POST') {
                    const contentType = req.headers['content-type'] || '';
                    // 处理文件上传
                    if (contentType.includes('multipart/form-data')) {
                        const form = (0, formidable_1.default)({ multiples: true, uploadDir: require('os').tmpdir() });
                        form.parse(req, async (err, fields, files) => {
                            if (err) {
                                res.writeHead(500);
                                res.end(JSON.stringify({ error: ['Upload error'] }));
                                return;
                            }
                            const params = { ...fields };
                            // formidable v3 返回的值可能是数组，需要转换
                            for (const key in params) {
                                if (Array.isArray(params[key]) && params[key].length === 1) {
                                    params[key] = params[key][0];
                                }
                            }
                            console.log('[ElFinder] Files received:', Object.keys(files));
                            console.log('[ElFinder] Files detail:', files);
                            try {
                                // 获取上传的文件（字段名可能是 upload, upload[] 等）
                                const uploadedFiles = files.upload || files['upload[]'] || Object.values(files)[0];
                                if (params.cmd === 'upload' && uploadedFiles) {
                                    const connector = new elfinderConnector_1.ElFinderConnector((0, elfinderConnector_1.getSystemRoot)());
                                    const uploadFiles = Array.isArray(uploadedFiles) ? uploadedFiles : [uploadedFiles];
                                    const added = [];
                                    for (const file of uploadFiles) {
                                        const target = connector.decode(params.target);
                                        const destPath = require('path').join(target, file.originalFilename || file.newFilename);
                                        await require('fs').promises.copyFile(file.filepath, destPath);
                                        await require('fs').promises.unlink(file.filepath);
                                        const fileInfo = await connector.getFileInfo(destPath);
                                        if (fileInfo)
                                            added.push(fileInfo);
                                    }
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ added }));
                                }
                                else {
                                    const connector = new elfinderConnector_1.ElFinderConnector((0, elfinderConnector_1.getSystemRoot)());
                                    const cmd = params.cmd || 'open';
                                    const result = await connector.handle(cmd, params);
                                    res.writeHead(200, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify(result));
                                }
                            }
                            catch (err) {
                                res.writeHead(500);
                                res.end(JSON.stringify({ error: [err.message] }));
                            }
                        });
                        return;
                    }
                    else {
                        // 普通POST数据
                        void readBody(req).then(async (body) => {
                            try {
                                // 修改开始：兼容 JSON 和 x-www-form-urlencoded
                                let params = {};
                                try {
                                    params = JSON.parse(body || '{}');
                                }
                                catch (e) {
                                    // 如果 JSON 解析失败，尝试解析为 URL 查询参数格式
                                    const urlParams = new URLSearchParams(body);
                                    urlParams.forEach((value, key) => {
                                        // 处理数组情况 (例如 targets[])
                                        if (params[key]) {
                                            if (Array.isArray(params[key])) {
                                                params[key].push(value);
                                            }
                                            else {
                                                params[key] = [params[key], value];
                                            }
                                        }
                                        else {
                                            params[key] = value;
                                        }
                                    });
                                }
                                // 修改结束
                                const connector = new elfinderConnector_1.ElFinderConnector((0, elfinderConnector_1.getSystemRoot)());
                                const cmd = params.cmd || 'open';
                                const result = await connector.handle(cmd, params);
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify(result));
                            }
                            catch (err) {
                                res.writeHead(500);
                                res.end(JSON.stringify({ error: [err.message] }));
                            }
                        });
                        return;
                    }
                }
                return;
            }
            // Configuration API
            if (pathname === '/api/config') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                if (req.method === 'GET') {
                    const config = {
                        serverName: global.lx.config.serverName,
                        maxSnapshotNum: global.lx.config.maxSnapshotNum,
                        'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
                        'proxy.enabled': global.lx.config['proxy.enabled'],
                        'proxy.header': global.lx.config['proxy.header'],
                        'user.enablePath': global.lx.config['user.enablePath'],
                        'user.enableRoot': global.lx.config['user.enableRoot'],
                        'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'],
                        'frontend.password': global.lx.config['frontend.password'],
                        'player.enableAuth': global.lx.config['player.enableAuth'] || false,
                        'player.password': global.lx.config['player.password'] || '',
                        'webdav.url': global.lx.config['webdav.url'] || '',
                        'webdav.username': global.lx.config['webdav.username'] || '',
                        'webdav.password': global.lx.config['webdav.password'] || '',
                        'sync.interval': global.lx.config['sync.interval'] || 60,
                        'proxy.all.enabled': global.lx.config['proxy.all.enabled'] || false,
                        'proxy.all.address': global.lx.config['proxy.all.address'] || '',
                        'admin.path': global.lx.config['admin.path'] ?? '',
                        'player.path': global.lx.config['player.path'] ?? '/music',
                        'subsonic.enable': global.lx.config['subsonic.enable'] ?? true,
                        'subsonic.path': global.lx.config['subsonic.path'] ?? '/rest',
                        'localLibrary.enableScraping': global.lx.config['localLibrary.enableScraping'] ?? true,
                        'radio.proxy.enabled': global.lx.config['radio.proxy.enabled'] || false,
                        'radio.proxy.address': global.lx.config['radio.proxy.address'] || '',
                    };
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify(config));
                    return;
                }
                if (req.method === 'POST') {
                    void readBody(req).then(body => {
                        try {
                            const newConfig = JSON.parse(body);
                            if (newConfig.serverName !== undefined)
                                global.lx.config.serverName = newConfig.serverName;
                            if (newConfig.maxSnapshotNum !== undefined)
                                global.lx.config.maxSnapshotNum = parseInt(newConfig.maxSnapshotNum);
                            if (newConfig['list.addMusicLocationType'] !== undefined)
                                global.lx.config['list.addMusicLocationType'] = newConfig['list.addMusicLocationType'];
                            if (newConfig['proxy.enabled'] !== undefined)
                                global.lx.config['proxy.enabled'] = newConfig['proxy.enabled'];
                            if (newConfig['proxy.header'] !== undefined)
                                global.lx.config['proxy.header'] = newConfig['proxy.header'];
                            if (newConfig['user.enablePath'] !== undefined)
                                global.lx.config['user.enablePath'] = newConfig['user.enablePath'];
                            // 新增：处理 user.enableRoot
                            if (newConfig['user.enableRoot'] !== undefined)
                                global.lx.config['user.enableRoot'] = newConfig['user.enableRoot'];
                            if (newConfig['user.enablePublicRestriction'] !== undefined)
                                global.lx.config['user.enablePublicRestriction'] = newConfig['user.enablePublicRestriction'];
                            let warning = '';
                            // 校验：至少开启一种模式
                            if (!global.lx.config['user.enablePath'] && !global.lx.config['user.enableRoot']) {
                                // 如果都关闭了，强制开启根路径（或者报错，这里建议强制开启并警告）
                                global.lx.config['user.enableRoot'] = true;
                                warning = '必须至少开启一种连接方式，已自动开启“根路径”模式。';
                            }
                            // 校验：如果开启了根路径，检查密码重复
                            if (global.lx.config['user.enableRoot']) {
                                const passwords = global.lx.config.users.map(u => u.password);
                                if (new Set(passwords).size !== passwords.length) {
                                    warning = warning ? warning + '\n' : '';
                                    warning += '检测到重复密码！开启“根路径”模式要求所有用户密码唯一，否则可能导致连接错误。';
                                }
                            }
                            if (newConfig['frontend.password'] !== undefined)
                                global.lx.config['frontend.password'] = newConfig['frontend.password'];
                            // Web播放器配置
                            if (newConfig['player.enableAuth'] !== undefined)
                                global.lx.config['player.enableAuth'] = newConfig['player.enableAuth'];
                            if (newConfig['player.password'] !== undefined)
                                global.lx.config['player.password'] = newConfig['player.password'];
                            // WebDAV 配置
                            if (newConfig['webdav.url'] !== undefined)
                                global.lx.config['webdav.url'] = newConfig['webdav.url'];
                            if (newConfig['webdav.username'] !== undefined)
                                global.lx.config['webdav.username'] = newConfig['webdav.username'];
                            if (newConfig['webdav.password'] !== undefined)
                                global.lx.config['webdav.password'] = newConfig['webdav.password'];
                            if (newConfig['sync.interval'] !== undefined)
                                global.lx.config['sync.interval'] = parseInt(newConfig['sync.interval']);
                            if (newConfig['proxy.all.enabled'] !== undefined)
                                global.lx.config['proxy.all.enabled'] = newConfig['proxy.all.enabled'];
                            if (newConfig['proxy.all.address'] !== undefined)
                                global.lx.config['proxy.all.address'] = newConfig['proxy.all.address'];
                            // URL路径配置校验与更新
                            if (newConfig['admin.path'] !== undefined || newConfig['player.path'] !== undefined) {
                                const adminPath = (newConfig['admin.path'] !== undefined ? newConfig['admin.path'] : global.lx.config['admin.path']) || '';
                                const playerPath = (newConfig['player.path'] !== undefined ? newConfig['player.path'] : global.lx.config['player.path']) || '/music';
                                const normalizedAdmin = adminPath.replace(/\/+$/, '');
                                const normalizedPlayer = playerPath.replace(/\/+$/, '');
                                if (!normalizedPlayer || !normalizedPlayer.startsWith('/')) {
                                    res.writeHead(422, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: false, error: '播放器路径不能为空且必须以 / 开头' }));
                                    return;
                                }
                                if (normalizedAdmin !== '' && !normalizedAdmin.startsWith('/')) {
                                    res.writeHead(422, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: false, error: '后台路径必须以 / 开头或为空' }));
                                    return;
                                }
                                if ((normalizedAdmin || '/admin') === normalizedPlayer) {
                                    res.writeHead(422, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: false, error: '后台管理路径与播放器路径不能相同' }));
                                    return;
                                }
                                if (normalizedAdmin.startsWith('/api') || normalizedPlayer.startsWith('/api')) {
                                    res.writeHead(422, { 'Content-Type': 'application/json' });
                                    res.end(JSON.stringify({ success: false, error: '路径不能以 /api 开头' }));
                                    return;
                                }
                                global.lx.config['admin.path'] = normalizedAdmin;
                                global.lx.config['player.path'] = normalizedPlayer;
                            }
                            // 新增：Subsonic 配置保存逻辑
                            if (newConfig['subsonic.enable'] !== undefined)
                                global.lx.config['subsonic.enable'] = newConfig['subsonic.enable'];
                            if (newConfig['subsonic.path'] !== undefined) {
                                global.lx.config['subsonic.path'] = newConfig['subsonic.path'].replace(/\/+$/, '') || '/rest';
                            }
                            // 本地库刮削配置
                            if (newConfig['localLibrary.enableScraping'] !== undefined)
                                global.lx.config['localLibrary.enableScraping'] = newConfig['localLibrary.enableScraping'];
                            // 电台独立代理配置
                            if (newConfig['radio.proxy.enabled'] !== undefined)
                                global.lx.config['radio.proxy.enabled'] = newConfig['radio.proxy.enabled'];
                            if (newConfig['radio.proxy.address'] !== undefined)
                                global.lx.config['radio.proxy.address'] = newConfig['radio.proxy.address'];
                            // 更新 WebDAVSync 配置
                            if (global.lx.webdavSync && (newConfig['webdav.url'] || newConfig['webdav.username'] || newConfig['webdav.password'] || newConfig['sync.interval'])) {
                                global.lx.webdavSync.updateConfig({
                                    url: global.lx.config['webdav.url'],
                                    username: global.lx.config['webdav.username'],
                                    password: global.lx.config['webdav.password'],
                                    interval: global.lx.config['sync.interval'],
                                });
                            }
                            const configPath = process.env.CONFIG_PATH || node_path_1.default.join(process.cwd(), 'config.js');
                            const configContent = `module.exports = ${JSON.stringify({
                                serverName: global.lx.config.serverName,
                                'proxy.enabled': global.lx.config['proxy.enabled'],
                                'proxy.header': global.lx.config['proxy.header'],
                                'user.enablePath': global.lx.config['user.enablePath'],
                                'user.enableRoot': global.lx.config['user.enableRoot'],
                                'user.enablePublicRestriction': global.lx.config['user.enablePublicRestriction'],
                                maxSnapshotNum: global.lx.config.maxSnapshotNum,
                                'list.addMusicLocationType': global.lx.config['list.addMusicLocationType'],
                                'frontend.password': global.lx.config['frontend.password'],
                                'player.enableAuth': global.lx.config['player.enableAuth'],
                                'player.password': global.lx.config['player.password'],
                                'webdav.url': global.lx.config['webdav.url'],
                                'webdav.username': global.lx.config['webdav.username'],
                                'webdav.password': global.lx.config['webdav.password'],
                                'sync.interval': global.lx.config['sync.interval'],
                                'proxy.all.enabled': global.lx.config['proxy.all.enabled'],
                                'proxy.all.address': global.lx.config['proxy.all.address'],
                                'admin.path': global.lx.config['admin.path'] ?? '',
                                'player.path': global.lx.config['player.path'] ?? '/music',
                                'subsonic.enable': global.lx.config['subsonic.enable'],
                                'subsonic.path': global.lx.config['subsonic.path'],
                                'localLibrary.enableScraping': global.lx.config['localLibrary.enableScraping'] ?? true,
                                'radio.proxy.enabled': global.lx.config['radio.proxy.enabled'] || false,
                                'radio.proxy.address': global.lx.config['radio.proxy.address'] || '',
                                users: global.lx.config.users.map(u => ({
                                    name: u.name,
                                    password: u.password,
                                    maxSnapshotNum: u.maxSnapshotNum,
                                    'list.addMusicLocationType': u['list.addMusicLocationType'],
                                })),
                            }, null, 2)}`;
                            node_fs_1.default.writeFileSync(configPath, configContent);
                            // 触发一次 WebDAV 同步检查（如果已配置）
                            if (global.lx.webdavSync && global.lx.webdavSync.isConfigured()) {
                                void global.lx.webdavSync.syncChangedFiles();
                            }
                            res.writeHead(200);
                            res.end(JSON.stringify({ success: true, warning }));
                        }
                        catch (e) {
                            res.writeHead(500);
                            res.end('Server Error');
                        }
                    });
                    return;
                }
            }
            // Test Proxy API
            if (pathname === '/api/config/test-proxy' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(async (body) => {
                    try {
                        const { address } = JSON.parse(body);
                        if (!address)
                            throw new Error('Missing address');
                        const url = new URL(address);
                        const options = {
                            timeout: 10000,
                            headers: {
                                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36'
                            }
                        };
                        if (url.protocol === 'http:' || url.protocol === 'https:') {
                            options.proxy = address;
                        }
                        else if (url.protocol.startsWith('socks')) {
                            const { SocksProxyAgent } = await import('socks-proxy-agent');
                            options.agent = new SocksProxyAgent(address);
                        }
                        else {
                            throw new Error('Unsupported protocol: ' + url.protocol);
                        }
                        console.log(`[Proxy Test] Trying to connect to baidu.com via ${address}...`);
                        const startTime = Date.now();
                        needle_1.default.get('https://www.baidu.com', options, (err, resp) => {
                            const duration = Date.now() - startTime;
                            if (err) {
                                console.error('[Proxy Test] Failed:', err.message);
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ success: false, message: err.message }));
                            }
                            else {
                                console.log(`[Proxy Test] Success: ${resp.statusCode} (${duration}ms)`);
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify({ success: true, message: `连接成功 (状态码: ${resp.statusCode}, 耗时: ${duration}ms)` }));
                            }
                        });
                    }
                    catch (err) {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // Logs API
            if (pathname === '/api/logs' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                const logType = urlObj.searchParams.get('type') || 'app';
                const lines = parseInt(urlObj.searchParams.get('lines') || '100');
                const logFile = node_path_1.default.join(global.lx.logPath, `${logType}.log`);
                node_fs_1.default.readFile(logFile, 'utf-8', (err, content) => {
                    if (err) {
                        res.writeHead(404);
                        res.end('Log file not found');
                        return;
                    }
                    const logLines = content.split('\n').slice(-lines);
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify({ logs: logLines }));
                });
                return;
            }
            // Stats API
            if (pathname === '/api/stats' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                const stats = {
                    users: global.lx.config.users.length,
                    connectedDevices: status.devices.length,
                    serverStatus: status.status,
                    uptime: process.uptime(),
                    memoryUsage: process.memoryUsage(),
                };
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache, no-store, must-revalidate'
                });
                res.end(JSON.stringify(stats));
                return;
            }
            // WebDAV Test Connection API
            if (pathname === '/api/webdav/test' && req.method === 'POST') {
                return webdavService.handleTestConnection(req, res);
            }
            // WebDAV Sync File API
            if (pathname === '/api/webdav/sync-file' && req.method === 'POST') {
                return webdavService.handleSyncFile(req, res);
            }
            // WebDAV Backup API
            if (pathname === '/api/webdav/backup' && req.method === 'POST') {
                return webdavService.handleBackup(req, res);
            }
            // WebDAV Sync All Files API
            if (pathname === '/api/webdav/sync' && req.method === 'POST') {
                return webdavService.handleSyncAllFiles(req, res);
            }
            // WebDAV Restore API
            if (pathname === '/api/webdav/restore' && req.method === 'POST') {
                return webdavService.handleRestore(req, res);
            }
            // WebDAV Logs API
            if (pathname === '/api/webdav/logs' && req.method === 'GET') {
                return webdavService.handleGetLogs(req, res);
            }
            // WebDAV Progress SSE API
            if (pathname === '/api/webdav/progress' && req.method === 'GET') {
                return webdavService.handleProgressSSE(req, res);
            }
            // [新增] 本地备份下载 API
            if (pathname === '/api/backup/download' && req.method === 'GET') {
                return webdavService.handleDownloadBackup(req, res, urlObj);
            }
            // [新增] 本地备份还原 API
            if (pathname === '/api/backup/upload' && req.method === 'POST') {
                return webdavService.handleUploadBackup(req, res);
            }
            // [新增] 管理重载 API
            if (pathname === '/api/admin/reload' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                try {
                    await reloadServerData();
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, message: 'Server data reloaded from disk' }));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(err.message);
                }
                return;
            }
            // Restart Server API
            if (pathname === '/api/restart' && req.method === 'POST') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Server restarting...' }));
                // 延迟1秒后重启
                setTimeout(() => {
                    console.log('Server restarting by admin request...');
                    // 尝试通过更新文件时间戳触发 nodemon 重启
                    const entryFile = node_path_1.default.join(process.cwd(), 'src', 'index.ts');
                    try {
                        if (node_fs_1.default.existsSync(entryFile)) {
                            const time = new Date();
                            node_fs_1.default.utimesSync(entryFile, time, time);
                        }
                        else {
                            process.exit(0);
                        }
                    }
                    catch (err) {
                        console.error('Restart failed, forcing exit:', err);
                        process.exit(0);
                    }
                }, 1000);
                return;
            }
            // File Management - List Files
            if (pathname === '/api/files' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                const dirPath = urlObj.searchParams.get('path') || '';
                const fullPath = node_path_1.default.join(global.lx.dataPath, dirPath);
                // 安全检查：确保路径在 dataPath 内
                if (!fullPath.startsWith(global.lx.dataPath)) {
                    res.writeHead(403);
                    res.end('Forbidden');
                    return;
                }
                try {
                    const items = node_fs_1.default.readdirSync(fullPath).map(name => {
                        const itemPath = node_path_1.default.join(fullPath, name);
                        const stat = node_fs_1.default.statSync(itemPath);
                        return {
                            name,
                            path: node_path_1.default.relative(global.lx.dataPath, itemPath),
                            isDirectory: stat.isDirectory(),
                            size: stat.size,
                            mtime: stat.mtime.getTime(),
                        };
                    });
                    res.writeHead(200, {
                        'Content-Type': 'application/json',
                        'Cache-Control': 'no-cache, no-store, must-revalidate'
                    });
                    res.end(JSON.stringify({ items }));
                }
                catch (err) {
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: err.message }));
                }
                return;
            }
            // File Management - Download File
            if (pathname === '/api/files/download' && req.method === 'GET') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                const filePath = urlObj.searchParams.get('path') || '';
                const fullPath = node_path_1.default.join(global.lx.dataPath, filePath);
                if (!fullPath.startsWith(global.lx.dataPath)) {
                    res.writeHead(403);
                    res.end('Forbidden');
                    return;
                }
                try {
                    const content = node_fs_1.default.readFileSync(fullPath);
                    res.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Disposition': `attachment; filename="${node_path_1.default.basename(fullPath)}"`,
                    });
                    res.end(content);
                }
                catch (err) {
                    res.writeHead(404);
                    res.end('File not found');
                }
                return;
            }
            // File Management - Create/Update File
            if (pathname === '/api/files' && (req.method === 'POST' || req.method === 'PUT')) {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const { path: filePath, content, isDirectory } = JSON.parse(body);
                        const fullPath = node_path_1.default.join(global.lx.dataPath, filePath);
                        if (!fullPath.startsWith(global.lx.dataPath)) {
                            res.writeHead(403);
                            res.end('Forbidden');
                            return;
                        }
                        if (isDirectory) {
                            node_fs_1.default.mkdirSync(fullPath, { recursive: true });
                        }
                        else {
                            const dir = node_path_1.default.dirname(fullPath);
                            if (!node_fs_1.default.existsSync(dir)) {
                                node_fs_1.default.mkdirSync(dir, { recursive: true });
                            }
                            node_fs_1.default.writeFileSync(fullPath, content || '');
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
            // File Management - Delete File
            if (pathname === '/api/files' && req.method === 'DELETE') {
                const auth = req.headers['x-frontend-auth'];
                if (auth !== global.lx.config['frontend.password']) {
                    res.writeHead(401);
                    res.end('Unauthorized');
                    return;
                }
                void readBody(req).then(body => {
                    try {
                        const { path: filePath } = JSON.parse(body);
                        const fullPath = node_path_1.default.join(global.lx.dataPath, filePath);
                        if (!fullPath.startsWith(global.lx.dataPath)) {
                            res.writeHead(403);
                            res.end('Forbidden');
                            return;
                        }
                        const stat = node_fs_1.default.statSync(fullPath);
                        if (stat.isDirectory()) {
                            node_fs_1.default.rmSync(fullPath, { recursive: true });
                        }
                        else {
                            node_fs_1.default.unlinkSync(fullPath);
                        }
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: true }));
                    }
                    catch (err) {
                        res.writeHead(500);
                        res.end(JSON.stringify({ success: false, message: err.message }));
                    }
                });
                return;
            }
        }
        const endUrl = `/${req.url?.split('/').at(-1) ?? ''}`;
        let code;
        let msg;
        switch (endUrl) {
            case '/hello':
                // 新增：如果禁用了根路径，且当前访问的是根路径 (例如 /hello 而不是 /user/hello)，则拒绝
                if (!global.lx.config['user.enableRoot']) {
                    const parts = pathname.split('/').filter(p => p);
                    // parts.length <= 1 说明没有用户名部分，只有 'hello'
                    if (parts.length <= 1) {
                        code = 403;
                        msg = 'Root access disabled';
                        break;
                    }
                }
                code = 200;
                msg = constants_1.SYNC_CODE.helloMsg;
                break;
            case '/id':
                // 新增：同上，对 /id 接口也进行同样的检查
                if (!global.lx.config['user.enableRoot']) {
                    const parts = pathname.split('/').filter(p => p);
                    if (parts.length <= 1) {
                        code = 403;
                        msg = 'Root access disabled';
                        break;
                    }
                }
                code = 200;
                msg = constants_1.SYNC_CODE.idPrefix + (0, user_1.getServerId)();
                break;
            case '/ah':
                let targetUserName;
                // 1. 尝试匹配用户路径 /<userName>/ah
                if (global.lx.config['user.enablePath']) {
                    const parts = pathname.split('/').filter(p => p);
                    // parts 应该是 ['username', 'ah']
                    if (parts.length > 1 && parts[parts.length - 1] === 'ah') {
                        targetUserName = decodeURIComponent(parts[parts.length - 2]);
                    }
                }
                // 2. 如果没有匹配到用户名（说明是访问的根路径 /ah，或者 URL 格式不对）
                if (!targetUserName) {
                    // 如果未开启根路径模式，则拒绝访问
                    if (!global.lx.config['user.enableRoot']) {
                        res.writeHead(403);
                        res.end('Access denied: Root path access is disabled. Please use /<username>/ah');
                        return;
                    }
                    // 如果开启了根路径，targetUserName 保持 undefined，authCode 会遍历尝试所有用户
                }
                // 将 targetUserName 传递给 authCode
                void (0, auth_1.authCode)(req, res, global.lx.config.users, targetUserName);
                break;
            default:
                // 根路径重定向到播放器页面
                if (pathname === '/' || pathname === '/index.html') {
                    const fallbackPlayerPath = global.lx.config['player.path'] || '/music';
                    res.writeHead(302, { 'Location': fallbackPlayerPath });
                    res.end();
                    return;
                }
                // Serve static files
                // If root, serve index.html
                let filePath = node_path_1.default.join(process.cwd(), 'public', pathname === '/' ? 'index.html' : pathname);
                // Prevent directory traversal
                if (!filePath.startsWith(node_path_1.default.join(process.cwd(), 'public'))) {
                    code = 403;
                    msg = 'Forbidden';
                    break;
                }
                // Check if file exists, if not fall back to 404 handled by serveStatic or check original logic
                if (node_fs_1.default.existsSync(filePath) && node_fs_1.default.statSync(filePath).isFile()) {
                    serveStatic(req, res, filePath);
                    return;
                }
                code = 404;
                msg = 'Not Found';
                break;
        }
        if (!code)
            return;
        res.writeHead(code);
        res.end(msg);
    });
    wss = new ws_1.WebSocketServer({
        noServer: true,
    });
    // ===== DLNA DMC 初始化 =====
    dlnaWs.createDlnaWsServer(httpServer);
    const dmcPort = global.lx.config.port;
    const dmcAddresses = (0, commonUtils_1.getServerAddresses)();
    const dmcHost = dmcAddresses.length > 0 ? dmcAddresses[0] : '127.0.0.1';
    const dmcCallbackUrl = `http://${dmcHost}:${dmcPort}/api/upnp/event`;
    dlnaDmc.initDmc(dlnaWs.broadcastToClients, dmcCallbackUrl);
    // ===== AirPlay DMC 初始化 =====
    airplayWs.createAirPlayWsServer(httpServer);
    // WebDAV Sync Progress Broadcast
    if (global.lx.webdavSync) {
        // 移除旧的监听器以防重复添加
        global.lx.webdavSync.removeAllListeners('progress');
        global.lx.webdavSync.on('progress', (data) => {
            // Broadcast to WebSocket clients
            if (wss) {
                const msg = JSON.stringify({ type: 'webdav_progress', data });
                for (const client of wss.clients) {
                    if (client.readyState === ws_1.WebSocket.OPEN) {
                        client.send(msg);
                    }
                }
            }
            // Broadcast to SSE clients
            broadcastToSSEClients(data);
        });
    }
    wss.on('connection', function (socket, request) {
        socket.isReady = false;
        socket.moduleReadys = {
            list: false,
            dislike: false,
        };
        socket.feature = {
            list: false,
            dislike: false,
        };
        socket.on('pong', () => {
            socket.isAlive = true;
        });
        // const events = new Map<keyof ActionsType, Array<(err: Error | null, data: LX.Sync.ActionSyncType[keyof LX.Sync.ActionSyncType]) => void>>()
        // const events = new Map<keyof LX.Sync.ActionSyncType, Array<(err: Error | null, data: LX.Sync.ActionSyncType[keyof LX.Sync.ActionSyncType]) => void>>()
        // let events: Partial<{ [K in keyof LX.Sync.ActionSyncType]: Array<(data: LX.Sync.ActionSyncType[K]) => void> }> = {}
        let closeEvents = [];
        let disconnected = false;
        const msg2call = (0, message2call_1.createMsg2call)({
            funcsObj: sync_1.callObj,
            timeout: 120 * 1000,
            sendMessage(data) {
                if (disconnected)
                    throw new Error('disconnected');
                void (0, tools_1.encryptMsg)(socket.keyInfo, JSON.stringify(data)).then((data) => {
                    // console.log('sendData', eventName)
                    socket.send(data);
                }).catch(err => {
                    log4js_1.syncLog.error('encrypt message error:', err);
                    log4js_1.syncLog.error(err.message);
                    socket.close(constants_1.SYNC_CLOSE_CODE.failed);
                });
            },
            onCallBeforeParams(rawArgs) {
                return [socket, ...rawArgs];
            },
            onError(error, path, groupName) {
                const name = groupName ?? '';
                const userName = socket.userInfo?.name ?? '';
                const deviceName = socket.keyInfo?.deviceName ?? '';
                log4js_1.syncLog.error(`sync call ${userName} ${deviceName} ${name} ${path.join('.')} error:`, error);
                // if (groupName == null) return
                // // TODO
                // socket.close(SYNC_CLOSE_CODE.failed)
            },
        });
        socket.remote = msg2call.remote;
        socket.remoteQueueList = msg2call.createQueueRemote('list');
        socket.remoteQueueDislike = msg2call.createQueueRemote('dislike');
        socket.addEventListener('message', ({ data }) => {
            if (typeof data != 'string')
                return;
            void (0, tools_1.decryptMsg)(socket.keyInfo, data).then((data) => {
                let syncData;
                try {
                    syncData = JSON.parse(data);
                }
                catch (err) {
                    log4js_1.syncLog.error('parse message error:', err);
                    socket.close(constants_1.SYNC_CLOSE_CODE.failed);
                    return;
                }
                msg2call.message(syncData);
            }).catch(err => {
                log4js_1.syncLog.error('decrypt message error:', err);
                log4js_1.syncLog.error(err.message);
                socket.close(constants_1.SYNC_CLOSE_CODE.failed);
            });
        });
        socket.addEventListener('close', () => {
            const err = new Error('closed');
            try {
                for (const handler of closeEvents)
                    void handler(err);
            }
            catch (err) {
                log4js_1.syncLog.error(err?.message);
            }
            closeEvents = [];
            disconnected = true;
            msg2call.destroy();
            if (socket.isReady) {
                log4js_1.accessLog.info('deconnection', socket.userInfo.name, socket.keyInfo.deviceName);
                // events = {}
                if (!status.devices.map(d => (0, user_1.getUserName)(d.clientId)).filter(n => n == socket.userInfo.name).length)
                    handleUnconnection(socket.userInfo.name);
            }
            else {
                const queryData = new URL(request.url, host).searchParams;
                log4js_1.accessLog.info('deconnection', queryData.get('i'));
            }
        });
        socket.onClose = function (handler) {
            closeEvents.push(handler);
            return () => {
                closeEvents.splice(closeEvents.indexOf(handler), 1);
            };
        };
        socket.broadcast = function (handler) {
            if (!wss)
                return;
            for (const client of wss.clients)
                handler(client);
        };
        void handleConnection(socket, request);
    });
    httpServer.on('upgrade', function upgrade(request, socket, head) {
        socket.addListener('error', onSocketError);
        const requestUrl = (request.url || '/').split('?')[0];
        // DLNA DMC WebSocket — 轻量认证（player session cookie 或 user token）
        if (requestUrl === '/ws/dlna') {
            socket.removeListener('error', onSocketError);
            dlnaWs.handleUpgrade(request, socket, head);
            return;
        }
        // AirPlay DMC WebSocket — 轻量认证
        if (requestUrl === '/ws/airplay') {
            socket.removeListener('error', onSocketError);
            airplayWs.handleUpgrade(request, socket, head);
            return;
        }
        // 默认 WS：同步通道（需完整 authConnection 鉴权）
        authConnection(request, (err, success) => {
            // 如果报错或者 success 为 false，则拒绝连接
            if (err || !success) {
                // console.log('Auth failed', err)
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            socket.removeListener('error', onSocketError);
            // 鉴权通过，升级协议
            wss?.handleUpgrade(request, socket, head, function done(ws) {
                wss?.emit('connection', ws, request);
            });
        });
    });
    const interval = setInterval(() => {
        wss?.clients.forEach(socket => {
            if (socket.isAlive == false) {
                log4js_1.syncLog.info('alive check false:', socket.userInfo.name, socket.keyInfo.deviceName);
                socket.terminate();
                return;
            }
            socket.isAlive = false;
            socket.ping(noop);
            if (socket.keyInfo.isMobile)
                socket.send('ping', noop);
        });
    }, 30000);
    wss.on('close', function close() {
        clearInterval(interval);
    });
    httpServer.on('error', error => {
        console.log(error);
        reject(error);
    });
    httpServer.on('listening', () => {
        const addr = httpServer.address();
        // console.log(addr)
        if (!addr) {
            reject(new Error('address is null'));
            return;
        }
        const bind = typeof addr == 'string' ? `pipe ${addr}` : `port ${addr.port}`;
        log4js_1.startupLog.info(`Listening on ${ip} ${bind}`);
        resolve(null);
        void (0, sync_1.registerLocalSyncEvent)(wss);
    });
    host = `http://${ip.includes(':') ? `[${ip}]` : ip}:${port}`;
    httpServer.listen(port, ip);
});
const startServer = async (port, ip) => {
    // if (status.status) await handleStopServer()
    log4js_1.startupLog.info(`starting sync server in ${process.env.NODE_ENV == 'production' ? 'production' : 'development'}`);
    const proxyEnabled = global.lx.config['proxy.all.enabled'];
    const proxyAddress = global.lx.config['proxy.all.address'];
    console.log(`[Proxy] Music SDK Proxy: ${proxyEnabled ? `Enabled (${proxyAddress})` : 'Disabled'}`);
    log4js_1.startupLog.info(`Music SDK Proxy: ${proxyEnabled ? `Enabled (${proxyAddress})` : 'Disabled'}`);
    try {
        await musicSdk.init();
        log4js_1.startupLog.info('musicSdk initialized');
    }
    catch (err) {
        log4js_1.startupLog.error('musicSdk init failed:', err);
    }
    // 初始化自定义源
    try {
        console.log('[Server] Initializing custom user APIs...');
        // 修改：不传参数，默认加载 open + 所有用户源
        await (0, userApi_1.initUserApis)();
        console.log('[Server] Custom user APIs initialized');
    }
    catch (err) {
        console.error('[Server] Failed to initialize user APIs:', err.message);
    }
    // 初始化 Acoustid WASM (指纹刮削功能)
    try {
        await acoustidScrape.initAcoustid();
        console.log('[Server] Acoustid scraper initialized');
    }
    catch (err) {
        console.warn('[Server] Acoustid init skipped:', err.message);
    }
    await handleStartServer(port, ip).then(() => {
        // console.log('sync server started')
        status.status = true;
        status.message = '';
        status.address = ip == '0.0.0.0' ? (0, tools_1.getAddress)() : [ip];
        // 启动 mDNS 服务广播 (供 Android App 自动发现)
        try {
            (0, mdnsAdvertise_1.startMdnsAdvertise)(port, (0, user_1.getServerId)(), global.lx.config.serverName);
        }
        catch (err) {
            console.warn('[Server] mDNS 广播启动失败:', err.message);
        }
        // void generateCode()
        // codeTools.start()
    }).catch(err => {
        console.log(err);
        status.status = false;
        status.message = err.message;
        status.address = [];
        // status.code = ''
    });
    // .finally(() => {
    //   sendStatus(status)
    // })
};
exports.startServer = startServer;
const getStatus = () => status;
exports.getStatus = getStatus;
// export const generateCode = async() => {
//   status.code = handleGenerateCode()
//   sendStatus(status)
//   return status.code
// }
const getDevices = async (userName) => {
    const userSpace = (0, user_1.getUserSpace)(userName);
    return userSpace.getDecices();
};
exports.getDevices = getDevices;
const removeDevice = async (userName, clientId) => {
    if (wss) {
        for (const client of wss.clients) {
            if (client.userInfo?.name == userName && client.keyInfo?.clientId == clientId)
                client.close(constants_1.SYNC_CLOSE_CODE.normal);
        }
    }
    const userSpace = (0, user_1.getUserSpace)(userName);
    await userSpace.removeDevice(clientId);
};
exports.removeDevice = removeDevice;
