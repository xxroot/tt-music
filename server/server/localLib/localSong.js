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
exports.handleCheckCache = exports.handleEnrichMeta = exports.handleDBSync = exports.handleUpdateDuration = exports.handleCheckDownloadStatus = exports.handleCacheProgress = exports.handleMoveCacheToMusic = exports.handleClearLyricCache = exports.handleClearCache = exports.handleCacheStats = exports.handleServeCacheFile = exports.handleStopDownload = exports.handleDownload = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const fileCache = __importStar(require("../fileCache"));
const pathUtil_1 = require("../../utils/pathUtil");
const commonUtils_1 = require("../commonUtils");
const db_1 = require("../../utils/db");
const MusicTagUtil = __importStar(require("../../utils/MusicTagUtil"));
/**
 * 触发下载
 * POST /api/music/cache/download
 * Body: { songInfo, url, quality, isOnlyDownload }
 */
const handleDownload = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        const { songInfo, url, quality, isOnlyDownload } = body;
        if (!songInfo || !url) {
            res.writeHead(400);
            res.end('Missing params');
            return;
        }
        const username = (0, commonUtils_1.verifyUserAccess)(req, res);
        if (!username)
            return;
        const rawSongKey = String(songInfo.id || songInfo.songmid);
        const songSource = String(songInfo.source || 'unknown');
        const songKey = `${songSource}_${rawSongKey}`;
        console.log(`[DL-DIAG] handleDownload: ${songInfo.name} (${songKey}), user=${username}`);
        const controller = new AbortController();
        let userTasks = fileCache.activeTasks.get(username);
        if (!userTasks) {
            userTasks = [];
            fileCache.activeTasks.set(username, userTasks);
        }
        userTasks.push({ songKey, controller });
        // [Fix] 下载场景: 使用 downloadMusic 保存到 music/ + DB
        void fileCache.downloadMusic(songInfo, url, isOnlyDownload, quality, controller.signal)
            .then(() => { })
            .catch((err) => {
            if (err.message === 'Aborted') {
                console.log(`[DL-DIAG] Download ABORTED: ${songInfo.name} (${songKey})`);
            }
            else {
                console.error(`[DL-DIAG] Download FAILED: ${songInfo.name} (${songKey}), error=${err.message}`);
            }
        })
            .finally(() => {
            // Cleanup active task
            const tasks = fileCache.activeTasks.get(username);
            if (tasks) {
                const idx = tasks.findIndex(t => t.songKey === songKey);
                if (idx !== -1) {
                    tasks.splice(idx, 1);
                }
            }
        });
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, message: 'Download started' });
    });
};
exports.handleDownload = handleDownload;
/**
 * 停止下载任务
 * POST /api/music/cache/stop
 * Body: { songKey, all }
 */
const handleStopDownload = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        try {
            const { songKey, all } = body;
            if (all) {
                fileCache.stopUserTasks(username);
                console.log(`[Cache] Stopped all tasks for user: ${username}`);
            }
            else if (songKey) {
                fileCache.stopUserTasks(username, songKey);
                console.log(`[Cache] Stopped task ${songKey} for user: ${username}`);
            }
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true });
        }
        catch (e) {
            res.writeHead(400);
            res.end(e.message);
        }
    });
};
exports.handleStopDownload = handleStopDownload;
/**
 * 提供缓存文件服务
 * GET /api/music/cache/file/{relativePath}
 * GET /api/music/cache/file/{source}/{relativePath} — 支持本地库 source
 */
const handleServeCacheFile = (req, res, pathname) => {
    const rawPath = decodeURIComponent(pathname.replace('/api/music/cache/file/', ''));
    // 检测 local/ 前缀: /api/music/cache/file/local/album/song.flac
    if (rawPath.startsWith('local/')) {
        const slashIdx = rawPath.indexOf('/');
        if (slashIdx > 0) {
            const source = rawPath.substring(0, slashIdx);
            const relativePath = rawPath.substring(slashIdx + 1);
            try {
                const localLib = require('../localLibrary');
                const absolutePath = localLib.resolveLocalFilePath(source, relativePath);
                if (absolutePath) {
                    // 直接服务本地文件 (支持 Range 请求)
                    const stat = node_fs_1.default.statSync(absolutePath);
                    const ext = node_path_1.default.extname(absolutePath).toLowerCase();
                    const mimeTypes = {
                        '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
                        '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ape': 'audio/ape',
                        '.wv': 'audio/wavpack', '.dsf': 'audio/dsf', '.dff': 'audio/dff',
                        '.aiff': 'audio/aiff', '.aif': 'audio/aiff', '.dts': 'audio/dts',
                    };
                    const contentType = mimeTypes[ext] || 'application/octet-stream';
                    const range = req.headers.range;
                    if (range) {
                        const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range);
                        if (!rangeMatch) {
                            res.writeHead(200, {
                                'Content-Length': stat.size,
                                'Content-Type': contentType,
                                'Accept-Ranges': 'bytes',
                            });
                            node_fs_1.default.createReadStream(absolutePath).pipe(res);
                        }
                        else {
                            let start = rangeMatch[1] === '' ? NaN : parseInt(rangeMatch[1], 10);
                            let end = rangeMatch[2] === '' ? NaN : parseInt(rangeMatch[2], 10);
                            // 后缀范围 bytes=-N
                            if (isNaN(start) && !isNaN(end)) {
                                start = Math.max(0, stat.size - end);
                                end = stat.size - 1;
                            }
                            else {
                                if (isNaN(start)) start = 0;
                                if (isNaN(end)) end = stat.size - 1;
                            }
                            if (start < 0) start = 0;
                            if (end > stat.size - 1) end = stat.size - 1;
                            // 越界：返回 416，避免 ReadStream 抛 ERR_OUT_OF_RANGE 把请求打挂
                            if (start >= stat.size || start > end) {
                                res.writeHead(416, {
                                    'Content-Range': `bytes */${stat.size}`,
                                    'Content-Type': contentType,
                                });
                                res.end();
                            }
                            else {
                                const chunksize = (end - start) + 1;
                                const file = node_fs_1.default.createReadStream(absolutePath, { start, end });
                                file.on('error', (err) => {
                                    console.error('[LocalSong] stream error:', err.message);
                                    res.destroy();
                                });
                                res.writeHead(206, {
                                    'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                                    'Accept-Ranges': 'bytes',
                                    'Content-Length': chunksize,
                                    'Content-Type': contentType,
                                });
                                file.pipe(res);
                            }
                        }
                    }
                    else {
                        res.writeHead(200, {
                            'Content-Length': stat.size,
                            'Content-Type': contentType,
                            'Accept-Ranges': 'bytes',
                        });
                        node_fs_1.default.createReadStream(absolutePath).pipe(res);
                    }
                    return;
                }
            }
            catch (err) {
                console.error('[LocalSong] Serve local file error:', err.message);
            }
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
    }
    // 原有逻辑
    if (rawPath) {
        fileCache.serveCacheFile(req, res, rawPath);
        return;
    }
};
exports.handleServeCacheFile = handleServeCacheFile;
/**
 * 获取缓存统计
 * GET /api/music/cache/stats
 */
const handleCacheStats = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const stats = fileCache.getCacheStats();
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, data: stats });
    }
    catch (e) {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: e.message || 'Failed to get cache stats' });
    }
};
exports.handleCacheStats = handleCacheStats;
/**
 * 清除所有缓存
 * POST /api/music/cache/clear
 */
const handleClearCache = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const result = fileCache.clearAllCache();
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, data: result });
    }
    catch (e) {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: e.message || 'Failed to clear cache' });
    }
};
exports.handleClearCache = handleClearCache;
/**
 * 清除歌词缓存
 * POST /api/music/cache/lyric/clear
 */
const handleClearLyricCache = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const result = fileCache.clearLyricCache();
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, data: result });
    }
    catch (e) {
        (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: e.message || 'Failed to clear lyric cache' });
    }
};
exports.handleClearLyricCache = handleClearLyricCache;
/**
 * 移动缓存到 music 目录
 * POST /api/music/cache/move-to-music
 * Body (可选): { relativePath } - 指定单个文件的相对路径; 不传则批量移动全部
 */
const handleMoveCacheToMusic = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        try {
            if (body?.relativePath) {
                // 单文件移动: 前端传入 relativePath
                const result = fileCache.moveSingleCacheToMusic(body.relativePath);
                console.log(`[MoveToMusic] Single file: ${body.relativePath} => ${result.success ? 'OK' : result.error}`);
                (0, commonUtils_1.sendJsonResponse)(res, result.success ? 200 : 500, { success: result.success, data: result });
            }
            else {
                // 批量移动: 移动全部 cache → download
                const result = fileCache.moveAllCacheToDownload();
                (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, data: result });
            }
        }
        catch (e) {
            (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: e.message || 'Failed to move cache to download' });
        }
    });
};
exports.handleMoveCacheToMusic = handleMoveCacheToMusic;
/**
 * 获取下载进度
 * GET /api/music/cache/progress?ids=id1,id2,id3
 */
const handleCacheProgress = (req, res, urlObj) => {
    const ids = urlObj.searchParams.get('ids')?.split(',') || [];
    const progress = {};
    ids.forEach(id => {
        if (fileCache.cacheProgress.has(id)) {
            progress[id] = fileCache.cacheProgress.get(id);
        }
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: progress }));
};
exports.handleCacheProgress = handleCacheProgress;
/**
 * 检查歌曲是否已下载（批量 DB 查询，基于 album + song_name + singer 唯一键）
 * POST /api/music/cache/status
 * Body: { songs: [{ id, name, singer, albumName, source }] }
 * 返回: { success, data: { [id]: { exists, relativePath, ext, filename } } }
 */
const handleCheckDownloadStatus = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        void (0, commonUtils_1.safeAsync)(res, async () => {
            const { songs } = body;
            if (!Array.isArray(songs) || songs.length === 0) {
                (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: 'Missing or empty songs array' });
                return;
            }
            const result = {};
            for (const song of songs) {
                const songId = String(song.id || song.songmid || '');
                if (!songId)
                    continue;
                // DB 存储原始值，不做 sanitizePath 处理
                const name = String(song.name || '');
                const singer = String(song.singer || 'Unknown');
                const album = String(song.albumName || 'Unknown');
                if (!name) {
                    result[songId] = { exists: false };
                    continue;
                }
                // DB song_name 就是原始 songInfo.name，直接用原始值查询
                const record = (0, db_1.getDownloadRecordByName)(name, singer, album);
                if (record) {
                    result[songId] = {
                        exists: true,
                        relativePath: record.relative_path || '',
                        ext: (record.ext || '').replace(/^\./, ''),
                        filename: record.file_path ? node_path_1.default.basename(record.file_path) : ''
                    };
                }
                else {
                    result[songId] = { exists: false };
                }
            }
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, data: result });
        }, 'CheckDownloadStatus');
    });
};
exports.handleCheckDownloadStatus = handleCheckDownloadStatus;
/**
 * 更新歌曲时长
 * POST /api/music/cache/update-duration
 * Body: { songId, duration }
 */
const handleUpdateDuration = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        const { songId, duration } = body;
        if (!songId || !duration || !Number.isFinite(duration) || duration <= 0) {
            (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: 'Missing or invalid songId/duration' });
            return;
        }
        void (0, commonUtils_1.safeAsync)(res, async () => {
            const { updateMusicLibMeta } = await import('../../utils/db.js');
            const durationSec = Math.round(duration);
            // songId 格式为 "source_songId", 需要拆分
            const songIdStr = String(songId);
            const underscoreIdx = songIdStr.indexOf('_');
            const source = underscoreIdx > 0 ? songIdStr.substring(0, underscoreIdx) : 'unknown';
            const rawSongId = underscoreIdx > 0 ? songIdStr.substring(underscoreIdx + 1) : songIdStr;
            updateMusicLibMeta(source, rawSongId, { duration: durationSec });
            console.log(`[DurationFix] Updated duration for ${songId}: ${durationSec}s`);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, duration: durationSec });
        }, 'DurationFix');
    });
};
exports.handleUpdateDuration = handleUpdateDuration;
/**
 * 同步磁盘文件到数据库
 * POST /api/music/db/sync
 */
const handleDBSync = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const { getAllDownloadRecords, upsertDownloadRecord } = await import('../../utils/db.js');
        // 获取所有现有DB记录
        const allRecords = getAllDownloadRecords();
        const existingPaths = new Set();
        const existingSongIds = new Set();
        allRecords.forEach((r) => {
            if (r.file_path)
                existingPaths.add(r.file_path);
            if (r.song_id)
                existingSongIds.add(r.song_id);
        });
        // 扫描所有音频文件
        const roots = ['cache', 'download'];
        let syncedCount = 0;
        for (const folder of roots) {
            const baseDir = folder === 'download' ? (0, pathUtil_1.getDownloadDir)() : (0, pathUtil_1.getCacheDir)();
            if (!node_fs_1.default.existsSync(baseDir))
                continue;
            const scanDir = (dir) => {
                if (!node_fs_1.default.existsSync(dir))
                    return;
                const items = node_fs_1.default.readdirSync(dir);
                const AUDIO_EXTS = ['.mp3', '.flac', '.m4a', '.ogg', '.wav'];
                for (const item of items) {
                    const itemPath = node_path_1.default.join(dir, item);
                    try {
                        const stats = node_fs_1.default.statSync(itemPath);
                        if (stats.isDirectory()) {
                            scanDir(itemPath);
                        }
                        else if (stats.isFile()) {
                            const ext = node_path_1.default.extname(item).toLowerCase();
                            if (!AUDIO_EXTS.includes(ext))
                                continue;
                            const MIN_AUDIO_FILE_SIZE = 10240;
                            if (stats.size < MIN_AUDIO_FILE_SIZE)
                                continue;
                            if (existingPaths.has(itemPath))
                                continue;
                            const relativePath = node_path_1.default.relative(baseDir, itemPath);
                            const pathParts = relativePath.split(node_path_1.default.sep);
                            const songNameRaw = node_path_1.default.basename(item, ext);
                            let songName = songNameRaw.replace(/^\.+/, '');
                            let album = 'Unknown';
                            let singer = 'Unknown';
                            if (pathParts.length >= 3) {
                                singer = pathParts[pathParts.length - 3];
                                album = pathParts[pathParts.length - 2];
                            }
                            else if (pathParts.length === 2) {
                                album = pathParts[pathParts.length - 2];
                                const parenMatch = songNameRaw.match(/^(.+)\(([^)]+)\)$/);
                                if (parenMatch) {
                                    songName = parenMatch[1];
                                    singer = parenMatch[2];
                                }
                            }
                            else {
                                const parenMatch = songNameRaw.match(/^(.+)\(([^)]+)\)$/);
                                if (parenMatch) {
                                    songName = parenMatch[1];
                                    singer = parenMatch[2];
                                }
                            }
                            const sanitize = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
                            const songId = `file_${sanitize(singer)}_${sanitize(album)}_${sanitize(songName)}`;
                            if (existingSongIds.has(songId))
                                continue;
                            upsertDownloadRecord({
                                song_id: songId,
                                song_name: songName,
                                singer: singer,
                                album: album,
                                source: '',
                                quality: ext.replace('.', ''),
                                file_path: itemPath,
                                file_size: stats.size,
                                status: 'finished',
                                relative_path: relativePath,
                                ext: ext,
                                mtime: stats.mtime.toISOString(),
                            });
                            existingPaths.add(itemPath);
                            existingSongIds.add(songId);
                            syncedCount++;
                        }
                    }
                    catch (e) {
                        // Skip files with errors
                    }
                }
            };
            scanDir(baseDir);
        }
        console.log(`[DBSync] Synced ${syncedCount} file(s) to DB`);
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, synced: syncedCount });
    }, 'DBSync');
};
exports.handleDBSync = handleDBSync;
/**
 * 补充元数据
 * POST /api/music/db/enrich-meta
 * Body: { relativePath }
 */
const handleEnrichMeta = (req, res) => {
    const readBody = global.readBody;
    if (!readBody) {
        res.writeHead(500);
        res.end('Internal error');
        return;
    }
    void readBody(req).then((body) => {
        void (async () => {
            try {
                const { relativePath } = JSON.parse(body);
                if (!relativePath)
                    throw new Error('Missing relativePath');
                const dbMod = await import('../../utils/db.js');
                // 解析文件路径（在下载和缓存目录中查找）
                const filePath = (0, pathUtil_1.resolveAudioFilePath)(relativePath);
                if (!filePath) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, message: 'File not found' }));
                    return;
                }
                // 读取音频标签 (使用 MusicTagUtil 统一封装)
                const tags = MusicTagUtil.readExtendedTags(filePath);
                const meta = { ...MusicTagUtil.tagsToDbRecord(tags) };
                // 更新DB
                const dbRecord = dbMod.getDownloadRecordByPath(filePath);
                if (dbRecord && dbRecord.song_id && Object.keys(meta).length > 0) {
                    const updates = {};
                    if (meta.genre && !dbRecord.genre)
                        updates.genre = meta.genre;
                    if (meta.year && !dbRecord.year)
                        updates.year = meta.year;
                    if (meta.track_number && !dbRecord.track_number)
                        updates.track_number = meta.track_number;
                    if (meta.disc_number && !dbRecord.disc_number)
                        updates.disc_number = meta.disc_number;
                    if (meta.disc_total && !dbRecord.disc_total)
                        updates.disc_total = meta.disc_total;
                    if (meta.audio_quality && !dbRecord.audio_quality)
                        updates.audio_quality = meta.audio_quality;
                    if (meta.album_artist && !dbRecord.album_artist)
                        updates.album_artist = meta.album_artist;
                    if (meta.composer && !dbRecord.composer)
                        updates.composer = meta.composer;
                    if (meta.sample_rate && !dbRecord.sample_rate)
                        updates.sample_rate = meta.sample_rate;
                    if (meta.bit_depth && !dbRecord.bit_depth)
                        updates.bit_depth = meta.bit_depth;
                    if (meta.channels && !dbRecord.channels)
                        updates.channels = meta.channels;
                    if (meta.bit_rate && !dbRecord.bit_rate)
                        updates.bit_rate = meta.bit_rate;
                    if (meta.duration && !dbRecord.duration)
                        updates.duration = meta.duration;
                    if (Object.keys(updates).length > 0) {
                        dbMod.updateMusicLibMeta(dbRecord.source || 'unknown', dbRecord.song_id, updates);
                        console.log(`[EnrichMeta] Updated DB for ${dbRecord.source}_${dbRecord.song_id}:`, Object.keys(updates).join(', '));
                    }
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, meta }));
            }
            catch (err) {
                console.error('[EnrichMeta] Failed:', err.message);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: false, message: err.message }));
            }
        })();
    });
};
exports.handleEnrichMeta = handleEnrichMeta;
/**
 * 检查缓存文件是否存在
 * GET /api/music/file/check — 原有逻辑 (向后兼容)
 * POST /api/music/file/check — 新逻辑，支持 local source
 * Query (GET): name, singer, source, songmid/songId, quality, albumName, exactQuality
 * Body (POST): { source, relativePath, downloadOrPlay } 或同 GET 参数
 */
const handleCheckCache = async (req, res, urlObj) => {
    // 用户认证
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    // POST 模式: 支持 JSON body
    if (req.method === 'POST') {
        try {
            const body = await (0, commonUtils_1.readBodySafe)(req, res);
            if (!body)
                return; // readBodySafe 已自动发送错误响应
            const source = body.source || '';
            const relativePath = body.relativePath || '';
            // local source 走本地库快速查找
            if (source === 'local' && relativePath) {
                const localLib = require('../localLibrary');
                const record = localLib.getLocalFileRecord(source, relativePath);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(record));
                return;
            }
            // 非 local source，降级到原有逻辑 (从 body 提取参数)
            const name = body.name;
            const singer = body.singer;
            const songmid = body.songmid || body.songId;
            const songId = body.songId || body.songmid;
            const quality = body.quality;
            const albumName = body.albumName;
            const exactQuality = body.exactQuality === '1' || body.exactQuality === true;
            if (!name || !singer || !source || (!songmid && !songId)) {
                res.writeHead(400);
                res.end('Missing params');
                return;
            }
            const result = fileCache.checkDownloadAndCache({ name, singer, source, songmid, songId, quality, albumName, exactQuality }, username);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ exists: false, error: err.message }));
        }
        return;
    }
    // GET 模式: 保持原有逻辑
    const name = urlObj.searchParams.get('name');
    const singer = urlObj.searchParams.get('singer');
    const source = urlObj.searchParams.get('source');
    const songmid = urlObj.searchParams.get('songmid');
    const songId = urlObj.searchParams.get('songId');
    const quality = urlObj.searchParams.get('quality');
    const albumName = urlObj.searchParams.get('albumName');
    const exactQuality = urlObj.searchParams.get('exactQuality') === '1' || urlObj.searchParams.get('exactQuality') === 'true';
    if (!name || !singer || !source || (!songmid && !songId)) {
        res.writeHead(400);
        res.end('Missing params');
        return;
    }
    const result = fileCache.checkDownloadAndCache({ name, singer, source, songmid, songId, quality, albumName, exactQuality }, username);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
};
exports.handleCheckCache = handleCheckCache;
