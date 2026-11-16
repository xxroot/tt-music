"use strict";
// 集中路径解析模块 — 统一管理下载、缓存两大目录的路径解析
// 消除 fileCache.ts / server.ts / localSong.ts / acoustidScrape.ts / localLibrary.ts 中的分散重复逻辑
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMusicDirectories = exports.resolveAudioFilePath = exports.getCacheDir = exports.getDownloadDir = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
// ==================== 两大目录解析函数 ====================
/**
 * 获取下载目录（音乐文件永久存储位置）
 * 优先级: DOWNLOAD_PATH > cwd/download
 */
const getDownloadDir = () => {
    if (process.env.DOWNLOAD_PATH)
        return process.env.DOWNLOAD_PATH;
    return node_path_1.default.join(process.cwd(), 'download');
};
exports.getDownloadDir = getDownloadDir;
/**
 * 获取缓存目录（在线播放临时缓存位置）
 * 优先级: CACHE_PATH > cwd/cache
 */
const getCacheDir = () => {
    if (process.env.CACHE_PATH)
        return process.env.CACHE_PATH;
    return node_path_1.default.join(process.cwd(), 'cache');
};
exports.getCacheDir = getCacheDir;
// ==================== 辅助函数 ====================
/**
 * 跨目录解析音频文件：在下载目录和缓存目录中查找
 * 替代 localSong.ts / acoustidScrape.ts / server.ts 中的内联 for 循环
 * @param relativePath 相对于目录根的文件路径（如 "专辑/歌曲.flac"）
 * @returns 找到的绝对路径，或 null
 */
const resolveAudioFilePath = (relativePath) => {
    const dirs = [(0, exports.getDownloadDir)(), (0, exports.getCacheDir)()];
    for (const dir of dirs) {
        const fullPath = node_path_1.default.join(dir, relativePath);
        if (node_fs_1.default.existsSync(fullPath))
            return fullPath;
    }
    return null;
};
exports.resolveAudioFilePath = resolveAudioFilePath;
/**
 * 启动时确保两个音乐子目录存在
 * 与 index.ts 中 checkAndCreateDir(global.lx.dataPath) 同模式
 * Docker 和非 Docker 环境均适用
 */
const ensureMusicDirectories = () => {
    const dirs = [(0, exports.getDownloadDir)(), (0, exports.getCacheDir)()];
    for (const dir of dirs) {
        if (!node_fs_1.default.existsSync(dir)) {
            node_fs_1.default.mkdirSync(dir, { recursive: true });
            console.log(`[PathUtil] Created directory: ${dir}`);
        }
    }
};
exports.ensureMusicDirectories = ensureMusicDirectories;
