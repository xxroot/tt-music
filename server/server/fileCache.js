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
exports.moveAllCacheToDownload = exports.moveSingleCacheToMusic = exports.clearLyricCache = exports.clearAllCache = exports.removeCacheDirFile = exports.scanCacheDirectory = exports.getCacheStats = exports.resolveCacheFilePath = exports.serveCacheFile = exports.stopUserTasks = exports.downloadAndCache = exports.downloadMusic = exports.saveLyricCache = exports.checkLyricCache = exports.checkDownloadAndCache = exports.checkDownloadDirectory = exports.moveCacheToDownload = exports.removeCacheFile = exports.backfillMissingMetadata = exports.getCacheCover = exports.extractCoverFromFile = exports.clearCoverCache = exports.sanitizePath = exports.getCacheDir = exports.activeTasks = exports.cacheProgress = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const http_1 = __importDefault(require("http"));
const https_1 = __importDefault(require("https"));
const lrcTool_1 = require("../utils/lrcTool");
const db_1 = require("../utils/db");
const MusicTagUtil = __importStar(require("../utils/MusicTagUtil"));
const pathUtil_1 = require("../utils/pathUtil");
// [Unified Enhancement] Cache Progress Tracker
exports.cacheProgress = new Map();
// [New] Active Cache Tasks Tracker: username -> [ { songKey, controller } ]
exports.activeTasks = new Map();
// [New] Global downloading song keys (to prevent duplicate downloads)
const downloadingSongKeys = new Set();
// Supported audio extensions
const AUDIO_EXTENSIONS = ['.flac', '.wav', '.mp3', '.m4a', '.ogg'];
/**
 * Parse MM:SS interval string to seconds
 */
const parseIntervalDuration = (interval) => {
    if (!interval || typeof interval !== 'string' || !interval.includes(':'))
        return undefined;
    const parts = interval.split(':');
    if (parts.length < 2)
        return undefined;
    const mins = parseInt(parts[0], 10);
    const secs = parseInt(parts[1], 10);
    if (isNaN(mins) || isNaN(secs) || (mins === 0 && secs === 0))
        return undefined;
    return mins * 60 + secs;
};
/**
 * Detect actual audio format from file magic numbers (first few bytes)
 * Returns: 'flac', 'mp3', 'wav', 'm4a', 'ogg', or 'unknown'
 */
const detectActualFormat = (filePath) => {
    try {
        const fd = fs_1.default.openSync(filePath, 'r');
        const buffer = Buffer.alloc(12); // Read first 12 bytes (enough for all formats)
        fs_1.default.readSync(fd, buffer, 0, 12, 0);
        fs_1.default.closeSync(fd);
        // FLAC: starts with "fLaC" (66 4C 61 43)
        if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
            return 'flac';
        }
        // MP3: starts with ID3 (49 44 33) or sync word FF FB / FF FA / FF F3 / FF F2
        if ((buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // ID3
            (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0)) { // Sync word
            return 'mp3';
        }
        // WAV: RIFF....WAVE
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
            return 'wav';
        }
        // M4A/MP4: ftyp at offset 4 (....ftyp)
        if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) {
            return 'm4a';
        }
        // OGG: starts with "OggS" (4F 67 67 53)
        if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
            return 'ogg';
        }
        return 'unknown';
    }
    catch (e) {
        return 'unknown';
    }
};
/**
 * Detect file extension from Content-Type, URL, and quality parameter
 * Priority: Content-Type > URL extension > Quality inference > default .flac
 */
const detectFileExtension = (url, quality, contentType) => {
    // Source 1: Content-Type header
    let headerExt = '';
    if (contentType.includes('audio/mpeg'))
        headerExt = '.mp3';
    else if (contentType.includes('audio/flac'))
        headerExt = '.flac';
    else if (contentType.includes('audio/ogg'))
        headerExt = '.ogg';
    else if (contentType.includes('audio/x-m4a') || contentType.includes('video/mp4'))
        headerExt = '.m4a';
    else if (contentType.includes('audio/wav'))
        headerExt = '.wav';
    // Source 2: URL path extension
    let urlExt = '';
    try {
        const urlPath = new URL(url).pathname;
        const urlExtMatch = urlPath.match(/\.(flac|mp3|m4a|ogg|wav)$/i);
        if (urlExtMatch)
            urlExt = '.' + urlExtMatch[1].toLowerCase();
    }
    catch (e) {
    }
    // Source 3: Quality parameter inference (lossless formats)
    let qualityExt = '';
    if (quality) {
        const q = quality.toLowerCase();
        if (q.includes('flac') || q.includes('hires') || q.includes('24bit') || q === '2000' || q === '3000') {
            qualityExt = '.flac';
        }
        else if (q.includes('wav')) {
            qualityExt = '.wav';
        }
    }
    return headerExt || urlExt || qualityExt || '.flac';
};
// Helper to get actual directory path based on folder type and environment variables
const getFolderDir = (folder) => {
    return folder === 'download' ? (0, pathUtil_1.getDownloadDir)() : (0, pathUtil_1.getCacheDir)();
};
// Get base directory (cache or download) - no user subdirectory
const getCacheDir = (isOnlyDownload) => {
    return isOnlyDownload ? (0, pathUtil_1.getDownloadDir)() : (0, pathUtil_1.getCacheDir)();
};
exports.getCacheDir = getCacheDir;
// Sanitize path segment (remove invalid characters, strip leading dots to avoid hidden files)
const sanitizePath = (str) => String(str || '').replace(/[\\/:*?"<>|]/g, '_').trim().replace(/^\.+/, '');
exports.sanitizePath = sanitizePath;
// Get song directory: baseDir/album/
const getSongDir = (songInfo, isOnlyDownload) => {
    const baseDir = (0, exports.getCacheDir)(isOnlyDownload);
    const album = sanitizePath(songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)) || 'Unknown');
    return path_1.default.join(baseDir, album);
};
// Ensure song directory exists (album)
const ensureSongDir = (songInfo, isOnlyDownload) => {
    const dir = getSongDir(songInfo, isOnlyDownload);
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return dir;
};
// Generate filename: {Name}(Singer) or {Name} if singer is 群星
const getFileName = (songInfo, quality) => {
    let name = sanitizePath(songInfo.name || 'Unknown');
    if (name.length > 200)
        name = name.substring(0, 200);
    const singer = sanitizePath(songInfo.singer || 'Unknown');
    if (singer && singer !== '群星' && singer !== 'Unknown') {
        name = `${name}(${singer})`;
    }
    return name;
};
// ======================== DB 记录构建 (DB Record Building) ========================
/**
 * Build download record object for DB upsert
 */
const buildDownloadRecord = (source, rawSongKey, songInfo, songName, savedFilePath, actualExt, quality, tagDuration, intervalDuration, tagMetadata) => {
    const downloadBaseDir = (0, exports.getCacheDir)(true);
    const relPath = savedFilePath.startsWith(downloadBaseDir)
        ? path_1.default.relative(downloadBaseDir, savedFilePath)
        : path_1.default.relative((0, exports.getCacheDir)(false), savedFilePath);
    return {
        song_id: rawSongKey,
        song_name: songName,
        singer: songInfo.singer,
        album: songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)),
        source: source,
        quality: quality || actualExt.replace('.', ''),
        file_path: savedFilePath,
        file_size: fs_1.default.existsSync(savedFilePath) ? fs_1.default.statSync(savedFilePath).size : 0,
        duration: tagDuration ?? intervalDuration,
        status: 'finished',
        relative_path: relPath,
        ext: actualExt,
        genre: tagMetadata.genre,
        year: tagMetadata.year,
        track_number: tagMetadata.trackNumber,
        disc_number: tagMetadata.discNumber,
        disc_total: tagMetadata.discTotal,
        audio_quality: tagMetadata.audioQuality,
        album_artist: tagMetadata.albumArtist,
        composer: tagMetadata.composer,
        sample_rate: tagMetadata.sampleRate,
        bit_depth: tagMetadata.bitDepth,
        channels: tagMetadata.channels,
        bit_rate: tagMetadata.bitRate,
        singer_ids: songInfo.singerMids || songInfo.singerIds || '',
        singer_id: Array.isArray(songInfo.singers)
            ? songInfo.singers.map((s) => s.id).filter((id) => id).join(',')
            : '',
        img: songInfo.img || null,
        album_id: songInfo.albumId || null,
    };
};
/**
 * 保存下载记录到 DB (替换 file_ 前缀记录 + 构建并写入新记录)
 * 封装 replaceFileRecordWithSongId + buildDownloadRecord + upsertDownloadRecord，消除重复代码
 */
const saveDownloadRecord = (source, rawSongKey, songInfo, songName, savedFilePath, actualExt, quality, tagDuration, intervalDuration, tagMetadata) => {
    try {
        const { replaceFileRecordWithSongId } = require('../utils/db');
        replaceFileRecordWithSongId(source, rawSongKey, songInfo.singer || 'Unknown', songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)) || 'Unknown', songName);
    }
    catch (replaceErr) {
        // Ignore replace errors
    }
    const record = buildDownloadRecord(source, rawSongKey, songInfo, songName, savedFilePath, actualExt, quality, tagDuration, intervalDuration, tagMetadata);
    (0, db_1.upsertDownloadRecord)(record);
    // 保存歌手信息到 singer_info 表
    saveSingerInfoFromSong(songInfo);
};
/**
 * 从歌曲对象提取歌手信息并保存到 singer_info 表
 * - 优先使用 songInfo.singers 数组 [{id, name, img}]
 * - 无 singers 时用 songInfo.singer 字符串按分隔符拆分
 */
const saveSingerInfoFromSong = (songInfo) => {
    try {
        const { upsertSingerInfo } = require('../utils/db');
        const source = String(songInfo.source || 'unknown');
        if (Array.isArray(songInfo.singers) && songInfo.singers.length > 0) {
            // 有 singers 数组：逐个保存
            for (const singer of songInfo.singers) {
                if (!singer || !singer.name)
                    continue;
                upsertSingerInfo({
                    singer_id: String(singer.id || ''),
                    source: source,
                    name: singer.name,
                    avatar: singer.img || null,
                });
            }
        }
        else if (songInfo.singer) {
            // 无 singers 数组：用 singer 字符串按分隔符拆分
            const singerNames = String(songInfo.singer)
                .split(/[；;,、\/＆&]/)
                .map((s) => s.trim())
                .filter((s) => s);
            for (const name of singerNames) {
                upsertSingerInfo({
                    singer_id: '',
                    source: source,
                    name: name,
                    avatar: '',
                });
            }
        }
    }
    catch (err) {
        console.error('[FileCache] Failed to save singer info from song:', err);
    }
};
/**
 * 从音频文件提取标签并构建完整的 DB 下载记录
 * 封装 MusicTagger 提取 + buildDownloadRecord 构建，消除多处重复代码
 */
const extractTagsAndBuildRecord = (filePath, songName, source, rawSongKey, songInfo, quality) => {
    const ext = path_1.default.extname(filePath);
    // 使用 MusicTagUtil 统一读取扩展标签
    const tags = MusicTagUtil.readExtendedTags(filePath);
    const tagDuration = tags.duration;
    const tagMetadata = {
        genre: tags.genre,
        year: tags.year,
        trackNumber: tags.trackNumber,
        discNumber: tags.discNumber,
        discTotal: tags.discTotal,
        audioQuality: tags.audioQuality,
        albumArtist: tags.albumArtist,
        composer: tags.composer,
        sampleRate: tags.sampleRate,
        bitDepth: tags.bitDepth,
        channels: tags.channels,
        bitRate: tags.bitRate,
    };
    return buildDownloadRecord(source, rawSongKey, songInfo, songName, filePath, ext, quality, tagDuration, undefined, tagMetadata);
};
// ======================== 封面缓存 (Cover Image Cache) ========================
// Cover image cache: keyed by album directory path, avoids re-reading the same file for songs in the same album
// null value means "no cover found in this album" (negative cache)
const coverCache = new Map();
const COVER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const COVER_CACHE_MAX = 200; // max cached entries
/** 清空封面缓存 (图片变更后调用) */
const clearCoverCache = () => { coverCache.clear(); };
exports.clearCoverCache = clearCoverCache;
/**
 * Try to extract cover image from a single audio file
 */
const extractCoverFromFile = (filePath) => {
    return MusicTagUtil.extractCover(filePath);
};
exports.extractCoverFromFile = extractCoverFromFile;
/**
 * Get cover image for a cached file
 * @param filename - Relative path (album/file.ext)
 */
const getCacheCover = (filename) => {
    // 按 filename 维度缓存封面（同一文件共享缓存，不同文件独立缓存）
    const cached = coverCache.get(filename);
    if (cached !== undefined && (Date.now() - cached.ts) < COVER_CACHE_TTL) {
        return 'data' in cached ? { data: cached.data, mime: cached.mime } : null;
    }
    // Helper: cache result (cover found or not found) and return
    const cacheAndReturn = (cover) => {
        if (coverCache.size >= COVER_CACHE_MAX) {
            let oldestKey = '';
            let oldestTs = Infinity;
            for (const [k, v] of coverCache) {
                if (v.ts < oldestTs) {
                    oldestTs = v.ts;
                    oldestKey = k;
                }
            }
            if (oldestKey)
                coverCache.delete(oldestKey);
        }
        if (cover) {
            coverCache.set(filename, { data: cover.data, mime: cover.mime, ts: Date.now() });
        }
        else {
            // Cache negative result too to avoid repeated scans
            coverCache.set(filename, { ts: Date.now() });
        }
        return cover;
    };
    // Check both cache and download directories
    const roots = ['download', 'cache'];
    for (const folder of roots) {
        const dir = getFolderDir(folder);
        const filePath = path_1.default.join(dir, filename);
        if (fs_1.default.existsSync(filePath)) {
            const cover = (0, exports.extractCoverFromFile)(filePath);
            if (cover)
                return cacheAndReturn(cover);
        }
    }
    return cacheAndReturn(null);
};
exports.getCacheCover = getCacheCover;
// ======================== 元数据补充 (Metadata Backfill) ========================
/**
 * 补充歌曲缺失的音频元数据 (Backfill missing audio metadata)
 * 遍历歌曲列表，对缺少 duration/channels/bitDepth/bitRate/sampleRate 的歌曲，
 * 加载文件 MusicTag 提取标签并更新到 DB，同时更新内存中的歌曲对象
 * @param songs 歌曲列表（需含 relativePath, source, songId, duration, channels, bitDepth, bitRate, sampleRate）
 * @param options.logLabel 日志标签，默认 '[MetaBackfill]'
 * @returns 更新的歌曲数量
 */
const backfillMissingMetadata = (songs, options) => {
    const label = options?.logLabel || '[MetaBackfill]';
    const songsNeedingUpdate = songs.filter((song) => !song.duration || !song.channels || !song.bitDepth || !song.bitRate || !song.sampleRate);
    if (songsNeedingUpdate.length === 0)
        return 0;
    const { updateMusicLibMeta } = require('../utils/db');
    const downloadDir = (0, exports.getCacheDir)(true);
    let updatedCount = 0;
    for (const song of songsNeedingUpdate) {
        try {
            if (!song.relativePath)
                continue;
            const filePath = path_1.default.join(downloadDir, song.relativePath);
            if (!fs_1.default.existsSync(filePath))
                continue;
            const tags = MusicTagUtil.readBasicTags(filePath);
            const meta = {};
            if (!song.duration && tags.duration)
                meta.duration = tags.duration;
            if (!song.sampleRate && tags.sampleRate)
                meta.sample_rate = tags.sampleRate;
            if (!song.bitDepth && tags.bitDepth)
                meta.bit_depth = tags.bitDepth;
            if (!song.channels && tags.channels)
                meta.channels = tags.channels;
            if (!song.bitRate && tags.bitRate)
                meta.bit_rate = tags.bitRate;
            if (Object.keys(meta).length > 0) {
                updateMusicLibMeta(song.source, song.songId, meta);
                // 同步更新内存中的歌曲数据 (Update in-memory song data)
                if (meta.duration !== undefined)
                    song.duration = meta.duration;
                if (meta.sample_rate !== undefined)
                    song.sampleRate = meta.sample_rate;
                if (meta.bit_depth !== undefined)
                    song.bitDepth = meta.bit_depth;
                if (meta.channels !== undefined)
                    song.channels = meta.channels;
                if (meta.bit_rate !== undefined)
                    song.bitRate = meta.bit_rate;
                updatedCount++;
            }
        }
        catch (err) {
            // 标签读取失败，跳过
        }
    }
    if (updatedCount > 0) {
        console.log(`${label} Metadata backfill: ${updatedCount}/${songsNeedingUpdate.length} songs updated`);
    }
    return updatedCount;
};
exports.backfillMissingMetadata = backfillMissingMetadata;
// ======================== 缓存管理 (Cache Management) ========================
/**
 * Remove a specific cache file
 * @param filename - Relative path (album/file.ext)
 */
const removeCacheFile = (filename) => {
    // Check both cache and download directories
    const roots = ['cache', 'download'];
    for (const folder of roots) {
        const dir = getFolderDir(folder);
        const filePath = path_1.default.join(dir, filename);
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            console.log(`[FileCache] Manually deleted: ${filename}`);
            // Delete associated lyric file
            const ext = path_1.default.extname(filename);
            if (ext !== '.lrc') {
                const lrcPath = filePath.substring(0, filePath.lastIndexOf('.')) + '.lrc';
                if (fs_1.default.existsSync(lrcPath)) {
                    fs_1.default.unlinkSync(lrcPath);
                    console.log(`[FileCache] Manually deleted associated lyric`);
                }
            }
            return true;
        }
    }
    return false;
};
exports.removeCacheFile = removeCacheFile;
/**
 * Move file from cache to download directory
 * Supports all audio formats (FLAC, WAV, MP3, M4A, OGG)
 * Uses copy+delete to support cross-device moves (e.g. Docker volumes)
 * Returns the new path or null if failed
 */
const moveCacheToDownload = (filePath) => {
    try {
        // Check if file exists
        if (!fs_1.default.existsSync(filePath)) {
            return { success: false, error: 'File not found' };
        }
        // Check if it's an audio file
        const ext = path_1.default.extname(filePath).toLowerCase();
        if (!AUDIO_EXTENSIONS.includes(ext)) {
            return { success: false, error: 'Not an audio file' };
        }
        // Check if already in download directory
        if (filePath.includes(`${path_1.default.sep}download${path_1.default.sep}`)) {
            return { success: true, newPath: filePath }; // Already in download
        }
        // Check if in cache directory
        if (!filePath.includes(`${path_1.default.sep}cache${path_1.default.sep}`)) {
            return { success: false, error: 'File not in cache directory' };
        }
        // Build destination path: replace 'cache' with 'download'
        const downloadPath = filePath.replace(`${path_1.default.sep}cache${path_1.default.sep}`, `${path_1.default.sep}download${path_1.default.sep}`);
        // Ensure destination directory exists
        const downloadDir = path_1.default.dirname(downloadPath);
        if (!fs_1.default.existsSync(downloadDir)) {
            fs_1.default.mkdirSync(downloadDir, { recursive: true });
        }
        // Check if destination already exists
        if (fs_1.default.existsSync(downloadPath)) {
            // Delete source file since destination already exists
            fs_1.default.unlinkSync(filePath);
            console.log(`[FileCache] Destination exists, deleted source: ${filePath}`);
            return { success: true, newPath: downloadPath };
        }
        // Move the audio file (use copy+delete to support cross-device moves)
        try {
            fs_1.default.renameSync(filePath, downloadPath);
        }
        catch (renameErr) {
            // If rename fails (e.g. EXDEV cross-device link), fallback to copy+delete
            if (renameErr.code === 'EXDEV') {
                console.log(`[FileCache] Cross-device move detected, using copy+delete: ${filePath}`);
                fs_1.default.copyFileSync(filePath, downloadPath);
                fs_1.default.unlinkSync(filePath);
            }
            else {
                throw renameErr;
            }
        }
        console.log(`[FileCache] Moved to download: ${downloadPath}`);
        return { success: true, newPath: downloadPath };
    }
    catch (err) {
        console.error(`[FileCache] Move to download failed: ${err.message}`);
        return { success: false, error: err.message };
    }
};
exports.moveCacheToDownload = moveCacheToDownload;
// ======================== 文件查找 (File Lookup) ========================
/**
 * 按专辑名/歌名规则查找音频文件（优化版：直接定位，不遍历目录）
 * 存储规则: album/name(singer).ext 或 album/name.ext (歌手为群星时)
 * 兼容旧格式: singer/album/name.ext
 *
 * @param dir 根目录 (cache/ 或 download/)
 * @param targetName 歌曲名
 * @param targetSinger 歌手名
 * @param targetAlbum 专辑名
 * @param baseDir 用于计算相对路径的基准目录
 * @returns 匹配的音频文件列表
 */
const findAudioFilesByPath = (dir, targetName, targetSinger, targetAlbum, baseDir) => {
    const matchedFiles = [];
    if (!fs_1.default.existsSync(dir))
        return matchedFiles;
    // 构建预期的文件名（新格式）
    const sanitizedName = sanitizePath(targetName);
    const sanitizedSinger = sanitizePath(targetSinger);
    const sanitizedAlbum = sanitizePath(targetAlbum);
    const newFormatName = (sanitizedSinger && sanitizedSinger !== '群星' && sanitizedSinger !== 'Unknown')
        ? `${sanitizedName}(${sanitizedSinger})`
        : sanitizedName;
    // === 新格式：直接定位到 album/ 目录 ===
    const albumDir = path_1.default.join(dir, sanitizedAlbum);
    if (fs_1.default.existsSync(albumDir)) {
        // 遍历所有支持的音频扩展名，直接检查文件是否存在
        for (const ext of AUDIO_EXTENSIONS) {
            const candidateFile = path_1.default.join(albumDir, newFormatName + ext);
            if (fs_1.default.existsSync(candidateFile)) {
                try {
                    const stats = fs_1.default.statSync(candidateFile);
                    if (stats.isFile() && stats.size >= 10240) {
                        const relativePath = path_1.default.relative(baseDir, candidateFile);
                        matchedFiles.push({
                            exists: true,
                            path: candidateFile,
                            filename: path_1.default.basename(candidateFile),
                            relativePath: relativePath,
                            ext: ext,
                            quality: '',
                            url: `/api/music/cache/file/${encodeURIComponent(relativePath)}`
                        });
                    }
                }
                catch (e) {
                }
            }
        }
    }
    // === 旧格式兼容：singer/album/name.ext ===
    // 仅在歌手不是"群星"或"Unknown"时尝试旧格式
    if (sanitizedSinger && sanitizedSinger !== '群星' && sanitizedSinger !== 'Unknown') {
        const singerDir = path_1.default.join(dir, sanitizedSinger);
        if (fs_1.default.existsSync(singerDir)) {
            const oldAlbumDir = path_1.default.join(singerDir, sanitizedAlbum);
            if (fs_1.default.existsSync(oldAlbumDir)) {
                // 遍历所有支持的音频扩展名
                for (const ext of AUDIO_EXTENSIONS) {
                    const candidateFile = path_1.default.join(oldAlbumDir, sanitizedName + ext);
                    if (fs_1.default.existsSync(candidateFile)) {
                        try {
                            const stats = fs_1.default.statSync(candidateFile);
                            if (stats.isFile() && stats.size >= 10240) {
                                const relativePath = path_1.default.relative(baseDir, candidateFile);
                                // 避免与新格式重复
                                if (!matchedFiles.some(f => f.path === candidateFile)) {
                                    matchedFiles.push({
                                        exists: true,
                                        path: candidateFile,
                                        filename: path_1.default.basename(candidateFile),
                                        relativePath: relativePath,
                                        ext: ext,
                                        quality: '',
                                        url: `/api/music/cache/file/${encodeURIComponent(relativePath)}`
                                    });
                                }
                            }
                        }
                        catch (e) {
                        }
                    }
                }
            }
        }
    }
    return matchedFiles;
};
/**
 * 通过 song_name + singer + album 查询 DB 下载记录
 * song_name 就是原始的 songInfo.name，直接用原始值查询，不存在新/旧格式双查
 * @param songInfo 歌曲信息
 * @returns DB 记录信息或 null
 */
const checkDownloadRecordInDB = (songInfo) => {
    try {
        const { getDownloadRecordByName } = require('../utils/db');
        // DB 存储原始值，不做 sanitizePath 处理
        const name = String(songInfo.name || '');
        const singer = String(songInfo.singer || 'Unknown');
        const album = String(songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)) || 'Unknown');
        if (!name)
            return null;
        // 辅助函数：校验 DB 记录并返回结果
        const validateRecord = (dbRecord) => {
            if (dbRecord && dbRecord.relative_path) {
                const ext = path_1.default.extname(dbRecord.relative_path).toLowerCase();
                if (AUDIO_EXTENSIONS.includes(ext) && dbRecord.file_path) {
                    const stats = fs_1.default.existsSync(dbRecord.file_path) ? fs_1.default.statSync(dbRecord.file_path) : null;
                    if (stats && stats.isFile()) {
                        return {
                            exists: true,
                            path: dbRecord.file_path,
                            filename: path_1.default.basename(dbRecord.file_path),
                            ext: dbRecord.ext || path_1.default.extname(dbRecord.file_path),
                            size: stats.size,
                            duration: dbRecord.duration || 0,
                            sampleRate: dbRecord.sample_rate || null,
                            bitDepth: dbRecord.bit_depth || null,
                            channels: dbRecord.channels || null,
                            bitRate: dbRecord.bit_rate || null,
                            source: dbRecord.source,
                            song_id: dbRecord.song_id
                        };
                    }
                }
            }
            return null;
        };
        // === DB song_name 就是原始 name，直接用原始值查询 ===
        const record = getDownloadRecordByName(name, singer, album);
        const result = validateRecord(record);
        if (result)
            return result;
    }
    catch (e) {
        // DB query failed, return null to continue with file system check
    }
    return null;
};
/**
 * 检查指定目录中的音频文件（cache/ 或 download/）
 * @param folder 目录名称 ('cache' 或 'download')
 * @param targetName 歌曲名
 * @param targetSinger 歌手名
 * @param targetAlbum 专辑名
 * @returns 文件信息或 { exists: false }
 */
const checkDirectory = (folder, targetName, targetSinger, targetAlbum) => {
    const baseDir = (0, exports.getCacheDir)(folder === 'download');
    if (fs_1.default.existsSync(baseDir)) {
        const matchedFiles = findAudioFilesByPath(baseDir, targetName, targetSinger, targetAlbum, baseDir);
        if (matchedFiles.length > 0) {
            // Priority: FLAC > M4A > MP3 > OGG > WAV
            const FORMAT_PRIORITY = {
                '.flac': 1,
                '.wav': 2,
                '.mp3': 3,
                '.m4a': 4,
                '.ogg': 5
            };
            matchedFiles.sort((a, b) => {
                const getRank = (ext) => FORMAT_PRIORITY[ext] || 99;
                return getRank(a.ext || path_1.default.extname(a.filename)) - getRank(b.ext || path_1.default.extname(b.filename));
            });
            // 添加 folder 字段标记文件来源 ('download' 或 'cache')
            return { ...matchedFiles[0], folder };
        }
    }
    return { exists: false };
};
/**
 * 检查 download/ 目录中的文件（用户下载的音乐）
 * @param targetName 歌曲名
 * @param targetSinger 歌手名
 * @param targetAlbum 专辑名
 * @returns 文件信息或 { exists: false }
 */
const checkDownloadDirectory = (targetName, targetSinger, targetAlbum) => {
    return checkDirectory('download', targetName, targetSinger, targetAlbum);
};
exports.checkDownloadDirectory = checkDownloadDirectory;
/**
 * 检查 download/ 和 cache/ 目录中的文件（不再查 DB）
 * @param songInfo 歌曲信息
 * @param username 用户名（保留参数以兼容）
 * @param includeTmp 是否包含临时文件（保留参数以兼容）
 * @returns 文件信息或 { exists: false }
 */
const checkDownloadAndCache = (songInfo, username, includeTmp = false) => {
    // 本地库快速路径: local source 直接从库目录解析
    if (songInfo.source && String(songInfo.source) === 'local') {
        try {
            const localLib = require('./localLibrary');
            const relativePath = songInfo.relativePath || '';
            if (relativePath) {
                return localLib.getLocalFileRecord(songInfo.source, relativePath);
            }
        }
        catch {
            // 延迟 require 失败时降级到原有逻辑
        }
    }
    const targetName = String(songInfo.name || '');
    const targetSinger = String(songInfo.singer || 'Unknown');
    const targetAlbum = String(songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)) || 'Unknown');
    if (!targetName) {
        return { exists: false };
    }
    // Step 1: Check download/ directory directly (用户下载的音乐)
    const downloadResult = (0, exports.checkDownloadDirectory)(targetName, targetSinger, targetAlbum);
    if (downloadResult.exists)
        return downloadResult;
    // Step 2: Check cache/ directory (online playback cache)
    return checkDirectory('cache', targetName, targetSinger, targetAlbum);
};
exports.checkDownloadAndCache = checkDownloadAndCache;
// ======================== 歌词缓存 (Lyric Cache) ========================
/**
 * 在 download/ 和 cache/ 目录中查找歌曲对应的音频文件
 * 用于歌词 TAG 读写操作
 * @param songInfo 歌曲信息 (name/singer/albumName)
 * @returns 音频文件绝对路径，未找到返回 null
 */
const findAudioFileForLyric = (songInfo) => {
    const targetName = String(songInfo.name || '');
    const targetSinger = String(songInfo.singer || 'Unknown');
    const targetAlbum = String(songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)) || 'Unknown');
    if (!targetName)
        return null;
    // 优先 download/（用户下载的高质量文件），其次 cache/
    const roots = ['download', 'cache'];
    for (const folder of roots) {
        const baseDir = getFolderDir(folder);
        if (!fs_1.default.existsSync(baseDir))
            continue;
        const matchedFiles = findAudioFilesByPath(baseDir, targetName, targetSinger, targetAlbum, baseDir);
        if (matchedFiles.length > 0) {
            return matchedFiles[0].path;
        }
    }
    return null;
};
// Helper: find lyric file by path
// New format: album/name(singer).lrc or album/name.lrc (singer is 群星)
// Also supports old format: singer/album/name.lrc for backward compatibility
const findLyricFileByPath = (dir, targetName, targetSinger, targetAlbum) => {
    const sanitizedName = sanitizePath(targetName);
    const sanitizedSinger = sanitizePath(targetSinger);
    const newFormatName = (sanitizedSinger && sanitizedSinger !== '群星' && sanitizedSinger !== 'Unknown')
        ? `${sanitizedName}(${sanitizedSinger})`
        : sanitizedName;
    // Try new format first: dir/album/name(singer).lrc
    const albumDir = path_1.default.join(dir, sanitizePath(targetAlbum));
    if (fs_1.default.existsSync(albumDir)) {
        const lrcFile = path_1.default.join(albumDir, `${newFormatName}.lrc`);
        if (fs_1.default.existsSync(lrcFile)) {
            const content = fs_1.default.readFileSync(lrcFile, 'utf-8');
            return {
                exists: true,
                path: lrcFile,
                content: (0, lrcTool_1.parseLyrics)(content),
                filename: path_1.default.basename(lrcFile)
            };
        }
        // Try case-insensitive match in album directory
        const items = fs_1.default.readdirSync(albumDir);
        for (const item of items) {
            if (item.toLowerCase() === `${newFormatName.toLowerCase()}.lrc`) {
                const itemPath = path_1.default.join(albumDir, item);
                const content = fs_1.default.readFileSync(itemPath, 'utf-8');
                return {
                    exists: true,
                    path: itemPath,
                    content: (0, lrcTool_1.parseLyrics)(content),
                    filename: item
                };
            }
        }
    }
    // Try old format for backward compatibility: dir/singer/album/name.lrc
    const singerDir = path_1.default.join(dir, sanitizedSinger);
    if (fs_1.default.existsSync(singerDir)) {
        const oldAlbumDir = path_1.default.join(singerDir, sanitizePath(targetAlbum));
        if (fs_1.default.existsSync(oldAlbumDir)) {
            const lrcFile = path_1.default.join(oldAlbumDir, `${sanitizedName}.lrc`);
            if (fs_1.default.existsSync(lrcFile)) {
                const content = fs_1.default.readFileSync(lrcFile, 'utf-8');
                return {
                    exists: true,
                    path: lrcFile,
                    content: (0, lrcTool_1.parseLyrics)(content),
                    filename: path_1.default.basename(lrcFile)
                };
            }
            // Try case-insensitive match
            const items = fs_1.default.readdirSync(oldAlbumDir);
            for (const item of items) {
                if (item.toLowerCase() === `${sanitizedName.toLowerCase()}.lrc`) {
                    const itemPath = path_1.default.join(oldAlbumDir, item);
                    const content = fs_1.default.readFileSync(itemPath, 'utf-8');
                    return {
                        exists: true,
                        path: itemPath,
                        content: (0, lrcTool_1.parseLyrics)(content),
                        filename: item
                    };
                }
            }
        }
    }
    return null;
};
const checkLyricCache = (songInfo) => {
    const roots = ['cache', 'download'];
    const targetName = String(songInfo.name || '');
    const targetSinger = String(songInfo.singer || 'Unknown');
    const targetAlbum = String(songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)) || 'Unknown');
    if (!targetName)
        return { exists: false };
    // Step 1: 优先从音频文件 TAG 中读取内嵌歌词
    const audioFilePath = findAudioFileForLyric(songInfo);
    if (audioFilePath) {
        const tagLyrics = MusicTagUtil.readLyrics(audioFilePath);
        if (tagLyrics) {
            console.log(`[FileCache] Lyric read from audio TAG: ${audioFilePath}`);
            return {
                exists: true,
                path: audioFilePath,
                content: (0, lrcTool_1.parseLyrics)(tagLyrics),
                filename: path_1.default.basename(audioFilePath),
                source: 'tag'
            };
        }
    }
    // Step 2: 回退到 .lrc 文件查找
    for (const folder of roots) {
        const baseDir = getFolderDir(folder);
        if (!fs_1.default.existsSync(baseDir))
            continue;
        const result = findLyricFileByPath(baseDir, targetName, targetSinger, targetAlbum);
        if (result)
            return result;
    }
    return { exists: false };
};
exports.checkLyricCache = checkLyricCache;
const saveLyricCache = (songInfo, lyricsObj, isOnlyDownload) => {
    try {
        const formattedLrc = (0, lrcTool_1.buildLyrics)(lyricsObj);
        if (!formattedLrc) {
            const baseName = getFileName(songInfo);
            console.log(`[FileCache] Empty lyrics for ${baseName}, skip saving.`);
            return false;
        }
        // Step 1: 优先写入音频文件 TAG（若存在音频文件）
        const audioFilePath = findAudioFileForLyric(songInfo);
        if (audioFilePath) {
            // 若 TAG 中已有相同歌词则跳过，避免重复写入
            const existingLyrics = MusicTagUtil.readLyrics(audioFilePath);
            if (existingLyrics && existingLyrics.trim() === formattedLrc.trim()) {
                console.log(`[FileCache] Lyric already embedded in TAG, skip: ${audioFilePath}`);
                return true;
            }
            const writeOk = MusicTagUtil.writeLyrics(audioFilePath, formattedLrc);
            if (writeOk) {
                console.log(`[FileCache] Lyric embedded into audio TAG: ${audioFilePath}`);
                return true;
            }
            // TAG 写入失败时降级到 .lrc 文件
            console.warn(`[FileCache] Failed to embed lyric into TAG, fallback to .lrc file: ${audioFilePath}`);
        }
        // Step 2: 无音频文件或 TAG 写入失败时，保存为独立 .lrc 文件
        const dir = ensureSongDir(songInfo, isOnlyDownload);
        const baseName = getFileName(songInfo);
        const finalPath = path_1.default.join(dir, baseName + '.lrc');
        // 本地已有 .lrc 文件则跳过，避免每次播放都覆写
        if (fs_1.default.existsSync(finalPath)) {
            console.log(`[FileCache] Lyric already exists, skip saving: ${finalPath}`);
            return true;
        }
        fs_1.default.writeFileSync(finalPath, formattedLrc, { encoding: 'utf-8' });
        console.log(`[FileCache] Lyric cached saved to: ${finalPath}`);
        return true;
    }
    catch (err) {
        console.error(`[FileCache] Lyric cache save failed: ${err.message}`);
        return false;
    }
};
exports.saveLyricCache = saveLyricCache;
// ======================== 下载操作 (Download Operations) ========================
/**
 * 下载音乐到 download/ 目录并写入 DB (用户主动下载)
 * 优先利用 cache/ 缓存,避免重复下载
 * @param songInfo 歌曲信息
 * @param url 下载 URL
 * @param quality 音质
 * @param signal 取消信号
 * @param isOnlyDownload true:下载到download中 false 下载到cache中
 */
const downloadMusic = async (songInfo, url, isOnlyDownload = false, quality, signal) => {
    // [Fix] songKey 加 source 前缀避免不同平台 song_id 冲突
    const rawSongKey = String(songInfo.id || songInfo.songmid);
    const source = String(songInfo.source || 'unknown');
    const songKey = `${source}_${rawSongKey}`;
    // Step 1: Check DB download records by relative_path
    const dbResult = checkDownloadRecordInDB(songInfo);
    if (dbResult) {
        console.log(`[FileCache] Already downloaded in DB, skipping: ${dbResult.filename}`);
        exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
        setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
        return Promise.resolve();
    }
    // Step 2: 检查 cache/ 是否有缓存,有且isOnlyDownload=true时则移动到 download/ + 写 DB
    const targetName = String(songInfo.name || '');
    const targetSinger = String(songInfo.singer || 'Unknown');
    const targetAlbum = String(songInfo.albumName || (songInfo.album && (songInfo.album.name || songInfo.album)) || 'Unknown');
    const cacheResult = checkDirectory('cache', targetName, targetSinger, targetAlbum);
    if (cacheResult.exists && cacheResult.path) {
        if (isOnlyDownload) {
            console.log(`[FileCache] Found in cache, moving to download/: ${cacheResult.path}`);
            const moveResult = (0, exports.moveCacheToDownload)(cacheResult.path);
            if (moveResult.success && moveResult.newPath) {
                // 写入 DB 下载记录 (提取音频标签 + 构建完整记录)
                try {
                    const record = extractTagsAndBuildRecord(moveResult.newPath, songInfo.name, source, rawSongKey, songInfo, quality);
                    (0, db_1.upsertDownloadRecord)(record);
                    saveSingerInfoFromSong(songInfo);
                    console.log(`[FileCache] Cache moved to download and saved to DB: ${moveResult.newPath}`);
                    exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
                    setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
                    return Promise.resolve();
                }
                catch (e) {
                    console.error(`[FileCache] Failed to save DB record: ${e.message}`);
                    // DB 写入失败,继续下载流程
                }
            }
            else {
                console.warn(`[FileCache] Failed to move cache to download: ${moveResult.error}`);
            }
        }
        else {
            exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
            setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
            return Promise.resolve();
        }
    }
    // Step 3: [过渡方法] 如果 cache 没有则扫描 download/ 目录查找文件并同步到 DB
    // TODO: 此步骤为历史数据迁移兼容,后续可删除
    const downloadResult = (0, exports.checkDownloadDirectory)(targetName, targetSinger, targetAlbum);
    if (downloadResult.exists && downloadResult.path) {
        const downloadFile = downloadResult;
        console.log(`[FileCache] Found in download directory: ${downloadFile.path}`);
        try {
            const { getDownloadRecordByName, upsertDownloadRecord } = require('../utils/db');
            // 按专辑名+歌名查找 DB 记录
            const dbRecord = getDownloadRecordByName(targetName, targetSinger, targetAlbum);
            if (dbRecord) {
                // 如果 DB 中存在且 song_id 以 file_ 开头,则更新 source 和 song_id
                if (!dbRecord.song_id || dbRecord.song_id.startsWith('file_')) {
                    console.log(`[FileCache] Updating file_ record to standard format: ${dbRecord.song_id} -> ${source}_${rawSongKey}`);
                    // 删除旧的 file_ 记录（按 relative_path）
                    const { deleteDownloadRecordByPath } = require('../utils/db');
                    const rp = dbRecord.relative_path || downloadFile.relativePath;
                    if (rp)
                        deleteDownloadRecordByPath(rp);
                    // 插入新的标准记录 (提取音频标签 + 构建完整记录)
                    const record = extractTagsAndBuildRecord(downloadFile.path, targetName, source, rawSongKey, songInfo, quality);
                    upsertDownloadRecord(record);
                    saveSingerInfoFromSong(songInfo);
                    console.log(`[FileCache] Record updated: ${source}_${rawSongKey}`);
                    exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
                    setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
                    return Promise.resolve();
                }
                else {
                    // DB 中已有标准记录,直接返回
                    console.log(`[FileCache] DB record already exists: ${dbRecord.song_id}`);
                    exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
                    setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
                    return Promise.resolve();
                }
            }
            else {
                // DB 中无记录,插入新记录 (提取音频标签 + 构建完整记录)
                console.log(`[FileCache] Inserting new DB record for download file: ${downloadFile.path}`);
                const record = extractTagsAndBuildRecord(downloadFile.path, targetName, source, rawSongKey, songInfo, quality);
                upsertDownloadRecord(record);
                saveSingerInfoFromSong(songInfo);
                exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
                setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
                return Promise.resolve();
            }
        }
        catch (e) {
            console.error(`[FileCache] Failed to sync download file to DB: ${e.message}`);
            // DB 同步失败,继续下载流程
        }
    }
    // Step 4: 都没有,从线上下载
    return (0, exports.downloadAndCache)(songInfo, url, quality, signal, isOnlyDownload);
};
exports.downloadMusic = downloadMusic;
/**
 * 下载并缓存 (在线播放场景,缓存到 cache/ 目录,不写 DB)
 * @param songInfo 歌曲信息
 * @param url 播放 URL
 * @param quality 音质
 * @param signal 取消信号
 * @param isOnlyDownload 是否仅下载(不传或false=播放缓存, true=下载到download/+DB)
 */
const downloadAndCache = async (songInfo, url, quality, signal, isOnlyDownload = false) => {
    // Use directory structure: album/
    const dir = ensureSongDir(songInfo, isOnlyDownload);
    const baseName = getFileName(songInfo);
    const tempPath = path_1.default.join(dir, baseName + '.tmp');
    // [Fix] songKey 使用 relative_path 避免不同平台 song_id 冲突
    const rawSongKey = String(songInfo.id || songInfo.songmid);
    const source = String(songInfo.source || 'unknown');
    const songKey = `${source}_${rawSongKey}`;
    // Check if already downloading (prevent duplicate downloads)
    if (downloadingSongKeys.has(songKey)) {
        console.log(`[FileCache] Song already downloading, skipping: ${baseName}`);
        // [Fix] 设置 cacheProgress 让客户端知道当前状态，避免永久卡在“云端下载中”
        exports.cacheProgress.set(songKey, { progress: 0, status: 'waiting' });
        return Promise.resolve();
    }
    // [Fix] 调用方(downloadMusic)已检查DB和cache,此处无需重复检查
    // 重定向回调也是内部递归,原始调用已通过检查,无需再次验证
    if (signal?.aborted)
        return;
    // Mark as downloading
    downloadingSongKeys.add(songKey);
    console.log(`[DL-DIAG] downloadAndCache START: ${baseName} (${songKey}), concurrent=${downloadingSongKeys.size}, isOnlyDownload=${isOnlyDownload}`);
    // [Fix] 在发起 HTTP 请求前就设置 cacheProgress 为 waiting 状态
    // 避免客户端轮询时拿不到任何数据导致无法触发超时检测
    exports.cacheProgress.set(songKey, { progress: 0, status: 'waiting' });
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https_1.default : http_1.default;
        let req;
        let settled = false;
        const settle = (fn) => {
            if (settled)
                return;
            settled = true;
            if (signal)
                signal.removeEventListener('abort', abortHandler);
            downloadingSongKeys.delete(songKey); // Cleanup
            fn();
        };
        const abortHandler = () => {
            console.log(`[FileCache] ABORTING task: ${songKey} (base: ${baseName})`);
            if (req)
                req.destroy();
            if (fs_1.default.existsSync(tempPath))
                fs_1.default.unlink(tempPath, () => {
                });
            exports.cacheProgress.set(songKey, { progress: 0, status: 'error', errorMsg: '已取消' });
            settle(() => reject(new Error('Aborted')));
        };
        if (signal)
            signal.addEventListener('abort', abortHandler);
        // [Fix] 设置 HTTP 请求超时：30 秒连接超时 + 120 秒整体超时
        // 防止音源服务器挂起导致下载永远卡在 waiting/downloading 状态
        const CONNECT_TIMEOUT = 30_000; // 30 秒连接超时
        const DOWNLOAD_TIMEOUT = 120_000; // 120 秒整体下载超时
        let downloadTimer = null;
        const reqStartTime = Date.now();
        let total = 0;
        let received = 0;
        const timeoutHandler = () => {
            // [Fix] 如果数据已全部接收，说明是标签写入阶段超时，不应视为下载失败
            if (total > 0 && received >= total) {
                console.warn(`[DL-DIAG] TIMEOUT during tagging (data complete): ${baseName}, received=${received}/${total} — ignoring`);
                return;
            }
            console.warn(`[DL-DIAG] DOWNLOAD TIMEOUT: ${baseName} after ${Date.now() - reqStartTime}ms, received=${received}/${total}`);
            if (req)
                req.destroy();
            if (fs_1.default.existsSync(tempPath))
                fs_1.default.unlink(tempPath, () => {
                });
            exports.cacheProgress.set(songKey, { progress: 0, status: 'error', errorMsg: '下载超时' });
            settle(() => reject(new Error('Download timeout')));
        };
        req = protocol.get(url, { timeout: CONNECT_TIMEOUT }, (res) => {
            console.log(`[DL-DIAG] HTTP connected: ${baseName}, status=${res.statusCode}, connectMs=${Date.now() - reqStartTime}`);
            // [Fix] 处理 HTTP 重定向 (3xx)：跟随重定向获取真正的文件 URL
            if (res.statusCode && [301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
                let redirectUrl = res.headers.location;
                if (!redirectUrl.startsWith('http')) {
                    try {
                        redirectUrl = new URL(redirectUrl, url).href;
                    }
                    catch (e) {
                    }
                }
                console.log(`[FileCache] Following redirect [${res.statusCode}] -> ${redirectUrl.substring(0, 80)}...`);
                // 清理当前请求，用新 URL 重新下载
                if (downloadTimer)
                    clearTimeout(downloadTimer);
                res.resume(); // 消费响应体避免内存泄漏
                settle(() => {
                    // 用重定向后的 URL 递归调用 downloadAndCache
                    (0, exports.downloadAndCache)(songInfo, redirectUrl, quality, signal, isOnlyDownload).then(resolve, reject);
                });
                return;
            }
            if (res.statusCode !== 200) {
                fs_1.default.unlink(tempPath, () => {
                });
                const errMsg = `下载失败 (HTTP ${res.statusCode})`;
                exports.cacheProgress.set(songKey, { progress: 0, status: 'error', errorMsg: errMsg });
                settle(() => reject(new Error(`Failed to download, status: ${res.statusCode}`)));
                return;
            }
            // [Fix] 连接成功后启动整体下载超时计时器
            if (downloadTimer)
                clearTimeout(downloadTimer);
            downloadTimer = setTimeout(timeoutHandler, DOWNLOAD_TIMEOUT);
            exports.cacheProgress.set(songKey, { progress: 0, status: 'downloading' });
            total = parseInt(res.headers['content-length'] || '0', 10);
            received = 0;
            // Detect extension from Content-Type
            const contentType = res.headers['content-type'] || '';
            const ext = detectFileExtension(url, quality, contentType);
            const fileStream = fs_1.default.createWriteStream(tempPath);
            res.on('data', (chunk) => {
                received += chunk.length;
                if (received === chunk.length) {
                    console.log(`[DL-DIAG] First data chunk: ${baseName}, firstByteMs=${Date.now() - reqStartTime}, chunkSize=${chunk.length}`);
                }
                if (total > 0) {
                    const progress = Math.round((received / total) * 100);
                    // [Fix] When progress reaches 100%, all network data has been received.
                    // Transition to 'tagging' immediately so the frontend can mark the task as finished,
                    // rather than leaving it stuck at "云端 100%" waiting for fileStream.close.
                    const status = progress >= 100 ? 'tagging' : 'downloading';
                    exports.cacheProgress.set(songKey, { progress, status, total, received });
                }
                else {
                    // [Fix] 当 content-length 缺失（total=0）时，也更新 received
                    // 避免客户端一直显示“云端下载中”无进度变化
                    exports.cacheProgress.set(songKey, { progress: 0, status: 'downloading', received });
                }
            });
            res.pipe(fileStream);
            fileStream.on('close', () => {
                if (settled)
                    return;
                // [Fix] 数据已全部接收，清除下载超时定时器，避免异步标签写入阶段误触超时
                if (downloadTimer) {
                    clearTimeout(downloadTimer);
                    downloadTimer = null;
                }
                console.log(`[DL-DIAG] Download complete: ${baseName}, totalMs=${Date.now() - reqStartTime}, received=${received}, total=${total}`);
                exports.cacheProgress.set(songKey, { progress: 100, status: 'tagging' });
                // [New] Verify actual file format via magic numbers (must be done before finalPath definition)
                const actualFormat = detectActualFormat(tempPath);
                const isLosslessRequested = quality && (quality.includes('flac') || quality.includes('hires') || quality.includes('24bit') || quality.includes('wav') || quality === '2000' || quality === '3000');
                const isActualLossy = actualFormat === 'mp3';
                // [Enhanced] Use actual detected format for extension (more reliable than Content-Type)
                let actualExt = ext;
                if (actualFormat !== 'unknown') {
                    actualExt = '.' + actualFormat;
                    if (actualFormat === 'ogg')
                        actualExt = '.ogg'; // OGG could be FLAC or Opus
                }
                const finalPath = path_1.default.join(dir, baseName + actualExt);
                if (!fs_1.default.existsSync(tempPath)) {
                    if (fs_1.default.existsSync(finalPath)) {
                        settle(() => resolve());
                    }
                    else {
                        settle(() => reject(new Error(`Temp file missing: ${tempPath}`)));
                    }
                    return;
                }
                // If lossless requested but file is actually MP3, reject and delete
                if (isLosslessRequested && isActualLossy) {
                    console.warn(`[FileCache] 音质不匹配: 请求 ${quality} 但实际文件为 MP3, 跳过: ${baseName}`);
                    fs_1.default.unlink(tempPath, () => {
                    });
                    exports.cacheProgress.set(songKey, { progress: 0, status: 'error', errorMsg: '音质不匹配' });
                    settle(() => reject(new Error('请求无损音质但音源返回有损格式')));
                    return;
                }
                fs_1.default.rename(tempPath, finalPath, async (err) => {
                    if (err) {
                        fs_1.default.unlink(tempPath, () => {
                        });
                        settle(() => reject(err));
                        return;
                    }
                    console.log(`[FileCache] Cached saved to: ${finalPath} (detected: ${actualFormat}, ext: ${actualExt})`);
                    // [Fix] Define savedFilePath before try block to ensure it's available in catch
                    let savedFilePath = finalPath;
                    // Parse songInfo.interval ("MM:SS") to seconds as fallback for duration
                    const intervalDuration = parseIntervalDuration(songInfo.interval);
                    let tagDuration = intervalDuration;
                    try {
                        const songName = (songInfo.name || 'Unknown').replace(/^\.+/, '');
                        const artist = songInfo.singer || 'Unknown';
                        const album = songInfo.albumName || (songInfo.meta && songInfo.meta.albumName) || '';
                        // Extract cover from multiple sources (URL > relativePath > album scan)
                        let imageBuffer;
                        // Source 1: Direct URL
                        const imageUrl = songInfo.img || (songInfo.meta && songInfo.meta.picUrl) ||
                            (songInfo.album && (songInfo.album.picUrl || songInfo.album.img));
                        if (imageUrl && imageUrl.startsWith('http')) {
                            try {
                                imageBuffer = await new Promise((resCover, rejCover) => {
                                    const imgProtocol = imageUrl.startsWith('https') ? https_1.default : http_1.default;
                                    imgProtocol.get(imageUrl, (imgRes) => {
                                        if (imgRes.statusCode !== 200) {
                                            rejCover(new Error('Failed to fetch cover'));
                                            return;
                                        }
                                        const chunks = [];
                                        imgRes.on('data', (chunk) => chunks.push(chunk));
                                        imgRes.on('end', () => resCover(Buffer.concat(chunks)));
                                        imgRes.on('error', rejCover);
                                    }).on('error', rejCover);
                                });
                            }
                            catch (e) {
                            }
                        }
                        // 使用 MusicTagUtil 写入标签并读回完整元数据
                        const writeResult = MusicTagUtil.writeAndReadBackTags(finalPath, {
                            title: songName,
                            artist,
                            album,
                            cover: imageBuffer ? { data: imageBuffer, mime: 'image/jpeg' } : undefined,
                        });
                        if (writeResult) {
                            tagDuration = tagDuration ?? writeResult.duration;
                        }
                        // Extract extended metadata for DB record
                        const tagGenre = writeResult?.genre;
                        const tagYear = writeResult?.year;
                        const tagTrackNumber = writeResult?.trackNumber;
                        const tagAlbumArtist = writeResult?.albumArtist;
                        const tagComposer = writeResult?.composer;
                        const tagSampleRate = writeResult?.sampleRate;
                        const tagBitDepth = writeResult?.bitDepth;
                        const tagChannels = writeResult?.channels;
                        const tagBitRate = writeResult?.bitRate;
                        // Write to DB only for user downloads (isOnlyDownload=true)
                        if (isOnlyDownload) {
                            try {
                                const songName = (songInfo.name || 'Unknown').replace(/^\.+/, '');
                                saveDownloadRecord(source, rawSongKey, songInfo, songName || baseName, savedFilePath, actualExt, quality, tagDuration, intervalDuration, {
                                    genre: tagGenre, year: tagYear, trackNumber: tagTrackNumber,
                                    albumArtist: tagAlbumArtist, composer: tagComposer,
                                    sampleRate: tagSampleRate, bitDepth: tagBitDepth,
                                    channels: tagChannels, bitRate: tagBitRate,
                                });
                            }
                            catch (dbErr) {
                                console.warn('[FileCache] Failed to save download record:', dbErr);
                            }
                        }
                        else {
                            console.log(`[FileCache] Cache saved (no DB record): ${savedFilePath}`);
                        }
                        exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
                        setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
                    }
                    catch (tagErr) {
                        // Even if tagging fails, the download was successful
                        if (isOnlyDownload) {
                            try {
                                const songName = (songInfo.name || 'Unknown').replace(/^\.+/, '');
                                saveDownloadRecord(source, rawSongKey, songInfo, songName || baseName, savedFilePath, actualExt, quality, tagDuration, intervalDuration, {
                                    genre: undefined, year: undefined, trackNumber: undefined,
                                    albumArtist: undefined, composer: undefined,
                                    sampleRate: undefined, bitDepth: undefined,
                                    channels: undefined, bitRate: undefined,
                                });
                            }
                            catch (dbErr) {
                            }
                        }
                        else {
                            console.log(`[FileCache] Cache saved (no DB record, tagging failed): ${savedFilePath}`);
                        }
                        exports.cacheProgress.set(songKey, { progress: 100, status: 'finished' });
                        setTimeout(() => exports.cacheProgress.delete(songKey), 60000);
                    }
                    settle(() => resolve());
                });
            });
            fileStream.on('error', (err) => {
                fs_1.default.unlink(tempPath, () => {
                });
                settle(() => reject(err));
            });
        });
        req.on('timeout', () => {
            console.warn(`[DL-DIAG] CONNECTION TIMEOUT: ${baseName} after ${Date.now() - reqStartTime}ms`);
            // Node.js 的 timeout 事件只通知不销毁，需要手动销毁请求
            req.destroy(new Error('Connection timeout'));
        });
        req.on('error', (err) => {
            console.error(`[DL-DIAG] REQUEST ERROR: ${baseName}, elapsed=${Date.now() - reqStartTime}ms, error=${err.message}`);
            if (downloadTimer)
                clearTimeout(downloadTimer);
            fs_1.default.unlink(tempPath, () => {
            });
            // 区分超时和其他错误
            const isTimeout = err.message === 'Connection timeout' || err.message === 'Download timeout';
            exports.cacheProgress.set(songKey, {
                progress: 0,
                status: 'error',
                errorMsg: isTimeout ? '下载超时' : `下载失败: ${err.message}`
            });
            settle(() => reject(err));
        });
    });
};
exports.downloadAndCache = downloadAndCache;
// ======================== 任务管理 (Task Management) ========================
/**
 * Stop active tasks for a user
 */
const stopUserTasks = (username, songKey) => {
    const tasks = exports.activeTasks.get(username);
    if (!tasks)
        return;
    if (songKey) {
        const idx = tasks.findIndex(t => t.songKey === songKey);
        if (idx !== -1) {
            tasks[idx].controller.abort();
            tasks.splice(idx, 1);
        }
    }
    else {
        tasks.forEach(t => t.controller.abort());
        exports.activeTasks.delete(username);
    }
};
exports.stopUserTasks = stopUserTasks;
// ======================== 文件服务 (File Serving) ========================
const serveCacheFile = (req, res, filename) => {
    // Support relative path (album/file.ext)
    // Check both cache and download directories
    const roots = ['cache', 'download'];
    let filePath = '';
    for (const folder of roots) {
        const baseDir = getFolderDir(folder);
        // Use filename directly as relative path (supports album/file.ext)
        const checkPath = path_1.default.join(baseDir, filename);
        if (fs_1.default.existsSync(checkPath)) {
            filePath = checkPath;
            break;
        }
    }
    if (!filePath) {
        res.writeHead(404);
        res.end('Not Found');
        return;
    }
    const stat = fs_1.default.statSync(filePath);
    const ext = path_1.default.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.ape': 'audio/ape',
        '.wv': 'audio/wavpack',
        '.dsf': 'audio/dsf',
        '.dff': 'audio/dff',
        '.aiff': 'audio/aiff',
        '.aif': 'audio/aiff',
        '.dts': 'audio/dts',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
        const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!rangeMatch) {
            res.writeHead(200, {
                'Content-Length': stat.size,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes'
            });
            fs_1.default.createReadStream(filePath).pipe(res);
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
                    'Content-Type': contentType
                });
                res.end();
            }
            else {
                const chunksize = (end - start) + 1;
                const file = fs_1.default.createReadStream(filePath, { start, end });
                file.on('error', (err) => {
                    console.error('[FileCache] stream error:', err.message);
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
            'Accept-Ranges': 'bytes'
        });
        fs_1.default.createReadStream(filePath).pipe(res);
    }
};
exports.serveCacheFile = serveCacheFile;
// ======================== 缓存统计与清理 (Cache Stats & Cleanup) ========================
/**
 * Resolve a relative path to an absolute file path (for direct file access)
 * Checks both cache and download directories
 * Returns absolute path if file exists, or null if not found
 */
const resolveCacheFilePath = (relativePath) => {
    const roots = ['cache', 'download'];
    for (const folder of roots) {
        const baseDir = getFolderDir(folder);
        const checkPath = path_1.default.join(baseDir, relativePath);
        if (fs_1.default.existsSync(checkPath)) {
            return checkPath;
        }
    }
    return null;
};
exports.resolveCacheFilePath = resolveCacheFilePath;
// Get cache statistics (cache/ directory only)
const getCacheStats = () => {
    const roots = ['cache'];
    let totalSize = 0;
    let fileCount = 0;
    const countDir = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return;
        const items = fs_1.default.readdirSync(dir);
        for (const item of items) {
            const itemPath = path_1.default.join(dir, item);
            try {
                const stats = fs_1.default.statSync(itemPath);
                if (stats.isDirectory()) {
                    countDir(itemPath);
                }
                else {
                    const ext = path_1.default.extname(item).toLowerCase();
                    if (AUDIO_EXTENSIONS.includes(ext) || ext === '.lrc') {
                        totalSize += stats.size;
                        if (ext !== '.lrc')
                            fileCount++;
                    }
                }
            }
            catch (e) {
            }
        }
    };
    for (const folder of roots) {
        const baseDir = getFolderDir(folder);
        countDir(baseDir);
    }
    return { totalSize, fileCount };
};
exports.getCacheStats = getCacheStats;
// 从缓存目录文件名解析元数据 (Parse metadata from cache filename)
const parseCacheFilename = (relativePath, fileSize) => {
    const dir = path_1.default.dirname(relativePath);
    const album = dir === '.' ? 'Unknown' : dir;
    const basename = path_1.default.basename(relativePath, path_1.default.extname(relativePath));
    const ext = path_1.default.extname(relativePath).toLowerCase();
    // 匹配最后一对英文括号中的歌手名 (Match singer in last parentheses)
    const singerMatch = basename.match(/^(.+?)\(([^)]+)\)$/);
    let name = basename;
    let singer = 'Unknown';
    if (singerMatch) {
        name = singerMatch[1].trim();
        singer = singerMatch[2].trim();
    }
    // 检查同目录是否有 .lrc 文件 (Check for associated lyric file)
    const cacheBase = getFolderDir('cache');
    const lrcPath = path_1.default.join(cacheBase, dir, basename + '.lrc');
    const hasLyric = fs_1.default.existsSync(lrcPath);
    // 从扩展名推断音质 (Infer quality from extension)
    const qualityMap = {
        '.flac': 'flac', '.wav': 'wav', '.ape': 'ape',
        '.m4a': '320k', '.mp3': '128k', '.ogg': '128k'
    };
    return {
        id: 'cache_' + Buffer.from(relativePath).toString('base64').substring(0, 24),
        songId: 'cache_' + Buffer.from(relativePath).toString('base64').substring(0, 24),
        name, singer, album,
        albumName: album,
        source: 'cache',
        quality: qualityMap[ext] || '',
        type: [],
        relativePath,
        ext,
        hasCover: false,
        hasLyric,
        duration: 0,
        size: fileSize,
        mtime: '',
        filename: path_1.default.basename(relativePath),
    };
};
// 扫描 cache/ 目录返回文件列表 (Scan cache/ directory and return file list)
const scanCacheDirectory = () => {
    const cacheBase = getFolderDir('cache');
    const result = [];
    if (!fs_1.default.existsSync(cacheBase))
        return result;
    const scanDir = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return;
        const items = fs_1.default.readdirSync(dir);
        for (const item of items) {
            const itemPath = path_1.default.join(dir, item);
            try {
                const stats = fs_1.default.statSync(itemPath);
                if (stats.isDirectory()) {
                    scanDir(itemPath);
                }
                else {
                    const ext = path_1.default.extname(item).toLowerCase();
                    if (AUDIO_EXTENSIONS.includes(ext)) {
                        const relativePath = path_1.default.relative(cacheBase, itemPath);
                        result.push(parseCacheFilename(relativePath, stats.size));
                    }
                }
            }
            catch (e) {
            }
        }
    };
    scanDir(cacheBase);
    return result;
};
exports.scanCacheDirectory = scanCacheDirectory;
// 仅从 cache/ 目录删除文件 + 关联 .lrc (Delete file from cache/ dir only, no DB operation)
const removeCacheDirFile = (relativePath) => {
    const cacheBase = getFolderDir('cache');
    const filePath = path_1.default.join(cacheBase, relativePath);
    if (fs_1.default.existsSync(filePath)) {
        fs_1.default.unlinkSync(filePath);
        // 同时删除关联 .lrc (Also delete associated lyric)
        const ext = path_1.default.extname(relativePath);
        if (ext !== '.lrc') {
            const lrcPath = filePath.substring(0, filePath.lastIndexOf('.')) + '.lrc';
            if (fs_1.default.existsSync(lrcPath)) {
                fs_1.default.unlinkSync(lrcPath);
            }
        }
        return true;
    }
    return false;
};
exports.removeCacheDirFile = removeCacheDirFile;
// Clear all cache files (recursive)
const clearAllCache = () => {
    const roots = ['cache', 'download'];
    let deletedCount = 0;
    let freedSize = 0;
    const clearDir = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return;
        const items = fs_1.default.readdirSync(dir);
        for (const item of items) {
            const itemPath = path_1.default.join(dir, item);
            try {
                const stats = fs_1.default.statSync(itemPath);
                if (stats.isDirectory()) {
                    clearDir(itemPath);
                }
                else {
                    const ext = path_1.default.extname(item).toLowerCase();
                    if (AUDIO_EXTENSIONS.includes(ext) || ext === '.lrc' || ext === '.tmp') {
                        const size = stats.size;
                        fs_1.default.unlinkSync(itemPath);
                        deletedCount++;
                        freedSize += size;
                    }
                }
            }
            catch (e) {
            }
        }
    };
    for (const folder of roots) {
        const baseDir = getFolderDir(folder);
        clearDir(baseDir);
    }
    return { deletedCount, freedSize };
};
exports.clearAllCache = clearAllCache;
// Clear all lyric cache files (recursive)
const clearLyricCache = () => {
    const roots = ['cache', 'download'];
    let deletedCount = 0;
    let freedSize = 0;
    const clearLrcDir = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return;
        const items = fs_1.default.readdirSync(dir);
        for (const item of items) {
            const itemPath = path_1.default.join(dir, item);
            try {
                const stats = fs_1.default.statSync(itemPath);
                if (stats.isDirectory()) {
                    clearLrcDir(itemPath);
                }
                else if (item.endsWith('.lrc')) {
                    const size = stats.size;
                    fs_1.default.unlinkSync(itemPath);
                    deletedCount++;
                    freedSize += size;
                }
            }
            catch (e) {
            }
        }
    };
    for (const folder of roots) {
        const baseDir = getFolderDir(folder);
        clearLrcDir(baseDir);
    }
    return { deletedCount, freedSize };
};
exports.clearLyricCache = clearLyricCache;
/**
 * 将单个缓存文件从 cache/ 移动到 download/ 目录
 * @param relativePath 相对于 cache/ 目录的文件路径 (如 "album/name(singer).flac")
 * @returns 移动结果
 */
const moveSingleCacheToMusic = (relativePath) => {
    if (!relativePath)
        return { success: false, error: 'Missing relativePath' };
    const cacheBase = getFolderDir('cache');
    const filePath = path_1.default.join(cacheBase, relativePath);
    return (0, exports.moveCacheToDownload)(filePath);
};
exports.moveSingleCacheToMusic = moveSingleCacheToMusic;
const moveAllCacheToDownload = () => {
    let movedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const moveDir = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return;
        const items = fs_1.default.readdirSync(dir);
        for (const item of items) {
            const itemPath = path_1.default.join(dir, item);
            try {
                const stats = fs_1.default.statSync(itemPath);
                if (stats.isDirectory()) {
                    moveDir(itemPath);
                }
                else {
                    const ext = path_1.default.extname(item).toLowerCase();
                    if (AUDIO_EXTENSIONS.includes(ext)) {
                        const result = (0, exports.moveCacheToDownload)(itemPath);
                        if (result.success) {
                            movedCount++;
                        }
                        else {
                            errorCount++;
                        }
                    }
                    else {
                        skippedCount++;
                    }
                }
            }
            catch (e) {
                errorCount++;
            }
        }
    };
    const cacheDir = getFolderDir('cache');
    if (fs_1.default.existsSync(cacheDir)) {
        moveDir(cacheDir);
    }
    console.log(`[FileCache] Move cache to download: ${movedCount} moved, ${skippedCount} skipped (non-audio), ${errorCount} errors`);
    return { movedCount, skippedCount, errorCount };
};
exports.moveAllCacheToDownload = moveAllCacheToDownload;
