"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServerAddresses = exports.safeAsync = exports.sendJsonResponse = exports.readBodySafe = exports.normalizeSongInfo = exports.verifyUserAccess = void 0;
const node_os_1 = __importDefault(require("node:os"));
/**
 * 验证用户认证 (返回用户名,认证失败返回null并自动写入401响应)
 * 适用于需要认证检查的API端点
 *
 * @param req HTTP请求对象
 * @param res HTTP响应对象
 * @returns 验证通过返回用户名,失败返回null
 */
const verifyUserAccess = (req, res) => {
    const reqUsername = req.headers['x-user-name'] || '';
    const isPublic = !reqUsername || reqUsername === 'default';
    let username = '_open';
    if (!isPublic) {
        const verified = global.verifyUserAuth?.(req);
        if (!verified) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Unauthorized' }));
            return null;
        }
        username = verified;
    }
    return username;
};
exports.verifyUserAccess = verifyUserAccess;
/**
 * 规范化歌曲信息
 * 确保收藏列表中的 meta 属性在根节点也可用,解决 SDK 无法识别收藏歌曲音质的问题
 *
 * @param songInfo 歌曲信息对象
 * @returns 规范化后的歌曲信息对象
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
            break;
        case 'tx': // 腾讯
            if (!songInfo.strMediaMid && meta.strMediaMid)
                songInfo.strMediaMid = meta.strMediaMid;
            if (!songInfo.albumMid && meta.albumMid)
                songInfo.albumMid = meta.albumMid;
            // 只有当 meta 中的 songId 是纯数字时才回填至 root.songId
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
    // console.log('normalizeSongInfo', songInfo)
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
exports.normalizeSongInfo = normalizeSongInfo;
/**
 * 读取并解析请求体 (带错误处理)
 *
 * @param req HTTP请求对象
 * @param res HTTP响应对象
 * @returns Promise<any> 解析后的JSON对象,失败返回null并自动写入响应
 */
const readBodySafe = (req, res) => {
    const readBody = global.readBody;
    if (!readBody) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'Internal error' }));
        return Promise.resolve(null);
    }
    return readBody(req).then((body) => {
        try {
            return JSON.parse(body);
        }
        catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Bad Request' }));
            return null;
        }
    });
};
exports.readBodySafe = readBodySafe;
/**
 * 发送JSON响应 (带错误处理)
 *
 * @param res HTTP响应对象
 * @param statusCode HTTP状态码
 * @param data 响应数据
 */
const sendJsonResponse = (res, statusCode, data) => {
    try {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    catch (err) {
        console.error('[sendJsonResponse] Failed:', err.message);
        // 响应头已发送时无法修改状态码,直接结束
        if (!res.headersSent) {
            res.writeHead(500);
        }
        res.end();
    }
};
exports.sendJsonResponse = sendJsonResponse;
/**
 * 异步安全执行器 (捕获异常并返回错误响应)
 *
 * @param res HTTP响应对象
 * @param fn 异步函数
 * @param context 错误日志上下文
 */
const safeAsync = async (res, fn, context = 'Unknown') => {
    try {
        await fn();
    }
    catch (err) {
        console.error(`[${context}] Error:`, err.message);
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: err.message || 'Internal server error' }));
        }
    }
};
exports.safeAsync = safeAsync;
/**
 * 获取服务器的局域网IP地址(非内部IPv4)
 *
 * @returns 局域网IP地址数组
 */
const getServerAddresses = () => {
    const interfaces = node_os_1.default.networkInterfaces();
    const addresses = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name] || []) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push(iface.address);
            }
        }
    }
    return addresses;
};
exports.getServerAddresses = getServerAddresses;
