"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const request_1 = require("../../request");
exports.default = {
    getPic({ songmid }) {
        const requestObj = (0, request_1.httpFetch)(`http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${songmid}`);
        requestObj.promise = requestObj.promise.then(({ body }) => /^http/.test(body) ? body : null);
        return requestObj.promise;
    },
};
