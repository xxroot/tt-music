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
exports.handleDlnaProxy = exports.handleDlnaPlaylist = exports.handleDlnaPrevious = exports.handleDlnaNext = exports.handleDlnaVolume = exports.handleDlnaSeek = exports.handleDlnaStop = exports.handleDlnaResume = exports.handleDlnaPause = exports.handleDlnaPlay = exports.handleDlnaState = exports.handleDlnaDisconnect = exports.handleDlnaConnect = exports.handleUpnpPrevious = exports.handleUpnpNext = exports.handleUpnpSetNext = exports.handleUpnpStatus = exports.handleUpnpGetVolume = exports.handleUpnpSetVolume = exports.handleUpnpSeek = exports.handleUpnpStop = exports.handleUpnpResume = exports.handleUpnpPause = exports.handleUpnpPlay = exports.handleCastState = exports.handleGetDevices = exports.handleScanDevices = exports.handleGenaEvent = void 0;
const upnp = __importStar(require("./upnp"));
const dlnaDmc = __importStar(require("./dlnaDmc"));
const commonUtils_1 = require("../commonUtils");
const needle_1 = __importDefault(require("needle"));
/**
 * GENA NOTIFY 回调端点 — DMR 主动推送事件
 * POST /api/upnp/event
 */
const handleGenaEvent = (req, res) => {
    // [调试] 记录所有进入的 GENA 请求
    // console.log(`[GENA] 收到 NOTIFY 请求: method=${req.method}, url=${req.url}, SID=${req.headers['sid'] || '无'}`)
    // [修复] GENA NOTIFY body 是 XML，不是 JSON，不能使用 readBodySafe
    // 直接读取原始 body
    let body = '';
    req.on('data', (chunk) => {
        body += chunk;
    });
    req.on('end', () => {
        try {
            const sid = req.headers['sid'];
            if (!sid) {
                console.error('[GENA] 错误: 缺少 SID 头');
                res.writeHead(400);
                res.end('Missing SID');
                return;
            }
            if (!body) {
                console.warn('[GENA] 警告: body 为空');
                res.writeHead(400);
                res.end('Missing SID');
                return;
            }
            // 将 NOTIFY 事件转发给 DMC 处理
            dlnaDmc.handleGenEvent(sid, body);
            res.writeHead(200);
            res.end();
        }
        catch (err) {
            console.error('[UPNP] GENA event handling failed:', err.message);
            console.error('[GENA] 错误堆栈:', err.stack);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end();
            }
        }
    });
    req.on('error', (err) => {
        console.error('[GENA] 读取请求体失败:', err.message);
        if (!res.headersSent) {
            res.writeHead(500);
            res.end();
        }
    });
};
exports.handleGenaEvent = handleGenaEvent;
/**
 * 扫描UPNP MediaRenderer设备
 * POST /api/upnp/scan
 */
const handleScanDevices = (req, res) => {
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const devices = await upnp.scanDevices();
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices });
    }, 'UPNP Scan');
};
exports.handleScanDevices = handleScanDevices;
/**
 * 获取缓存的UPNP设备(不扫描,即时返回)
 * GET /api/upnp/devices
 */
const handleGetDevices = (req, res) => {
    const devices = upnp.getCachedDevices();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, devices });
};
exports.handleGetDevices = handleGetDevices;
/**
 * 获取当前投屏连接状态
 * GET /api/cast/state
 */
const handleCastState = (req, res) => {
    const castState = upnp.getActiveCastState();
    (0, commonUtils_1.sendJsonResponse)(res, 200, {
        success: true,
        deviceId: castState.deviceId,
        deviceName: castState.deviceName,
        castType: castState.castType,
    });
};
exports.handleCastState = handleCastState;
/**
 * UPNP播放: 设置URI并开始播放
 * POST /api/upnp/play
 */
const handleUpnpPlay = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId, mediaUrl, title, artist, album, albumArtUrl } = body;
            if (!deviceId || !mediaUrl)
                throw new Error('Missing deviceId or mediaUrl');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found. Please scan again.');
            // 标记此设备为活跃状态,播放期间不会过期
            upnp.setActiveDevice(deviceId, device.name, 'upnp');
            // 构建完整URL
            let fullUrl = mediaUrl;
            const addresses = (0, commonUtils_1.getServerAddresses)();
            const lanHost = addresses.length > 0 ? addresses[0] : '127.0.0.1';
            const port = global.lx.config.port;
            if (mediaUrl.startsWith('/')) {
                fullUrl = `http://${lanHost}:${port}${mediaUrl}`;
            }
            else if (mediaUrl.startsWith('http://')) {
                try {
                    const urlObj = new URL(mediaUrl);
                    if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                        urlObj.hostname = lanHost;
                        urlObj.port = String(port);
                        fullUrl = urlObj.toString();
                        console.log('[UPNP] Rewrote localhost URL to LAN IP:', fullUrl);
                    }
                }
                catch (_) {
                    // URL解析失败,使用原始值
                }
            }
            // 构建DIDL元数据
            const didl = upnp.buildSongDIDL(fullUrl, title || '', artist || '', album || '', albumArtUrl ? (albumArtUrl.startsWith('/') ? `http://${(0, commonUtils_1.getServerAddresses)()[0] || '127.0.0.1'}:${global.lx.config.port}${albumArtUrl}` : albumArtUrl) : undefined);
            // SetAVTransportURI with fallback
            let setURIOk = false;
            try {
                await upnp.setAVTransportURI(device, fullUrl, didl);
                setURIOk = true;
            }
            catch (setErr) {
                console.warn('[UPNP] SetAVTransportURI with metadata failed:', setErr.message);
                try {
                    await upnp.setAVTransportURI(device, fullUrl, '');
                    setURIOk = true;
                    console.log('[UPNP] SetAVTransportURI without metadata succeeded');
                }
                catch (setErr2) {
                    console.warn('[UPNP] SetAVTransportURI without metadata also failed:', setErr2.message);
                }
            }
            // 尝试播放
            let playOk = false;
            try {
                await upnp.play(device);
                playOk = true;
            }
            catch (playErr) {
                console.warn('[UPNP] Play also failed:', playErr.message);
            }
            if (!playOk) {
                throw new Error('UPNP Play failed - device cannot play this media URL. SetAVTransportURI ok=' + setURIOk + ', URL: ' + fullUrl);
            }
            console.log('[UPNP] Play succeeded (setAVTransportURI ok=' + setURIOk + ')');
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Play');
    });
};
exports.handleUpnpPlay = handleUpnpPlay;
/**
 * UPNP暂停
 * POST /api/upnp/pause
 */
const handleUpnpPause = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId } = body;
            if (!deviceId)
                throw new Error('Missing deviceId');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found');
            await upnp.pause(device);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Pause');
    });
};
exports.handleUpnpPause = handleUpnpPause;
/**
 * UPNP恢复播放
 * POST /api/upnp/resume
 */
const handleUpnpResume = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId } = body;
            if (!deviceId)
                throw new Error('Missing deviceId');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found');
            await upnp.play(device);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Resume');
    });
};
exports.handleUpnpResume = handleUpnpResume;
/**
 * UPNP停止
 * POST /api/upnp/stop
 */
const handleUpnpStop = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId } = body;
            if (!deviceId)
                throw new Error('Missing deviceId');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found');
            await upnp.stop(device);
            // 停止时清除活跃设备
            upnp.setActiveDevice(null, '', '');
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Stop');
    });
};
exports.handleUpnpStop = handleUpnpStop;
/**
 * UPNP跳转进度
 * POST /api/upnp/seek
 */
const handleUpnpSeek = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId, position } = body;
            if (!deviceId || position === undefined)
                throw new Error('Missing deviceId or position');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found');
            const timeStr = typeof position === 'number' ? upnp.secondsToTime(position) : position;
            await upnp.seek(device, timeStr);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Seek');
    });
};
exports.handleUpnpSeek = handleUpnpSeek;
/**
 * UPNP设置音量
 * POST /api/upnp/volume
 */
const handleUpnpSetVolume = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId, volume } = body;
            if (!deviceId || volume === undefined)
                throw new Error('Missing deviceId or volume');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found');
            await upnp.setVolume(device, volume);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Set Volume');
    });
};
exports.handleUpnpSetVolume = handleUpnpSetVolume;
/**
 * UPNP获取音量
 * GET /api/upnp/volume
 */
const handleUpnpGetVolume = (req, res, urlObj) => {
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const deviceId = urlObj.searchParams.get('deviceId');
        if (!deviceId)
            throw new Error('Missing deviceId');
        const device = await upnp.getDeviceWithRefresh(deviceId);
        if (!device)
            throw new Error('Device not found');
        const volume = await upnp.getVolume(device);
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, volume });
    }, 'UPNP Get Volume');
};
exports.handleUpnpGetVolume = handleUpnpGetVolume;
/**
 * UPNP获取传输状态(播放状态+进度)
 * GET /api/upnp/status
 */
const handleUpnpStatus = (req, res, urlObj) => {
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const deviceId = urlObj.searchParams.get('deviceId');
        if (!deviceId)
            throw new Error('Missing deviceId');
        const device = await upnp.getDeviceWithRefresh(deviceId);
        if (!device)
            throw new Error('Device not found');
        const [transportInfo, positionInfo] = await Promise.all([
            upnp.getTransportInfo(device).catch(() => ({ currentTransportState: 'UNKNOWN', currentTransportStatus: 'ERROR', currentSpeed: '0' })),
            upnp.getPositionInfo(device).catch(() => ({ track: '0', trackDuration: '00:00:00', trackMetaData: '', trackURI: '', relTime: '00:00:00', absTime: '00:00:00' })),
        ]);
        (0, commonUtils_1.sendJsonResponse)(res, 200, {
            success: true,
            state: transportInfo.currentTransportState,
            status: transportInfo.currentTransportStatus,
            position: upnp.timeToSeconds(positionInfo.relTime),
            duration: upnp.timeToSeconds(positionInfo.trackDuration),
            relTime: positionInfo.relTime,
            trackDuration: positionInfo.trackDuration,
            trackUri: positionInfo.trackURI || '',
        });
    }, 'UPNP Status');
};
exports.handleUpnpStatus = handleUpnpStatus;
/**
 * UPNP设置下一首(预加载)
 * POST /api/upnp/setNext
 */
const handleUpnpSetNext = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId, mediaUrl, title, artist, album, albumArtUrl } = body;
            if (!deviceId || !mediaUrl)
                throw new Error('Missing deviceId or mediaUrl');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found. Please scan again.');
            // 构建完整URL
            let fullUrl = mediaUrl;
            if (mediaUrl.startsWith('/')) {
                const port = global.lx.config.port;
                const addresses = (0, commonUtils_1.getServerAddresses)();
                const host = addresses.length > 0 ? addresses[0] : '127.0.0.1';
                fullUrl = `http://${host}:${port}${mediaUrl}`;
            }
            else if (mediaUrl.startsWith('http://')) {
                try {
                    const urlObj = new URL(mediaUrl);
                    if (urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1') {
                        const addresses = (0, commonUtils_1.getServerAddresses)();
                        urlObj.hostname = addresses.length > 0 ? addresses[0] : '127.0.0.1';
                        urlObj.port = String(global.lx.config.port);
                        fullUrl = urlObj.toString();
                    }
                }
                catch (_) { /* 使用原始值 */ }
            }
            const didl = upnp.buildSongDIDL(fullUrl, title || '', artist || '', album || '', albumArtUrl ? (albumArtUrl.startsWith('/') ? `http://${(0, commonUtils_1.getServerAddresses)()[0] || '127.0.0.1'}:${global.lx.config.port}${albumArtUrl}` : albumArtUrl) : undefined);
            // SetNextAVTransportURI with fallback
            try {
                await upnp.setNextAVTransportURI(device, fullUrl, didl);
            }
            catch (setErr) {
                console.warn('[UPNP] SetNextAVTransportURI with metadata failed:', setErr.message);
                try {
                    await upnp.setNextAVTransportURI(device, fullUrl, '');
                }
                catch (setErr2) {
                    console.warn('[UPNP] SetNextAVTransportURI not supported by device, skipping preload:', setErr2.message);
                }
            }
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP SetNext');
    });
};
exports.handleUpnpSetNext = handleUpnpSetNext;
/**
 * UPNP下一首
 * POST /api/upnp/next
 */
const handleUpnpNext = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId } = body;
            if (!deviceId)
                throw new Error('Missing deviceId');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found');
            await upnp.nextTrack(device);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Next');
    });
};
exports.handleUpnpNext = handleUpnpNext;
/**
 * UPNP上一首
 * POST /api/upnp/previous
 */
const handleUpnpPrevious = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId } = body;
            if (!deviceId)
                throw new Error('Missing deviceId');
            const device = await upnp.getDeviceWithRefresh(deviceId);
            if (!device)
                throw new Error('Device not found');
            await upnp.previousTrack(device);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'UPNP Previous');
    });
};
exports.handleUpnpPrevious = handleUpnpPrevious;
/**
 * 连接DMR设备
 * POST /api/dlna/connect
 */
const handleDlnaConnect = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { deviceId } = body;
            if (!deviceId)
                throw new Error('Missing deviceId');
            await dlnaDmc.connectDevice(deviceId);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'DLNA Connect');
    });
};
exports.handleDlnaConnect = handleDlnaConnect;
/**
 * 断开DMR设备
 * POST /api/dlna/disconnect
 */
const handleDlnaDisconnect = (req, res) => {
    void dlnaDmc.disconnectDevice().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleDlnaDisconnect = handleDlnaDisconnect;
/**
 * 获取DMC完整状态
 * GET /api/dlna/state
 */
const handleDlnaState = (req, res) => {
    const state = dlnaDmc.getFullState();
    (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, ...state });
};
exports.handleDlnaState = handleDlnaState;
/**
 * DMC播放歌曲
 * POST /api/dlna/play
 */
const handleDlnaPlay = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { song, index } = body;
            if (!song)
                throw new Error('Missing song');
            await dlnaDmc.playSong(song, index);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'DLNA Play');
    });
};
exports.handleDlnaPlay = handleDlnaPlay;
/**
 * DMC暂停
 * POST /api/dlna/pause
 */
const handleDlnaPause = (req, res) => {
    void dlnaDmc.pause().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleDlnaPause = handleDlnaPause;
/**
 * DMC恢复播放
 * POST /api/dlna/resume
 */
const handleDlnaResume = (req, res) => {
    void dlnaDmc.resume().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleDlnaResume = handleDlnaResume;
/**
 * DMC停止
 * POST /api/dlna/stop
 */
const handleDlnaStop = (req, res) => {
    void dlnaDmc.stop().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleDlnaStop = handleDlnaStop;
/**
 * DMC跳转进度
 * POST /api/dlna/seek
 */
const handleDlnaSeek = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { position } = body;
            if (position === undefined)
                throw new Error('Missing position');
            await dlnaDmc.seek(position);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'DLNA Seek');
    });
};
exports.handleDlnaSeek = handleDlnaSeek;
/**
 * DMC设置音量
 * POST /api/dlna/volume
 */
const handleDlnaVolume = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { volume } = body;
            if (volume === undefined)
                throw new Error('Missing volume');
            await dlnaDmc.setVolume(volume);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }, 'DLNA Volume');
    });
};
exports.handleDlnaVolume = handleDlnaVolume;
/**
 * DMC下一首
 * POST /api/dlna/next
 */
const handleDlnaNext = (req, res) => {
    void dlnaDmc.next().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleDlnaNext = handleDlnaNext;
/**
 * DMC上一首
 * POST /api/dlna/previous
 */
const handleDlnaPrevious = (req, res) => {
    void dlnaDmc.previous().then(() => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
    }).catch((err) => {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
    });
};
exports.handleDlnaPrevious = handleDlnaPrevious;
/**
 * DMC设置播放列表
 * POST /api/dlna/playlist
 */
const handleDlnaPlaylist = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        try {
            const { songs, startIndex, playImmediately } = body;
            console.log(`[API] /api/dlna/playlist: songs.length=${songs?.length || 0}, startIndex=${startIndex || 0}, playImmediately=${playImmediately !== false}`);
            if (songs && songs.length > 0) {
                console.log(`[API] /api/dlna/playlist: First song: id=${songs[0]?.id}, name=${songs[0]?.name}, source=${songs[0]?.source}`);
                console.log(`[API] /api/dlna/playlist: Last song: id=${songs[songs.length - 1]?.id}, name=${songs[songs.length - 1]?.name}`);
            }
            if (!songs)
                throw new Error('Missing songs');
            dlnaDmc.setPlaylist(songs, startIndex || 0, playImmediately !== false);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }
        catch (err) {
            (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: err.message });
        }
    });
};
exports.handleDlnaPlaylist = handleDlnaPlaylist;
/**
 * DLNA音频代理(将在线URL代理给DMR,确保局域网可达)
 * GET /api/dlna/proxy
 */
const handleDlnaProxy = (req, res, urlObj) => {
    const targetUrl = urlObj.searchParams.get('url');
    if (!targetUrl) {
        res.writeHead(400);
        res.end('Missing url parameter');
        return;
    }
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const proxyRes = await (0, needle_1.default)('get', targetUrl, null, {
            follow_max: 5,
            response_timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': '*/*',
            },
        });
        if (proxyRes.statusCode === 200 || proxyRes.statusCode === 206) {
            const headers = {
                'Content-Type': proxyRes.headers['content-type'] || 'audio/mpeg',
                'Access-Control-Allow-Origin': '*',
            };
            if (proxyRes.headers['content-length']) {
                headers['Content-Length'] = proxyRes.headers['content-length'];
            }
            if (proxyRes.headers['content-range']) {
                headers['Content-Range'] = proxyRes.headers['content-range'];
            }
            if (proxyRes.headers['accept-ranges']) {
                headers['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
            }
            res.writeHead(proxyRes.statusCode, headers);
            res.end(proxyRes.body);
        }
        else {
            res.writeHead(proxyRes.statusCode || 502);
            res.end('Upstream error');
        }
    }, 'DLNA Proxy');
};
exports.handleDlnaProxy = handleDlnaProxy;
