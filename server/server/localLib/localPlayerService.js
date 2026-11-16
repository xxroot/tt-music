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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleGetInfo = exports.handleGetStatus = exports.handleGetVolume = exports.handleSetVolume = exports.handleSeek = exports.handleStop = exports.handleResume = exports.handlePause = exports.handlePlay = exports.handleGetCachedDevices = exports.handleGetDevices = void 0;
const localPlayer = __importStar(require("./localPlayer"));
const upnp = __importStar(require("../dlna/upnp"));
const fileCache = __importStar(require("../fileCache"));
const commonUtils_1 = require("../commonUtils");
/**
 * 获取服务端音频设备列表
 * GET /api/local/devices
 */
const handleGetDevices = (req, res) => {
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const devices = localPlayer.scanDevices();
        const playerInfo = localPlayer.getPlayerInfo();
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices, playerInfo });
    }, 'LocalPlayer Scan Devices');
};
exports.handleGetDevices = handleGetDevices;
/**
 * 获取缓存的设备列表(不扫描)
 * GET /api/local/devices/cached
 */
const handleGetCachedDevices = (req, res) => {
    const devices = localPlayer.getCachedDevices();
    const playerInfo = localPlayer.getPlayerInfo();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices, playerInfo });
};
exports.handleGetCachedDevices = handleGetCachedDevices;
/**
 * 本地播放: 开始播放
 * POST /api/local/play
 */
const handlePlay = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId, mediaUrl, title, startPosition } = body;
            if (!deviceId || !mediaUrl)
                throw new Error('Missing deviceId or mediaUrl');
            let playUrl = mediaUrl;
            // 优化: 对于服务端缓存文件,直接解析为本地文件路径
            // 避免HTTP请求(绕过认证问题和HTTP开销)
            if (mediaUrl.startsWith('/api/music/cache/file/')) {
                const rawPath = decodeURIComponent(mediaUrl.replace('/api/music/cache/file/', ''));
                // 本地库文件 (source=local): URL 带 local/ 前缀, 解析为本地库绝对路径 (fileCache 不查本地库目录)
                if (rawPath.startsWith('local/')) {
                    const localLib = require('../localLibrary');
                    const absolutePath = localLib.resolveLocalFilePath('local', rawPath.substring('local/'.length));
                    if (absolutePath) {
                        playUrl = absolutePath;
                        console.log('[LocalPlayer] Using local library file path:', playUrl);
                    }
                }
                else {
                    const localPath = fileCache.resolveCacheFilePath(rawPath);
                    if (localPath) {
                        playUrl = localPath;
                        console.log('[LocalPlayer] Using local file path:', localPath);
                    }
                }
            }
            // 对于服务端代理URL,构建完整的localhost URL
            if (playUrl.startsWith('/')) {
                const port = global.lx.config.port;
                const addresses = (0, commonUtils_1.getServerAddresses)();
                const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
                playUrl = `http://${host}:${port}${playUrl}`;
            }
            // 设置活跃设备
            localPlayer.setActiveDevice(deviceId);
            // 同时在UPNP模块中记录,用于跨客户端状态持久化
            upnp.setActiveDevice(deviceId, title || 'Server Audio', 'local');
            await localPlayer.play(deviceId, playUrl, {
                title: title || '',
                startPosition: startPosition || 0,
            });
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'LocalPlayer Play');
    });
};
exports.handlePlay = handlePlay;
/**
 * 本地播放: 暂停
 * POST /api/local/pause
 */
const handlePause = (req, res) => {
    localPlayer.pause();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
};
exports.handlePause = handlePause;
/**
 * 本地播放: 恢复播放
 * POST /api/local/resume
 */
const handleResume = (req, res) => {
    localPlayer.resume();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
};
exports.handleResume = handleResume;
/**
 * 本地播放: 停止
 * POST /api/local/stop
 */
const handleStop = (req, res) => {
    localPlayer.stop();
    localPlayer.setActiveDevice(null);
    // 同时清除UPNP模块中的状态,用于跨客户端状态持久化
    upnp.setActiveDevice(null, '', '');
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
};
exports.handleStop = handleStop;
/**
 * 本地播放: 跳转进度
 * POST /api/local/seek
 */
const handleSeek = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { position } = body;
            if (position === undefined)
                throw new Error('Missing position');
            await localPlayer.seek(position);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'LocalPlayer Seek');
    });
};
exports.handleSeek = handleSeek;
/**
 * 本地播放: 设置音量
 * POST /api/local/volume
 */
const handleSetVolume = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { volume } = body;
            if (volume === undefined)
                throw new Error('Missing volume');
            localPlayer.setVolume(volume);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'LocalPlayer Set Volume');
    });
};
exports.handleSetVolume = handleSetVolume;
/**
 * 本地播放: 获取音量
 * GET /api/local/volume
 */
const handleGetVolume = (req, res) => {
    const volume = localPlayer.getVolume();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, volume });
};
exports.handleGetVolume = handleGetVolume;
/**
 * 本地播放: 获取播放状态
 * GET /api/local/status
 */
const handleGetStatus = (req, res) => {
    const status = localPlayer.getStatus();
    // 映射为UPNP兼容的状态格式,保持前端一致性
    let state = 'STOPPED';
    if (status.isPlaying)
        state = 'PLAYING';
    else if (status.isPaused)
        state = 'PAUSED_PLAYBACK';
    (0, commonUtils_1.sendJsonResponse)(res, 200, {
        success: true,
        state,
        position: status.position,
        duration: status.duration,
        title: status.title,
        deviceId: status.deviceId,
        volume: status.volume,
    });
};
exports.handleGetStatus = handleGetStatus;
/**
 * 本地播放: 获取播放器信息
 * GET /api/local/info
 */
const handleGetInfo = (req, res) => {
    const info = localPlayer.getPlayerInfo();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, ...info });
};
exports.handleGetInfo = handleGetInfo;
