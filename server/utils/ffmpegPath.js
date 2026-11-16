"use strict";
/**
 * ffmpeg 二进制路径统一获取工具 (Unified ffmpeg Path Resolver)
 *
 * 优先使用系统 ffmpeg（Docker apk add / 本机 brew install 均可命中），
 * fallback 到 ffmpeg-static npm 包，最终回退到 PATH 查找。
 * Alpine Linux 下系统 ffmpeg 为 musl 原生编译，可避免 ffmpeg-static (glibc) 的 DNS 解析不兼容问题。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getFfmpegPath = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
let cachedPath = null;
/**
 * 获取 ffmpeg 可执行文件路径
 * 优先使用系统 ffmpeg，fallback 到 ffmpeg-static npm 包
 */
const getFfmpegPath = () => {
    if (cachedPath)
        return cachedPath;
    // 1. 优先系统 ffmpeg (Docker apk add / 本机 brew install 均可命中)
    try {
        const systemFfmpeg = (0, node_child_process_1.execSync)('which ffmpeg', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (systemFfmpeg && node_fs_1.default.existsSync(systemFfmpeg)) {
            cachedPath = systemFfmpeg;
            return cachedPath;
        }
    }
    catch { /* not found */ }
    // 2. fallback 到 ffmpeg-static npm 包
    try {
        cachedPath = require('ffmpeg-static');
        return cachedPath;
    }
    catch { /* not available */ }
    // 3. 最终回退: 依赖 PATH
    cachedPath = 'ffmpeg';
    return cachedPath;
};
exports.getFfmpegPath = getFfmpegPath;
