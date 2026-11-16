"use strict";
/**
 * AirPlay DMC (Digital Media Controller) 核心模块
 *
 * AirPlay 版本的状态机：URL解析、播放控制、歌单管理、自动切歌。
 * 与 DLNA DMC 不同，AirPlay 是"推送"模型，需要持续发送 PCM 数据。
 *
 * 大量复用 dlnaDmc.ts 的逻辑（URL解析、歌单管理、洗牌算法）。
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
exports.playIndex = exports.setPlayMode = exports.clearPlaylist = exports.removeFromPlaylist = exports.addToPlaylist = exports.updatePlaylistOrder = exports.setPlaylist = exports.previous = exports.next = exports.setVolume = exports.seek = exports.stop = exports.resume = exports.pause = exports.playSong = exports.disconnectDevice = exports.connectDevice = exports.getFullState = exports.initAirPlayDmc = exports.AIRPLAY_MSG_TYPE = void 0;
const airplayDiscovery = __importStar(require("./airplayDiscovery"));
const airplayRaop = __importStar(require("./airplayRaop"));
const db_1 = require("../../utils/db");
const userApi_1 = require("../userApi");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const needle_1 = __importDefault(require("needle"));
const node_os_1 = __importDefault(require("node:os"));
const pathUtil_1 = require("../../utils/pathUtil");
// ==================== Types ====================
/** AirPlay DMC 播放状态常量 */
const AIRPLAY_PLAY_STATE = {
    IDLE: 'IDLE',
    CONNECTING: 'CONNECTING',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    TRANSITIONING: 'TRANSITIONING',
    RESOLVING: 'RESOLVING',
};
/** 广播消息类型常量 */
exports.AIRPLAY_MSG_TYPE = {
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
    playState: AIRPLAY_PLAY_STATE.IDLE,
    connectedDevice: null,
    currentSong: null,
    playlist: [],
    playlistIndex: -1,
    playMode: 'list',
    position: 0,
    duration: 0,
    volume: 50,
    isSwitchingTrack: false,
    consecutiveFailCount: 0,
    progressTimer: null,
    songStartedAt: 0,
    shuffleOrder: [],
    shufflePosition: -1,
};
let broadcastFn = () => { };
// ==================== Broadcast Helpers ====================
const broadcast = (type, payload) => {
    broadcastFn({ type, payload });
};
const broadcastFullState = () => {
    broadcast(exports.AIRPLAY_MSG_TYPE.STATE, (0, exports.getFullState)());
};
const broadcastPlayState = () => {
    broadcast(exports.AIRPLAY_MSG_TYPE.PLAY_STATE, {
        playState: state.playState,
        position: state.position,
        duration: state.duration,
    });
};
// ==================== Initialization ====================
/** 初始化 AirPlay DMC 模块 */
const initAirPlayDmc = (broadcast) => {
    broadcastFn = broadcast;
};
exports.initAirPlayDmc = initAirPlayDmc;
/** 获取 AirPlay DMC 完整状态 */
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
/** 连接 AirPlay 设备 */
const connectDevice = async (deviceId) => {
    console.log(`[AirPlay-DMC] connectDevice: deviceId=${deviceId}`);
    if (state.connectedDevice && state.connectedDevice.id === deviceId) {
        console.log('[AirPlay-DMC] 已连接到设备:', deviceId);
        broadcast(exports.AIRPLAY_MSG_TYPE.CONNECTED, { deviceId, deviceName: state.connectedDevice.name });
        return;
    }
    if (state.connectedDevice) {
        await (0, exports.disconnectDevice)();
    }
    state.playState = AIRPLAY_PLAY_STATE.CONNECTING;
    broadcastFullState();
    const device = airplayDiscovery.getDevice(deviceId);
    if (!device)
        throw new Error('AirPlay device not found. Please scan again.');
    state.connectedDevice = device;
    airplayDiscovery.setActiveDevice(deviceId, device.name);
    console.log(`[AirPlay-DMC] 已连接 AirPlay 设备: "${device.name}" @ ${device.host}:${device.port}`);
    state.playState = AIRPLAY_PLAY_STATE.IDLE;
    broadcast(exports.AIRPLAY_MSG_TYPE.CONNECTED, { deviceId, deviceName: device.name });
    broadcastFullState();
    console.log(`[AirPlay-DMC] 设备连接成功, 等待播放命令`);
};
exports.connectDevice = connectDevice;
/** 断开 AirPlay 设备 */
const disconnectDevice = async () => {
    // 停止音频流
    airplayRaop.stopStream();
    stopProgressTimer();
    if (state.connectedDevice) {
        airplayDiscovery.setActiveDevice(null, '');
    }
    state.connectedDevice = null;
    state.currentSong = null;
    state.playlist = [];
    state.playlistIndex = -1;
    state.position = 0;
    state.duration = 0;
    state.isSwitchingTrack = false;
    state.playState = AIRPLAY_PLAY_STATE.IDLE;
    broadcast(exports.AIRPLAY_MSG_TYPE.DISCONNECTED, { reason: 'User disconnected' });
    broadcastFullState();
};
exports.disconnectDevice = disconnectDevice;
// ==================== URL Resolution ====================
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
/** 构建局域网文件 URL */
const buildLanUrl = (relativePath, source) => {
    const port = global.lx?.config?.port || 9527;
    const addresses = getServerAddresses();
    const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
    if (source && source === 'local') {
        return `http://${host}:${port}/api/music/cache/file/${source}/${encodeURIComponent(relativePath)}`;
    }
    return `http://${host}:${port}/api/music/cache/file/${encodeURIComponent(relativePath)}`;
};
/** 构建本地文件绝对路径 */
const buildLocalFilePath = (relativePath, source) => {
    if (source === 'local') {
        try {
            const localLib = require('../localLibrary');
            return localLib.resolveLocalFilePath(source, relativePath) || null;
        }
        catch {
            return null;
        }
    }
    const fullPath = node_path_1.default.join((0, pathUtil_1.getDownloadDir)(), relativePath);
    return node_fs_1.default.existsSync(fullPath) ? fullPath : null;
};
/** 构建封面 URL */
const buildAlbumArtUrl = (song) => {
    const port = global.lx?.config?.port || 9527;
    const addresses = getServerAddresses();
    const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
    if (song.img && (song.img.startsWith('http://') || song.img.startsWith('https://'))) {
        return song.img;
    }
    if (song.img && song.img.startsWith('/')) {
        return `http://${host}:${port}${song.img}`;
    }
    if (song.relativePath) {
        if (song.source && song.source === 'local') {
            return `http://${host}:${port}/api/music/cache/cover?filename=${encodeURIComponent(song.relativePath)}&source=${encodeURIComponent(song.source)}&relativePath=${encodeURIComponent(song.relativePath)}`;
        }
        return `http://${host}:${port}/api/music/cache/cover?filename=${encodeURIComponent(song.relativePath)}`;
    }
    return undefined;
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
                'Referer': new URL(url).origin,
            },
        });
        if (resp.statusCode && [301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
            let nextUrl = resp.headers.location;
            if (!nextUrl.startsWith('http')) {
                try {
                    nextUrl = new URL(nextUrl, url).href;
                }
                catch { /* ignore */ }
            }
            return resolveRedirect(nextUrl, depth + 1);
        }
        return { url, contentType: resp.headers['content-type'] || null };
    }
    catch {
        return { url, contentType: null };
    }
};
/** 从数据库查找缓存记录 */
const findCachedRecord = (song) => {
    if (song.source && song.source === 'local' && song.relativePath) {
        try {
            const localLib = require('../localLibrary');
            const absolutePath = localLib.resolveLocalFilePath(song.source, song.relativePath);
            if (absolutePath)
                return { relative_path: song.relativePath };
        }
        catch { /* fallback */ }
        return null;
    }
    if (song._isMusicLibSong && song.relativePath) {
        const record = (0, db_1.getDownloadRecordByRelativePath)(song.relativePath);
        if (record?.relative_path)
            return record;
        if (node_fs_1.default.existsSync(node_path_1.default.join((0, pathUtil_1.getDownloadDir)(), song.relativePath)))
            return { relative_path: song.relativePath };
    }
    if (song.id) {
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
/** 解析歌曲的音频源 (返回本地文件路径或 HTTP URL) */
const resolveSongSource = async (song) => {
    // 0. 直接 URL 短路（电台等直接流）
    if (song.directUrl) {
        console.log(`[AirPlay-DMC] directUrl short-circuit: ${song.directUrl.substring(0, 80)}...`);
        return { source: song.directUrl, isLocal: false };
    }
    console.log(`[AirPlay-DMC] resolveSongSource: "${song.name}" by ${song.singer}, source=${song.source}, relativePath=${song.relativePath || 'null'}`);
    // 1. 检查本地缓存
    const cachedRecord = findCachedRecord(song);
    if (cachedRecord?.relative_path) {
        console.log(`[AirPlay-DMC] 缓存命中: relative_path=${cachedRecord.relative_path}`);
        // 优先返回本地文件路径（更快、无网络开销）
        const localPath = buildLocalFilePath(cachedRecord.relative_path, song.source);
        if (localPath) {
            console.log(`[AirPlay-DMC] 使用本地文件路径: ${localPath}`);
            return { source: localPath, isLocal: true };
        }
        // 回退到 HTTP URL
        const lanUrl = buildLanUrl(cachedRecord.relative_path, song.source);
        console.log(`[AirPlay-DMC] 回退到局域网 URL: ${lanUrl}`);
        return { source: lanUrl, isLocal: false };
    }
    // 2. 在线获取
    const QUALITY_PRIORITY = ['flac24bit', 'flac', '320k', '128k'];
    const requestedQuality = song.quality;
    const isValidQuality = requestedQuality && QUALITY_PRIORITY.includes(requestedQuality);
    const startIndex = isValidQuality ? QUALITY_PRIORITY.indexOf(requestedQuality) : 0;
    const qualitiesToTry = QUALITY_PRIORITY.slice(startIndex);
    for (const quality of qualitiesToTry) {
        try {
            broadcast(exports.AIRPLAY_MSG_TYPE.RESOLVING, { songName: song.name, quality });
            const onlineUrl = await (0, userApi_1.callUserApiGetMusicUrl)(song.source, song, quality);
            if (onlineUrl?.url) {
                let finalUrl = onlineUrl.url;
                console.log(`[AirPlay-DMC] 获取到在线 URL: quality=${quality}, url=${finalUrl.substring(0, 80)}...`);
                // 解析重定向
                if (finalUrl.startsWith('http')) {
                    const resolveResult = await resolveRedirect(finalUrl);
                    if (resolveResult.url !== finalUrl) {
                        console.log(`[AirPlay-DMC] 重定向解析: ${resolveResult.url.substring(0, 80)}...`);
                        finalUrl = resolveResult.url;
                    }
                }
                // AirPlay 可接受 HTTPS（ffmpeg 支持）
                return { source: finalUrl, isLocal: false };
            }
        }
        catch { /* 尝试下一个音质 */ }
    }
    throw new Error(`Cannot resolve URL for: ${song.name}`);
};
// ==================== Playback Control ====================
/** 播放指定歌曲 */
const playSong = async (song, index) => {
    if (!state.connectedDevice)
        throw new Error('No AirPlay device connected');
    console.log(`[AirPlay-DMC] playSong: "${song.name}" by ${song.singer}, index=${index}, playlist.length=${state.playlist.length}, playMode=${state.playMode}`);
    state.isSwitchingTrack = true;
    state.playState = AIRPLAY_PLAY_STATE.RESOLVING;
    if (index !== undefined)
        state.playlistIndex = index;
    broadcast(exports.AIRPLAY_MSG_TYPE.RESOLVING, { songName: song.name });
    try {
        // 停止当前流
        console.log(`[AirPlay-DMC] 停止当前流...`);
        airplayRaop.stopStream();
        stopProgressTimer();
        // 解析音频源
        console.log(`[AirPlay-DMC] 解析音频源...`);
        const resolved = await Promise.race([
            resolveSongSource(song),
            new Promise((_, reject) => setTimeout(() => reject(new Error('URL解析超时(30s)')), 30000)),
        ]);
        console.log(`[AirPlay-DMC] 音频源解析: ${resolved.isLocal ? '本地' : '远程'}, source=${resolved.source.substring(0, 80)}...`);
        state.playState = AIRPLAY_PLAY_STATE.TRANSITIONING;
        // 构建元数据
        const coverUrl = buildAlbumArtUrl(song);
        const durationMs = parseInterval(song.interval) * 1000;
        console.log(`[AirPlay-DMC] 元数据: title=${song.name}, artist=${song.singer}, durationMs=${durationMs}, coverUrl=${coverUrl ? 'yes' : 'no'}`);
        // 开始流式传输
        console.log(`[AirPlay-DMC] 开始 RAOP 流式传输...`);
        await airplayRaop.startStream(state.connectedDevice, {
            source: resolved.source,
            metadata: {
                title: song.name,
                artist: song.singer,
                album: song.albumName,
                coverUrl,
                durationMs,
                elapsedMs: 0,
            },
            onDurationDetected: (sec) => {
                // ffmpeg 转码时从 stderr 检测到时长，更新 DMC 状态
                if (sec > 0 && state.currentSong === song && state.duration === 0) {
                    state.duration = Math.round(sec);
                    console.log(`[AirPlay-DMC] ✅ ffmpeg stderr 检测到时长: ${state.duration}s`);
                }
            },
            onStreamComplete: () => {
                // ffmpeg 转码完成或 WAV 读取完毕，停止进度定时器以防止 setProgress 访问已销毁的 RTSP socket
                console.log('[AirPlay-DMC] 音频流自然结束，停止进度定时器');
                stopProgressTimer();
            },
            onDeviceDisconnected: (reason) => {
                // 设备主动断开 (RAOP 侧已清理会话): 同步 DMC 状态，防止进度定时器继续 setProgress 刷 not_found
                console.log(`[AirPlay-DMC] 设备断开连接 (reason=${reason})，停止进度定时器并置为 IDLE`);
                stopProgressTimer();
                if (state.playState === AIRPLAY_PLAY_STATE.PLAYING || state.playState === AIRPLAY_PLAY_STATE.TRANSITIONING) {
                    state.playState = AIRPLAY_PLAY_STATE.IDLE;
                }
                broadcastPlayState();
            },
        });
        console.log(`[AirPlay-DMC] RAOP 流式传输已启动`);
        state.currentSong = song;
        state.position = 0;
        state.duration = parseInterval(song.interval);
        console.log(`[AirPlay-DMC] 歌曲时长: ${state.duration}s (interval="${song.interval}")`);
        if (state.duration === 0) {
            console.warn(`[AirPlay-DMC] ⚠ 歌曲时长为 0！interval="${song.interval}"，尝试从音频文件探测时长...`);
            // 异步探测时长（仅本地文件，HTTP URL 可能超时）
            if (resolved.isLocal) {
                airplayRaop.probeAudioDuration(resolved.source).then((probedSec) => {
                    if (probedSec > 0 && state.currentSong === song) {
                        state.duration = Math.round(probedSec);
                        console.log(`[AirPlay-DMC] ✅ 从音频文件探测到时长: ${state.duration}s`);
                    }
                }).catch(() => { });
            }
        }
        state.consecutiveFailCount = 0;
        state.songStartedAt = Date.now();
        // 启动进度追踪
        startProgressTimer();
        state.playState = AIRPLAY_PLAY_STATE.PLAYING;
        state.isSwitchingTrack = false;
        broadcast(exports.AIRPLAY_MSG_TYPE.SONG_CHANGE, { song, index: state.playlistIndex });
        broadcastPlayState();
    }
    catch (err) {
        airplayRaop.stopStream(); // 防御性清理
        console.error(`[AirPlay-DMC] playSong 失败: ${err.message}`);
        state.playState = AIRPLAY_PLAY_STATE.IDLE;
        broadcastPlayState();
        state.consecutiveFailCount++;
        broadcast(exports.AIRPLAY_MSG_TYPE.ERROR, { message: `无法播放: ${song.name} - ${err.message}` });
        if (state.consecutiveFailCount >= 3) {
            console.warn(`[AirPlay-DMC] 连续失败 ${state.consecutiveFailCount} 次，停止重试`);
            state.consecutiveFailCount = 0;
            return;
        }
        setTimeout(() => {
            if (state.playlist.length > 0 && state.playState === AIRPLAY_PLAY_STATE.IDLE) {
                void (0, exports.next)();
            }
        }, 1000);
    }
    finally {
        if (state.isSwitchingTrack)
            state.isSwitchingTrack = false;
    }
};
exports.playSong = playSong;
/** 暂停播放 (AirPlay 推送模型下 = 停止流) */
const pause = async () => {
    if (!state.connectedDevice || state.playState === AIRPLAY_PLAY_STATE.PAUSED)
        return;
    // AirPlay 没有真正的 "暂停" — 停止流但保持状态
    airplayRaop.stopStream();
    stopProgressTimer();
    state.playState = AIRPLAY_PLAY_STATE.PAUSED;
    broadcastPlayState();
};
exports.pause = pause;
/** 恢复播放 (重新推送流) */
const resume = async () => {
    if (!state.connectedDevice || state.playState !== AIRPLAY_PLAY_STATE.PAUSED)
        return;
    if (!state.currentSong)
        return;
    // 重新推送当前歌曲（从当前位置开始）
    state.playState = AIRPLAY_PLAY_STATE.RESOLVING;
    broadcastPlayState();
    try {
        const resolved = await resolveSongSource(state.currentSong);
        const coverUrl = buildAlbumArtUrl(state.currentSong);
        const elapsedMs = state.position * 1000;
        const durationMs = state.duration * 1000;
        await airplayRaop.startStream(state.connectedDevice, {
            source: resolved.source,
            metadata: {
                title: state.currentSong.name,
                artist: state.currentSong.singer,
                album: state.currentSong.albumName,
                coverUrl,
                durationMs,
                elapsedMs,
            },
            onStreamComplete: () => {
                // ffmpeg 转码完成或 WAV 读取完毕，停止进度定时器以防止 setProgress 访问已销毁的 RTSP socket
                console.log('[AirPlay-DMC] 音频流自然结束，停止进度定时器');
                stopProgressTimer();
            },
            onDeviceDisconnected: (reason) => {
                // 设备主动断开 (RAOP 侧已清理会话): 同步 DMC 状态，防止进度定时器继续 setProgress 刷 not_found
                console.log(`[AirPlay-DMC] 设备断开连接 (reason=${reason})，停止进度定时器并置为 IDLE`);
                stopProgressTimer();
                if (state.playState === AIRPLAY_PLAY_STATE.PLAYING || state.playState === AIRPLAY_PLAY_STATE.TRANSITIONING) {
                    state.playState = AIRPLAY_PLAY_STATE.IDLE;
                }
                broadcastPlayState();
            },
        });
        state.songStartedAt = Date.now() - elapsedMs;
        startProgressTimer();
        state.playState = AIRPLAY_PLAY_STATE.PLAYING;
        broadcastPlayState();
    }
    catch (err) {
        state.playState = AIRPLAY_PLAY_STATE.IDLE;
        broadcastPlayState();
        broadcast(exports.AIRPLAY_MSG_TYPE.ERROR, { message: `恢复播放失败: ${err.message}` });
    }
};
exports.resume = resume;
/** 停止播放 */
const stop = async () => {
    if (!state.connectedDevice)
        return;
    airplayRaop.stopStream();
    stopProgressTimer();
    state.playState = AIRPLAY_PLAY_STATE.IDLE;
    state.position = 0;
    state.currentSong = null;
    broadcastPlayState();
};
exports.stop = stop;
/** 跳转进度 (AirPlay 需要重新推送流) */
const seek = async (seconds) => {
    if (!state.connectedDevice || !state.currentSong)
        return;
    // 更新进度显示
    airplayRaop.setProgress(seconds, state.duration);
    state.position = seconds;
    broadcast(exports.AIRPLAY_MSG_TYPE.PROGRESS, { position: state.position, duration: state.duration });
    // AirPlay 精确 seek 需要重新推流（复杂场景暂不实现，仅更新显示）
};
exports.seek = seek;
/** 设置音量 */
const setVolume = (level) => {
    if (!state.connectedDevice)
        return;
    airplayRaop.setVolume(level);
    state.volume = level;
    broadcast(exports.AIRPLAY_MSG_TYPE.VOLUME, { volume: state.volume });
};
exports.setVolume = setVolume;
/** 下一首 */
const next = async () => {
    const nextIndex = getNextIndex();
    if (nextIndex < 0 || nextIndex >= state.playlist.length) {
        console.log('[AirPlay-DMC] 没有下一首可用');
        airplayRaop.stopStream();
        stopProgressTimer();
        state.playState = AIRPLAY_PLAY_STATE.IDLE;
        state.currentSong = null;
        state.position = 0;
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
        console.log('[AirPlay-DMC] 没有上一首可用');
        return;
    }
    await (0, exports.playSong)(state.playlist[prevIndex], prevIndex);
};
exports.previous = previous;
// ==================== Progress Timer ====================
/** 启动进度追踪定时器 */
const startProgressTimer = () => {
    stopProgressTimer();
    state.progressTimer = setInterval(() => {
        if (state.isSwitchingTrack)
            return;
        if (state.playState === AIRPLAY_PLAY_STATE.PLAYING) {
            const elapsed = (Date.now() - state.songStartedAt) / 1000;
            state.position = Math.min(elapsed, state.duration || Infinity);
            // 定期更新 AirPlay 接收器进度显示
            airplayRaop.setProgress(state.position, state.duration);
            broadcast(exports.AIRPLAY_MSG_TYPE.PROGRESS, { position: state.position, duration: state.duration });
            // 检查是否播放完毕
            if (state.duration > 0 && state.position >= state.duration) {
                console.log(`[AirPlay-DMC] 歌曲播放完毕 (position=${state.position.toFixed(1)}s >= duration=${state.duration}s)，自动切歌`);
                void handleSongEnded();
            }
            else if (state.duration === 0 && state.position > 600) {
                // 安全检查：duration 为 0 时，超过 10 分钟仍无有效时长则停止
                console.warn(`[AirPlay-DMC] ⚠ duration=0 且已播放 ${state.position.toFixed(0)}s，强制停止防止无限推流`);
                void handleSongEnded();
            }
        }
    }, 1000); // 每秒更新
};
/** 停止进度追踪 */
const stopProgressTimer = () => {
    if (state.progressTimer) {
        clearInterval(state.progressTimer);
        state.progressTimer = null;
    }
};
/** 歌曲播放完毕处理 */
const handleSongEnded = async () => {
    console.log(`[AirPlay-DMC] handleSongEnded: playMode=${state.playMode}, playlistIndex=${state.playlistIndex}, playlist.length=${state.playlist.length}, currentSong="${state.currentSong?.name}"`);
    stopProgressTimer();
    state.isSwitchingTrack = true;
    try {
        const nextIndex = getNextIndex();
        if (nextIndex >= 0 && nextIndex < state.playlist.length) {
            await (0, exports.playSong)(state.playlist[nextIndex], nextIndex);
        }
        else {
            console.log('[AirPlay-DMC] 没有下一首，停止播放');
            airplayRaop.stopStream();
            state.playState = AIRPLAY_PLAY_STATE.IDLE;
            state.currentSong = null;
            state.position = 0;
            broadcastPlayState();
        }
    }
    catch (err) {
        console.error(`[AirPlay-DMC] handleSongEnded 失败: ${err.message}`);
        airplayRaop.stopStream();
        state.playState = AIRPLAY_PLAY_STATE.IDLE;
        broadcastPlayState();
    }
    finally {
        state.isSwitchingTrack = false;
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
    console.log(`[AirPlay-DMC] setPlaylist: ${songs.length} 首, startIndex=${startIndex}, playImmediately=${playImmediately}, playMode=${state.playMode}`);
    if (songs.length > 0) {
        console.log(`[AirPlay-DMC] 歌单详情:`, songs.map((s, i) => `[${i}] "${s.name}" - ${s.singer} (source=${s.source}, id=${s.id})`).join('\n  '));
    }
    const isSamePlaylist = isPlaylistEqual(state.playlist, songs);
    if (isSamePlaylist && !playImmediately) {
        console.log(`[AirPlay-DMC] setPlaylist: 歌单相同且 playImmediately=false，跳过`);
        return;
    }
    state.consecutiveFailCount = 0;
    state.playlist = [...(songs || [])];
    if (state.playMode === 'random') {
        resetShuffleState();
        startIndex = state.shuffleOrder[0];
    }
    console.log('[AirPlay-DMC] 设置播放列表:', songs.length, '从', startIndex, '开始播放', playImmediately);
    if (state.connectedDevice && !playImmediately) {
        airplayRaop.stopStream();
        stopProgressTimer();
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
    broadcast(exports.AIRPLAY_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
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
    broadcast(exports.AIRPLAY_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
};
exports.updatePlaylistOrder = updatePlaylistOrder;
/** 追加歌曲 */
const addToPlaylist = (songs) => {
    state.playlist.push(...songs);
    broadcast(exports.AIRPLAY_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
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
    broadcast(exports.AIRPLAY_MSG_TYPE.PLAYLIST, { songs: state.playlist, index: state.playlistIndex });
};
exports.removeFromPlaylist = removeFromPlaylist;
/** 清空歌单 */
const clearPlaylist = () => {
    state.playlist = [];
    state.playlistIndex = -1;
    if (state.playState !== AIRPLAY_PLAY_STATE.IDLE) {
        void (0, exports.stop)();
    }
    broadcast(exports.AIRPLAY_MSG_TYPE.PLAYLIST, { songs: [], index: -1 });
};
exports.clearPlaylist = clearPlaylist;
/** 设置播放模式 */
const setPlayMode = (mode) => {
    state.playMode = mode;
    broadcast(exports.AIRPLAY_MSG_TYPE.PLAY_MODE, { playMode: state.playMode });
    if (state.playMode === 'random') {
        resetShuffleState();
    }
};
exports.setPlayMode = setPlayMode;
/** 播放指定 index 的歌曲 */
const playIndex = async (index) => {
    if (!state.connectedDevice)
        throw new Error('No AirPlay device connected');
    if (index < 0 || index >= state.playlist.length) {
        throw new Error(`Invalid index: ${index}, playlist length: ${state.playlist.length}`);
    }
    const song = state.playlist[index];
    await (0, exports.playSong)(song, index);
};
exports.playIndex = playIndex;
// ==================== Index Calculation ====================
/** Fisher-Yates 洗牌 */
const generateShuffleOrder = (length, excludeIndex) => {
    const order = Array.from({ length }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    if (excludeIndex >= 0 && order[0] === excludeIndex && order.length > 1) {
        const swapIdx = 1 + Math.floor(Math.random() * (order.length - 1));
        [order[0], order[swapIdx]] = [order[swapIdx], order[0]];
    }
    return order;
};
const resetShuffleState = () => {
    state.shuffleOrder = generateShuffleOrder(state.playlist.length, state.playlistIndex);
    state.shufflePosition = 0;
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
            if (state.shufflePosition >= state.shuffleOrder.length)
                return -1;
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
            if (state.shufflePosition > 0) {
                state.shufflePosition--;
                return state.shuffleOrder[state.shufflePosition];
            }
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
// ==================== Helpers ====================
/** 解析 interval 字符串为秒数 (格式: "MM:SS" 或秒数) */
const parseInterval = (interval) => {
    if (!interval) {
        console.warn(`[AirPlay-DMC] parseInterval: interval 为空 (${interval})`);
        return 0;
    }
    if (typeof interval === 'number')
        return interval;
    const str = String(interval);
    if (str.includes(':')) {
        const parts = str.split(':');
        if (parts.length === 2) {
            const result = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
            console.log(`[AirPlay-DMC] parseInterval: "${interval}" → ${result}s`);
            return result;
        }
        if (parts.length === 3) {
            const result = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseInt(parts[2], 10);
            console.log(`[AirPlay-DMC] parseInterval: "${interval}" → ${result}s`);
            return result;
        }
    }
    const num = parseInt(str, 10);
    const result = isNaN(num) ? 0 : num;
    console.log(`[AirPlay-DMC] parseInterval: "${interval}" → ${result}s`);
    return result;
};
