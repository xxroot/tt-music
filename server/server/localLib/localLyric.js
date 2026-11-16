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
exports.handleSaveCachedLyric = exports.handleGetCachedLyric = exports.handleGetLyricPost = exports.handleGetLyric = exports.normalizeSongInfo = void 0;
const fileCache = __importStar(require("../fileCache"));
const commonUtils_1 = require("../commonUtils");
// @ts-ignore
const index_js_1 = __importDefault(require("../../modules/utils/musicSdk/index.js"));
const musicSdk = index_js_1.default;
// 导出 normalizeSongInfo 供其他模块使用
exports.normalizeSongInfo = commonUtils_1.normalizeSongInfo;
/**
 * 获取歌词 (GET)
 * GET /api/music/lyric?source=xxx&songmid=xxx&name=xxx&singer=xxx
 */
const handleGetLyric = (req, res, urlObj) => {
    const source = urlObj.searchParams.get('source');
    let songmid = urlObj.searchParams.get('songmid') || urlObj.searchParams.get('songId') || urlObj.searchParams.get('id');
    if (!source || !songmid) {
        res.writeHead(400);
        res.end('Missing source or songmid');
        return;
    }
    // 规范化 ID
    const sourcePrefix = `${source}_`;
    if (songmid.startsWith(sourcePrefix)) {
        songmid = songmid.slice(sourcePrefix.length);
    }
    void (async () => {
        try {
            if (!musicSdk[source]) {
                throw new Error('Source not supported');
            }
            // 构造完整的 songInfo 对象
            const songInfo = {
                songmid,
                name: urlObj.searchParams.get('name') || '',
                singer: urlObj.searchParams.get('singer') || '',
                hash: urlObj.searchParams.get('hash') || '',
                interval: urlObj.searchParams.get('interval') || '',
                copyrightId: urlObj.searchParams.get('copyrightId') || '',
                albumId: urlObj.searchParams.get('albumId') || '',
                lrcUrl: urlObj.searchParams.get('lrcUrl') || '',
                mrcUrl: urlObj.searchParams.get('mrcUrl') || '',
                trcUrl: urlObj.searchParams.get('trcUrl') || ''
            };
            const requestObj = musicSdk[source].getLyric(songInfo);
            const lyricInfo = await requestObj.promise;
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=86400' // 缓存1天
            });
            res.end(JSON.stringify(lyricInfo));
        }
        catch (err) {
            console.error('[Lyric] Fetch error:', source, songmid, err.message || err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(err.message || 'Failed to fetch lyric');
        }
    })();
};
exports.handleGetLyric = handleGetLyric;
/**
 * 获取歌词 (POST)
 * POST /api/music/lyric
 * Body: { songInfo }
 */
const handleGetLyricPost = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        try {
            let { songInfo } = body;
            songInfo = (0, commonUtils_1.normalizeSongInfo)(songInfo);
            if (!songInfo || !songInfo.source) {
                throw new Error('Invalid songInfo');
            }
            const source = songInfo.source;
            if (!musicSdk[source] || !musicSdk[source].getLyric) {
                throw new Error(`Source ${source} not supported`);
            }
            const requestObj = musicSdk[source].getLyric(songInfo);
            const result = await requestObj.promise;
            (0, commonUtils_1.sendJsonResponse)(res, 200, result);
        }
        catch (err) {
            console.error(err);
            res.writeHead(500);
            res.end(err.message);
        }
    });
};
exports.handleGetLyricPost = handleGetLyricPost;
/**
 * 获取缓存歌词
 * GET /api/music/cache/lyric?source=xxx&songmid=xxx&name=xxx&singer=xxx
 */
const handleGetCachedLyric = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const name = urlObj.searchParams.get('name') || '';
    const singer = urlObj.searchParams.get('singer') || '';
    const albumName = urlObj.searchParams.get('albumName') || urlObj.searchParams.get('album') || '';
    // 按 name/singer/albumName 搜索
    if (name) {
        const result = fileCache.checkLyricCache({ name, singer: singer || 'Unknown', albumName: albumName || 'Unknown' });
        if (result.exists) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, data: result.content }));
        }
        else {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: false, message: 'Not found in cache' }));
        }
        return;
    }
    res.writeHead(400);
    res.end('Missing source or songmid or name');
};
exports.handleGetCachedLyric = handleGetCachedLyric;
/**
 * 保存缓存歌词
 * POST /api/music/cache/lyric
 * Body: { songInfo, lyricsObj }
 */
const handleSaveCachedLyric = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        const { songInfo, lyricsObj } = body;
        if (!songInfo || !lyricsObj) {
            res.writeHead(400);
            res.end('Missing parameters');
            return;
        }
        try {
            const success = fileCache.saveLyricCache(songInfo, lyricsObj);
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success });
        }
        catch (e) {
            console.error('[LyricCache] Save error:', e.message || e);
            (0, commonUtils_1.sendJsonResponse)(res, 500, { success: false, message: e.message || 'Server internal error' });
        }
    });
};
exports.handleSaveCachedLyric = handleSaveCachedLyric;
