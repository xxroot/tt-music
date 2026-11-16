"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleComment = exports.handleLeaderboardList = exports.handleLeaderboardBoards = exports.handleSongListSearch = exports.handleSongListDetail = exports.handleSongListList = exports.handleSongListTags = void 0;
// @ts-ignore
const index_js_1 = __importDefault(require("../modules/utils/musicSdk/index.js"));
const musicSdk = index_js_1.default;
const commonUtils_1 = require("./commonUtils");
/**
 * 获取歌单分类标签
 * GET /api/music/songList/tags?source=wy
 */
const handleSongListTags = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'wy';
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].songList) {
                throw new Error(`Source ${source} does not support songList`);
            }
            const result = await musicSdk[source].songList.getTags();
            const sortList = musicSdk[source].songList.sortList;
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ...result, sortList }));
        }
        catch (err) {
            console.error(`[SongList Tags] Error:`, err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || '获取歌单标签失败' }));
        }
    })();
};
exports.handleSongListTags = handleSongListTags;
/**
 * 获取歌单列表
 * GET /api/music/songList/list?source=wy&tagId=&sortId=hot&page=1
 */
const handleSongListList = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'wy';
    const tagId = urlObj.searchParams.get('tagId') || '';
    const sortId = urlObj.searchParams.get('sortId') || 'hot';
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].songList) {
                throw new Error(`Source ${source} does not support songList`);
            }
            const result = await musicSdk[source].songList.getList(sortId, tagId, page);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error(`[SongList List] Error:`, err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || '获取歌单列表失败' }));
        }
    })();
};
exports.handleSongListList = handleSongListList;
/**
 * 获取歌单详情
 * GET /api/music/songList/detail?source=wy&id=xxx&page=1
 */
const handleSongListDetail = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'wy';
    const id = urlObj.searchParams.get('id');
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    if (!id) {
        res.writeHead(400);
        res.end('Missing id');
        return;
    }
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].songList) {
                throw new Error(`Source ${source} does not support songList`);
            }
            const result = await musicSdk[source].songList.getListDetail(id, page);
            if (result && result.list) {
                result.list = result.list.map(commonUtils_1.normalizeSongInfo);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error(`[SongList Detail] Error:`, err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || '获取歌单详情失败' }));
        }
    })();
};
exports.handleSongListDetail = handleSongListDetail;
/**
 * 搜索歌单
 * GET /api/music/songList/search?source=wy&text=xxx&page=1
 */
const handleSongListSearch = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'wy';
    const text = urlObj.searchParams.get('text');
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    if (!text) {
        res.writeHead(400);
        res.end('Missing text');
        return;
    }
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].songList) {
                throw new Error(`Source ${source} does not support songList`);
            }
            const result = await musicSdk[source].songList.search(text, page);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error(`[SongList Search] Error:`, err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || '搜索歌单失败' }));
        }
    })();
};
exports.handleSongListSearch = handleSongListSearch;
/**
 * 获取排行榜列表
 * GET /api/music/leaderboard/boards?source=kg
 */
const handleLeaderboardBoards = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'kg';
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].leaderboard) {
                throw new Error(`Source ${source} does not support leaderboard`);
            }
            const result = await musicSdk[source].leaderboard.getBoards();
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=600'
            });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error(`[Leaderboard Boards] Error:`, err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || '获取排行榜列表失败' }));
        }
    })();
};
exports.handleLeaderboardBoards = handleLeaderboardBoards;
/**
 * 获取排行榜歌曲
 * GET /api/music/leaderboard/list?source=kg&bangid=xxx&page=1
 */
const handleLeaderboardList = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'kg';
    const bangid = urlObj.searchParams.get('bangid');
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    if (!bangid) {
        res.writeHead(400);
        res.end('Missing bangid');
        return;
    }
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].leaderboard) {
                throw new Error(`Source ${source} does not support leaderboard`);
            }
            const result = await musicSdk[source].leaderboard.getList(bangid, page);
            if (result && result.list) {
                result.list = result.list.map(commonUtils_1.normalizeSongInfo);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error(`[Leaderboard List] Error:`, err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message || '获取排行榜歌曲失败' }));
        }
    })();
};
exports.handleLeaderboardList = handleLeaderboardList;
/**
 * 获取评论
 * POST /api/music/comment
 * Body: { songInfo, type, page, limit }
 */
const handleComment = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        try {
            let { songInfo, type, page, limit } = body;
            // 规范化歌曲信息 (使用公共工具)
            songInfo = (0, commonUtils_1.normalizeSongInfo)(songInfo);
            if (!songInfo || !songInfo.source) {
                console.warn('[Comment] Invalid request body:', body);
                throw new Error('Invalid songInfo');
            }
            const source = songInfo.source;
            console.log(`[Comment] Request: ${source} - ${songInfo.name} - ${type} - page ${page}`);
            if (!musicSdk[source] || !musicSdk[source].comment) {
                console.warn(`[Comment] Source ${source} not supported for comments`);
                throw new Error(`Source ${source} not supported for comments`);
            }
            const method = type === 'hot' ? 'getHotComment' : 'getComment';
            console.log(`[Comment] Song: ${songInfo.name}, ID: ${songInfo.songmid}, Source: ${source}`);
            if (!musicSdk[source].comment[method]) {
                console.warn(`[Comment] Method ${method} not supported for source ${source}`);
                throw new Error(`Method ${method} not supported for source ${source}`);
            }
            const result = await musicSdk[source].comment[method](songInfo, page, limit);
            console.log(`[Comment] Success: ${source} - ${result.comments?.length} comments found`);
            (0, commonUtils_1.sendJsonResponse)(res, 200, result);
        }
        catch (err) {
            console.error('[Comment] Error:', err.message);
            (0, commonUtils_1.sendJsonResponse)(res, 500, { error: err.message, code: 500 });
        }
    });
};
exports.handleComment = handleComment;
