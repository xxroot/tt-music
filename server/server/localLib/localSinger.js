"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.singerSyncTasks = exports.handleSingerAlbums = exports.handleSingerSyncProgress = exports.handleSingerSync = exports.handleSingerList = void 0;
// @ts-ignore
const index_js_1 = __importDefault(require("../../modules/utils/musicSdk/index.js"));
const musicSdk = index_js_1.default;
// 内存存储同步任务进度
const singerSyncTasks = new Map();
exports.singerSyncTasks = singerSyncTasks;
/**
 * 获取歌手列表
 * GET /api/music/singer/list?source=xxx&keyword=xxx&page=1&limit=24
 */
const handleSingerList = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || '';
    const keyword = urlObj.searchParams.get('keyword') || '';
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    const limit = parseInt(urlObj.searchParams.get('limit') || '24');
    void (async () => {
        try {
            const { getAllSingerInfo } = await import('../../utils/db.js');
            const result = getAllSingerInfo({ source, keyword, page, limit });
            // snake_case 转 camelCase
            const list = result.list.map((s) => ({
                singerId: s.singer_id,
                source: s.source,
                name: s.name,
                avatar: s.avatar || '',
                desc: s.desc || '',
                gender: s.gender || '',
                musicCount: s.music_count || 0,
                albumCount: s.album_count || 0,
                createdAt: s.created_at || '',
                updatedAt: s.updated_at || '',
            }));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, data: { list, total: result.total, page, limit } }));
        }
        catch (err) {
            console.error('[SingerList] Failed:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: -1, msg: err.message }));
        }
    })();
};
exports.handleSingerList = handleSingerList;
/**
 * 同步歌手信息 - 启动异步任务
 * POST /api/music/singer/sync
 */
const handleSingerSync = (req, res) => {
    const taskId = `singer_sync_${Date.now()}`;
    // 初始化进度对象
    const progress = {
        total: 0, processed: 0, synced: 0, skipped: 0, failed: 0,
        status: 'running', errors: [],
    };
    singerSyncTasks.set(taskId, progress);
    // 立即返回 taskId
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 0, data: { taskId } }));
    (async () => {
        try {
            const { getUnsyncedSingers, getDistinctSingersFromDownloads, upsertSingerInfo, } = await import('../../utils/db.js');
            // 先取所有歌手名，再一次 SQL 查出未同步的（替代旧的 N+1 循环查询）
            const allNames = getDistinctSingersFromDownloads();
            const unsyncedNames = getUnsyncedSingers(allNames);
            progress.total = allNames.length;
            progress.skipped = allNames.length - unsyncedNames.length;
            progress.processed = progress.skipped;
            for (const singerName of unsyncedNames) {
                try {
                    // 优先 WY，降级 TX，严格相等匹配（通过 musicSdk.searchSingerInfoStrict）
                    const info = await musicSdk.searchSingerInfoStrict(singerName);
                    if (info) {
                        upsertSingerInfo({
                            singer_id: info.singerId,
                            source: info.source,
                            name: info.name || singerName,
                            avatar: info.avatar,
                            desc: info.desc,
                            gender: undefined,
                            music_count: info.musicCount,
                            album_count: info.albumCount,
                        });
                        progress.synced++;
                    }
                    else {
                        progress.failed++;
                        progress.errors.push(`${singerName}: 所有平台查询失败`);
                    }
                }
                catch (err) {
                    progress.failed++;
                    progress.errors.push(`${singerName}: ${err.message}`);
                }
                progress.processed++;
            }
            progress.status = 'done';
        }
        catch (err) {
            console.error('[SingerSync] Task failed:', err.message);
            progress.status = 'error';
            progress.errors.push(`Task error: ${err.message}`);
        }
    })();
};
exports.handleSingerSync = handleSingerSync;
/**
 * 同步进度轮询
 * GET /api/music/singer/sync-progress?taskId=xxx
 */
const handleSingerSyncProgress = (req, res, urlObj) => {
    const taskId = urlObj.searchParams.get('taskId') || '';
    const progress = singerSyncTasks.get(taskId);
    if (!progress) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: -1, msg: 'Task not found' }));
        return;
    }
    // 任务完成后，延迟清理 (保留 30 秒供客户端读取最终结果)
    if (progress.status === 'done' || progress.status === 'error') {
        setTimeout(() => singerSyncTasks.delete(taskId), 30000);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ code: 0, data: progress }));
};
exports.handleSingerSyncProgress = handleSingerSyncProgress;
/**
 * 获取歌手关联的专辑
 * GET /api/music/singer/albums?singerName=xxx
 */
const handleSingerAlbums = (req, res, urlObj) => {
    const singerName = urlObj.searchParams.get('singerName') || '';
    if (!singerName) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: -1, msg: 'Missing singerName parameter' }));
        return;
    }
    void (async () => {
        try {
            const { getSingerDownloadRecords } = await import('../../utils/db.js');
            const songs = getSingerDownloadRecords(singerName);
            // 按 album 分组
            const albumMap = new Map();
            for (const song of songs) {
                const albumName = song.album || '未知专辑';
                if (!albumMap.has(albumName)) {
                    albumMap.set(albumName, {
                        name: albumName,
                        singer: song.singer,
                        songs: [],
                        cover: `/api/music/cache/cover?filename=${encodeURIComponent(song.relativePath)}`,
                        latestMtime: song.mtime || '',
                        coverPath: song.relativePath
                    });
                }
                const album = albumMap.get(albumName);
                album.songs.push(song);
                // 更新最新时间
                if (song.mtime && song.mtime > album.latestMtime) {
                    album.latestMtime = song.mtime;
                }
            }
            const albums = Array.from(albumMap.values()).sort((a, b) => b.latestMtime.localeCompare(a.latestMtime));
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 0, data: albums, singerName }));
        }
        catch (err) {
            console.error('[SingerAlbums] Failed:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: -1, msg: err.message }));
        }
    })();
};
exports.handleSingerAlbums = handleSingerAlbums;
