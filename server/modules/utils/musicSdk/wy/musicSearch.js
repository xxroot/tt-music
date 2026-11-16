"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// import { httpFetch } from '../../request'
// import { weapi } from './utils/crypto'
const index_1 = require("../../index");
// import musicDetailApi from './musicDetail'
const index_2 = require("./utils/index");
const utils_1 = require("../utils");
exports.default = {
    limit: 30,
    total: 0,
    page: 0,
    allPage: 1,
    musicSearch(str, page, limit) {
        // const searchRequest = eapiRequest('/api/cloudsearch/pc', {
        //   s: str,
        //   type: 1, // 1: 单曲, 10: 专辑, 100: 歌手, 1000: 歌单, 1002: 用户, 1004: MV, 1006: 歌词, 1009: 电台, 1014: 视频
        //   limit,
        //   total: page == 1,
        //   offset: limit * (page - 1),
        // })
        const searchRequest = (0, index_2.eapiRequest)('/api/search/song/list/page', {
            keyword: str,
            needCorrect: '1',
            channel: 'typing',
            offset: limit * (page - 1),
            scene: 'normal',
            total: page == 1,
            limit,
        });
        return searchRequest.promise.then(({ body }) => body);
    },
    getSinger(singers) {
        let arr = [];
        singers.forEach(singer => {
            arr.push(singer.name);
        });
        return arr.join('、');
    },
    handleResult(rawList) {
        // console.log(rawList)
        if (!rawList)
            return [];
        return rawList.map(item => {
            item = item.baseInfo.simpleSongData;
            const types = [];
            const _types = {};
            let size;
            if (item.privilege.maxBrLevel == 'hires') {
                size = item.hr ? (0, index_1.sizeFormate)(item.hr.size) : null;
                types.push({ type: 'flac24bit', size });
                _types.flac24bit = {
                    size,
                };
            }
            switch (item.privilege.maxbr) {
                case 999000:
                    size = item.sq ? (0, index_1.sizeFormate)(item.sq.size) : null;
                    types.push({ type: 'flac', size });
                    _types.flac = {
                        size,
                    };
                    break;
                case 320000:
                    size = item.h ? (0, index_1.sizeFormate)(item.h.size) : null;
                    types.push({ type: '320k', size });
                    _types['320k'] = {
                        size,
                    };
                    break;
                case 192000:
                case 128000:
                    size = item.l ? (0, index_1.sizeFormate)(item.l.size) : null;
                    types.push({ type: '128k', size });
                    _types['128k'] = {
                        size,
                    };
                    break;
            }
            types.reverse();
            // console.log("wy-搜索====》",item)
            return {
                singer: this.getSinger(item.ar),
                singerIds: item.ar ? item.ar.map(a => a.id).join(',') : '',
                singers: item.ar,
                name: item.name,
                albumName: item.al.name,
                albumId: item.al.id,
                source: 'wy',
                interval: (0, index_1.formatPlayTime)(item.dt / 1000),
                songmid: item.id,
                img: item.al.picUrl,
                lrc: null,
                types,
                _types,
                typeUrl: {},
            };
        });
    },
    // 搜索专辑 (Album Search, cloudsearch type=10)
    searchAlbum(str, page = 1, limit) {
        if (limit == null)
            limit = this.limit;
        return (0, index_2.eapiRequest)('/api/cloudsearch/pc', {
            s: str,
            type: 10,
            limit,
            total: page == 1,
            offset: limit * (page - 1),
        }).promise.then(({ body }) => {
            if (!body || body.code !== 200)
                throw new Error('WY 专辑搜索失败');
            console.log('[WY AlbumSearch] raw response:', JSON.stringify(body.result, null, 2).substring(0, 3000));
            const rawAlbums = body.result?.albums || [];
            const list = rawAlbums.map(item => ({
                id: String(item.id),
                name: item.name || '',
                singer: (0, utils_1.formatSingerName)(item.artists, 'name'),
                img: item.picUrl || '',
                count: item.size || 0,
                publishTime: item.publishTime ? new Date(item.publishTime).toISOString().split('T')[0] : '',
                source: 'wy',
            }));
            const total = body.result?.albumCount || list.length;
            this.total = total;
            this.page = page;
            this.allPage = Math.ceil(total / limit);
            return { list, allPage: this.allPage, limit, total, source: 'wy', type: 'album' };
        });
    },
    // 搜索歌手 (Singer Search, cloudsearch type=100)
    searchSinger(str, page = 1, limit) {
        if (limit == null)
            limit = this.limit;
        return (0, index_2.eapiRequest)('/api/cloudsearch/pc', {
            s: str,
            type: 100,
            limit,
            total: page == 1,
            offset: limit * (page - 1),
        }).promise.then(({ body }) => {
            if (!body || body.code !== 200)
                throw new Error('WY 歌手搜索失败');
            console.log('[WY SingerSearch] raw response:', JSON.stringify(body.result, null, 2).substring(0, 3000));
            const rawArtists = body.result?.artists || [];
            const list = rawArtists.map(a => ({
                id: String(a.id),
                name: a.name || '',
                avatar: a.picUrl || a.img1v1Url || '',
                musicCount: a.musicSize || 0,
                albumCount: a.albumSize || 0,
                source: 'wy',
            }));
            const total = body.result?.artistCount || list.length;
            this.total = total;
            this.page = page;
            this.allPage = Math.ceil(total / limit);
            return { list, allPage: this.allPage, limit, total, source: 'wy', type: 'singer' };
        });
    },
    // 获取专辑歌曲列表 (Get Album Songs)
    getAlbumSongs(albumId) {
        return (0, index_2.eapiRequest)('/api/v1/album/' + albumId, {
            id: albumId,
            n: 100,
        }).promise.then(({ body }) => {
            if (!body || body.code !== 200)
                throw new Error('获取专辑歌曲失败');
            // console.log('[WY AlbumSongs] raw response keys:', Object.keys(body))
            const album = body.album || {};
            const songs = body.songs || [];
            const list = songs.map(item => {
                if (!item.id)
                    return null;
                const types = [];
                const _types = {};
                // WY album songs use privilege.fee/flag for quality info
                if (item.h?.size) {
                    types.push({ type: '320k', size: (0, index_1.sizeFormate)(item.h.size) });
                    _types['320k'] = { size: (0, index_1.sizeFormate)(item.h.size) };
                }
                if (item.l?.size) {
                    types.push({ type: '128k', size: (0, index_1.sizeFormate)(item.l.size) });
                    _types['128k'] = { size: (0, index_1.sizeFormate)(item.l.size) };
                }
                if (item.sq?.size) {
                    types.push({ type: 'flac', size: (0, index_1.sizeFormate)(item.sq.size) });
                    _types.flac = { size: (0, index_1.sizeFormate)(item.sq.size) };
                }
                if (item.hr?.size) {
                    types.push({ type: 'flac24bit', size: (0, index_1.sizeFormate)(item.hr.size) });
                    _types.flac24bit = { size: (0, index_1.sizeFormate)(item.hr.size) };
                }
                return {
                    singer: this.getSinger(item.ar),
                    singerIds: item.ar ? item.ar.map(a => a.id).join(',') : '',
                    name: item.name,
                    albumName: item.al?.name || album.name || '',
                    albumId: String(item.al?.id || album.id || albumId),
                    source: 'wy',
                    interval: (0, index_1.formatPlayTime)((item.dt || 0) / 1000),
                    songmid: item.id,
                    img: item.al?.picUrl || album.picUrl || '',
                    lrc: null,
                    types, _types,
                    typeUrl: {},
                };
            }).filter(Boolean);
            return {
                list,
                info: {
                    name: album.name || '',
                    singer: (0, utils_1.formatSingerName)(album.artists, 'name'),
                    img: album.picUrl || '',
                    count: list.length,
                },
                source: 'wy',
            };
        });
    },
    search(str, page = 1, limit, type = 'song', retryNum = 0) {
        if (++retryNum > 3)
            return Promise.reject(new Error('try max num'));
        if (limit == null)
            limit = this.limit;
        if (type === 'album')
            return this.searchAlbum(str, page, limit);
        if (type === 'singer')
            return this.searchSinger(str, page, limit);
        // 默认歌曲搜索
        return this.musicSearch(str, page, limit).then(result => {
            if (!result || result.code !== 200)
                return this.search(str, page, limit, type, retryNum);
            let list = this.handleResult(result.data.resources || []);
            if (list == null)
                return this.search(str, page, limit, type, retryNum);
            this.total = result.data.totalCount || 0;
            this.page = page;
            this.allPage = Math.ceil(this.total / this.limit);
            return {
                list,
                allPage: this.allPage,
                limit: this.limit,
                total: this.total,
                source: 'wy',
            };
        });
    },
};
