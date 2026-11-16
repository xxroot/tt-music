"use strict";
/**
 * DLNA DMC WebSocket 通信模块
 *
 * 独立 WS 通道（/ws/dlna），DMC↔WEB 消息路由。
 * 多客户端管理：所有连接的 WEB 客户端共享同一个 DMC 实例，
 * 新客户端自动接收完整状态，任一客户端的控制命令作用于同一 DMC。
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
exports.getConnectedClientCount = exports.broadcastToClients = exports.handleUpgrade = exports.createDlnaWsServer = void 0;
const ws_1 = require("ws");
const dlnaDmc = __importStar(require("./dlnaDmc"));
const dlnaDmc_1 = require("./dlnaDmc");
// ==================== Client Management ====================
const clients = new Set();
let wss = null;
// ==================== Server Creation ====================
/**
 * 创建 DLNA WebSocket 服务器
 * 挂载在 /ws/dlna 路径上（通过 server.ts 的 upgrade 路由分发）
 */
const createDlnaWsServer = (httpServer) => {
    wss = new ws_1.WebSocketServer({ noServer: true });
    wss.on('connection', (ws, request) => {
        clients.add(ws);
        setTimeout(() => {
            const state = dlnaDmc.getFullState();
            if (state.connected) {
                wsSend(ws, { type: dlnaDmc_1.DMC_MSG_TYPE.STATE, payload: state });
            }
        }, 500);
        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                handleClientMessage(ws, msg);
            }
            catch (err) {
                console.warn('[DLNA-WS] Invalid message:', err.message);
            }
        });
        ws.on('close', () => {
            clients.delete(ws);
        });
        ws.on('error', (err) => {
            console.warn('[DLNA-WS] Client error:', err.message);
            clients.delete(ws);
        });
    });
};
exports.createDlnaWsServer = createDlnaWsServer;
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
    switch (type) {
        case 'getState':
            wsSend(ws, { type: dlnaDmc_1.DMC_MSG_TYPE.STATE, payload: dlnaDmc.getFullState() });
            break;
        case 'connect':
            void dlnaDmc.connectDevice(payload.deviceId).catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'disconnect':
            void dlnaDmc.disconnectDevice().catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'play':
            void dlnaDmc.playSong(payload.song, payload.index).catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'pause':
            void dlnaDmc.pause().catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'resume':
            void dlnaDmc.resume().catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'stop':
            void dlnaDmc.stop().catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'seek':
            void dlnaDmc.seek(payload.position).catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'volume':
            void dlnaDmc.setVolume(payload.volume).catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'next':
            void dlnaDmc.next().catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'previous':
            void dlnaDmc.previous().catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        case 'setPlaylist':
            dlnaDmc.setPlaylist(payload.songs, payload.startIndex, payload.playImmediately);
            break;
        case 'updatePlaylistOrder':
            dlnaDmc.updatePlaylistOrder(payload.songs);
            break;
        case 'addToPlaylist':
            dlnaDmc.addToPlaylist(payload.songs);
            break;
        case 'removeFromPlaylist':
            dlnaDmc.removeFromPlaylist(payload.indices);
            break;
        case 'clearPlaylist':
            dlnaDmc.clearPlaylist();
            break;
        case 'setPlayMode':
            dlnaDmc.setPlayMode(payload.mode);
            break;
        case 'playIndex':
            void dlnaDmc.playIndex(payload.index).catch((err) => {
                (0, exports.broadcastToClients)({ type: dlnaDmc_1.DMC_MSG_TYPE.ERROR, payload: { message: err.message } });
            });
            break;
        default:
            console.warn('[DLNA-WS] Unknown message type:', type);
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
