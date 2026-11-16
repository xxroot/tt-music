"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatPlayCount = exports.formatPlayTime = exports.sizeFormate = exports.decodeName = exports.dateFormat2 = exports.dateFormat = void 0;
const index_1 = __importDefault(require("./kw/index"));
const index_2 = __importDefault(require("./kg/index"));
const index_3 = __importDefault(require("./tx/index"));
const index_4 = __importDefault(require("./wy/index"));
const index_5 = __importDefault(require("./mg/index"));
const index_6 = __importDefault(require("./bd/index"));
const xm_1 = __importDefault(require("./xm"));
const api_source_1 = require("./api-source");
var index_7 = require("../index");
Object.defineProperty(exports, "dateFormat", { enumerable: true, get: function () { return index_7.dateFormat; } });
Object.defineProperty(exports, "dateFormat2", { enumerable: true, get: function () { return index_7.dateFormat2; } });
Object.defineProperty(exports, "decodeName", { enumerable: true, get: function () { return index_7.decodeName; } });
Object.defineProperty(exports, "sizeFormate", { enumerable: true, get: function () { return index_7.sizeFormate; } });
Object.defineProperty(exports, "formatPlayTime", { enumerable: true, get: function () { return index_7.formatPlayTime; } });
Object.defineProperty(exports, "formatPlayCount", { enumerable: true, get: function () { return index_7.formatPlayCount; } });
const sources = {
    sources: [
        {
            name: '酷我音乐',
            id: 'kw',
        },
        {
            name: '酷狗音乐',
            id: 'kg',
        },
        {
            name: 'QQ音乐',
            id: 'tx',
        },
        {
            name: '网易音乐',
            id: 'wy',
        },
        {
            name: '咪咕音乐',
            id: 'mg',
        },
        {
            name: '虾米音乐',
            id: 'xm',
        },
        // {
        //   name: '百度音乐',
        //   id: 'bd',
        // },
    ],
    kw: index_1.default,
    kg: index_2.default,
    tx: index_3.default,
    wy: index_4.default,
    mg: index_5.default,
    bd: index_6.default,
    xm: xm_1.default,
};
exports.default = {
    ...sources,
    init() {
        const tasks = [];
        for (let source of sources.sources) {
            let sm = sources[source.id];
            sm && sm.init && tasks.push(sm.init());
        }
        return Promise.all(tasks);
    },
    supportQuality: api_source_1.supportQuality,
    async searchMusic({ name, singer, source: s, limit = 25, page = 1 }) {
        const trimStr = str => typeof str == 'string' ? str.trim() : str;
        const musicName = trimStr(name);
        const tasks = [];
        const excludeSource = ['xm'];
        for (const source of sources.sources) {
            if (!sources[source.id].musicSearch || source.id == s || excludeSource.includes(source.id))
                continue;
            tasks.push(sources[source.id].musicSearch.search(`${musicName} ${singer || ''}`.trim(), page, limit).catch(err => {
                console.error(`[MusicSdk] Search error in ${source.id}:`, err);
                return null;
            }));
        }
        return (await Promise.all(tasks)).filter(s => s);
    },
    async findMusic({ name, singer, albumName, interval, source: s }) {
        const lists = await this.searchMusic({ name, singer, source: s, limit: 25 });
        // console.log(lists)
        // console.log({ name, singer, albumName, interval, source: s })
        const singersRxp = /、|&|;|；|\/|,|，|\|/;
        const sortSingle = singer => singersRxp.test(singer)
            ? singer.split(singersRxp).sort((a, b) => a.localeCompare(b)).join('、')
            : (singer || '');
        const sortMusic = (arr, callback) => {
            const tempResult = [];
            for (let i = arr.length - 1; i > -1; i--) {
                const item = arr[i];
                if (callback(item)) {
                    delete item.fSinger;
                    delete item.fMusicName;
                    delete item.fAlbumName;
                    delete item.fInterval;
                    tempResult.push(item);
                    arr.splice(i, 1);
                }
            }
            tempResult.reverse();
            return tempResult;
        };
        const getIntv = (interval) => {
            if (!interval)
                return 0;
            // if (musicInfo._interval) return musicInfo._interval
            let intvArr = interval.split(':');
            let intv = 0;
            let unit = 1;
            while (intvArr.length) {
                intv += parseInt(intvArr.pop()) * unit;
                unit *= 60;
            }
            return intv;
        };
        const trimStr = str => typeof str == 'string' ? str.trim() : (str || '');
        const filterStr = str => typeof str == 'string' ? str.replace(/\s|'|\.|,|，|&|"|、|\(|\)|（|）|`|~|-|<|>|\||\/|\]|\[|!|！/g, '') : String(str || '');
        const fMusicName = filterStr(name).toLowerCase();
        const fSinger = filterStr(sortSingle(singer)).toLowerCase();
        const fAlbumName = filterStr(albumName).toLowerCase();
        const fInterval = getIntv(interval);
        const isEqualsInterval = (intv) => Math.abs((fInterval || intv) - (intv || fInterval)) < 5;
        const isIncludesName = (name) => (fMusicName.includes(name) || name.includes(fMusicName));
        const isIncludesSinger = (singer) => fSinger ? (fSinger.includes(singer) || singer.includes(fSinger)) : true;
        const isEqualsAlbum = (album) => fAlbumName ? fAlbumName == album : true;
        const result = lists.map(source => {
            for (const item of source.list) {
                item.name = trimStr(item.name);
                item.singer = trimStr(item.singer);
                item.fSinger = filterStr(sortSingle(item.singer).toLowerCase());
                item.fMusicName = filterStr(String(item.name ?? '').toLowerCase());
                item.fAlbumName = filterStr(String(item.albumName ?? '').toLowerCase());
                item.fInterval = getIntv(item.interval);
                // console.log(fMusicName, item.fMusicName, item.source)
                if (!isEqualsInterval(item.fInterval)) {
                    item.name = null;
                    continue;
                }
                if (item.fMusicName == fMusicName && isIncludesSinger(item.fSinger))
                    return item;
            }
            for (const item of source.list) {
                if (item.name == null)
                    continue;
                if (item.fSinger == fSinger && isIncludesName(item.fMusicName))
                    return item;
            }
            for (const item of source.list) {
                if (item.name == null)
                    continue;
                if (isEqualsAlbum(item.fAlbumName) && isIncludesSinger(item.fSinger) && isIncludesName(item.fMusicName))
                    return item;
            }
            return null;
        }).filter(s => s);
        const newResult = [];
        if (result.length) {
            newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.fMusicName == fMusicName && item.interval == interval));
            newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName && item.fSinger == fSinger && item.fAlbumName == fAlbumName));
            newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.fMusicName == fMusicName));
            newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName && item.interval == interval));
            newResult.push(...sortMusic(result, item => item.fSinger == fSinger && item.interval == interval));
            newResult.push(...sortMusic(result, item => item.interval == interval));
            newResult.push(...sortMusic(result, item => item.fMusicName == fMusicName));
            newResult.push(...sortMusic(result, item => item.fSinger == fSinger));
            newResult.push(...sortMusic(result, item => item.fAlbumName == fAlbumName));
            for (const item of result) {
                delete item.fSinger;
                delete item.fMusicName;
                delete item.fAlbumName;
                delete item.fInterval;
            }
            newResult.push(...result);
        }
        // console.log(newResult)
        return newResult;
    },
    /**
     * 搜索歌手信息 (优先 WY, 降级 TX)
     * @param {string} singerName - 歌手名
     * @returns {Promise<{source, singerId, name, avatar, desc, gender, musicCount, albumCount}|null>}
     */
    async searchSingerInfo(singerName) {
        // 优先 WY: 直接使用 searchSinger 结果，避免额外调用 getInfo
        try {
            if (index_4.default.singer?.searchSinger) {
                const artists = await index_4.default.singer.searchSinger(singerName, 5);
                if (artists && artists.length > 0) {
                    const match = artists.find(a => a.name === singerName) || artists[0];
                    // searchSinger 已返回 id, name, picUrl, musicSize, albumSize
                    // 如需 desc 和 gender，可降级调用 getInfo
                    return {
                        source: 'wy',
                        singerId: String(match.id),
                        name: match.name,
                        avatar: match.avatar,
                        avatarRaw: match.avatarRaw || null, // 原图 URL (img1v1Url)
                        desc: null, // searchSinger 不返回简介，需要时可调用 getInfo
                        gender: null, // searchSinger 不返回性别，需要时可调用 getInfo
                        musicCount: match.musicCount || 0,
                        albumCount: match.albumCount || 0,
                    };
                }
                else {
                    console.log(`[MusicSdk] WY searchSinger no result for "${singerName}"`);
                }
            }
        }
        catch (err) {
            console.error(`[MusicSdk] WY searchSinger failed for "${singerName}":`, err?.message || err);
        }
        // 降级 TX: 从 searchSingerPic 获取 singerMid → getInfo
        try {
            if (index_3.default.singer?.getInfo) {
                const data = await index_3.default.musicSearch.musicSearch(singerName, 1, 5);
                const songList = data?.body?.item_song;
                if (songList && songList.length > 0) {
                    let singerMid = '';
                    for (const song of songList) {
                        const target = song.singer?.find(s => s.name === singerName);
                        if (target) {
                            singerMid = target.mid;
                            break;
                        }
                    }
                    if (!singerMid && songList[0].singer?.[0]) {
                        singerMid = songList[0].singer[0].mid;
                    }
                    if (singerMid) {
                        const detail = await index_3.default.singer.getInfo(singerMid);
                        if (detail && detail.info) {
                            return {
                                source: 'tx',
                                singerId: String(detail.id),
                                name: detail.info.name,
                                avatar: detail.info.avatar,
                                desc: detail.info.desc,
                                gender: detail.info.gender,
                                musicCount: detail.count?.music || 0,
                                albumCount: detail.count?.album || 0,
                            };
                        }
                    }
                }
            }
        }
        catch (err) {
            console.error(`[MusicSdk] TX searchSinger failed for "${singerName}":`, err?.message || err);
        }
        // 降级 KG: 从搜索结果中获取 singerid → getInfo
        try {
            if (index_2.default.singer?.getInfo) {
                const searchResult = await index_2.default.musicSearch.search(singerName, 1, 5);
                if (searchResult && searchResult.list && searchResult.list.length > 0) {
                    // KG 搜索结果不直接含 singerid，跳过
                }
            }
        }
        catch (err) {
            // KG 搜索结果不含 singer ID，忽略
        }
        return null;
    },
    /**
     * 严格匹配歌手信息（仅查 WY 和 TX，优先 WY）
     * 步骤：extendSearch.searchSinger 找精确匹配 → extendDetail.getArtistDetail 获取明细
     * @param {string} singerName - 歌手名
     * @returns {Promise<{source, singerId, name, avatar, desc, musicCount, albumCount}|null>}
     */
    async searchSingerInfoStrict(singerName) {
        const sources = ['wy', 'tx']; // 优先 WY
        for (const src of sources) {
            try {
                const result = await this[src].extendSearch.searchSinger(singerName, 1, 20);
                const list = result?.list || [];
                // 严格相等匹配，找不到就当没有
                const match = list.find(item => item.name === singerName);
                if (match) {
                    // 调用 getArtistDetail 获取完整信息（含 desc、avatar 等）
                    const detail = await this[src].extendDetail.getArtistDetail(match.id);
                    return {
                        source: detail.source || src,
                        singerId: String(detail.id),
                        name: detail.name,
                        avatar: detail.avatar || '',
                        desc: detail.desc || '',
                        musicCount: detail.musicSize || 0,
                        albumCount: detail.albumSize || 0,
                        gender: detail.gender || ''
                    };
                }
            }
            catch (err) {
                console.error(`[MusicSdk] ${src.toUpperCase()} searchSingerInfoStrict failed for "${singerName}":`, err?.message || err);
            }
        }
        return null;
    },
};
