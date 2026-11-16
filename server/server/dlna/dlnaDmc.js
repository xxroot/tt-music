"use strict";
/**
 * DLNA DMC (Digital Media Controller) 核心模块
 *
 * 后端 DMC 状态机：URL解析、播放控制、歌单管理、自动切歌。
 * 独立于 WEB 前端运行，关闭浏览器不影响 DLNA 播放。
 * 通过 GENA 事件订阅接收 DMR 状态变化，替代前端轮询。
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
exports.handleGenEvent = exports.playIndex = exports.setPlayMode = exports.clearPlaylist = exports.removeFromPlaylist = exports.addToPlaylist = exports.updatePlaylistOrder = exports.setPlaylist = exports.previous = exports.next = exports.setVolume = exports.seek = exports.stop = exports.resume = exports.pause = exports.playSong = exports.disconnectDevice = exports.connectDevice = exports.getFullState = exports.initDmc = exports.DMC_MSG_TYPE = void 0;
const upnp = __importStar(require("./upnp"));
const dlnaGena_1 = require("./dlnaGena");
const db_1 = require("../../utils/db");
const userApi_1 = require("../userApi");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const needle_1 = __importDefault(require("needle"));
const node_os_1 = __importDefault(require("node:os"));
const pathUtil_1 = require("../../utils/pathUtil");
// ==================== Types ====================
/** DMC 播放状态常量 */
const DMC_PLAY_STATE = {
    IDLE: 'IDLE',
    CONNECTING: 'CONNECTING',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    TRANSITIONING: 'TRANSITIONING',
    RESOLVING: 'RESOLVING',
    PAUSED_PLAYBACK: 'PAUSED_PLAYBACK'
};
/** DMC 广播消息类型常量 */
exports.DMC_MSG_TYPE = {
    STATE: 'state',
    PLAY_STATE: 'playState',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    RESOLVING: 'resolving',
    SONG_CHANGE: 'songChange',
    ERROR: 'error',
    PROGRESS: 'progress',
    VOLUME: 'volume',
    PLAYLIST: 'playlist',
    PLAY_MODE: 'playMode',
};
const state = {
    playState: DMC_PLAY_STATE.IDLE,
    connectedDevice: null,
    currentSong: null,
    playlist: [],
    playlistIndex: -1,
    playMode: 'list',
    position: 0,
    duration: 0,
    volume: -1,
    isSwitchingTrack: false,
    currentTrackUrl: null,
    consecutiveFailCount: 0,
    dmcInitiatedStop: false,
    genSubscriptions: { avTransport: null, renderingControl: null },
    nextPreloadedSong: null,
    nextPreloadedUrl: null,
    shuffleOrder: [],
    shufflePosition: -1,
    lastValidTotalSeconds: 0,
    lastObservedUri: '',
    pollingTimer: null,
    lastStateEventTime: 0,
    stateEventStaleThreshold: 5000,
    dmcInitiatedStopTimer: null,
};
let broadcastFn = () => {
};
let genCallbackUrl = '';
/** 轮询互斥锁：防止 setInterval + async 回调重叠 */
let pollingInProgress = false;
// ==================== Broadcast Helpers ====================
const broadcast = (type, payload) => {
    broadcastFn({ type, payload });
};
const broadcastFullState = () => {
    broadcast(exports.DMC_MSG_TYPE.STATE, (0, exports.getFullState)());
};
const broadcastPlayState = () => {
    broadcast(exports.DMC_MSG_TYPE.PLAY_STATE, {
        playState: state.playState,
        position: state.position,
        duration: state.duration,
    });
};
// ==================== Initialization ====================
/** 初始化 DMC 模块 */
const initDmc = (broadcast, callbackUrl) => {
    broadcastFn = broadcast;
    genCallbackUrl = callbackUrl;
};
exports.initDmc = initDmc;
/** 获取 DMC 完整状态 */
const getFullState = () => {
    return {
        playState: state.playState,
        connected: state.connectedDevice !== null,
        deviceId: state.connectedDevice?.id || null,
        deviceName: state.connectedDevice?.name || null,
        currentSong: state.currentSong,
        playlist: state.playlist,
        playlistIndex: state.playlistIndex,
        playMode: state.playMode,
        position: state.position,
        duration: state.duration,
        volume: state.volume,
    };
};
exports.getFullState = getFullState;
// ==================== Device Connection ====================
/** 连接 DMR 设备 */
const connectDevice = async (deviceId) => {
    if (state.connectedDevice && state.connectedDevice.id === deviceId) {
        console.log('[DMC] 已连接到设备:', deviceId);
        broadcast(exports.DMC_MSG_TYPE.CONNECTED, { deviceId, deviceName: state.connectedDevice.name });
        return;
    }
    if (state.connectedDevice) {
        await (0, exports.disconnectDevice)();
    }
    state.playState = DMC_PLAY_STATE.CONNECTING;
    broadcastFullState();
    const device = await upnp.getDeviceWithRefresh(deviceId);
    if (!device)
        throw new Error('Device not found. Please scan again.');
    state.connectedDevice = device;
    upnp.setActiveDevice(deviceId, device.name, 'upnp');
    const versionInfo = [];
    if (device.upnpVersion)
        versionInfo.push(`UPNP ${device.upnpVersion}`);
    if (device.dlnaVersion)
        versionInfo.push(`DLNA ${device.dlnaVersion}`);
    const versionStr = versionInfo.length > 0 ? ` (${versionInfo.join(', ')})` : '';
    console.log(`[DMC] 已连接DMR设备: "${device.name}" [${device.manufacturer || '未知'} ${device.model || '未知'}]${versionStr}`);
    try {
        state.volume = await upnp.getVolume(device);
    }
    catch {
        state.volume = -1;
    }
    // 查询设备支持的 AVTransport Actions（非阻塞，不影响连接流程）
    upnp.queryServiceActions(device).catch(() => {
    });
    if (device.avTransportEventUrl || device.renderingControlEventUrl) {
        try {
            const subs = await (0, dlnaGena_1.subscribeEvents)(device, genCallbackUrl);
            state.genSubscriptions = subs;
            // GENA 续订失败后的重新订阅回调
            const handleResubscribe = async (sub) => {
                console.warn(`[DMC] GENA 续订失败，重新订阅: ${sub.serviceId}`);
                // 立即激活轮询兜底，不等待 stale 阈值
                state.lastStateEventTime = 0;
                const currentDevice = state.connectedDevice;
                if (!currentDevice)
                    return;
                const eventSubUrl = sub.serviceId === 'AVTransport'
                    ? currentDevice.avTransportEventUrl
                    : currentDevice.renderingControlEventUrl;
                if (!eventSubUrl)
                    return;
                const newSub = await (0, dlnaGena_1.subscribeService)(eventSubUrl, genCallbackUrl);
                if (newSub) {
                    newSub.serviceId = sub.serviceId;
                    if (sub.serviceId === 'AVTransport') {
                        state.genSubscriptions.avTransport = newSub;
                        (0, dlnaGena_1.startAutoRenew)(newSub, () => {
                        }, handleResubscribe);
                    }
                    else {
                        state.genSubscriptions.renderingControl = newSub;
                        (0, dlnaGena_1.startAutoRenew)(newSub, () => {
                        }, handleResubscribe);
                    }
                    console.log(`[DMC] GENA 重新订阅成功: ${sub.serviceId}`);
                }
                else {
                    console.warn(`[DMC] GENA 重新订阅失败: ${sub.serviceId}`);
                }
            };
            if (subs.avTransport)
                (0, dlnaGena_1.startAutoRenew)(subs.avTransport, () => {
                }, handleResubscribe);
            if (subs.renderingControl)
                (0, dlnaGena_1.startAutoRenew)(subs.renderingControl, () => {
                }, handleResubscribe);
        }
        catch (err) {
            console.error('[DMC] GENA 订阅失败:', err.message);
            throw err;
        }
    }
    state.playState = DMC_PLAY_STATE.IDLE;
    broadcast(exports.DMC_MSG_TYPE.CONNECTED, { deviceId, deviceName: device.name });
    broadcastFullState();
    // 启动轮询兜底（GENA 事件丢失时自动接管）
    startPollingFallback();
};
exports.connectDevice = connectDevice;
/** 断开 DMR 设备 */
const disconnectDevice = async () => {
    stopPollingFallback();
    await (0, dlnaGena_1.unsubscribeAll)(state.genSubscriptions);
    state.genSubscriptions = { avTransport: null, renderingControl: null };
    if (state.connectedDevice) {
        try {
            await upnp.stop(state.connectedDevice);
        }
        catch { /* ignore */
        }
        upnp.setActiveDevice(null, '', '');
    }
    state.connectedDevice = null;
    state.currentSong = null;
    state.playlist = [];
    state.playlistIndex = -1;
    state.position = 0;
    state.duration = 0;
    state.isSwitchingTrack = false;
    state.dmcInitiatedStop = false;
    state.playState = DMC_PLAY_STATE.IDLE;
    state.nextPreloadedSong = null;
    state.nextPreloadedUrl = null;
    state.lastValidTotalSeconds = 0;
    state.lastObservedUri = '';
    state.lastStateEventTime = 0;
    if (state.dmcInitiatedStopTimer) {
        clearTimeout(state.dmcInitiatedStopTimer);
        state.dmcInitiatedStopTimer = null;
    }
    broadcast(exports.DMC_MSG_TYPE.DISCONNECTED, { reason: 'User disconnected' });
    broadcastFullState();
};
exports.disconnectDevice = disconnectDevice;
// ==================== URL Resolution ====================
/** MIME 推断：从文件路径扩展名 */
const MIME_FROM_EXT = {
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.wma': 'audio/x-ms-wma',
    '.ape': 'audio/x-ape',
    '.mp3': 'audio/mpeg',
};
const inferMimeFromPath = (filePath) => {
    const dotIdx = filePath.lastIndexOf('.');
    if (dotIdx >= 0) {
        const ext = filePath.substring(dotIdx).toLowerCase();
        return MIME_FROM_EXT[ext];
    }
    return undefined;
};
/** MIME 推断：从在线音质标识 */
const inferMimeFromQuality = (quality) => {
    switch (quality) {
        case 'flac24bit':
        case 'flac':
            return 'audio/flac';
        case '320k':
        case '128k':
            return 'audio/mpeg';
        default:
            return undefined;
    }
};
/** 获取服务器局域网 IP 地址 */
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
/** 构建 DMR 可访问的局域网 URL */
const buildLanUrl = (relativePath, source) => {
    const port = global.lx?.config?.port || 9527;
    const addresses = getServerAddresses();
    const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
    // 本地库 source: URL 中包含 source 前缀
    if (source && source === 'local') {
        return `http://${host}:${port}/api/music/cache/file/${source}/${encodeURIComponent(relativePath)}`;
    }
    return `http://${host}:${port}/api/music/cache/file/${encodeURIComponent(relativePath)}`;
};
/** 构建封面 URL */
const buildAlbumArtUrl = (song, host, port) => {
    if (song.img && (song.img.startsWith('http://') || song.img.startsWith('https://') || song.img.startsWith('/'))) {
        return song.img.startsWith('/') ? `http://${host}:${port}${song.img}` : song.img;
    }
    if (song.relativePath) {
        // 本地库 source: 添加 source 和 relativePath 参数
        if (song.source && song.source === 'local') {
            return `http://${host}:${port}/api/music/cache/cover?filename=${encodeURIComponent(song.relativePath)}&source=${encodeURIComponent(song.source)}&relativePath=${encodeURIComponent(song.relativePath)}`;
        }
        return `http://${host}:${port}/api/music/cache/cover?filename=${encodeURIComponent(song.relativePath)}`;
    }
    return undefined;
};
/** 解析 interval 字符串为秒数 (格式: "MM:SS"、"HH:MM:SS" 或纯数字秒) */
const parseInterval = (interval) => {
    if (!interval)
        return 0;
    if (typeof interval === 'number')
        return interval;
    const str = String(interval);
    if (str.includes(':')) {
        const parts = str.split(':');
        if (parts.length === 2) {
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        }
        if (parts.length === 3) {
            return parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
        }
    }
    const num = parseInt(str, 10);
    return isNaN(num) ? 0 : num;
};
/** 解析重定向 */
const resolveRedirect = async (url, depth = 0) => {
    if (depth > 3)
        return { url, contentType: null };
    try {
        const resp = await (0, needle_1.default)('head', url, null, {
            follow_max: 0,
            response_timeout: 4000,
            read_timeout: 4000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': new URL(url).origin
            }
        });
        if (resp.statusCode && [301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
            let nextUrl = resp.headers.location;
            if (!nextUrl.startsWith('http')) {
                try {
                    nextUrl = new URL(nextUrl, url).href;
                }
                catch {
                }
            }
            return resolveRedirect(nextUrl, depth + 1);
        }
        if (resp.statusCode === 404 || resp.statusCode === 405) {
            try {
                const getResp = await (0, needle_1.default)('get', url, null, {
                    follow_max: 5,
                    response_timeout: 5000,
                    read_timeout: 5000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                        'Referer': new URL(url).origin,
                        'Range': 'bytes=0-1'
                    }
                });
                if (getResp.statusCode === 206 || getResp.statusCode === 200) {
                    const finalUrl = getResp.uri ? String(getResp.uri) : url;
                    return { url: finalUrl, contentType: getResp.headers['content-type'] || null };
                }
            }
            catch { /* ignore */
            }
        }
        return { url, contentType: resp.headers['content-type'] || null };
    }
    catch {
        return { url, contentType: null };
    }
};
/** 检查本地文件是否存在 */
const checkLocalFile = (relativePath) => {
    const fullPath = node_path_1.default.join((0, pathUtil_1.getDownloadDir)(), relativePath);
    return node_fs_1.default.existsSync(fullPath);
};
/** 从数据库查找缓存记录 */
const findCachedRecord = (song) => {
    // 本地库 source: 直接检查文件存在性
    if (song.source && song.source === 'local' && song.relativePath) {
        try {
            const localLib = require('../localLibrary');
            const absolutePath = localLib.resolveLocalFilePath(song.source, song.relativePath);
            if (absolutePath)
                return { relative_path: song.relativePath };
        }
        catch {
            // 降级到原有逻辑
        }
        return null;
    }
    if (song._isMusicLibSong && song.relativePath) {
        const record = (0, db_1.getDownloadRecordByRelativePath)(song.relativePath);
        if (record?.relative_path)
            return record;
        if (checkLocalFile(song.relativePath))
            return { relative_path: song.relativePath };
    }
    if (song.id) {
        // song.id 格式为 "source_songId", 需要拆分
        const songIdStr = String(song.id);
        const underscoreIdx = songIdStr.indexOf('_');
        const source = underscoreIdx > 0 ? songIdStr.substring(0, underscoreIdx) : 'unknown';
        const rawSongId = underscoreIdx > 0 ? songIdStr.substring(underscoreIdx + 1) : songIdStr;
        const record = (0, db_1.getDownloadRecordBySongId)(source, rawSongId);
        if (record?.relative_path)
            return record;
    }
    const recordByName = (0, db_1.getDownloadRecordByName)(song.name, song.singer, song.albumName);
    return recordByName?.relative_path ? recordByName : null;
};
/** 解析歌曲 URL */
const resolveSongUrl = async (song) => {
    // 0. 直接 URL 短路（电台等直接流）
    if (song.directUrl) {
        return { url: song.directUrl, source: 'direct' };
    }
    // 1. 检查本地缓存
    const cachedRecord = findCachedRecord(song);
    if (cachedRecord?.relative_path) {
        const url = buildLanUrl(cachedRecord.relative_path, song.source);
        const mimeType = inferMimeFromPath(cachedRecord.relative_path);
        return { url, source: 'server_cache', mimeType };
    }
    // 2. 在线获取
    const QUALITY_PRIORITY = ['flac24bit', 'flac', '320k', '128k'];
    const requestedQuality = song.quality;
    const isValidQuality = requestedQuality && QUALITY_PRIORITY.includes(requestedQuality);
    const startIndex = isValidQuality ? QUALITY_PRIORITY.indexOf(requestedQuality) : 0;
    const qualitiesToTry = QUALITY_PRIORITY.slice(startIndex);
    for (const quality of qualitiesToTry) {
        try {
            broadcast(exports.DMC_MSG_TYPE.RESOLVING, { songName: song.name, quality });
            const onlineUrl = await (0, userApi_1.callUserApiGetMusicUrl)(song.source, song, quality);
            if (onlineUrl?.url) {
                let finalUrl = onlineUrl.url;
                // 解析重定向
                if (finalUrl.startsWith('http')) {
                    const resolveResult = await resolveRedirect(finalUrl);
                    if (resolveResult.url !== finalUrl)
                        finalUrl = resolveResult.url;
                }
                // HTTPS → HTTP 转换
                if (finalUrl.startsWith('https://'))
                    finalUrl = finalUrl.replace('https://', 'http://');
                return { url: finalUrl, source: 'online', mimeType: inferMimeFromQuality(quality) };
            }
        }
        catch { /* 尝试下一个音质 */
        }
    }
    throw new Error(`Cannot resolve URL for: ${song.name}`);
};
// ==================== Playback Control ====================
/**
 * 动态就绪探测：轮询 GetTransportInfo 直到设备回到 STOPPED/NO_MEDIA_PRESENT
 * 用于 DMP-A6（XMOS 继电器锁定采样率慢）、HQPlayer（重采样管道就绪）
 */
const waitForDeviceReady = async (device, profile) => {
    for (let i = 0; i < profile.readinessMaxRetry; i++) {
        await new Promise(r => setTimeout(r, profile.readinessInterval));
        try {
            const info = await upnp.getTransportInfo(device);
            console.log('[DMC] GetTransportInfo', info);
            if (profile.type === 'DMP_A6' || profile.type === 'HQPLAYER') {
                if (info.currentTransportStatus === 'OK') {
                    return;
                }
            }
            else {
                if (info.currentTransportState === 'STOPPED'
                    || info.currentTransportState === 'NO_MEDIA_PRESENT'
                    || info.currentTransportState === 'PAUSED_PLAYBACK'
                    || info.currentTransportState === 'PAUSED') {
                    return; // 设备就绪
                }
            }
        }
        catch { /* 忽略单个探测失败 */
        }
    }
    console.warn(`[DMC] 动态就绪探测超时 (${profile.readinessMaxRetry * profile.readinessInterval}ms)，继续执行`);
};
/** 播放指定歌曲 */
const playSong = async (song, index) => {
    if (!state.connectedDevice)
        throw new Error('No device connected');
    state.isSwitchingTrack = true;
    state.playState = DMC_PLAY_STATE.RESOLVING;
    // broadcastPlayState()
    if (index !== undefined)
        state.playlistIndex = index;
    broadcast(exports.DMC_MSG_TYPE.RESOLVING, { songName: song.name });
    try {
        // 检查预加载 URL
        let url;
        let source;
        let mimeType;
        if (state.nextPreloadedSong?.id === song.id && state.nextPreloadedUrl) {
            url = state.nextPreloadedUrl;
            source = 'preloaded';
        }
        else {
            // [Bug C fix] 整体超时 30s，防止 resolveSongUrl 无限挂起导致"解析中"卡死
            const resolved = await Promise.race([
                resolveSongUrl(song),
                new Promise((_, reject) => setTimeout(() => reject(new Error('URL解析超时(30s)')), 30000))
            ]);
            url = resolved.url;
            source = resolved.source;
            mimeType = resolved.mimeType;
        }
        // 构建 DIDL
        const addresses = getServerAddresses();
        const port = global.lx?.config?.port || 9527;
        const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
        const albumArtUrl = buildAlbumArtUrl(song, host, port);
        const durationSec = parseInterval(song.interval);
        const didl = upnp.buildSongDIDL(url, song.name, song.singer, song.albumName, albumArtUrl, mimeType, durationSec);
        state.playState = DMC_PLAY_STATE.TRANSITIONING;
        // broadcastPlayState()
        const profile = state.connectedDevice.profile;
        // Pre-Stop：根据 Profile 决定是否需要先 Stop，并采用动态就绪探测或固定延迟
        if (profile?.preStopRequired) {
            if (state.dmcInitiatedStopTimer)
                clearTimeout(state.dmcInitiatedStopTimer);
            state.dmcInitiatedStop = true;
            state.dmcInitiatedStopTimer = setTimeout(() => {
                state.dmcInitiatedStop = false;
                state.dmcInitiatedStopTimer = null;
            }, 10000);
            try {
                await upnp.stop(state.connectedDevice);
            }
            catch { /* ignore - 可能当前无播放 */
            }
            // 动态就绪探测 or 固定延迟
            if (profile.dynamicReadiness) {
                await waitForDeviceReady(state.connectedDevice, profile);
            }
            else {
                await new Promise(resolve => setTimeout(resolve, profile.minTransitionDelay));
            }
        }
        // SetAVTransportURI（带 DIDL 失败时 fallback 无 DIDL）
        let setUriOk = false;
        try {
            await upnp.setAVTransportURI(state.connectedDevice, url, didl);
            setUriOk = true;
        }
        catch {
            try {
                await upnp.setAVTransportURI(state.connectedDevice, url, '');
                setUriOk = true;
                console.log('[DMC] SetAVTransportURI fallback (no metadata) succeeded');
            }
            catch { /* 设置 URI 失败，不继续 play */
            }
        }
        if (setUriOk) {
            // DMP-A6/HQPlayer: SetAVTransportURI 后等待设备就绪再 Play
            if (profile?.dynamicReadiness) {
                await waitForDeviceReady(state.connectedDevice, profile);
            }
            await upnp.play(state.connectedDevice);
        }
        else {
            throw new Error('SetAVTransportURI failed');
        }
        state.currentSong = song;
        state.currentTrackUrl = url;
        state.position = 0;
        state.duration = 0;
        state.consecutiveFailCount = 0;
        state.nextPreloadedSong = null;
        state.nextPreloadedUrl = null;
        // 重置进度阻尼器与 URI 追踪
        state.lastValidTotalSeconds = 0;
        state.lastObservedUri = url;
        // [Bug A fix] 显式设置 PLAYING 状态（之前发送了错误的 TRANSITIONING）
        state.playState = DMC_PLAY_STATE.PLAYING;
        // [Bug B fix] 提前释放 isSwitchingTrack，允许 GENA PLAYING 事件更新状态
        state.isSwitchingTrack = false;
        // [Fix] play 已成功，清除 pre-stop 保护标志，后续 STOPPED 应触发自动切歌
        if (state.dmcInitiatedStopTimer) {
            clearTimeout(state.dmcInitiatedStopTimer);
            state.dmcInitiatedStopTimer = null;
        }
        state.dmcInitiatedStop = false;
        broadcast(exports.DMC_MSG_TYPE.SONG_CHANGE, { song, index: state.playlistIndex });
        broadcastPlayState();
        // 异步预加载下一首
        void preloadNextTrack();
    }
    catch (err) {
        state.playState = DMC_PLAY_STATE.IDLE;
        broadcastPlayState();
        state.consecutiveFailCount++;
        broadcast(exports.DMC_MSG_TYPE.ERROR, { message: `无法播放: ${song.name} - ${err.message}` });
        if (state.consecutiveFailCount >= 3) {
            state.consecutiveFailCount = 0;
            return;
        }
        setTimeout(() => {
            if (state.playlist.length > 0 && state.playState === DMC_PLAY_STATE.IDLE) {
                void (0, exports.next)();
            }
        }, 1000);
    }
    finally {
        // 保护：成功路径已提前释放，此处仅兜底错误路径
        if (state.isSwitchingTrack)
            state.isSwitchingTrack = false;
        if (state.dmcInitiatedStopTimer) {
            clearTimeout(state.dmcInitiatedStopTimer);
            state.dmcInitiatedStopTimer = null;
        }
        state.dmcInitiatedStop = false;
    }
};
exports.playSong = playSong;
/** 暂停播放 */
const pause = async () => {
    if (!state.connectedDevice || state.playState === DMC_PLAY_STATE.PAUSED)
        return;
    await upnp.pause(state.connectedDevice);
    state.playState = DMC_PLAY_STATE.PAUSED;
    broadcastPlayState();
};
exports.pause = pause;
/** 恢复播放 */
const resume = async () => {
    if (!state.connectedDevice || state.playState !== DMC_PLAY_STATE.PAUSED)
        return;
    await upnp.play(state.connectedDevice);
    state.playState = DMC_PLAY_STATE.PLAYING;
    broadcastPlayState();
};
exports.resume = resume;
/** 停止播放 */
const stop = async () => {
    if (!state.connectedDevice)
        return;
    if (state.dmcInitiatedStopTimer)
        clearTimeout(state.dmcInitiatedStopTimer);
    state.dmcInitiatedStop = true;
    state.dmcInitiatedStopTimer = setTimeout(() => {
        state.dmcInitiatedStop = false;
        state.dmcInitiatedStopTimer = null;
    }, 10000);
    try {
        await upnp.stop(state.connectedDevice);
    }
    catch { /* ignore */
    }
    state.playState = DMC_PLAY_STATE.IDLE;
    state.position = 0;
    state.duration = 0;
    state.currentSong = null;
    state.currentTrackUrl = null;
    // 清除 stop 保护定时器（flag 已在下方同步重置）
    if (state.dmcInitiatedStopTimer) {
        clearTimeout(state.dmcInitiatedStopTimer);
        state.dmcInitiatedStopTimer = null;
    }
    state.dmcInitiatedStop = false;
    state.nextPreloadedSong = null;
    state.nextPreloadedUrl = null;
    state.lastValidTotalSeconds = 0;
    state.lastObservedUri = '';
    broadcastPlayState();
};
exports.stop = stop;
/** 跳转进度 */
const seek = async (seconds) => {
    if (!state.connectedDevice)
        return;
    const timeStr = upnp.secondsToTime(seconds);
    await upnp.seek(state.connectedDevice, timeStr);
    state.position = seconds;
    broadcast(exports.DMC_MSG_TYPE.PROGRESS, { position: state.position, duration: state.duration });
};
exports.seek = seek;
/** 设置音量 */
const setVolume = async (level) => {
    if (!state.connectedDevice)
        return;
    await upnp.setVolume(state.connectedDevice, level);
    state.volume = level;
    broadcast(exports.DMC_MSG_TYPE.VOLUME, { volume: state.volume });
};
exports.setVolume = setVolume;
/** 下一首 */
const next = async () => {
    const nextIndex = getNextIndex();
    if (nextIndex < 0 || nextIndex >= state.playlist.length) {
        console.log('[DMC] 没有下一首可用');
        state.playState = DMC_PLAY_STATE.IDLE;
        state.currentSong = null;
        broadcastPlayState();
        return;
    }
    await (0, exports.playSong)(state.playlist[nextIndex], nextIndex);
};
exports.next = next;
/** 上一首 */
const previous = async () => {
    const prevIndex = getPreviousIndex();
    if (prevIndex < 0 || prevIndex >= state.playlist.length) {
        console.log('[DMC] 没有上一首可用');
        return;
    }
    await (0, exports.playSong)(state.playlist[prevIndex], prevIndex);
};
exports.previous = previous;
// ==================== Preloading ====================
/** 预加载下一首 */
const preloadNextTrack = async () => {
    if (!state.connectedDevice)
        return;
    const nextIndex = getNextIndex();
    if (nextIndex < 0 || nextIndex >= state.playlist.length) {
        state.nextPreloadedSong = null;
        state.nextPreloadedUrl = null;
        return;
    }
    const nextSong = state.playlist[nextIndex];
    try {
        const { url } = await resolveSongUrl(nextSong);
        // Gapless Playback: 如果设备支持 SetNextAVTransportURI，提前推送下一首
        const device = state.connectedDevice;
        const supportsNext = device.supportedActions?.includes('SetNextAVTransportURI');
        if (supportsNext) {
            try {
                const addresses = getServerAddresses();
                const port = global.lx?.config?.port || 9527;
                const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
                const albumArtUrl = buildAlbumArtUrl(nextSong, host, port);
                const nextDurationSec = parseInterval(nextSong.interval);
                const didl = upnp.buildSongDIDL(url, nextSong.name, nextSong.singer, nextSong.albumName, albumArtUrl, undefined, nextDurationSec);
                await upnp.setNextAVTransportURI(device, url, didl);
                console.log(`[DMC] Gapless: 已预加载下一首到 DMR: ${nextSong.name}`);
            }
            catch (err) {
                console.warn(`[DMC] Gapless: SetNextAVTransportURI 失败 (设备可能不支持): ${err.message}`);
            }
        }
        state.nextPreloadedSong = nextSong;
        state.nextPreloadedUrl = url;
    }
    catch {
        state.nextPreloadedSong = null;
        state.nextPreloadedUrl = null;
    }
};
// ==================== Playlist Management ====================
/** 歌单比较 */
const isPlaylistEqual = (a, b) => {
    if (!a || !b)
        return a === b;
    if (a.length !== b.length)
        return false;
    return a.every((song, i) => song.id === b[i]?.id);
};
/** 设置播放列表 */
const setPlaylist = (songs, startIndex, playImmediately) => {
    const isSamePlaylist = isPlaylistEqual(state.playlist, songs);
    if (isSamePlaylist && !playImmediately)
        return;
    state.consecutiveFailCount = 0;
    state.playlist = [...(songs || [])];
    // 歌单变化时重置洗牌顺序（随机模式需要）
    if (state.playMode === 'random') {
        resetShuffleState();
        startIndex = state.shuffleOrder[0];
    }
    console.log('[DMC] 设置播放列表:', songs.length, '从', startIndex, '开始播放', playImmediately);
    if (state.connectedDevice) {
        if (state.dmcInitiatedStopTimer)
            clearTimeout(state.dmcInitiatedStopTimer);
        state.dmcInitiatedStop = true;
        state.dmcInitiatedStopTimer = setTimeout(() => {
            state.dmcInitiatedStop = false;
            state.dmcInitiatedStopTimer = null;
        }, 10000);
        try {
            void upnp.stop(state.connectedDevice);
        }
        catch { /* ignore */
        }
    }
    if (!songs || songs.length === 0) {
        state.playlistIndex = -1;
        state.currentSong = null;
    }
    else if (playImmediately) {
        if (startIndex < 0 || startIndex >= songs.length)
            startIndex = 0;
        state.playlistIndex = startIndex;
        if (state.connectedDevice) {
            void (0, exports.playSong)(songs[startIndex], startIndex);
        }
    }
    broadcast(exports.DMC_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
};
exports.setPlaylist = setPlaylist;
/** 更新歌单顺序 */
const updatePlaylistOrder = (songs) => {
    const currentId = state.currentSong?.id;
    state.playlist = [...songs];
    if (currentId) {
        const newIndex = state.playlist.findIndex(s => s.id === currentId);
        if (newIndex >= 0)
            state.playlistIndex = newIndex;
    }
    broadcast(exports.DMC_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
};
exports.updatePlaylistOrder = updatePlaylistOrder;
/** 追加歌曲 */
const addToPlaylist = (songs) => {
    state.playlist.push(...songs);
    broadcast(exports.DMC_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
};
exports.addToPlaylist = addToPlaylist;
/** 移除歌曲 */
const removeFromPlaylist = (indices) => {
    const sorted = [...indices].sort((a, b) => b - a);
    const currentIndex = state.playlistIndex;
    for (const idx of sorted) {
        if (idx >= 0 && idx < state.playlist.length) {
            state.playlist.splice(idx, 1);
        }
    }
    if (currentIndex >= 0) {
        const currentId = state.currentSong?.id;
        if (currentId) {
            const newIndex = state.playlist.findIndex(s => s.id === currentId);
            state.playlistIndex = newIndex >= 0 ? newIndex : -1;
        }
    }
    broadcast(exports.DMC_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
};
exports.removeFromPlaylist = removeFromPlaylist;
/** 清空歌单 */
const clearPlaylist = () => {
    state.playlist = [];
    state.playlistIndex = -1;
    if (state.playState !== DMC_PLAY_STATE.IDLE) {
        void (0, exports.stop)();
    }
    broadcast(exports.DMC_MSG_TYPE.PLAYLIST, { songs: [], index: -1 });
};
exports.clearPlaylist = clearPlaylist;
/** 设置播放模式 */
const setPlayMode = (mode) => {
    state.playMode = mode;
    broadcast(exports.DMC_MSG_TYPE.PLAY_MODE, { playMode: state.playMode });
    // 切换到随机模式时重新洗牌（不中断当前播放，仅影响后续切歌）
    if (state.playMode === 'random') {
        resetShuffleState();
    }
    // 切换模式后重新预加载下一首
    state.nextPreloadedSong = null;
    state.nextPreloadedUrl = null;
    void preloadNextTrack();
};
exports.setPlayMode = setPlayMode;
/** 播放指定 index 的歌曲 */
const playIndex = async (index) => {
    if (!state.connectedDevice)
        throw new Error('No device connected');
    if (index < 0 || index >= state.playlist.length) {
        throw new Error(`Invalid index: ${index}, playlist length: ${state.playlist.length}`);
    }
    const song = state.playlist[index];
    await (0, exports.playSong)(song, index);
};
exports.playIndex = playIndex;
// ==================== Polling Fallback ====================
/**
 * 启动轮询兜底定时器
 * GENA 事件新鲜时跳过，GENA 事件丢失超过阈值时自动接管
 */
const startPollingFallback = () => {
    if (state.pollingTimer)
        clearInterval(state.pollingTimer);
    pollingInProgress = false;
    const profile = state.connectedDevice?.profile;
    const interval = profile?.pollInterval ?? 1000;
    state.pollingTimer = setInterval(async () => {
        if (!state.connectedDevice || state.isSwitchingTrack || pollingInProgress)
            return;
        // 仅在播放或过渡状态下轮询，避免 IDLE/PAUSED 时无谓请求
        if (state.playState !== DMC_PLAY_STATE.PLAYING &&
            state.playState !== DMC_PLAY_STATE.TRANSITIONING &&
            state.playState !== DMC_PLAY_STATE.PAUSED)
            return;
        // GENA/状态事件新鲜 → 跳过轮询
        const timeSinceEvent = Date.now() - state.lastStateEventTime;
        if (state.lastStateEventTime > 0 && timeSinceEvent < state.stateEventStaleThreshold)
            return;
        pollingInProgress = true;
        try {
            if (profile?.serialPoll) {
                // Yamaha 串行轮询：禁止并发请求导致硬件崩溃
                const info = await upnp.getTransportInfo(state.connectedDevice);
                await new Promise(r => setTimeout(r, 100)); // 给硬件留出 CPU 善息时间
                const pos = await upnp.getPositionInfo(state.connectedDevice);
                handlePollingResult(info, pos);
            }
            else {
                // 正常设备：并发轮询
                const [info, pos] = await Promise.all([
                    upnp.getTransportInfo(state.connectedDevice),
                    upnp.getPositionInfo(state.connectedDevice),
                ]);
                handlePollingResult(info, pos);
            }
        }
        catch (err) {
            console.warn('[DMC] 轮询兜底失败:', err.message);
        }
        finally {
            pollingInProgress = false;
        }
    }, interval);
};
/** 停止轮询兜底定时器 */
const stopPollingFallback = () => {
    if (state.pollingTimer) {
        clearInterval(state.pollingTimer);
        state.pollingTimer = null;
    }
    pollingInProgress = false;
};
/**
 * 处理轮询结果：构造 GenStateEvent 后复用 handleAvTransportEvent
 */
const handlePollingResult = (info, pos) => {
    const event = {
        transportState: info.currentTransportState,
        trackURI: pos.trackURI,
        trackDuration: pos.trackDuration,
        relTime: pos.relTime,
        source: '轮询'
    };
    // 更新 lastStateEventTime 防止轮询和 GENA 互相触发
    // state.lastStateEventTime = Date.now()
    handleAvTransportEvent(event);
};
// ==================== GENA Event Handling ====================
/** 处理 GENA NOTIFY 事件 */
const handleGenEvent = (sid, xmlBody) => {
    // 更新状态事件时间戳
    state.lastStateEventTime = Date.now();
    const serviceId = (0, dlnaGena_1.identifyServiceBySid)(sid, state.genSubscriptions);
    if (!serviceId)
        return;
    const event = (0, dlnaGena_1.parseLastChangeXml)(xmlBody);
    if (serviceId === 'AVTransport') {
        handleAvTransportEvent(event);
    }
    else if (serviceId === 'RenderingControl') {
        handleRenderingControlEvent(event);
    }
};
exports.handleGenEvent = handleGenEvent;
/** 处理 DMR 播放结束/自动切歌 */
const handleDmrTrackEnded = () => {
    // DMC 主动停止期间不触发自动切歌
    if (state.dmcInitiatedStop) {
        console.log('[DMC] handleDmrTrackEnded 被 dmcInitiatedStop 抑制');
        state.dmcInitiatedStop = false;
        return;
    }
    if (state.nextPreloadedSong && state.nextPreloadedUrl && state.nextPreloadedSong.id !== state.currentSong?.id) {
        const nextIndex = state.playlist.findIndex(s => s.id === state.nextPreloadedSong.id);
        if (nextIndex >= 0) {
            void (0, exports.playSong)(state.nextPreloadedSong, nextIndex);
        }
        else {
            state.playState = DMC_PLAY_STATE.IDLE;
            state.currentSong = null;
            state.nextPreloadedSong = null;
            state.nextPreloadedUrl = null;
            broadcastPlayState();
        }
    }
    else {
        state.playState = DMC_PLAY_STATE.IDLE;
        state.currentSong = null;
        state.nextPreloadedSong = null;
        state.nextPreloadedUrl = null;
        broadcastPlayState();
    }
};
/**
 * 检测 DMR 硬件上的切歌行为（遥控器/屏幕操作）
 * 通过 TrackURI 变化检测，同步内部状态
 */
const handleHardwareTrackChange = (trackUri) => {
    // 尝试在播放列表中匹配 URI
    // 注意：DLNA URI 包含服务器地址和路径，需要匹配相对路径部分
    const matchedIndex = state.playlist.findIndex(s => {
        if (s.directUrl && trackUri === s.directUrl)
            return true;
        // 匹配 URI 中是否包含歌曲的相对路径（比 ID 子串匹配更精确）
        if (s.relativePath && trackUri.includes(encodeURIComponent(s.relativePath)))
            return true;
        return false;
    });
    if (matchedIndex !== -1) {
        console.log(`[DMC] 硬件切歌检测：匹配到播放列表索引 ${matchedIndex}`);
        state.playlistIndex = matchedIndex;
        state.currentSong = state.playlist[matchedIndex];
        state.currentTrackUrl = trackUri;
        state.lastValidTotalSeconds = 0;
        broadcast(exports.DMC_MSG_TYPE.SONG_CHANGE, { song: state.currentSong, index: matchedIndex });
        broadcastPlayState();
        void preloadNextTrack();
    }
    else {
        console.log(`[DMC] 外部流劫持：URI=${trackUri}`);
        state.playState = DMC_PLAY_STATE.IDLE;
        state.currentSong = null;
        broadcastPlayState();
    }
};
/** 处理 AVTransport 事件 */
const handleAvTransportEvent = (event) => {
    // 切歌期间：仅忽略状态变化事件，进度事件仍可通过（经 URI 过滤）
    if (state.isSwitchingTrack && event.transportState) {
        return;
    }
    console.log('[DMC] ===>响应:AVTransport event:', decodeURIComponent(JSON.stringify(event)), 'current state:', state.playState);
    const profile = state.connectedDevice?.profile;
    // 硬件切歌检测：PLAYING 状态下 TrackURI 变化
    // 注意：isSwitchingTrack=true 时已在函数入口 return，此处无需重复判断
    if (event.transportState === 'PLAYING' && event.trackURI && event.trackURI !== state.lastObservedUri) {
        handleHardwareTrackChange(event.trackURI);
        state.lastObservedUri = event.trackURI;
        return;
    }
    // 状态变化
    if (event.transportState) {
        const newState = event.transportState;
        if (newState === 'PLAYING') {
            state.playState = DMC_PLAY_STATE.PLAYING;
        }
        else if (newState === 'PAUSED_PLAYBACK') {
            state.playState = DMC_PLAY_STATE.PAUSED;
            // DMP-A6 特殊行为：自然结束时先发 PAUSED 再发 STOPPED
            // 仅在时长 > 100 且进度接近末尾时触发
            /*         if (event.trackDuration && upnp.timeToSeconds(event.trackDuration) > 100) {
                         const total = upnp.timeToSeconds(event.trackDuration)
                         const progress = total > 0 ? state.position / total : 0
                         if (progress > 0.95) {
                             handleDmrTrackEnded()
                             return
                         }
                     }*/
        }
        else if (newState === 'STOPPED') {
            // DMC 主动停止 → 不触发自动切歌
            if (state.dmcInitiatedStop) {
                console.log('[DMC] STOPPED 被 dmcInitiatedStop 抑制 (pre-stop 保护)');
                state.dmcInitiatedStop = false;
                state.playState = DMC_PLAY_STATE.IDLE;
                broadcastPlayState();
                return;
            }
            // 自然播放结束 → 自动下一首
            if (state.playState === DMC_PLAY_STATE.PLAYING || state.playState === DMC_PLAY_STATE.PAUSED) {
                handleDmrTrackEnded();
                return;
            }
            state.playState = DMC_PLAY_STATE.IDLE;
        }
        else if (newState === 'NO_MEDIA_PRESENT') {
            state.playState = DMC_PLAY_STATE.IDLE;
        }
        else if (newState === 'TRANSITIONING') {
            state.playState = DMC_PLAY_STATE.TRANSITIONING;
        }
        else {
            console.warn('[DMC] Unhandled AVTransport event:', newState);
        }
        broadcastPlayState();
    }
    // 更新进度（带过滤与阻尼）
    if (event.relTime || event.trackDuration) {
        // 进度过滤：URI 不匹配时丢弃脏数据（HQPlayer/DMP-A6 优化）
        if (profile?.progressFilter && state.currentTrackUrl && event.trackURI && event.trackURI !== state.currentTrackUrl) {
            return;
        }
        // 阻尼：切歌过渡期忽略进度抖动
        if (state.isSwitchingTrack || state.playState === DMC_PLAY_STATE.TRANSITIONING) {
            return;
        }
        if (event.relTime) {
            const relSeconds = upnp.timeToSeconds(event.relTime);
            // 阻尼：DMR 数据瞬断（relTime=0 但已有进度），不更新
            if (!(relSeconds === 0 && state.position > 0)) {
                state.position = relSeconds;
            }
        }
        if (event.trackDuration) {
            let total = upnp.timeToSeconds(event.trackDuration);
            // 时长阻尼：HQPlayer/DMP-A6 切歌瞬间返回 0，使用上次合法值
            if (total <= 0 && state.lastValidTotalSeconds > 0) {
                total = state.lastValidTotalSeconds;
            }
            else if (total > 0) {
                state.lastValidTotalSeconds = total;
            }
            state.duration = total;
        }
        broadcast(exports.DMC_MSG_TYPE.PROGRESS, { position: state.position, duration: state.duration });
    }
};
/** 处理 RenderingControl 事件 */
const handleRenderingControlEvent = (event) => {
    if (event.volume !== undefined) {
        state.volume = event.volume;
        broadcast(exports.DMC_MSG_TYPE.VOLUME, { volume: state.volume });
    }
};
// ==================== Index Calculation ====================
/** Fisher-Yates 洗牌：生成不重复的播放顺序（排除当前索引放在首位） */
const generateShuffleOrder = (length, excludeIndex) => {
    const order = Array.from({ length }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    // 确保当前歌曲不在开头（避免刚播完又重复）
    if (excludeIndex >= 0 && order[0] === excludeIndex && order.length > 1) {
        const swapIdx = 1 + Math.floor(Math.random() * (order.length - 1));
        [order[0], order[swapIdx]] = [order[swapIdx], order[0]];
    }
    return order;
};
/** 初始化或重新洗牌（切换到随机模式、歌单变化时调用） */
const resetShuffleState = () => {
    state.shuffleOrder = generateShuffleOrder(state.playlist.length, state.playlistIndex);
    state.shufflePosition = 0;
    console.log('[DMC] 洗牌顺序:', state.shuffleOrder);
};
const getNextIndex = () => {
    if (state.playlist.length === 0)
        return -1;
    switch (state.playMode) {
        case 'singleLoop':
            return state.playlistIndex;
        case 'single':
            return -1;
        case 'random': {
            if (state.playlist.length === 1)
                return 0;
            // 没有洗牌顺序或已播完所有歌曲 → 停止
            if (state.shufflePosition >= state.shuffleOrder.length) {
                return -1;
            }
            const nextIdx = state.shuffleOrder[state.shufflePosition];
            state.shufflePosition++;
            return nextIdx !== undefined ? nextIdx : -1;
        }
        case 'listLoop':
            return (state.playlistIndex + 1) % state.playlist.length;
        case 'list':
        default:
            const next = state.playlistIndex + 1;
            return next < state.playlist.length ? next : -1;
    }
};
const getPreviousIndex = () => {
    if (state.playlist.length === 0)
        return -1;
    switch (state.playMode) {
        case 'singleLoop':
            return state.playlistIndex;
        case 'random': {
            if (state.playlist.length === 1)
                return 0;
            // 上一首：回退洗牌位置
            if (state.shufflePosition > 0) {
                state.shufflePosition--;
                return state.shuffleOrder[state.shufflePosition];
            }
            // 已到开头 → 重新洗牌并从末尾开始
            resetShuffleState();
            state.shufflePosition = state.shuffleOrder.length - 1;
            return state.shuffleOrder[state.shufflePosition];
        }
        case 'listLoop': {
            const prev = state.playlistIndex - 1;
            return prev >= 0 ? prev : state.playlist.length - 1;
        }
        case 'single':
        case 'list':
        default:
            const prev2 = state.playlistIndex - 1;
            return prev2 >= 0 ? prev2 : -1;
    }
};
