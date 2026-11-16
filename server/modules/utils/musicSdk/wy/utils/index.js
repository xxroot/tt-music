"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.weapiRequest = exports.eapiRequest = void 0;
const request_1 = require("../../../request");
const crypto_1 = require("./crypto");
const eapiRequest = (url, data) => {
    return (0, request_1.httpFetch)('http://interface.music.163.com/eapi/batch', {
        method: 'post',
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
            origin: 'https://music.163.com',
        },
        form: (0, crypto_1.eapi)(url, data),
    });
};
exports.eapiRequest = eapiRequest;
// weapi 请求（用于歌手详情/歌曲/专辑等接口）
const weapiRequest = (url, data) => {
    return (0, request_1.httpFetch)(`https://music.163.com/weapi${url}`, {
        method: 'post',
        headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.90 Safari/537.36',
            origin: 'https://music.163.com',
            referer: 'https://music.163.com',
        },
        form: (0, crypto_1.weapi)(data),
    });
};
exports.weapiRequest = weapiRequest;
