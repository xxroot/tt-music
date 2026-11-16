"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const index_1 = require("../../index");
const utils_1 = require("../utils");
// type 值	搜索类型	说明
// 1	歌曲	默认值，搜索单曲
// 2	专辑	搜索专辑
// 3	歌手	搜索歌手 / 艺人
// 4	歌单	搜索歌单 /playlist
// 5	歌词	按歌词内容搜索
// 6	MV	搜索音乐视频
// 7	用户	搜索酷狗用户
// 8	电台	搜索电台节目
// 9	场景音乐	场景化音乐搜索
// 10	KTV	KTV 歌曲搜索
// 新版URL：https://complexsearch.kugou.com/v2/search/song
exports.default = {
    limit: 30,
    total: 0,
    page: 0,
    allPage: 1,
    musicSearch(str, page, limit) {
        const searchRequest = (0, request_1.httpFetch)(`https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(str)}&page=${page}&pagesize=${limit}&userid=0&clientver=&platform=WebFilter&filter=2&iscorrection=1&privilege_filter=0&area_code=1`);
        return searchRequest.promise.then(({ body }) => body);
    },
    filterData(rawData) {
        const types = [];
        const _types = {};
        if (rawData.FileSize !== 0) {
            let size = (0, index_1.sizeFormate)(rawData.FileSize);
            types.push({ type: '128k', size, hash: rawData.FileHash });
            _types['128k'] = {
                size,
                hash: rawData.FileHash,
            };
        }
        if (rawData.HQFileSize !== 0) {
            let size = (0, index_1.sizeFormate)(rawData.HQFileSize);
            types.push({ type: '320k', size, hash: rawData.HQFileHash });
            _types['320k'] = {
                size,
                hash: rawData.HQFileHash,
            };
        }
        if (rawData.SQFileSize !== 0) {
            let size = (0, index_1.sizeFormate)(rawData.SQFileSize);
            types.push({ type: 'flac', size, hash: rawData.SQFileHash });
            _types.flac = {
                size,
                hash: rawData.SQFileHash,
            };
        }
        if (rawData.ResFileSize !== 0) {
            let size = (0, index_1.sizeFormate)(rawData.ResFileSize);
            types.push({ type: 'flac24bit', size, hash: rawData.ResFileHash });
            _types.flac24bit = {
                size,
                hash: rawData.ResFileHash,
            };
        }
        // console.log("kg-搜索===》",rawData)
        return {
            singer: (0, index_1.decodeName)((0, utils_1.formatSingerName)(rawData.Singers, 'name')),
            singers: rawData.Singers,
            name: (0, index_1.decodeName)(rawData.SongName),
            albumName: (0, index_1.decodeName)(rawData.AlbumName),
            albumId: rawData.AlbumID,
            songmid: rawData.Audioid,
            source: 'kg',
            interval: (0, index_1.formatPlayTime)(rawData.Duration),
            _interval: rawData.Duration,
            img: rawData.Image ? rawData.Image.replace('{size}', '600') : (rawData.trans_param?.union_cover?.replace('{size}', '600') || null),
            lrc: null,
            otherSource: null,
            hash: rawData.FileHash,
            types,
            _types,
            typeUrl: {},
        };
    },
    handleResult(rawData) {
        let ids = new Set();
        const list = [];
        rawData.forEach(item => {
            const key = item.Audioid + item.FileHash;
            if (ids.has(key))
                return;
            ids.add(key);
            list.push(this.filterData(item));
            for (const childItem of item.Grp) {
                const key = item.Audioid + item.FileHash;
                if (ids.has(key))
                    continue;
                ids.add(key);
                list.push(this.filterData(childItem));
            }
        });
        return list;
    },
    search(str, page = 1, limit, retryNum = 0) {
        if (++retryNum > 3)
            return Promise.reject(new Error('try max num'));
        if (limit == null)
            limit = this.limit;
        // http://newlyric.kuwo.cn/newlyric.lrc?62355680
        return this.musicSearch(str, page, limit).then(result => {
            if (!result || result.error_code !== 0)
                return this.search(str, page, limit, retryNum);
            let list = this.handleResult(result.data.lists);
            if (list == null)
                return this.search(str, page, limit, retryNum);
            this.total = result.data.total;
            this.page = page;
            this.allPage = Math.ceil(this.total / limit);
            return Promise.resolve({
                list,
                allPage: this.allPage,
                limit,
                total: this.total,
                source: 'kg',
            });
        });
    },
};
