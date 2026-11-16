"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAlbumSongs = exports.handleArtistSongs = exports.handleArtistAlbums = exports.handleArtistInfo = exports.handleOnlineSingerDetail = exports.handleOnlineAlbumDetail = exports.handleHotSearch = exports.handleTipSearch = exports.handleMusicSearch = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const commonUtils_1 = require("./commonUtils");
// @ts-ignore
const index_js_1 = __importDefault(require("../modules/utils/musicSdk/index.js"));
const musicSdk = index_js_1.default;
/**
 * 音乐搜索 API 处理器
 * GET /api/music/search?name=xxx&singer=xxx&source=kw&limit=20&page=1&type=song
 * type 可选值: song(默认), album, singer (仅 tx/wy 支持 album/singer)
 */
const handleMusicSearch = (req, res, urlObj) => {
    const name = urlObj.searchParams.get('name') || '';
    const singer = urlObj.searchParams.get('singer') || '';
    const source = urlObj.searchParams.get('source') || 'kw';
    const limit = parseInt(urlObj.searchParams.get('limit') || '20');
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    const type = urlObj.searchParams.get('type') || 'song';
    if (!name) {
        res.writeHead(400);
        res.end('Missing name');
        return;
    }
    void (async () => {
        try {
            if (!musicSdk[source]) {
                throw new Error(`Source ${source} is not supported`);
            }
            // 专辑/歌手搜索 (仅 tx/wy 支持)
            if (type === 'album' || type === 'singer') {
                const searchFn = type === 'album'
                    ? musicSdk[source].extendSearch.searchAlbum
                    : musicSdk[source].extendSearch.searchSinger;
                if (!searchFn) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: `该音源(${source})不支持${type === 'album' ? '专辑' : '歌手'}搜索`, code: 400 }));
                    return;
                }
                const searchData = await searchFn.call(musicSdk[source].extendSearch, name, page, limit);
                const list = searchData.list || [];
                node_fs_1.default.appendFileSync(node_path_1.default.join(process.cwd(), 'debug.txt'), `[Search] Type: ${type}, Source: ${source}, Query: ${name}, Result Count: ${list.length}\n`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ list, total: searchData.total, allPage: searchData.allPage, type }));
                return;
            }
            // 默认歌曲搜索
            const searchData = await musicSdk[source].musicSearch.search(name, page, limit);
            const list = (searchData.list || []).map(commonUtils_1.normalizeSongInfo);
            node_fs_1.default.appendFileSync(node_path_1.default.join(process.cwd(), 'debug.txt'), `[Search] Source: ${source}, Query: ${name}, Result Count: ${list.length}\n`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(list));
        }
        catch (err) {
            node_fs_1.default.appendFileSync(node_path_1.default.join(process.cwd(), 'debug.txt'), `[Search Error] ${err.message}\n${err.stack}\n`);
            console.error(err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message, code: 500 }));
        }
    })();
};
exports.handleMusicSearch = handleMusicSearch;
/**
 * 搜索提示 API 处理器
 * GET /api/music/tipSearch?name=xxx&source=kw
 */
const handleTipSearch = (req, res, urlObj) => {
    const name = urlObj.searchParams.get('name') || '';
    const source = urlObj.searchParams.get('source') || 'kw';
    if (!name) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
        return;
    }
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].tipSearch) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('[]');
                return;
            }
            const result = await musicSdk[source].tipSearch.search(name);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error('[TipSearch] Error:', err.message);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('[]');
        }
    })();
};
exports.handleTipSearch = handleTipSearch;
/**
 * 热搜 API 处理器
 * GET /api/music/hotSearch?source=mg
 */
const handleHotSearch = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'mg';
    void (async () => {
        try {
            // 检查是否支持热搜
            if (!musicSdk[source] || !musicSdk[source].hotSearch) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: '该音源不支持热搜功能' }));
                return;
            }
            const result = await musicSdk[source].hotSearch.getList();
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=300' // 5分钟缓存
            });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error('[HotSearch] Error:', err.message);
            // Return empty array instead of 500 to keep UI stable
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify([]));
        }
    })();
};
exports.handleHotSearch = handleHotSearch;
/**
 * 在线专辑详情 API 处理器
 * GET /api/music/online/album/detail?source=tx&albumId=xxx
 * 返回专辑信息 + 歌曲列表
 */
const handleOnlineAlbumDetail = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'tx';
    const albumId = urlObj.searchParams.get('albumId') || '';
    if (!albumId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing albumId', code: 400 }));
        return;
    }
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].musicSearch?.getAlbumSongs) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `该音源(${source})不支持专辑详情`, code: 400 }));
                return;
            }
            const result = await musicSdk[source].musicSearch.getAlbumSongs(albumId);
            if (Array.isArray(result)) {
                result.forEach(commonUtils_1.normalizeSongInfo);
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error('[OnlineAlbumDetail] Error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message, code: 500 }));
        }
    })();
};
exports.handleOnlineAlbumDetail = handleOnlineAlbumDetail;
/**
 * 在线歌手详情 API 处理器 (专辑列表 + 热门歌曲)
 * GET /api/music/online/singer/detail?source=tx&singerId=xxx&page=1&limit=20
 * 同时返回歌手的专辑列表和热门歌曲列表
 */
const handleOnlineSingerDetail = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source') || 'tx';
    const singerId = urlObj.searchParams.get('singerId') || '';
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    const limit = parseInt(urlObj.searchParams.get('limit') || '20');
    if (!singerId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing singerId', code: 400 }));
        return;
    }
    void (async () => {
        try {
            if (!musicSdk[source] || !musicSdk[source].singer) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `该音源(${source})不支持歌手详情`, code: 400 }));
                return;
            }
            const singerModule = musicSdk[source].singer;
            // 并行获取专辑列表 + 热门歌曲 + 歌手信息
            const [albumData, songData, singerInfo] = await Promise.all([
                singerModule.getAlbumList?.(singerId, page, limit).catch((e) => {
                    console.warn(`[SingerDetail] getAlbumList failed: ${e.message}`);
                    return { list: [], total: 0 };
                }),
                singerModule.getSongList?.(singerId, 1, 50).catch((e) => {
                    console.warn(`[SingerDetail] getSongList failed: ${e.message}`);
                    return { list: [], total: 0 };
                }),
                singerModule.getInfo?.(singerId).catch((e) => {
                    console.warn(`[SingerDetail] getInfo failed: ${e.message}`);
                    return null;
                }),
            ]);
            const result = {
                albums: albumData?.list || [],
                albumTotal: albumData?.total || 0,
                songs: (songData?.list || []).map(commonUtils_1.normalizeSongInfo),
                songTotal: songData?.total || 0,
                info: singerInfo?.info || null,
                count: singerInfo?.count || null,
                source,
                singerId,
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
        }
        catch (err) {
            console.error('[OnlineSingerDetail] Error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message, code: 500 }));
        }
    })();
};
exports.handleOnlineSingerDetail = handleOnlineSingerDetail;
const handleArtistInfo = async (req, res, urlObj) => {
    const id = urlObj.searchParams.get('id');
    const source = urlObj.searchParams.get('source') || 'wy';
    if (!id) {
        res.writeHead(400);
        res.end('Missing id');
        return;
    }
    try {
        const data = await musicSdk[source].extendDetail.getArtistDetail(id);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    catch (err) {
        res.writeHead(500);
        res.end(err.message);
    }
    return;
};
exports.handleArtistInfo = handleArtistInfo;
const handleArtistAlbums = async (req, res, urlObj) => {
    const id = urlObj.searchParams.get('id');
    const source = urlObj.searchParams.get('source') || 'wy';
    const page = parseInt(urlObj.searchParams.get('page') || '1');
    if (!id) {
        res.writeHead(400);
        res.end('Missing id');
        return;
    }
    try {
        const data = await musicSdk[source].extendDetail.getArtistAlbums(id, page);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    catch (err) {
        res.writeHead(500);
        res.end(err.message);
    }
    return;
};
exports.handleArtistAlbums = handleArtistAlbums;
// [新增] 获取歌手歌曲 API（循环拉取全部，前端分页）
const handleArtistSongs = async (req, res, urlObj) => {
    const id = urlObj.searchParams.get('id');
    const source = urlObj.searchParams.get('source') || 'wy';
    const order = urlObj.searchParams.get('order') || 'hot';
    if (!id) {
        res.writeHead(400);
        res.end('Missing id');
        return;
    }
    try {
        const MAX_PAGES = 5; // 最多拉取 5 页 = 500 首
        const PAGE_SIZE = 100;
        let allSongs = [];
        for (let p = 1; p <= MAX_PAGES; p++) {
            const data = await musicSdk[source].extendDetail.getArtistSongs(id, p, PAGE_SIZE, order);
            const pageList = data.list || [];
            allSongs = allSongs.concat(pageList.map(commonUtils_1.normalizeSongInfo));
            // 如果本页返回数量小于 PAGE_SIZE，说明已经是最后一页
            if (pageList.length < PAGE_SIZE)
                break;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(allSongs));
    }
    catch (err) {
        res.writeHead(500);
        res.end(err.message);
    }
    return;
};
exports.handleArtistSongs = handleArtistSongs;
// [新增] 获取专辑歌曲 API
const handleAlbumSongs = async (req, res, urlObj) => {
    const id = urlObj.searchParams.get('id');
    const source = urlObj.searchParams.get('source') || 'wy';
    if (!id) {
        res.writeHead(400);
        res.end('Missing id');
        return;
    }
    try {
        const data = await musicSdk[source].extendDetail.getAlbumSongs(id);
        if (Array.isArray(data)) {
            data.forEach(commonUtils_1.normalizeSongInfo);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    }
    catch (err) {
        res.writeHead(500);
        res.end(err.message);
    }
    return;
};
exports.handleAlbumSongs = handleAlbumSongs;
