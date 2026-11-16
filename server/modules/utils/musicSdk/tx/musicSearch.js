"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const index_1 = require("../../index");
const utils_1 = require("../utils");
exports.default = {
    limit: 50,
    total: 0,
    page: 0,
    allPage: 1,
    successCode: 0,
    musicSearch(str, page, limit, searchType = 0, retryNum = 0) {
        if (retryNum > 5)
            return Promise.reject(new Error('搜索失败'));
        // search_type 值	搜索类型
        // 0	单曲 / 歌曲
        // 2	歌单
        // 7	歌词
        // 8	专辑
        // 9	歌手
        // 12	MV
        const searchRequest = (0, request_1.httpFetch)('https://u.y.qq.com/cgi-bin/musicu.fcg', {
            method: 'post',
            headers: {
                'User-Agent': 'QQMusic 14090508(android 12)',
            },
            body: {
                comm: {
                    ct: '11',
                    cv: '14090508',
                    v: '14090508',
                    tmeAppID: 'qqmusic',
                    phonetype: 'EBG-AN10',
                    deviceScore: '553.47',
                    devicelevel: '50',
                    newdevicelevel: '20',
                    rom: 'HuaWei/EMOTION/EmotionUI_14.2.0',
                    os_ver: '12',
                    OpenUDID: '0',
                    OpenUDID2: '0',
                    QIMEI36: '0',
                    udid: '0',
                    chid: '0',
                    aid: '0',
                    oaid: '0',
                    taid: '0',
                    tid: '0',
                    wid: '0',
                    uid: '0',
                    sid: '0',
                    modeSwitch: '6',
                    teenMode: '0',
                    ui_mode: '2',
                    nettype: '1020',
                    v4ip: '',
                },
                req: {
                    module: 'music.search.SearchCgiService',
                    method: 'DoSearchForQQMusicMobile',
                    param: {
                        search_type: searchType,
                        query: str,
                        page_num: page,
                        num_per_page: limit,
                        highlight: 0,
                        nqc_flag: 0,
                        multi_zhida: 0,
                        cat: 2,
                        grp: 1,
                        sin: 0,
                        sem: 0,
                    },
                },
            },
        });
        return searchRequest.promise.then(({ body }) => {
            console.log('[TX Search] raw response:', JSON.stringify(body, null, 2).substring(0, 3000));
            if (body.code != this.successCode || body.req.code != this.successCode)
                return this.musicSearch(str, page, limit, searchType, ++retryNum);
            return body.req.data;
        });
    },
    handleResult(rawList) {
        // console.log(rawList)
        const list = [];
        rawList.forEach(item => {
            if (!item.file?.media_mid)
                return;
            let types = [];
            let _types = {};
            const file = item.file;
            if (file.size_128mp3 != 0) {
                let size = (0, index_1.sizeFormate)(file.size_128mp3);
                types.push({ type: '128k', size });
                _types['128k'] = {
                    size,
                };
            }
            if (file.size_320mp3 !== 0) {
                let size = (0, index_1.sizeFormate)(file.size_320mp3);
                types.push({ type: '320k', size });
                _types['320k'] = {
                    size,
                };
            }
            if (file.size_flac !== 0) {
                let size = (0, index_1.sizeFormate)(file.size_flac);
                types.push({ type: 'flac', size });
                _types.flac = {
                    size,
                };
            }
            if (file.size_hires !== 0) {
                let size = (0, index_1.sizeFormate)(file.size_hires);
                types.push({ type: 'flac24bit', size });
                _types.flac24bit = {
                    size,
                };
            }
            // types.reverse()
            let albumId = '';
            let albumName = '';
            if (item.album) {
                albumName = item.album.name;
                albumId = item.album.mid;
            }
            // console.log('tx-搜索===》', item)
            list.push({
                singer: (0, utils_1.formatSingerName)(item.singer, 'name'),
                singers: item.singer ? item.singer.map(s => ({ id: s.mid, name: s.name })) : [],
                singerMids: item.singer ? item.singer.map(s => s.mid).join(',') : '',
                name: item.name + (item.title_extra ?? ''),
                albumName,
                albumId,
                source: 'tx',
                interval: (0, index_1.formatPlayTime)(item.interval),
                songId: item.id,
                albumMid: item.album?.mid ?? '',
                strMediaMid: item.file.media_mid,
                songmid: item.mid,
                img: (albumId === '' || albumId === '空')
                    ? item.singer?.length ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer[0].mid}.jpg` : ''
                    : `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
                types,
                _types,
                typeUrl: {},
            });
        });
        // console.log(list)
        return list;
    },
    // 搜索专辑 (Album Search, search_type=8)
    searchAlbum(str, page = 1, limit) {
        if (limit == null)
            limit = this.limit;
        return this.musicSearch(str, page, limit, 8).then(({ body, meta }) => {
            console.log('[TX AlbumSearch] raw response:', JSON.stringify(body, null, 2).substring(0, 3000));
            const rawAlbums = body?.album || [];
            const list = rawAlbums.map(item => ({
                id: item.album_mid || item.albumMid || '',
                name: item.album_name || item.albumName || '',
                singer: (0, utils_1.formatSingerName)(item.singers || item.singer, 'name'),
                img: (item.album_mid || item.albumMid)
                    ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${item.album_mid || item.albumMid}.jpg`
                    : '',
                count: item.song_count || item.totalNum || 0,
                publishTime: item.publish_time || item.pubTime || '',
                source: 'tx',
            }));
            const total = meta?.estimate_sum || list.length;
            this.total = total;
            this.page = page;
            this.allPage = Math.ceil(total / limit);
            return { list, allPage: this.allPage, limit, total, source: 'tx', type: 'album' };
        });
    },
    // 搜索歌手 (Singer Search, search_type=9)
    searchSinger(str, page = 1, limit) {
        if (limit == null)
            limit = this.limit;
        return this.musicSearch(str, page, limit, 9).then(({ body, meta }) => {
            // console.log('[TX SingerSearch] raw response:', JSON.stringify(body, null, 2).substring(0, 3000))
            const rawSingers = body?.singer || [];
            const list = rawSingers.map(item => ({
                id: item.singer_mid || item.singerMid || '',
                name: item.singer_name || item.singerName || '',
                avatar: (item.singer_mid || item.singerMid)
                    ? `https://y.gtimg.cn/music/photo_new/T001R500x500M000${item.singer_mid || item.singerMid}.jpg`
                    : '',
                musicCount: item.song_count || 0,
                albumCount: item.album_count || 0,
                source: 'tx',
            }));
            const total = meta?.estimate_sum || list.length;
            this.total = total;
            this.page = page;
            this.allPage = Math.ceil(total / limit);
            return { list, allPage: this.allPage, limit, total, source: 'tx', type: 'singer' };
        });
    },
    // 获取专辑歌曲列表 (Get Album Songs)
    getAlbumSongs(albumMid) {
        return (0, request_1.httpFetch)('https://u.y.qq.com/cgi-bin/musicu.fcg', {
            method: 'post',
            headers: {
                'User-Agent': 'QQMusic 14090508(android 12)',
            },
            body: {
                comm: {
                    ct: '11', cv: '14090508', v: '14090508',
                    tmeAppID: 'qqmusic', uin: 0,
                },
                req: {
                    module: 'music.musichallAlbum.AlbumSongListServer',
                    method: 'GetAlbumSongList',
                    param: {
                        albumMid,
                        order: 1,
                        begin: 0,
                        num: 100,
                    },
                },
            },
        }).promise.then(({ body }) => {
            console.log('[TX AlbumSongs] raw response:', JSON.stringify(body, null, 2).substring(0, 2000));
            if (body.code != 0 || body.req?.code != 0)
                throw new Error('获取专辑歌曲失败');
            const songList = body.req?.data?.songList || [];
            const albumInfo = body.req?.data?.albumInfo || {};
            const list = songList.map(item => {
                const song = item.songInfo || item;
                if (!song?.file?.media_mid)
                    return null;
                const albumId = song.album?.mid || albumMid;
                return {
                    singer: (0, utils_1.formatSingerName)(song.singer, 'name'),
                    singerMids: song.singer ? song.singer.map(s => s.mid).join(',') : '',
                    name: song.name + (song.title_extra ?? ''),
                    albumName: song.album?.name || albumInfo.name || '',
                    albumId,
                    source: 'tx',
                    interval: (0, index_1.formatPlayTime)(song.interval),
                    songId: song.id,
                    albumMid: albumId,
                    strMediaMid: song.file.media_mid,
                    songmid: song.mid,
                    img: `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumId}.jpg`,
                    types: [], _types: {}, typeUrl: {},
                };
            }).filter(Boolean);
            return {
                list,
                info: {
                    name: albumInfo.name || '',
                    singer: (0, utils_1.formatSingerName)(albumInfo.singers || albumInfo.singer, 'name') || '',
                    img: albumMid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albumMid}.jpg` : '',
                    count: list.length,
                },
                source: 'tx',
            };
        });
    },
    search(str, page = 1, limit, type = 'song') {
        if (limit == null)
            limit = this.limit;
        if (type === 'album')
            return this.searchAlbum(str, page, limit);
        if (type === 'singer')
            return this.searchSinger(str, page, limit);
        // 默认歌曲搜索
        return this.musicSearch(str, page, limit, 0).then(({ body, meta }) => {
            let list = this.handleResult(body.item_song);
            this.total = meta.estimate_sum;
            this.page = page;
            this.allPage = Math.ceil(this.total / limit);
            return Promise.resolve({
                list,
                allPage: this.allPage,
                limit,
                total: this.total,
                source: 'tx',
            });
        });
    },
};
