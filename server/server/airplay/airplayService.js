"use strict";
/**
 * AirPlay 投屏服务模块 (AirPlay Casting Service Module)
 * 封装所有 AirPlay 设备扫描、控制、状态管理等 HTTP API 路由处理。
 *
 * 对应 DLNA 侧的 dlnaService.ts。
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlayMode = exports.handlePlaylist = exports.handlePrevious = exports.handleNext = exports.handleVolume = exports.handleSeek = exports.handleStop = exports.handleResume = exports.handlePause = exports.handlePlay = exports.handleState = exports.handleDisconnect = exports.handleConnect = exports.handleGetDevices = exports.handleScanDevices = void 0;
const airplayDiscovery = __importStar(require("./airplayDiscovery"));
const airplayDmc = __importStar(require("./airplayDmc"));
const commonUtils_1 = require("../commonUtils");
// ==================== 设备发现 API ====================
/**
 * 扫描 AirPlay 设备 (mDNS)
 * POST /api/airplay/scan
 */
const handleScanDevices = (req, res) => {
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const devices = await airplayDiscovery.scanDevices();
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices });
    }, 'AirPlay Scan');
};
exports.handleScanDevices = handleScanDevices;
/**
 * 获取缓存的 AirPlay 设备 (不扫描，即时返回)
 * GET /api/airplay/devices
 */
const handleGetDevices = (req, res) => {
    const devices = airplayDiscovery.getCachedDevices();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices });
};
exports.handleGetDevices = handleGetDevices;
// ==================== 连接管理 API ====================
/**
 * 连接 AirPlay 设备
 * POST /api/airplay/connect
 */
const handleConnect = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId } = body;
            if (!deviceId)
                throw new Error('Missing deviceId');
            await airplayDmc.connectDevice(deviceId);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'AirPlay Connect');
    });
};
exports.handleConnect = handleConnect;
/**
 * 断开 AirPlay 设备
 * POST /api/airplay/disconnect
 */
const handleDisconnect = (req, res) => {
    void airplayDmc.disconnectDevice().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleDisconnect = handleDisconnect;
/**
 * 获取 AirPlay DMC 完整状态
 * GET /api/airplay/state
 */
const handleState = (req, res) => {
    const state = airplayDmc.getFullState();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, ...state });
};
exports.handleState = handleState;
// ==================== 播放控制 API ====================
/**
 * AirPlay 播放歌曲
 * POST /api/airplay/play
 */
const handlePlay = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { song, index } = body;
            if (!song)
                throw new Error('Missing song');
            await airplayDmc.playSong(song, index);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'AirPlay Play');
    });
};
exports.handlePlay = handlePlay;
/**
 * AirPlay 暂停
 * POST /api/airplay/pause
 */
const handlePause = (req, res) => {
    void airplayDmc.pause().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handlePause = handlePause;
/**
 * AirPlay 恢复播放
 * POST /api/airplay/resume
 */
const handleResume = (req, res) => {
    void airplayDmc.resume().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleResume = handleResume;
/**
 * AirPlay 停止
 * POST /api/airplay/stop
 */
const handleStop = (req, res) => {
    void airplayDmc.stop().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleStop = handleStop;
/**
 * AirPlay 跳转进度
 * POST /api/airplay/seek
 */
const handleSeek = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { position } = body;
            if (position === undefined)
                throw new Error('Missing position');
            await airplayDmc.seek(position);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'AirPlay Seek');
    });
};
exports.handleSeek = handleSeek;
/**
 * AirPlay 设置音量
 * POST /api/airplay/volume
 */
const handleVolume = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { volume } = body;
            if (volume === undefined)
                throw new Error('Missing volume');
            airplayDmc.setVolume(volume);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'AirPlay Volume');
    });
};
exports.handleVolume = handleVolume;
/**
 * AirPlay 下一首
 * POST /api/airplay/next
 */
const handleNext = (req, res) => {
    void airplayDmc.next().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleNext = handleNext;
/**
 * AirPlay 上一首
 * POST /api/airplay/previous
 */
const handlePrevious = (req, res) => {
    void airplayDmc.previous().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handlePrevious = handlePrevious;
/**
 * AirPlay 设置播放列表
 * POST /api/airplay/playlist
 */
const handlePlaylist = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        try {
            const { songs, startIndex, playImmediately } = body;
            console.log(`[API] /api/airplay/playlist: songs.length=${songs?.length || 0}, startIndex=${startIndex || 0}, playImmediately=${playImmediately !== false}`);
            if (!songs)
                throw new Error('Missing songs');
            airplayDmc.setPlaylist(songs, startIndex || 0, playImmediately !== false);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }
        catch (err) {
            (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
        }
    });
};
exports.handlePlaylist = handlePlaylist;
/**
 * AirPlay 设置播放模式
 * POST /api/airplay/playMode
 */
const handlePlayMode = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        try {
            const { mode } = body;
            if (!mode)
                throw new Error('Missing mode');
            airplayDmc.setPlayMode(mode);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }
        catch (err) {
            (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
        }
    });
};
exports.handlePlayMode = handlePlayMode;
