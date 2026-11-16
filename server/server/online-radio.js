"use strict";
/**
 * 在线电台 API 模块 (Online Radio API Module)
 * 代理 radio-browser.info 公共 API，提供全球在线电台搜索、浏览和交互功能
 * 使用 npm 包 radio-browser 作为 SDK
 */
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
exports.handleRequest = handleRequest;
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const tunnel = __importStar(require("tunnel"));
const node_url_1 = require("node:url");
const node_child_process_1 = require("node:child_process");
const node_stream_1 = require("node:stream");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const user_1 = require("../user");
const ffmpegPath_1 = require("../utils/ffmpegPath");
// radio-browser SDK (CJS 模块)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RadioBrowser = require('radio-browser');
// ==================== 收藏文件路径 ====================
/** 获取用户收藏文件路径 */
function getFavoritesPath(username) {
    const userDir = node_path_1.default.join(global.lx.userPath, (0, user_1.getUserDirname)(username));
    if (!node_fs_1.default.existsSync(userDir))
        node_fs_1.default.mkdirSync(userDir, { recursive: true });
    return node_path_1.default.join(userDir, 'online-radio-favorites.json');
}
/** 读取收藏数据 */
function readFavorites(username) {
    const fp = getFavoritesPath(username);
    if (!node_fs_1.default.existsSync(fp))
        return {};
    try {
        const raw = JSON.parse(node_fs_1.default.readFileSync(fp, 'utf-8'));
        return raw.favorites || {};
    }
    catch {
        return {};
    }
}
/** 写入收藏数据 */
function writeFavorites(username, favorites) {
    const fp = getFavoritesPath(username);
    node_fs_1.default.writeFileSync(fp, JSON.stringify({ favorites }, null, 2), 'utf-8');
}
// ==================== 辅助函数 ====================
/** 读取请求体 */
const readBody = (req) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
};
/** 发送 JSON 响应 */
const sendJson = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟
const categoryCache = new Map();
/** 获取缓存（未过期则返回） */
function getCached(key) {
    const entry = categoryCache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
        return entry.data;
    }
    categoryCache.delete(key);
    return null;
}
/** 设置缓存 */
function setCache(key, data) {
    categoryCache.set(key, { data, timestamp: Date.now() });
}
const STREAM_CACHE_TTL = 30 * 60 * 1000; // 30 分钟（动态流地址变化频繁）
const streamResolveCache = new Map();
/** 获取流解析缓存 */
function getStreamCache(stationId) {
    const entry = streamResolveCache.get(stationId);
    if (entry && Date.now() - entry.timestamp < STREAM_CACHE_TTL) {
        return entry;
    }
    streamResolveCache.delete(stationId);
    return null;
}
/** 设置流解析缓存 */
function setStreamCache(stationId, resolvedUrl, needsProxy, streamInfo) {
    const existing = streamResolveCache.get(stationId);
    if (existing) {
        // 更新已有条目（保留 URL/timestamp，追加 streamInfo）
        if (streamInfo)
            existing.streamInfo = streamInfo;
    }
    else {
        streamResolveCache.set(stationId, { resolvedUrl, needsProxy, timestamp: Date.now(), streamInfo });
    }
    // 清理过期条目，防止内存泄漏
    const now = Date.now();
    for (const [key, val] of streamResolveCache) {
        if (now - val.timestamp > STREAM_CACHE_TTL)
            streamResolveCache.delete(key);
    }
}
/** 清除流解析缓存（失败时调用） */
function deleteStreamCache(stationId) {
    streamResolveCache.delete(stationId);
}
// ==================== 路由处理 ====================
/**
 * 统一请求入口
 * pathname 已去除 /api/online-radio/ 前缀
 */
async function handleRequest(req, res, urlObj, pathname, username) {
    // 去除前缀
    const subPath = pathname.replace('/api/online-radio/', '');
    try {
        // ===== 收藏管理 =====
        if (subPath === 'favorites' && req.method === 'GET') {
            const favorites = readFavorites(username);
            return sendJson(res, 200, { success: true, data: Object.values(favorites) });
        }
        if (subPath === 'favorites' && req.method === 'POST') {
            const body = await readBody(req);
            const station = JSON.parse(body);
            if (!station.stationuuid) {
                return sendJson(res, 400, { success: false, message: '缺少 stationuuid' });
            }
            const favorites = readFavorites(username);
            favorites[station.stationuuid] = station;
            writeFavorites(username, favorites);
            return sendJson(res, 200, { success: true });
        }
        if (subPath.startsWith('favorites/') && req.method === 'DELETE') {
            const uuid = subPath.replace('favorites/', '');
            if (!uuid) {
                return sendJson(res, 400, { success: false, message: '缺少 uuid' });
            }
            const favorites = readFavorites(username);
            delete favorites[uuid];
            writeFavorites(username, favorites);
            return sendJson(res, 200, { success: true });
        }
        // ===== 电台代理配置 (Radio Proxy Config) =====
        if (subPath === 'proxy-config' && req.method === 'GET') {
            const config = global.lx?.config || {};
            return sendJson(res, 200, {
                success: true,
                data: {
                    enabled: config['radio.proxy.enabled'] || false,
                    address: config['radio.proxy.address'] || '',
                }
            });
        }
        if (subPath === 'proxy-config' && req.method === 'POST') {
            const body = await readBody(req);
            const { enabled, address } = JSON.parse(body);
            if (enabled !== undefined)
                global.lx.config['radio.proxy.enabled'] = !!enabled;
            if (address !== undefined)
                global.lx.config['radio.proxy.address'] = address;
            // 持久化到 config.js
            try {
                const configPath = process.env.CONFIG_PATH || node_path_1.default.join(process.cwd(), 'config.js');
                const currentConfig = JSON.parse(node_fs_1.default.readFileSync(configPath, 'utf-8').replace('module.exports = ', ''));
                currentConfig['radio.proxy.enabled'] = global.lx.config['radio.proxy.enabled'];
                currentConfig['radio.proxy.address'] = global.lx.config['radio.proxy.address'];
                node_fs_1.default.writeFileSync(configPath, `module.exports = ${JSON.stringify(currentConfig, null, 2)}`);
            }
            catch (e) {
                console.error('[RadioProxy] Failed to persist proxy config:', e);
            }
            return sendJson(res, 200, { success: true });
        }
        // ===== 电台代理测试 (Radio Proxy Test) =====
        if (subPath === 'proxy-test' && req.method === 'POST') {
            const body = await readBody(req);
            const { address } = JSON.parse(body);
            if (!address) {
                return sendJson(res, 200, { success: false, message: '缺少代理地址' });
            }
            try {
                // 使用 HTTP 请求测试代理（避免 CONNECT 方法被 Squid 拒绝）
                const testUrl = 'http://www.baidu.com';
                const parsedProxy = new node_url_1.URL(address);
                const startTime = Date.now();
                if (parsedProxy.protocol === 'http:' || parsedProxy.protocol === 'https:') {
                    // HTTP 代理：直接通过代理发送 GET 请求
                    const proxyAuth = parsedProxy.username
                        ? Buffer.from(`${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password || '')}`).toString('base64')
                        : undefined;
                    const options = {
                        hostname: parsedProxy.hostname,
                        port: parseInt(parsedProxy.port) || 80,
                        method: 'GET',
                        path: testUrl,
                        timeout: 10000,
                        headers: {
                            'Host': 'www.baidu.com',
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                            ...(proxyAuth ? { 'Proxy-Authorization': `Basic ${proxyAuth}` } : {})
                        }
                    };
                    let responded = false;
                    const testReq = node_http_1.default.request(options, (testRes) => {
                        if (responded)
                            return;
                        responded = true;
                        const duration = Date.now() - startTime;
                        testRes.resume();
                        return sendJson(res, 200, { success: true, message: `连接成功 (状态码: ${testRes.statusCode}, 耗时: ${duration}ms)` });
                    });
                    testReq.on('error', (err) => {
                        if (responded)
                            return;
                        responded = true;
                        return sendJson(res, 200, { success: false, message: err.message });
                    });
                    testReq.on('timeout', () => {
                        testReq.destroy();
                        if (!responded) {
                            responded = true;
                            return sendJson(res, 200, { success: false, message: '连接超时 (10s)' });
                        }
                    });
                    testReq.end();
                }
                else if (parsedProxy.protocol.startsWith('socks')) {
                    const { SocksProxyAgent } = await import('socks-proxy-agent');
                    const agent = new SocksProxyAgent(address);
                    const options = {
                        agent,
                        timeout: 10000,
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
                    };
                    let responded = false;
                    const testReq = node_http_1.default.request(testUrl, options, (testRes) => {
                        if (responded)
                            return;
                        responded = true;
                        const duration = Date.now() - startTime;
                        testRes.resume();
                        return sendJson(res, 200, { success: true, message: `连接成功 (状态码: ${testRes.statusCode}, 耗时: ${duration}ms)` });
                    });
                    testReq.on('error', (err) => {
                        if (responded)
                            return;
                        responded = true;
                        return sendJson(res, 200, { success: false, message: err.message });
                    });
                    testReq.on('timeout', () => {
                        testReq.destroy();
                        if (!responded) {
                            responded = true;
                            return sendJson(res, 200, { success: false, message: '连接超时 (10s)' });
                        }
                    });
                    testReq.end();
                }
                else {
                    return sendJson(res, 200, { success: false, message: '不支持的代理协议: ' + parsedProxy.protocol });
                }
            }
            catch (err) {
                return sendJson(res, 200, { success: false, message: err.message });
            }
            return;
        }
        // ===== 流媒体代理 (Stream Proxy，解决 CORS / 自签名证书 / 重定向问题) =====
        if (subPath === 'stream' && req.method === 'GET') {
            return handleStreamProxy(req, res, urlObj);
        }
        // ===== 流模式信息查询（轻量接口，读内存缓存，不连接上游） =====
        if (subPath === 'stream-info' && req.method === 'GET') {
            const id = urlObj.searchParams.get('id');
            if (!id)
                return sendJson(res, 400, { success: false, message: '缺少 id 参数' });
            const entry = getStreamCache(id);
            if (entry?.streamInfo) {
                return sendJson(res, 200, { success: true, data: entry.streamInfo });
            }
            return sendJson(res, 404, { success: false, message: '暂无流信息' });
        }
        // ===== 电台搜索 =====
        if (subPath === 'stations/search' && req.method === 'GET') {
            return await handleSearchStations(req, res, urlObj);
        }
        // ===== 最受欢迎电台 =====
        if (subPath === 'stations/topvote' && req.method === 'GET') {
            return await handleTopVote(res, urlObj);
        }
        // ===== 最多点击电台 =====
        if (subPath === 'stations/topclick' && req.method === 'GET') {
            return await handleTopClick(res, urlObj);
        }
        // ===== 最近更改 =====
        if (subPath === 'stations/recent' && req.method === 'GET') {
            return await handleRecent(res, urlObj);
        }
        // ===== 按 UUID 查询 =====
        if (subPath === 'stations/byuuid' && req.method === 'GET') {
            return await handleByUuid(res, urlObj);
        }
        // ===== 分类列表 (tags/countries/languages/codecs) =====
        if (subPath === 'tags' && req.method === 'GET') {
            return await handleCategory(res, 'tags', urlObj);
        }
        if (subPath === 'countries' && req.method === 'GET') {
            return await handleCategory(res, 'countries', urlObj);
        }
        if (subPath === 'languages' && req.method === 'GET') {
            return await handleCategory(res, 'languages', urlObj);
        }
        if (subPath === 'codecs' && req.method === 'GET') {
            return await handleCategory(res, 'codecs', urlObj);
        }
        // ===== 记录点击 =====
        if (subPath === 'click' && req.method === 'POST') {
            return await handleClick(req, res);
        }
        // ===== 投票 =====
        if (subPath === 'vote' && req.method === 'POST') {
            return await handleVote(req, res);
        }
        // ===== 服务器统计 =====
        if (subPath === 'stats' && req.method === 'GET') {
            return await handleStats(res);
        }
        // 未匹配路由
        sendJson(res, 404, { success: false, message: '未找到路由' });
    }
    catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error('[OnlineRadio] Error:', errMsg);
        sendJson(res, 500, { success: false, message: errMsg });
    }
}
// ==================== 处理器实现 ====================
/** 高级搜索电台 (Advanced station search) */
async function handleSearchStations(req, res, urlObj) {
    const params = {};
    const searchKeys = ['name', 'nameexact', 'tag', 'tagexact', 'country', 'countryexact',
        'language', 'languageexact', 'codec', 'bitrate', 'state', 'stateexact'];
    for (const key of searchKeys) {
        const val = urlObj.searchParams.get(key);
        if (val)
            params[key] = val;
    }
    // 分页与排序
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');
    const order = urlObj.searchParams.get('order');
    const reverse = urlObj.searchParams.get('reverse') || 'true';
    const hidebroken = urlObj.searchParams.get('hidebroken');
    if (limit)
        params.limit = limit;
    if (offset)
        params.offset = offset;
    if (order)
        params.order = order;
    if (reverse)
        params.reverse = reverse;
    if (hidebroken)
        params.hidebroken = hidebroken;
    // 默认隐藏损坏的电台
    if (!params.hidebroken)
        params.hidebroken = 'true';
    const data = await RadioBrowser.searchStations(params);
    sendJson(res, 200, { success: true, data });
}
/** 最受欢迎电台 (Top voted stations)，支持 limit/offset 分页 */
async function handleTopVote(res, urlObj) {
    const limit = urlObj.searchParams.get('limit') || '50';
    const offset = urlObj.searchParams.get('offset') || '0';
    const data = await RadioBrowser.getStations({ by: 'topvote', limit: parseInt(limit), offset: parseInt(offset) });
    sendJson(res, 200, { success: true, data });
}
/** 最多点击电台 (Most clicked stations)，支持 limit/offset 分页 */
async function handleTopClick(res, urlObj) {
    const limit = urlObj.searchParams.get('limit') || '50';
    const offset = urlObj.searchParams.get('offset') || '0';
    const data = await RadioBrowser.getStations({ by: 'topclick', limit: parseInt(limit), offset: parseInt(offset) });
    sendJson(res, 200, { success: true, data });
}
/** 最近更改电台 (Recently changed stations)，支持 limit/offset 分页 */
async function handleRecent(res, urlObj) {
    const limit = urlObj.searchParams.get('limit') || '50';
    const offset = urlObj.searchParams.get('offset') || '0';
    const data = await RadioBrowser.getStations({ by: 'lastchange', limit: parseInt(limit), offset: parseInt(offset) });
    sendJson(res, 200, { success: true, data });
}
/** 按 UUID 查询电台 (Stations by UUID) */
async function handleByUuid(res, urlObj) {
    const uuids = urlObj.searchParams.get('uuids');
    if (!uuids) {
        sendJson(res, 400, { success: false, message: '缺少 uuids 参数' });
        return;
    }
    const data = await RadioBrowser.getStations({ by: 'uuid', searchterm: uuids });
    sendJson(res, 200, { success: true, data });
}
/** 分类列表 (Category list with caching) */
async function handleCategory(res, category, urlObj) {
    const searchterm = urlObj.searchParams.get('searchterm') || '';
    const order = urlObj.searchParams.get('order') || 'stationcount';
    const reverse = urlObj.searchParams.get('reverse') || 'true';
    const limit = urlObj.searchParams.get('limit') || '200';
    const hidebroken = urlObj.searchParams.get('hidebroken') || 'true';
    const cacheKey = `${category}_${searchterm}_${order}_${reverse}_${limit}`;
    const cached = getCached(cacheKey);
    if (cached) {
        sendJson(res, 200, { success: true, data: cached, cached: true });
        return;
    }
    const filter = {
        order,
        reverse: reverse === 'true',
        hidebroken: hidebroken === 'true',
        limit: parseInt(limit)
    };
    if (searchterm)
        filter.searchterm = searchterm;
    const data = await RadioBrowser.getCategory(category, filter);
    setCache(cacheKey, data);
    sendJson(res, 200, { success: true, data });
}
/** 记录点击 (Count station click) */
async function handleClick(req, res) {
    const body = await readBody(req);
    const { stationuuid } = JSON.parse(body);
    if (!stationuuid) {
        sendJson(res, 400, { success: false, message: '缺少 stationuuid' });
        return;
    }
    const data = await RadioBrowser.clickStation(stationuuid);
    sendJson(res, 200, { success: true, data });
}
/** 投票 (Vote for station) */
async function handleVote(req, res) {
    const body = await readBody(req);
    const { stationuuid } = JSON.parse(body);
    if (!stationuuid) {
        sendJson(res, 400, { success: false, message: '缺少 stationuuid' });
        return;
    }
    const data = await RadioBrowser.voteStation(stationuuid);
    sendJson(res, 200, { success: true, data });
}
/** 服务器统计 (Server stats) */
async function handleStats(res) {
    const data = await RadioBrowser.getServerStats();
    sendJson(res, 200, { success: true, data });
}
// ==================== 流媒体代理 (Stream Proxy) ====================
/** 内网 IP 检测（SSRF 防护） */
function isPrivateHost(hostname) {
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1')
        return true;
    if (hostname.startsWith('10.') || hostname.startsWith('192.168.'))
        return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname))
        return true;
    if (hostname.startsWith('169.254.') || hostname.startsWith('0.'))
        return true;
    return false;
}
// ==================== HTML 流地址解析 ====================
/**
 * 从 HTML 页面中提取实际的音频流 URL
 * 部分电台（如 radio.co）的 /listen URL 返回 HTML 页面而非直接音频流
 * 浏览器打开时渲染内嵌播放器，但 <audio> 元素无法解码 HTML
 */
function extractStreamUrlFromHtml(html, baseUrl) {
    // 匹配常见流地址模式（按优先级排序）
    const patterns = [
        // <source src="..."> 标签
        /<source[^>]+src=["']([^"']+)["']/i,
        // <audio src="..."> 标签
        /<audio[^>]+src=["']([^"']+)["']/i,
        // JS 变量赋值: streamUrl/stream_url/audioUrl/audio_url = "..."
        /(?:streamUrl|stream_url|audioUrl|audio_url|streamSrc|stream_src)\s*[=:]\s*["']([^"']+)["']/i,
        // data-stream-url / data-url 属性
        /data-(?:stream-)?url=["']([^"']+)["']/i,
        // JSON 中的 stream_url / url 字段（如 {"stream_url": "..."}）
        /["'](?:stream_url|streamUrl|audio_url|audioUrl)["']\s*:\s*["']([^"']+)["']/i,
        // Icecast/Shoutcast 常见 .m3u / .pls 链接
        /href=["']([^"']+\.(?:m3u|pls|xspf)(?:\?[^"']*)?)["']/i,
        // 直接的音频流 URL（含常见扩展名）
        /(https?:\/\/[^\s"'<>]+\.(?:mp3|aac|ogg|opus|m3u8|flac)(?:\?[^\s"'<>]*)?)/i,
        // radio.co 风格: /sXXXX/stream 路径
        /(\/s[a-f0-9]+\/stream(?:\?[^\s"'<>]*)?)/i,
    ];
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            let url = match[1];
            // 相对 URL 转绝对 URL
            if (url.startsWith('/')) {
                try {
                    const base = new node_url_1.URL(baseUrl);
                    url = `${base.protocol}//${base.host}${url}`;
                }
                catch { /* ignore */ }
            }
            else if (!url.startsWith('http')) {
                try {
                    url = new node_url_1.URL(url, baseUrl).href;
                }
                catch { /* ignore */ }
            }
            // 验证提取的 URL 不是 HTML 页面
            if (url && !url.endsWith('/listen') && !url.endsWith('/listen/')) {
                console.log(`[RadioProxy] Extracted stream URL from HTML: ${url.substring(0, 80)}`);
                return url;
            }
        }
    }
    console.warn('[RadioProxy] Could not extract stream URL from HTML page');
    return null;
}
/**
 * 解析 PLS 播放列表格式，提取实际音频流 URL
 * PLS 格式示例：
 * [playlist]
 * File1=http://stream-url
 * Title1=Station Name
 * NumberOfEntries=1
 */
function parsePlsPlaylist(body, baseUrl) {
    const match = body.match(/File\d*\s*=\s*(.+)/i);
    if (match && match[1]) {
        let url = match[1].trim();
        // 相对路径转绝对路径
        if (url.startsWith('/')) {
            try {
                const base = new node_url_1.URL(baseUrl);
                url = `${base.protocol}//${base.host}${url}`;
            }
            catch { /* ignore */ }
        }
        else if (!url.startsWith('http')) {
            try {
                url = new node_url_1.URL(url, baseUrl).href;
            }
            catch { /* ignore */ }
        }
        if (url.startsWith('http')) {
            // 如果 File 字段指向同源服务器或播放列表文件自身，
            // 使用服务器根路径 + /stream 作为实际流地址（Icecast/Shoutcast 约定）
            // 场景：File1=http://server:port/ 或 File1=http://server:port/listen.pls
            try {
                const parsed = new node_url_1.URL(url);
                const base = new node_url_1.URL(baseUrl);
                if (parsed.host === base.host || /\.(pls|m3u|xspf)(\?|$)/i.test(parsed.pathname)) {
                    url = `${parsed.protocol}//${parsed.host}/stream`;
                    console.log(`[RadioProxy] PLS File points to same server, using stream endpoint: ${url.substring(0, 80)}`);
                }
            }
            catch { /* ignore */ }
            console.log(`[RadioProxy] PLS playlist, following stream: ${url.substring(0, 80)}`);
            return url;
        }
    }
    console.warn('[RadioProxy] Could not extract stream URL from PLS playlist');
    return null;
}
/**
 * 解析 M3U 播放列表格式，提取实际音频流 URL
 * M3U 格式示例：
 * #EXTM3U
 * #EXTINF:-1,Station Name
 * http://stream-url
 */
function parseM3uPlaylist(body, baseUrl) {
    const lines = body.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        // 跳过空行和注释行
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        // 第一个 http(s) URL 就是流地址
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            console.log(`[RadioProxy] M3U playlist, following stream: ${trimmed.substring(0, 80)}`);
            return trimmed;
        }
        // 相对路径
        if (trimmed.startsWith('/')) {
            try {
                const base = new node_url_1.URL(baseUrl);
                const url = `${base.protocol}//${base.host}${trimmed}`;
                console.log(`[RadioProxy] M3U playlist, following stream: ${url.substring(0, 80)}`);
                return url;
            }
            catch { /* ignore */ }
        }
    }
    console.warn('[RadioProxy] Could not extract stream URL from M3U playlist');
    return null;
}
// ==================== HLS 流处理 ====================
/**
 * 用 ffmpeg 探测 HLS 流的音频编码名称（不依赖 ffprobe，ffmpeg-static 不含 ffprobe）
 * 原理：ffmpeg -i input 会在 stderr 打印流信息后退出，解析 Audio: 行提取 codec
 * 返回小写 codec 名称（如 'aac', 'flac', 'opus', 'mp3'），探测失败返回 null
 */
async function probeHlsAudioCodec(hlsUrl, useProxy = false) {
    const ffmpegBin = (0, ffmpegPath_1.getFfmpegPath)();
    const args = [
        '-hide_banner',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ];
    if (useProxy) {
        const radioProxyEnabled = global.lx?.config?.['radio.proxy.enabled'] || false;
        const proxyAddress = radioProxyEnabled ? (global.lx?.config?.['radio.proxy.address'] || '') : '';
        if (proxyAddress)
            args.push('-http_proxy', proxyAddress);
    }
    args.push('-i', hlsUrl);
    // 不指定输出文件：ffmpeg 打印流信息到 stderr 后以非零码退出（无需额外参数）
    return new Promise((resolve) => {
        const proc = (0, node_child_process_1.spawn)(ffmpegBin, args);
        let stderr = '';
        const timer = setTimeout(() => {
            if (!proc.killed)
                proc.kill('SIGTERM');
            resolve(null); // 超时视为探测失败，降级到转码模式
        }, 5000);
        proc.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > 4096)
                stderr = stderr.slice(-2048);
        });
        proc.on('close', () => {
            clearTimeout(timer);
            // 从 stderr 的 Audio: 行提取编码名称
            // 示例: "Audio: flac, 44100 Hz, stereo, s16" → 'flac'
            // 示例: "Audio: aac (LC), 44100 Hz, stereo, fltp" → 'aac'
            // 示例: "Audio: mp3, 44100 Hz, stereo, fltp" → 'mp3'
            const audioLine = stderr.match(/Audio:\s+(\w+)/);
            const codec = audioLine ? audioLine[1].toLowerCase() : null;
            if (codec) {
                console.log(`[RadioProbe] HLS audio codec detected: ${codec}`);
            }
            else {
                console.warn('[RadioProbe] Could not detect audio codec from ffmpeg output, falling back to transcode');
            }
            resolve(codec);
        });
        proc.on('error', (err) => {
            clearTimeout(timer);
            console.warn(`[RadioProbe] ffmpeg spawn error: ${err.message}, falling back to transcode`);
            resolve(null);
        });
    });
}
/**
 * 解析 HLS Master Playlist，提取最佳音频变体 URL
 * Master Playlist 包含 #EXT-X-STREAM-INF 行，指向子播放列表
 * 优先选择 CODECS 包含 mp4a（AAC 音频）的变体
 */
function parseHlsMasterPlaylist(content, baseUrl) {
    const lines = content.split('\n');
    let bestUrl = null;
    let bestBandwidth = 0;
    let bestIsAudioOnly = false;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line.startsWith('#EXT-X-STREAM-INF:'))
            continue;
        const bandwidth = parseInt(line.match(/BANDWIDTH=(\d+)/)?.[1] || '0');
        const codecs = line.match(/CODECS="([^"]+)"/)?.[1] || '';
        const hasVideo = codecs.includes('avc') || codecs.includes('hvc') || codecs.includes('hev');
        // 识别所有常见音频编码（大小写不敏感）
        const codecsLower = codecs.toLowerCase();
        const isAudioOnly = !hasVideo && (codecs === '' ||
            codecsLower.includes('mp4a') || // AAC-LC / HE-AAC / HE-AACv2 / MP3(in-MP4)
            codecsLower.includes('ac-3') || // Dolby Digital
            codecsLower.includes('ec-3') || // Dolby Digital Plus
            codecsLower.includes('flac') || // FLAC
            codecsLower.includes('opus') || // Opus
            codecsLower.includes('vorb') || // Vorbis
            codecsLower.includes('samr') || // AMR-NB
            codecsLower.includes('sawb') || // AMR-WB
            codecsLower.includes('alac') // ALAC (Apple Lossless)
        );
        // 下一个非空、非注释行是变体 URL
        const nextLine = lines.slice(i + 1).find(l => l.trim() && !l.trim().startsWith('#'))?.trim();
        if (!nextLine)
            continue;
        const variantUrl = nextLine.startsWith('http')
            ? nextLine
            : new node_url_1.URL(nextLine, baseUrl).href;
        // 优先选择纯音频变体，其次选带宽最低的
        if (isAudioOnly && (!bestIsAudioOnly || bandwidth < bestBandwidth)) {
            bestUrl = variantUrl;
            bestBandwidth = bandwidth;
            bestIsAudioOnly = true;
        }
        else if (!bestIsAudioOnly && !bestUrl) {
            bestUrl = variantUrl;
            bestBandwidth = bandwidth;
        }
    }
    return bestUrl;
}
/**
 * HLS 流式转发：通过 ffmpeg 将 HLS (.m3u8) 实时处理为浏览器可播放的音频流
 * AAC/MP3/Opus 源流直接 copy 透传（零 CPU 开销，各自输出对应容器）；
 * 其余编码（FLAC/Vorbis/ALAC/AMR 等）实时转码为 AAC-LC + ADTS 容器；
 * 所有输出格式在全浏览器中可正常播放
 */
async function handleHlsStream(req, res, hlsUrl, useProxy = false, stationId = null) {
    const ffmpegBin = (0, ffmpegPath_1.getFfmpegPath)();
    // 探测源编码：AAC/MP3/Opus 透传，其余转码为 AAC（性能优化）
    const codec = await probeHlsAudioCodec(hlsUrl, useProxy);
    // 根据探测结果选择输出参数
    // AAC → ADTS 容器（AAC 专属）
    // MP3 → MP3 容器（浏览器全面支持 audio/mpeg）
    // Opus → OGG 容器（Chrome/Firefox 支持 audio/ogg）
    // 其它 / 探测失败 → 转码为 AAC-LC + ADTS 容器
    let outputArgs;
    let contentType;
    if (codec === 'aac') {
        outputArgs = ['-c:a', 'copy', '-f', 'adts'];
        contentType = 'audio/aac';
    }
    else if (codec === 'mp3') {
        outputArgs = ['-c:a', 'copy', '-f', 'mp3'];
        contentType = 'audio/mpeg';
    }
    else if (codec === 'opus') {
        outputArgs = ['-c:a', 'copy', '-f', 'ogg'];
        contentType = 'audio/ogg';
    }
    else {
        outputArgs = ['-c:a', 'aac', '-b:a', '256k', '-f', 'adts'];
        contentType = 'audio/aac';
    }
    const mode = ['aac', 'mp3', 'opus'].includes(codec || '') ? 'copy' : 'transcode';
    console.log(`[RadioProxy] HLS ${mode} mode (codec=${codec || 'unknown'}, container=${contentType}): ${hlsUrl.substring(0, 80)}`);
    // 构建 ffmpeg 参数
    const args = [
        '-hide_banner', '-loglevel', 'error',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ];
    // 代理重试：传递 HTTP 代理地址给 ffmpeg（使用电台独立代理配置）
    if (useProxy) {
        const radioProxyEnabled = global.lx?.config?.['radio.proxy.enabled'] || false;
        const proxyAddress = radioProxyEnabled ? (global.lx?.config?.['radio.proxy.address'] || '') : '';
        if (proxyAddress) {
            args.push('-http_proxy', proxyAddress);
        }
    }
    args.push('-i', hlsUrl, '-vn'); // HLS 输入，禁用视频（音频电台无需视频）
    args.push(...outputArgs);
    args.push('pipe:1'); // 输出到 stdout
    const ffmpeg = (0, node_child_process_1.spawn)(ffmpegBin, args);
    let clientDisconnected = false;
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'none');
    const streamInfo = { connection: useProxy ? 'proxy' : 'direct', mode, sourceCodec: codec || 'unknown', targetCodec: mode === 'transcode' ? 'aac' : (codec || 'unknown'), cached: !!res._streamCached };
    res.setHeader('X-Radio-Stream-Info', JSON.stringify(streamInfo));
    if (stationId)
        setStreamCache(stationId, hlsUrl, useProxy, streamInfo);
    res.writeHead(200);
    res.flushHeaders();
    ffmpeg.stdout.pipe(res);
    let stderrBuf = '';
    ffmpeg.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 4096)
            stderrBuf = stderrBuf.slice(-2048);
    });
    ffmpeg.on('close', (code) => {
        if (code !== 0 && !clientDisconnected) {
            console.error(`[RadioProxy] ffmpeg exited with code ${code}: ${stderrBuf.substring(0, 200)}`);
            // [Cache] ffmpeg 流中途失败，清除缓存，下次重连重新解析
            if (stationId)
                deleteStreamCache(stationId);
            if (!res.writableEnded) {
                if (!res.headersSent) {
                    sendJson(res, 502, { success: false, message: 'HLS 转码失败' });
                }
            }
        }
        res.end();
    });
    ffmpeg.on('error', (err) => {
        console.error(`[RadioProxy] ffmpeg spawn error: ${err.message}`);
        if (stationId)
            deleteStreamCache(stationId);
        if (!res.headersSent) {
            sendJson(res, 500, { success: false, message: 'ffmpeg 不可用: ' + err.message });
        }
        res.end();
    });
    // 客户端断连时杀死 ffmpeg
    req.on('close', () => {
        clientDisconnected = true;
        if (!ffmpeg.killed)
            ffmpeg.kill('SIGTERM');
    });
}
/**
 * AAC+ 流转码为 AAC-LC (AAC+ Stream to AAC-LC Transcoding)
 * Icecast 返回 Content-Type: audio/aacp (AAC Plus / HE-AAC)，
 * 浏览器 <audio> 元素无法解码 HE-AAC，通过 ffmpeg 实时转码为 AAC-LC
 * [关键] ffmpeg 直接连接上游 URL，利用 -reconnect 自动重连机制
 * 避免 Node.js HTTP 客户端被服务器主动断连（如 streamtheworld.com 5 秒断连）
 */
function handleAacpStream(req, res, proxyRes, streamUrl, useProxy, stationId = null) {
    const ffmpegBin = (0, ffmpegPath_1.getFfmpegPath)();
    // 释放 Node.js 上游连接（ffmpeg 将直接连接 URL）
    proxyRes.destroy();
    console.log(`[RadioProxy] AAC+ detected, transcoding to AAC-LC via ffmpeg (direct URL): ${streamUrl.substring(0, 80)}`);
    // 构建 ffmpeg 参数：直连上游 URL + 自动重连
    const args = [
        '-hide_banner', '-loglevel', 'error',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    ];
    // 代理重试：传递 HTTP 代理地址给 ffmpeg（使用电台独立代理配置）
    if (useProxy) {
        const radioProxyEnabled = global.lx?.config?.['radio.proxy.enabled'] || false;
        const proxyAddress = radioProxyEnabled ? (global.lx?.config?.['radio.proxy.address'] || '') : '';
        if (proxyAddress) {
            args.push('-http_proxy', proxyAddress);
        }
    }
    args.push('-reconnect', '1', // 连接断开时自动重连
    '-reconnect_streamed', '1', // 对直播流也启用重连
    '-reconnect_delay_max', '5', // 重连最大延迟 5 秒
    '-i', streamUrl, // 直接连接上游 URL
    '-vn', // 禁用视频
    '-c:a', 'aac', '-b:a', '192k', // HE-AAC → AAC-LC 转码
    '-f', 'adts', // 输出 ADTS 容器
    'pipe:1' // 输出到 stdout
    );
    const ffmpeg = (0, node_child_process_1.spawn)(ffmpegBin, args);
    let clientDisconnected = false;
    res.setHeader('Content-Type', 'audio/aac');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'none');
    const streamInfo = { connection: useProxy ? 'proxy' : 'direct', mode: 'transcode', sourceCodec: 'aacp', targetCodec: 'aac', cached: !!res._streamCached };
    res.setHeader('X-Radio-Stream-Info', JSON.stringify(streamInfo));
    if (stationId)
        setStreamCache(stationId, '', useProxy, streamInfo);
    res.writeHead(200);
    res.flushHeaders();
    ffmpeg.stdout.pipe(res);
    let stderrBuf = '';
    ffmpeg.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 4096)
            stderrBuf = stderrBuf.slice(-2048);
    });
    ffmpeg.on('close', (code) => {
        if (code !== 0 && !clientDisconnected) {
            console.error(`[RadioProxy] ffmpeg exited with code ${code}: ${stderrBuf.substring(0, 200)}`);
            // [Cache] ffmpeg 流中途失败，清除缓存，下次重连重新解析
            if (stationId)
                deleteStreamCache(stationId);
            if (!res.writableEnded) {
                if (!res.headersSent) {
                    sendJson(res, 502, { success: false, message: 'AAC+ 转码失败' });
                }
            }
        }
        res.end();
    });
    ffmpeg.on('error', (err) => {
        console.error(`[RadioProxy] ffmpeg spawn error: ${err.message}`);
        if (stationId)
            deleteStreamCache(stationId);
        if (!res.headersSent) {
            sendJson(res, 500, { success: false, message: 'ffmpeg 不可用: ' + err.message });
        }
        res.end();
    });
    // 客户端断连时杀死 ffmpeg
    req.on('close', () => {
        clientDisconnected = true;
        if (!ffmpeg.killed)
            ffmpeg.kill('SIGTERM');
    });
}
/**
 * FLV/MP4 容器流解封装 (Container Remuxing)
 * 部分电台服务 (如 streamtheworld.com) 使用 FLV 或 MP4 容器封装音频，
 * 浏览器 <audio> 元素不支持这些容器格式。
 * [关键] 对 FLV 容器自动探测内部音频编码：
 *   - AAC → 透传为 ADTS (零损失，零 CPU)
 *   - MP3 → 重编码为 MP3 192k (libmp3lame)
 * 直接将上游响应 pipe 到 ffmpeg stdin，避免发起新连接
 * @param containerType 容器类型名称，仅用于日志区分 (如 "FLV"、"MP4")
 * @param useProxy 是否通过代理连接上游
 */
function handleRemuxStream(req, res, proxyRes, containerType, useProxy, stationId = null) {
    const ffmpegBin = (0, ffmpegPath_1.getFfmpegPath)();
    // FLV 容器需要探测内部音频编码（可能是 AAC 或 MP3）
    // MP4 容器电台流统一为 AAC，无需探测
    if (containerType === 'FLV') {
        const chunks = [];
        let totalLen = 0;
        let detected = false;
        const onData = (chunk) => {
            chunks.push(chunk);
            totalLen += chunk.length;
            if (totalLen >= 4096 && !detected)
                tryDetectAndStart();
        };
        proxyRes.on('data', onData);
        const tryDetectAndStart = () => {
            if (detected)
                return;
            detected = true;
            proxyRes.removeListener('data', onData);
            const buf = Buffer.concat(chunks);
            const codec = detectFlvAudioCodec(buf);
            const isMP3 = codec === 'mp3';
            console.log(`[RadioProxy] FLV audio codec: ${codec}, ${isMP3 ? 're-encoding to MP3' : 'remuxing to ADTS (copy)'}`);
            // 重新构建可读流：已缓冲数据 + 剩余上游数据
            const combined = new node_stream_1.Readable({ read() { } });
            combined.push(buf);
            proxyRes.on('data', (chunk) => combined.push(chunk));
            proxyRes.on('end', () => combined.push(null));
            // 探测完成后也要捕获上游错误，避免 ECONNRESET 成为 Uncaught Exception
            proxyRes.on('error', () => combined.push(null));
            startRemuxFfmpeg(req, res, combined, ffmpegBin, containerType, isMP3, useProxy, proxyRes, stationId);
        };
        proxyRes.on('end', () => {
            if (!detected)
                tryDetectAndStart();
        });
        proxyRes.on('error', (err) => {
            if (!detected) {
                detected = true;
                console.error(`[RadioProxy] FLV probe read error: ${err.message}`);
                if (!res.headersSent) {
                    sendJson(res, 502, { success: false, message: '上游流读取失败' });
                }
                res.end();
            }
            // 探测完成后的错误由 tryDetectAndStart 内的 handler 处理
        });
    }
    else {
        // MP4 容器电台流统一为 AAC，直接透传
        console.log(`[RadioProxy] ${containerType} container detected, remuxing to ADTS via ffmpeg (stdin pipe)`);
        startRemuxFfmpeg(req, res, proxyRes, ffmpegBin, containerType, false, useProxy, undefined, stationId);
    }
}
/**
 * 解析 FLV 头部，探测内部音频编码类型
 * FLV 结构: Header(9B) → PrevTagSize(4B) → Tag(tagType=08为音频)
 * 音频 Tag Data 首字节 bit 7-4: 2=MP3, 10=AAC
 * @returns 'aac' | 'mp3' | 'unknown'
 */
function detectFlvAudioCodec(buf) {
    if (buf.length < 13)
        return 'unknown';
    // 验证 FLV 签名: 'FLV'
    if (buf[0] !== 0x46 || buf[1] !== 0x4C || buf[2] !== 0x56)
        return 'unknown';
    let pos = 9; // 跳过 FLV Header (9 bytes)
    const MAX_SCAN = Math.min(buf.length, 8192);
    while (pos + 11 <= MAX_SCAN) {
        pos += 4; // 跳过 PreviousTagSize (4 bytes)
        if (pos + 11 > MAX_SCAN)
            break;
        const tagType = buf[pos] & 0x1F;
        const dataSize = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
        if (tagType === 0x08 && dataSize > 0 && pos + 11 < MAX_SCAN) {
            const audioCodecByte = (buf[pos + 11] >> 4) & 0x0F;
            if (audioCodecByte === 2)
                return 'mp3';
            if (audioCodecByte === 10)
                return 'aac';
            return 'unknown';
        }
        pos += 11 + dataSize;
    }
    return 'unknown';
}
/**
 * 启动 ffmpeg 解封装进程
 * @param source 输入流（已缓冲+剩余数据的组合流，或原始 proxyRes）
 * @param isMP3 true=MP3编码(重编码为MP3), false=AAC(透传为ADTS)
 * @param useProxy 是否通过代理连接上游
 */
function startRemuxFfmpeg(req, res, source, ffmpegBin, containerType, isMP3, useProxy, proxyRes, stationId = null) {
    const args = [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn',
    ];
    if (isMP3) {
        args.push('-c:a', 'libmp3lame', '-b:a', '192k', '-f', 'mp3');
    }
    else {
        args.push('-c:a', 'copy', '-f', 'adts');
    }
    args.push('pipe:1');
    const ffmpeg = (0, node_child_process_1.spawn)(ffmpegBin, args);
    let clientDisconnected = false;
    source.pipe(ffmpeg.stdin);
    res.setHeader('Content-Type', isMP3 ? 'audio/mpeg' : 'audio/aac');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Accept-Ranges', 'none');
    const streamInfo = { connection: useProxy ? 'proxy' : 'direct', mode: isMP3 ? 'transcode' : 'passthrough', sourceCodec: isMP3 ? 'mp3' : 'aac', targetCodec: isMP3 ? 'mp3' : 'aac', container: containerType, cached: !!res._streamCached };
    res.setHeader('X-Radio-Stream-Info', JSON.stringify(streamInfo));
    if (stationId)
        setStreamCache(stationId, '', useProxy, streamInfo);
    res.writeHead(200);
    res.flushHeaders();
    ffmpeg.stdout.pipe(res);
    let stderrBuf = '';
    ffmpeg.stderr.on('data', (chunk) => {
        stderrBuf += chunk.toString();
        if (stderrBuf.length > 4096)
            stderrBuf = stderrBuf.slice(-2048);
    });
    ffmpeg.on('close', (code) => {
        if (code !== 0 && !clientDisconnected) {
            console.error(`[RadioProxy] ${containerType} ffmpeg exited with code ${code}: ${stderrBuf.substring(0, 200)}`);
            // [Cache] ffmpeg 流中途失败，清除缓存，下次重连重新解析
            if (stationId)
                deleteStreamCache(stationId);
            if (!res.writableEnded) {
                if (!res.headersSent) {
                    sendJson(res, 502, { success: false, message: `${containerType} 解封装失败` });
                }
            }
        }
        res.end();
    });
    ffmpeg.on('error', (err) => {
        console.error(`[RadioProxy] ${containerType} ffmpeg spawn error: ${err.message}`);
        if (stationId)
            deleteStreamCache(stationId);
        if (!res.headersSent) {
            sendJson(res, 500, { success: false, message: 'ffmpeg 不可用: ' + err.message });
        }
        res.end();
    });
    req.on('close', () => {
        clientDisconnected = true;
        if (!ffmpeg.killed)
            ffmpeg.kill('SIGTERM');
        // 主动销毁上游连接，避免 ffmpeg 停止读取后服务器断连触发 ECONNRESET
        if (proxyRes && !proxyRes.destroyed)
            proxyRes.destroy();
    });
}
// ==================== 代理 Agent 辅助 ====================
const httpsRxp = /^https:/;
/**
 * 获取电台代理 Agent（用于电台流代理重试）
 * 使用独立的 radio.proxy 配置，支持 http/https/socks 代理
 */
const getProxyAgent = async (targetUrl) => {
    const config = global.lx?.config || {};
    const radioProxyEnabled = config['radio.proxy.enabled'];
    const proxyAddress = radioProxyEnabled ? (config['radio.proxy.address'] || '') : '';
    if (proxyAddress) {
        try {
            const proxyUrl = new node_url_1.URL(proxyAddress);
            if (proxyUrl.protocol === 'http:' || proxyUrl.protocol === 'https:') {
                const isHttps = httpsRxp.test(targetUrl);
                const tunnelOptions = {
                    proxy: {
                        host: proxyUrl.hostname,
                        port: parseInt(proxyUrl.port) || 80,
                        proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined
                    }
                };
                return (isHttps ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions);
            }
            else if (proxyUrl.protocol.startsWith('socks')) {
                const { SocksProxyAgent } = await import('socks-proxy-agent');
                return new SocksProxyAgent(proxyAddress);
            }
        }
        catch (e) {
            // 代理地址解析失败，忽略
        }
    }
    // 回退到环境变量
    if (process.env.HTTPS_PROXY) {
        try {
            const proxyUrl = new node_url_1.URL(process.env.HTTPS_PROXY);
            const tunnelOptions = {
                proxy: {
                    host: proxyUrl.hostname,
                    port: parseInt(proxyUrl.port) || 80,
                    proxyAuth: proxyUrl.username ? `${proxyUrl.username}:${proxyUrl.password}` : undefined
                }
            };
            return (httpsRxp.test(targetUrl) ? tunnel.httpsOverHttp : tunnel.httpOverHttp)(tunnelOptions);
        }
        catch (e) { /* ignore */ }
    }
    return undefined;
};
// ==================== 流代理 ====================
/**
 * 流媒体代理端点 (Stream Proxy Endpoint)
 * 解决浏览器 <audio crossorigin="anonymous"> 强制 CORS 检查，
 * 而 Icecast/Shoutcast 流服务器不返回 Access-Control-Allow-Origin 头的问题。
 * 同时处理自签名 HTTPS 证书、重定向和 HTML 播放页面。
 */
function handleStreamProxy(req, res, urlObj) {
    const targetUrl = urlObj.searchParams.get('url');
    const stationId = urlObj.searchParams.get('id') // stationuuid
    ;
    res._streamCached = false;
    if (!targetUrl) {
        sendJson(res, 400, { success: false, message: '缺少 url 参数' });
        return;
    }
    // 验证协议（仅允许 http/https）
    let parsed;
    try {
        parsed = new node_url_1.URL(targetUrl);
    }
    catch {
        sendJson(res, 400, { success: false, message: '非法 URL' });
        return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        sendJson(res, 400, { success: false, message: '仅支持 http/https 协议' });
        return;
    }
    // SSRF 防护
    if (isPrivateHost(parsed.hostname)) {
        sendJson(res, 403, { success: false, message: '禁止访问内网地址' });
        return;
    }
    const doFetch = async (currentUrl, attempt, useProxy = false, fromCache = false) => {
        if (attempt > 5) {
            if (!res.headersSent) {
                sendJson(res, 502, { success: false, message: '重定向次数过多' });
            }
            return;
        }
        let currentParsed;
        try {
            currentParsed = new node_url_1.URL(currentUrl);
        }
        catch {
            if (!res.headersSent)
                sendJson(res, 400, { success: false, message: '非法重定向 URL' });
            return;
        }
        // 重定向后仍需 SSRF 防护
        if (isPrivateHost(currentParsed.hostname)) {
            if (!res.headersSent)
                sendJson(res, 403, { success: false, message: '重定向到内网地址，已拦截' });
            return;
        }
        const lib = currentParsed.protocol === 'https:' ? node_https_1.default : node_http_1.default;
        const options = {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*'
                // [关键] 不发送 Icy-MetaData: 1，避免 Icecast 在音频流中插入元数据块
                // 浏览器无法解码含 ICY 元数据的音频流
            },
            timeout: 15000,
            // [关键] 容忍自签名 HTTPS 证书（Icecast 服务器常用自签名证书）
            rejectUnauthorized: false
        };
        // [关键] settled 标志：防止响应回调和 timeout/error 事件同时触发导致重复 doFetch
        // 场景：301 响应到达后 socket 仍保持打开，10s socket timeout 可能再次触发
        let settled = false;
        // 安全定时器：兜底超时机制（tunnel 库 CONNECT 隧道下 Node.js 内置 timeout 可能失效）
        let safetyTimer;
        // 代理重试：直连失败后通过电台独立代理重试
        if (useProxy) {
            const radioProxyEnabled = global.lx?.config?.['radio.proxy.enabled'] || false;
            const proxyAddress = radioProxyEnabled ? (global.lx?.config?.['radio.proxy.address'] || '') : '';
            if (proxyAddress) {
                try {
                    const parsedProxy = new node_url_1.URL(proxyAddress);
                    const targetIsHttps = currentParsed.protocol === 'https:';
                    if (!targetIsHttps && (parsedProxy.protocol === 'http:' || parsedProxy.protocol === 'https:')) {
                        // HTTP 目标 + HTTP 代理：使用普通代理转发（GET http://full-url/）
                        // 不使用 CONNECT 隧道，避免代理服务器拒绝（403 Forbidden）
                        options.host = parsedProxy.hostname;
                        options.port = parseInt(parsedProxy.port) || 80;
                        options.path = currentUrl;
                        options.headers = {
                            ...options.headers,
                            'Host': currentParsed.host
                        };
                        if (parsedProxy.username) {
                            const auth = `${decodeURIComponent(parsedProxy.username)}:${decodeURIComponent(parsedProxy.password || '')}`;
                            options.headers['Proxy-Authorization'] = 'Basic ' + Buffer.from(auth).toString('base64');
                        }
                        console.log(`[RadioProxy] Using HTTP proxy forwarding via ${parsedProxy.hostname}:${parsedProxy.port}`);
                    }
                    else {
                        // HTTPS 目标：使用 CONNECT 隧道
                        const agent = await getProxyAgent(currentUrl);
                        if (agent) {
                            options.agent = agent;
                            console.log(`[RadioProxy] Retrying via system proxy: ${currentUrl.substring(0, 60)}...`);
                        }
                    }
                }
                catch (e) {
                    // 代理地址解析失败，回退直连
                }
            }
        }
        // [关键] HTTP 代理转发时不能同时传 URL 和 options
        // Node.js http.request(url, options) 中 URL 会覆盖 options 的 host/port/path
        // 导致代理转发参数失效，请求仍然直连目标
        const proxyReq = (useProxy && options.path === currentUrl)
            ? lib.request(options, (proxyRes) => { handleProxyResponse(proxyRes); })
            : lib.request(currentUrl, options, (proxyRes) => { handleProxyResponse(proxyRes); });
        function handleProxyResponse(proxyRes) {
            settled = true; // 响应已到达，阻止后续 timeout/error 触发重复重试
            clearTimeout(safetyTimer);
            // [关键] 直播流是长连接，禁用 socket 不活动超时
            // 初始连接阶段由 timeout: 15000 和 safetyTimer 保护
            // 响应到达后必须禁用，否则浏览器缓冲导致的数据流间隙会触发超时断连
            if (proxyRes.socket)
                proxyRes.socket.setTimeout(0);
            // 处理重定向 (301/302/303/307/308)
            if (proxyRes.statusCode && [301, 302, 303, 307, 308].includes(proxyRes.statusCode)) {
                const location = proxyRes.headers.location;
                if (location) {
                    const nextUrl = location.startsWith('http') ? location : new node_url_1.URL(location, currentUrl).href;
                    console.log(`[RadioProxy] Redirect [${proxyRes.statusCode}]: ${currentUrl.substring(0, 60)}... -> ${nextUrl.substring(0, 60)}...`);
                    doFetch(nextUrl, attempt + 1, useProxy);
                    return;
                }
            }
            const contentType = proxyRes.headers['content-type'] || 'audio/mpeg';
            const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
            // [关键] 检测 HTML 播放页面（如 radio.co /listen）
            // 部分电台 URL 返回 HTML 页面而非直接音频流
            // <audio> 元素无法解码 HTML，会报 MEDIA_ERR_SRC_NOT_SUPPORTED
            if (isHtml) {
                let body = '';
                let bodySize = 0;
                const MAX_BODY = 64 * 1024; // 最多读取 64KB HTML
                proxyRes.on('data', (chunk) => {
                    bodySize += chunk.length;
                    if (bodySize <= MAX_BODY) {
                        body += chunk.toString('utf-8');
                    }
                });
                proxyRes.on('end', () => {
                    const streamUrl = extractStreamUrlFromHtml(body, currentUrl);
                    if (streamUrl) {
                        console.log(`[RadioProxy] HTML page detected, following stream: ${currentUrl.substring(0, 60)} -> ${streamUrl.substring(0, 60)}`);
                        doFetch(streamUrl, attempt + 1, useProxy);
                    }
                    else {
                        console.warn(`[RadioProxy] HTML page detected but no stream URL found: ${currentUrl.substring(0, 60)}`);
                        if (!res.headersSent) {
                            sendJson(res, 502, { success: false, message: '电台 URL 返回网页而非音频流，无法自动解析流地址' });
                        }
                    }
                });
                return;
            }
            // [关键] 检测 HLS 流 (.m3u8)
            // Chrome/Firefox 的 <audio> 元素不支持原生 HLS 播放
            // 通过 ffmpeg 将 HLS 实时转码为 MP3 流，全浏览器兼容
            // 注意: .m3u 是普通播放列表（非 HLS），需排除，否则 audio/mpegurl 会误匹配
            const isHlsUrl = /\.m3u8(\?|$)/i.test(currentUrl);
            const isPlainM3uUrl = /\.m3u(\?|$)/i.test(currentUrl) && !isHlsUrl;
            const isHlsContentType = !isPlainM3uUrl && (contentType.includes('mpegurl') || contentType.includes('apple.mpegurl'));
            if (isHlsContentType || isHlsUrl) {
                let body = '';
                let bodySize = 0;
                const MAX_PLAYLIST = 128 * 1024;
                proxyRes.on('data', (chunk) => {
                    bodySize += chunk.length;
                    if (bodySize <= MAX_PLAYLIST) {
                        body += chunk.toString('utf-8');
                    }
                });
                proxyRes.on('end', async () => {
                    // 检测 Master Playlist（包含 #EXT-X-STREAM-INF，指向子播放列表）
                    if (body.includes('#EXT-X-STREAM-INF')) {
                        const variantUrl = parseHlsMasterPlaylist(body, currentUrl);
                        if (variantUrl) {
                            console.log(`[RadioProxy] HLS Master Playlist, following audio variant: ${variantUrl.substring(0, 80)}`);
                            doFetch(variantUrl, attempt + 1, useProxy);
                            return;
                        }
                    }
                    // Media Playlist（包含 #EXTINF，实际的 HLS 片段列表）
                    // 使用 ffmpeg 处理为浏览器可播放的音频流
                    if (body.includes('#EXTM3U')) {
                        // [Cache] 成功解析 HLS 流，写入缓存
                        if (stationId && (currentUrl !== targetUrl || useProxy)) {
                            setStreamCache(stationId, currentUrl, useProxy);
                        }
                        await handleHlsStream(req, res, currentUrl, useProxy, stationId);
                        return;
                    }
                    // 可能是普通 M3U 播放列表（content-type 含 mpegurl 但无 HLS 标记）
                    // 尝试作为 M3U 解析，提取实际音频流地址
                    const m3uStreamUrl = parseM3uPlaylist(body, currentUrl);
                    if (m3uStreamUrl) {
                        console.log(`[RadioProxy] mpegurl content is plain M3U playlist (not HLS), following stream: ${m3uStreamUrl.substring(0, 80)}`);
                        doFetch(m3uStreamUrl, attempt + 1, useProxy);
                        return;
                    }
                    // 无法识别的 mpegurl 格式，回退到常规流式转发
                    console.warn('[RadioProxy] Unrecognized mpegurl format, falling through to direct stream');
                    res.setHeader('Content-Type', contentType);
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Accept-Ranges', 'none');
                    res.writeHead(200);
                    res.flushHeaders();
                    res.end(body);
                });
                return;
            }
            // [关键] 检测 PLS/M3U 播放列表格式
            // 浏览器 <audio> 元素无法解码 PLS/M3U 播放列表文件
            // 解析播放列表内容，提取实际音频流地址并跟随
            const isPlsContentType = contentType.includes('scpls');
            const isM3uContentType = contentType.includes('mpegurl') && !isHlsContentType && !isHlsUrl;
            const isPlsUrl = /\.pls(\?|$)/i.test(currentUrl);
            const isM3uUrl = /\.m3u(\?|$)/i.test(currentUrl);
            if (isPlsContentType || isPlsUrl || isM3uContentType || isM3uUrl) {
                let body = '';
                let bodySize = 0;
                const MAX_PLAYLIST = 64 * 1024;
                proxyRes.on('data', (chunk) => {
                    bodySize += chunk.length;
                    if (bodySize <= MAX_PLAYLIST) {
                        body += chunk.toString('utf-8');
                    }
                });
                proxyRes.on('end', () => {
                    const isPls = isPlsContentType || isPlsUrl;
                    const streamUrl = isPls
                        ? parsePlsPlaylist(body, currentUrl)
                        : parseM3uPlaylist(body, currentUrl);
                    if (streamUrl) {
                        doFetch(streamUrl, attempt + 1, useProxy);
                    }
                    else {
                        console.warn(`[RadioProxy] Playlist detected but no stream URL found: ${currentUrl.substring(0, 60)}`);
                        if (!res.headersSent) {
                            sendJson(res, 502, { success: false, message: '播放列表解析失败，无法提取流地址' });
                        }
                    }
                });
                return;
            }
            // [关键] 检测 AAC+ (audio/aacp) 流
            // Icecast 返回的非标准 Content-Type，浏览器无法解码 HE-AAC
            // 通过 ffmpeg 直连上游 URL 实时转码为 AAC-LC
            if (contentType.includes('aacp')) {
                // [Cache] 成功解析 AAC+ 流，写入缓存
                if (stationId && (currentUrl !== targetUrl || useProxy)) {
                    setStreamCache(stationId, currentUrl, useProxy);
                }
                handleAacpStream(req, res, proxyRes, currentUrl, useProxy, stationId);
                return;
            }
            // [关键] 检测 FLV/MP4 容器流
            // 部分电台服务 (如 streamtheworld.com) 使用 FLV 或 MP4 容器封装 AAC 音频
            // 浏览器 <audio> 不支持这些容器，但内部 AAC 编码可无损透传为 ADTS
            if (contentType.includes('application/flv') || contentType.includes('video/x-flv')) {
                // [Cache] 成功解析 FLV 流，写入缓存
                if (stationId && (currentUrl !== targetUrl || useProxy)) {
                    setStreamCache(stationId, currentUrl, useProxy);
                }
                handleRemuxStream(req, res, proxyRes, 'FLV', useProxy, stationId);
                return;
            }
            if (contentType.includes('audio/mp4') || contentType.includes('video/mp4')) {
                // [Cache] 成功解析 MP4 流，写入缓存
                if (stationId && (currentUrl !== targetUrl || useProxy)) {
                    setStreamCache(stationId, currentUrl, useProxy);
                }
                handleRemuxStream(req, res, proxyRes, 'MP4', useProxy, stationId);
                return;
            }
            // 构建响应头（针对 <audio> 元素流式播放优化）
            // [关键] 始终返回 200，即使客户端发送 Range 请求
            // 直播流无固定长度，无法支持 Range，但音频元素可以正常播放 200 响应
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Accept-Ranges', 'none');
            // 转发 ICY 元数据头（供前端显示电台名称等）
            if (proxyRes.headers['icy-name'])
                res.setHeader('icy-name', proxyRes.headers['icy-name']);
            if (proxyRes.headers['icy-genre'])
                res.setHeader('icy-genre', proxyRes.headers['icy-genre']);
            if (proxyRes.headers['icy-description'])
                res.setHeader('icy-description', proxyRes.headers['icy-description']);
            console.log(`[RadioProxy] Streaming: ${currentUrl.substring(0, 80)}... (Content-Type: ${contentType})`);
            const streamInfo = {
                connection: useProxy ? 'proxy' : 'direct',
                mode: 'passthrough',
                contentType: contentType,
                cached: !!res._streamCached
            };
            // [Cache] 仅 proxy 成功时写入缓存（含 streamInfo）
            // redirect 和直通透传不缓存，前端默认即为"直连 · 透传"
            if (useProxy && stationId) {
                setStreamCache(stationId, currentUrl, true, streamInfo);
            }
            res.setHeader('X-Radio-Stream-Info', JSON.stringify(streamInfo));
            res.writeHead(200);
            res.flushHeaders();
            proxyRes.pipe(res);
            // [关键] 上游流断连或出错时，关闭客户端响应，避免前端永远"缓冲中"
            proxyRes.on('error', (err) => {
                console.error(`[RadioProxy] Upstream stream error during passthrough: ${err.message} (url: ${currentUrl.substring(0, 60)})`);
                // [Cache] 流中途断连，清除缓存，下次重连重新解析
                if (stationId)
                    deleteStreamCache(stationId);
                if (!res.writableEnded)
                    res.end();
            });
            res.on('error', (err) => {
                // 客户端断连时静默处理（浏览器切换电台时会 abort 旧连接）
                if (err.code !== 'ECONNRESET') {
                    console.warn(`[RadioProxy] Client response error: ${err.message}`);
                }
                if (!proxyRes.destroyed)
                    proxyRes.destroy();
            });
        }
        proxyReq.on('error', (err) => {
            if (settled)
                return; // 响应已处理，忽略后续错误
            settled = true;
            clearTimeout(safetyTimer);
            console.error(`[RadioProxy] Upstream error: ${err.message} (url: ${currentUrl.substring(0, 60)}...)`);
            // [Cache] 缓存信息连接失败，清除缓存，不用缓存重新走完整解析流程
            if (fromCache && stationId && !res.headersSent) {
                console.log(`[RadioProxy] Cached URL failed, clearing cache and retrying fresh: ${stationId}`);
                deleteStreamCache(stationId);
                doFetch(targetUrl, 0);
                return;
            }
            // 直连失败时尝试通过系统代理重试一次
            if (!useProxy && !res.headersSent) {
                console.log(`[RadioProxy] Retrying via proxy after error: ${currentUrl.substring(0, 60)}...`);
                doFetch(currentUrl, attempt, true);
                return;
            }
            if (!res.headersSent) {
                sendJson(res, 502, { success: false, message: '上游连接失败: ' + err.message });
            }
        });
        proxyReq.on('timeout', () => {
            if (settled)
                return; // 响应已处理，忽略后续超时
            settled = true;
            clearTimeout(safetyTimer);
            console.warn(`[RadioProxy] Upstream timeout: ${currentUrl.substring(0, 60)}...`);
            proxyReq.destroy();
            // [Cache] 缓存信息连接超时，清除缓存，不用缓存重新走完整解析流程
            if (fromCache && stationId && !res.headersSent) {
                console.log(`[RadioProxy] Cached URL timed out, clearing cache and retrying fresh: ${stationId}`);
                deleteStreamCache(stationId);
                doFetch(targetUrl, 0);
                return;
            }
            // 直连超时时尝试通过系统代理重试一次
            if (!useProxy && !res.headersSent) {
                console.log(`[RadioProxy] Retrying via proxy after timeout: ${currentUrl.substring(0, 60)}...`);
                doFetch(currentUrl, attempt, true);
                return;
            }
            if (!res.headersSent) {
                sendJson(res, 504, { success: false, message: '上游连接超时' });
            }
        });
        // 客户端断连时立即销毁上游请求，释放带宽
        req.on('close', () => {
            clearTimeout(safetyTimer);
            if (!proxyReq.destroyed)
                proxyReq.destroy();
        });
        proxyReq.end();
        // [关键] 手动安全定时器：兜底超时机制
        // tunnel 库创建 CONNECT 隧道时自行管理 socket，
        // Node.js 内置的 options.timeout 可能不生效，导致代理重试请求无限挂起
        safetyTimer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            console.warn(`[RadioProxy] Safety timeout (20s): ${currentUrl.substring(0, 60)}...`);
            proxyReq.destroy();
            // [Cache] 缓存信息连接超时 (safety)，清除缓存，不用缓存重新走完整解析流程
            if (fromCache && stationId && !res.headersSent) {
                console.log(`[RadioProxy] Cached URL safety timeout, clearing cache and retrying fresh: ${stationId}`);
                deleteStreamCache(stationId);
                doFetch(targetUrl, 0);
                return;
            }
            // 直连超时时尝试通过系统代理重试一次（与 timeout 事件逻辑一致）
            if (!useProxy && !res.headersSent) {
                console.log(`[RadioProxy] Retrying via proxy after safety timeout: ${currentUrl.substring(0, 60)}...`);
                doFetch(currentUrl, attempt, true);
                return;
            }
            if (!res.headersSent) {
                sendJson(res, 504, { success: false, message: '上游连接超时 (safety)' });
            }
        }, 20000);
    };
    // [Cache] 检查流解析缓存
    /*    if (stationId) {
            const cached = getStreamCache(stationId)
            if (cached) {
                console.log(`[RadioProxy] Cache hit: ${stationId} -> ${cached.resolvedUrl.substring(0, 60)}... (proxy: ${cached.needsProxy})`)
                ;(res as any)._streamCached = true
                doFetch(cached.resolvedUrl, 0, cached.needsProxy, true)
                return
            }
        }*/
    doFetch(targetUrl, 0);
}
