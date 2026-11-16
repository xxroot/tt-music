"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
const crypto_1 = require("./utils/crypto");
const index_1 = require("../../index");
// https://github.com/Binaryify/NeteaseCloudMusicApi/blob/master/module/song_detail.js
exports.default = {
    getSinger(singers) {
        let arr = [];
        // console.log(singers)
        singers?.forEach(singer => {
            arr.push(singer.name);
        });
        return arr.join('、');
    },
    filterList({ songs, privileges }) {
        // console.log(songs, privileges)
        const list = [];
        songs.forEach((item, index) => {
            const types = [];
            const _types = {};
            let size;
            let privilege = privileges[index];
            if (privilege.id !== item.id)
                privilege = privileges.find(p => p.id === item.id);
            if (!privilege)
                return;
            if (privilege.maxBrLevel === 'hires') {
                size = item.hr ? (0, index_1.sizeFormate)(item.hr.size) : null;
                types.push({ type: 'flac24bit', size });
                _types.flac24bit = {
                    size,
                };
            }
            switch (privilege.maxbr) {
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
            // console.log('wy====>',item)
            if (item.pc) {
                list.push({
                    singer: item.pc.ar ?? '',
                    singers: item.pc.ar,
                    name: item.pc.sn ?? '',
                    albumName: item.pc.alb ?? '',
                    albumId: item.al?.id,
                    source: 'wy',
                    interval: (0, index_1.formatPlayTime)(item.dt / 1000),
                    songmid: item.id,
                    img: item.al?.picUrl ?? '',
                    lrc: null,
                    otherSource: null,
                    types,
                    _types,
                    typeUrl: {},
                });
            }
            else {
                list.push({
                    singer: this.getSinger(item.ar),
                    // [ { id: 1007135, name: '陈小虎', tns: [], alias: [] } ]
                    singers: item.ar,
                    name: item.name ?? '',
                    albumName: item.al?.name,
                    albumId: item.al?.id,
                    source: 'wy',
                    interval: (0, index_1.formatPlayTime)(item.dt / 1000),
                    songmid: item.id,
                    img: item.al?.picUrl,
                    lrc: null,
                    otherSource: null,
                    types,
                    _types,
                    typeUrl: {},
                });
            }
        });
        // console.log(list)
        return list;
    },
    async getList(ids = [], retryNum = 0) {
        if (retryNum > 2)
            return Promise.reject(new Error('try max num'));
        const requestObj = (0, request_1.httpFetch)('https://music.163.com/weapi/v3/song/detail', {
            method: 'post',
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
                origin: 'https://music.163.com',
            },
            form: (0, crypto_1.weapi)({
                c: '[' + ids.map(id => ('{"id":' + id + '}')).join(',') + ']',
                ids: '[' + ids.join(',') + ']',
            }),
        });
        const { body, statusCode } = await requestObj.promise;
        if (statusCode !== 200 || body.code !== 200)
            throw new Error('获取歌曲详情失败');
        // console.log(body)
        return { source: 'wy', list: this.filterList(body) };
    },
};
