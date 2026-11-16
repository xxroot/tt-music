"use strict";
/**
 * 本地库文件监听模块 (Local Library File Watcher)
 * 使用 chokidar 监听文件变更，自动增量更新数据库
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setDebounce = exports.restoreWatchers = exports.getWatcherStatus = exports.stopAllWatchers = exports.stopWatcher = exports.startWatcher = void 0;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const db_songs_1 = require("../utils/db-songs");
const localLibrary_1 = require("./localLibrary");
// ==================== 全局状态 ====================
/** 活跃的监听器 Map<libraryId, WatcherState> */
const watcherMap = new Map();
// ==================== 内部工具 ====================
/** 获取音频扩展名检查 */
const isAudioFile = (filePath) => {
    const ext = path_1.default.extname(filePath).toLowerCase();
    return localLibrary_1.LOCAL_AUDIO_EXTENSIONS.includes(ext);
};
/** 判断是否为封面图片文件 */
const isImageFile = (filePath) => {
    const ext = path_1.default.extname(filePath).toLowerCase();
    return localLibrary_1.IMAGE_EXTENSIONS.includes(ext);
};
/** 是否应忽略的文件 */
const shouldIgnore = (filePath) => {
    const basename = path_1.default.basename(filePath);
    if (basename.startsWith('.'))
        return true;
    if (basename.toLowerCase().endsWith('.cue'))
        return true;
    return false;
};
/** 处理防抖队列中的变更 */
const flushPendingChanges = async (state) => {
    if (state.pendingChanges.size === 0)
        return;
    const library = (0, localLibrary_1.getLibraryById)(state.libraryId);
    if (!library) {
        state.pendingChanges.clear();
        return;
    }
    const source = 'local';
    const libraryPath = library.path;
    const changes = new Map(state.pendingChanges);
    state.pendingChanges.clear();
    console.log(`[Watcher] Flushing ${changes.size} changes for ${library.name}`);
    // 初始化进度计数器并广播开始
    let processed = 0, added = 0, deleted = 0, errors = 0;
    const total = changes.size;
    (0, localLibrary_1.broadcastScanProgress)({
        type: 'local_watcher_progress',
        libraryId: state.libraryId,
        progress: { total, scanned: 0, added: 0, skipped: 0, errors: 0 },
        currentFile: '',
    });
    // 收集需要重建封面的专辑目录 (按 albumDir 去重)
    const affectedAlbumDirs = new Set();
    // 收集所有待处理音频文件的目录，批量加入刮削白名单
    const protectedDirs = new Set();
    for (const [filePath, changeType] of changes) {
        if (isAudioFile(filePath) && (changeType === 'add' || changeType === 'change')) {
            protectedDirs.add(path_1.default.dirname(filePath));
        }
    }
    for (const dir of protectedDirs)
        (0, localLibrary_1.addScrapingDirectory)(dir);
    try {
        for (const [filePath, changeType] of changes) {
            const relativePath = path_1.default.relative(libraryPath, filePath).replace(/\\/g, '/');
            try {
                if (isImageFile(filePath)) {
                    // 图片文件变更: 收集受影响的专辑目录，统一在后面处理封面重建
                    const albumDir = path_1.default.dirname(filePath);
                    affectedAlbumDirs.add(albumDir);
                    console.log(`[Watcher] Image ${changeType}: ${relativePath} (album dir queued for cover rebuild)`);
                }
                else if (isAudioFile(filePath)) {
                    const songId = (0, localLibrary_1.generateSongId)(library.id, relativePath);
                    if (changeType === 'unlink') {
                        // 音频文件删除: 删除 DB 记录 (使用 db-songs 封装函数)
                        (0, db_songs_1.deleteDownloadRecordBySourceAndSongId)(source, songId);
                        deleted++;
                        console.log(`[Watcher] Deleted record: ${relativePath}`);
                    }
                    else if (changeType === 'add' || changeType === 'change') {
                        // 音频文件新增/修改: 使用公共函数构建记录并写入 DB
                        if (!fs_1.default.existsSync(filePath))
                            continue;
                        const stats = fs_1.default.statSync(filePath);
                        if (stats.size < 1024 * 1024)
                            continue; // < 1MB 跳过
                        const record = await (0, localLibrary_1.buildLocalSongRecord)(filePath, libraryPath, source, undefined, affectedAlbumDirs, library.id);
                        if (!record)
                            continue;
                        (0, db_songs_1.upsertDownloadRecord)(record);
                        added++;
                        console.log(`[Watcher] ${changeType === 'add' ? 'Added' : 'Updated'} record: ${relativePath}`);
                    }
                }
            }
            catch (err) {
                errors++;
                console.error(`[Watcher] Error processing ${changeType} for ${relativePath}:`, err.message);
            }
            // 每个文件处理完后广播进度
            processed++;
            (0, localLibrary_1.broadcastScanProgress)({
                type: 'local_watcher_progress',
                libraryId: state.libraryId,
                progress: { total, scanned: processed, added, skipped: deleted, errors },
                currentFile: path_1.default.basename(filePath),
            });
        }
        // 封面重建: 对每个受影响的专辑目录执行缓存失效 → 重新查找 → 批量更新 DB
        for (const albumDir of affectedAlbumDirs) {
            try {
                (0, localLibrary_1.invalidateAlbumCoverCache)(albumDir);
                const coverFile = (0, localLibrary_1.findAlbumCover)(albumDir);
                const albumRelativeDir = path_1.default.relative(libraryPath, albumDir).replace(/\\/g, '/');
                const imgPath = coverFile
                    ? path_1.default.relative(libraryPath, path_1.default.join(albumDir, coverFile)).replace(/\\/g, '/')
                    : '';
                const affected = (0, db_songs_1.updateAlbumCoverBatch)(source, albumRelativeDir, !!coverFile, imgPath);
                console.log(`[Watcher] Cover rebuilt for ${albumRelativeDir}, updated ${affected} records (cover: ${coverFile || 'none'})`);
            }
            catch (err) {
                console.error(`[Watcher] Cover rebuild failed for ${albumDir}:`, err.message);
            }
        }
        // 更新 songCount (按库路径前缀统计，多库互不影响)
        const count = (0, db_songs_1.getFinishedCountByPathPrefix)(libraryPath);
        (0, localLibrary_1.updateLibraryField)(state.libraryId, 'songCount', count);
        // 广播 watcher 处理完成
        (0, localLibrary_1.broadcastScanProgress)({
            type: 'local_watcher_complete',
            libraryId: state.libraryId,
            result: { added, deleted, errors },
        });
    }
    finally {
        // 批量移除所有刮削白名单目录
        for (const dir of protectedDirs)
            (0, localLibrary_1.removeScrapingDirectory)(dir);
    }
};
/** 设置防抖定时器 */
const scheduleFlush = (state) => {
    if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        void flushPendingChanges(state);
    }, state.debounceMs);
};
// ==================== 公共 API ====================
/**
 * 启动指定库的文件监听
 */
const startWatcher = (libraryId) => {
    const library = (0, localLibrary_1.getLibraryById)(libraryId);
    if (!library) {
        console.error(`[Watcher] Library not found: ${libraryId}`);
        return false;
    }
    // 已启动则跳过
    const existing = watcherMap.get(libraryId);
    if (existing && existing.active) {
        console.log(`[Watcher] Already watching: ${library.name}`);
        return true;
    }
    // 清理旧状态
    if (existing) {
        (0, exports.stopWatcher)(libraryId);
    }
    try {
        const chokidar = require('chokidar');
        const state = {
            watcher: null,
            libraryId,
            active: false,
            debounceMs: library.autoWatchDebounce || 3000,
            pendingChanges: new Map(),
            debounceTimer: null,
        };
        const watcher = chokidar.watch(library.path, {
            ignoreInitial: true,
            awaitWriteFinish: {
                stabilityThreshold: 2000,
                pollInterval: 100,
            },
            ignored: (filePath) => shouldIgnore(filePath),
            persistent: true,
        });
        watcher.on('add', (filePath) => {
            if (!isAudioFile(filePath) && !isImageFile(filePath))
                return;
            if ((0, localLibrary_1.isFileUnderScraping)(filePath))
                return; // 白名单命中，不入队
            state.pendingChanges.set(filePath, 'add');
            scheduleFlush(state);
        });
        watcher.on('change', (filePath) => {
            if (!isAudioFile(filePath) && !isImageFile(filePath))
                return;
            if ((0, localLibrary_1.isFileUnderScraping)(filePath))
                return; // 白名单命中，不入队
            state.pendingChanges.set(filePath, 'change');
            scheduleFlush(state);
        });
        watcher.on('unlink', (filePath) => {
            if (!isAudioFile(filePath) && !isImageFile(filePath))
                return;
            if ((0, localLibrary_1.isFileUnderScraping)(filePath))
                return; // 白名单命中，不入队
            state.pendingChanges.set(filePath, 'unlink');
            scheduleFlush(state);
        });
        watcher.on('error', (err) => {
            console.error(`[Watcher] Error for ${library.name}:`, err.message);
        });
        watcher.on('ready', () => {
            console.log(`[Watcher] Ready: ${library.name} at ${library.path}`);
        });
        state.watcher = watcher;
        state.active = true;
        watcherMap.set(libraryId, state);
        // 更新库配置
        (0, localLibrary_1.updateLibraryField)(libraryId, 'autoWatch', true);
        console.log(`[Watcher] Started watching: ${library.name}`);
        return true;
    }
    catch (err) {
        console.error(`[Watcher] Failed to start: ${err.message}`);
        return false;
    }
};
exports.startWatcher = startWatcher;
/**
 * 停止指定库的文件监听
 * @param libraryId 库 ID
 * @param persist 是否将 autoWatch=false 持久化到配置文件（进程退出时传 false，避免下次启动丢失配置）
 */
const stopWatcher = (libraryId, persist = true) => {
    const state = watcherMap.get(libraryId);
    if (!state) {
        // 即使 watcher 未运行，也要将 autoWatch 写回 false，确保配置与 UI 一致
        if (persist) {
            (0, localLibrary_1.updateLibraryField)(libraryId, 'autoWatch', false);
        }
        return;
    }
    // 清除防抖定时器
    if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
    }
    // 刷新待处理的变更
    if (state.pendingChanges.size > 0) {
        void flushPendingChanges(state);
    }
    // 关闭 watcher
    if (state.watcher) {
        state.watcher.close().catch(() => { });
        state.watcher = null;
    }
    state.active = false;
    watcherMap.delete(libraryId);
    // 仅用户主动停止时才将 autoWatch 写回 false；进程退出时不动配置，保留下次启动自动恢复
    if (persist) {
        (0, localLibrary_1.updateLibraryField)(libraryId, 'autoWatch', false);
    }
    console.log(`[Watcher] Stopped watching library: ${libraryId}${persist ? '' : ' (shutdown, config preserved)'}`);
};
exports.stopWatcher = stopWatcher;
/**
 * 停止所有监听器 (进程退出时调用)
 */
const stopAllWatchers = () => {
    console.log(`[Watcher] Stopping all watchers (${watcherMap.size} active)`);
    for (const [libraryId] of watcherMap) {
        (0, exports.stopWatcher)(libraryId, false); // 进程退出：不持久化，保留 autoWatch 配置
    }
};
exports.stopAllWatchers = stopAllWatchers;
/**
 * 获取监听器状态
 */
const getWatcherStatus = (libraryId) => {
    const state = watcherMap.get(libraryId);
    if (!state) {
        const library = (0, localLibrary_1.getLibraryById)(libraryId);
        return {
            autoWatch: library?.autoWatch || false,
            watcherActive: false,
            debounceMs: library?.autoWatchDebounce || 3000,
            pendingChanges: 0,
        };
    }
    return {
        autoWatch: true,
        watcherActive: state.active,
        debounceMs: state.debounceMs,
        pendingChanges: state.pendingChanges.size,
    };
};
exports.getWatcherStatus = getWatcherStatus;
/**
 * 恢复所有已配置自动监听的库 (启动时调用)
 */
const restoreWatchers = () => {
    const config = (0, localLibrary_1.loadLocalLibraries)();
    let restored = 0;
    for (const lib of config.libraries) {
        if (lib.autoWatch) {
            const started = (0, exports.startWatcher)(lib.id);
            if (started)
                restored++;
        }
    }
    if (restored > 0) {
        console.log(`[Watcher] Restored ${restored} watchers`);
    }
};
exports.restoreWatchers = restoreWatchers;
/**
 * 设置指定库的防抖延迟
 */
const setDebounce = (libraryId, ms) => {
    const state = watcherMap.get(libraryId);
    if (state) {
        state.debounceMs = ms;
    }
    // 同时更新库配置
    (0, localLibrary_1.updateLibraryField)(libraryId, 'autoWatchDebounce', ms);
};
exports.setDebounce = setDebounce;
