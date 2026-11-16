"use strict";
/**
 * AirPlay DMC WebSocket 通信模块
 *
 * 独立 WS 通道（/ws/airplay），AirPlay DMC↔WEB 消息路由。
 * 与 /ws/dlna 平行，共享相同的消息协议格式。
 *
 * 对应 DLNA 侧的 dlnaWs.ts。
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
exports.getConnectedClientCount = exports.broadcastToClients = exports.handleUpgrade = exports.createAirPlayWsServer = void 0;
const ws_1 = require("ws");
const airplayDmc = __importStar(require("./airplayDmc"));
const airplayDmc_1 = require("./airplayDmc");
// ==================== Client Management ====================
const clients = new Set();
let wss = null;
// ==================== Server Creation ====================
/**
 * 创建 AirPlay WebSocket 服务器
 * 挂载在 /ws/airplay 路径上（通过 server.ts 的 upgrade 路由分发）
 */
const createAirPlayWsServer = (httpServer) => {
    wss = new ws_1.WebSocketServer({ noServer: true });
    // 初始化 DMC 广播函数
    airplayDmc.initAirPlayDmc(exports.broadcastToClients);
    wss.on('connection', (ws, request) => {
        clients.add(ws);
        // 新客户端连接后发送当前状态
        setTimeout(() => {
            const state = airplayDmc.getFullState();
            if (state.connected) {
                wsSend(ws, { type: airplayDmc_1.AIRPLAY_MSG_TYPE.STATE, payload: state });
            }
        }, 500);
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                handleClientMessage(ws, msg);
            }
            catch (err) {
                console.warn('[AirPlay-WS] Invalid message:', err.message);
            }
        });
        ws.on('close', () => {
            clients.delete(ws);
        });
        ws.on('error', (err) => {
            console.warn('[AirPlay-WS] Client error:', err.message);
            clients.delete(ws);
        });
    });
};
exports.createAirPlayWsServer = createAirPlayWsServer;
/**
 * 处理 WS upgrade 请求（由 server.ts 调用）
 */
const handleUpgrade = (request, socket, head) => {
    if (!wss)
        return;
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit('connection', ws, request);
    });
};
exports.handleUpgrade = handleUpgrade;
// ==================== Message Routing ====================
/**
 * 处理 WEB 客户端发来的命令消息
 */
const handleClientMessage = (ws, msg) => {
    const { type, payload } = msg;
    console.log(`[AirPlay-WS] 收到命令: type=${type}`, payload ? JSON.stringify(payload).substring(0, 150) : '');
    switch (type) {
        case 'getState':
            wsSend(ws, { type: airplayDmc_1.AIRPLAY_MSG_TYPE.STATE, payload: airplayDmc.getFullState() });
            break;
        case 'connect':
            void airplayDmc.connectDevice(payload.deviceId).catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'disconnect':
            void airplayDmc.disconnectDevice().catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'play':
            void airplayDmc.playSong(payload.song, payload.index).catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'pause':
            void airplayDmc.pause().catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'resume':
            void airplayDmc.resume().catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'stop':
            void airplayDmc.stop().catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'seek':
            void airplayDmc.seek(payload.position).catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'volume':
            airplayDmc.setVolume(payload.volume);
            break;
        case 'next':
            void airplayDmc.next().catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'previous':
            void airplayDmc.previous().catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'setPlaylist':
            airplayDmc.setPlaylist(payload.songs, payload.startIndex, payload.playImmediately);
            break;
        case 'updatePlaylistOrder':
            airplayDmc.updatePlaylistOrder(payload.songs);
            break;
        case 'addToPlaylist':
            airplayDmc.addToPlaylist(payload.songs);
            break;
        case 'removeFromPlaylist':
            airplayDmc.removeFromPlaylist(payload.indices);
            break;
        case 'clearPlaylist':
            airplayDmc.clearPlaylist();
            break;
        case 'setPlayMode':
            airplayDmc.setPlayMode(payload.mode);
            break;
        case 'playIndex':
            void airplayDmc.playIndex(payload.index).catch((err) => {
                (0, exports.broadcastToClients)({ type: airplayDmc_1.AIRPLAY_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        default:
            console.warn('[AirPlay-WS] Unknown message type:', type);
    }
};
// ==================== Broadcast ====================
/**
 * 广播消息给所有连接的 WEB 客户端
 */
const broadcastToClients = (message) => {
    const data = JSON.stringify(message);
    for (const client of clients) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            client.send(data);
        }
    }
};
exports.broadcastToClients = broadcastToClients;
/**
 * 获取连接的客户端数量
 */
const getConnectedClientCount = () => {
    return clients.size;
};
exports.getConnectedClientCount = getConnectedClientCount;
// ==================== Helpers ====================
const wsSend = (ws, message) => {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
};
