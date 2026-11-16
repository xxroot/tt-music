"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRequestAgent = exports.STATUS = void 0;
const tunnel_1 = require("tunnel");
exports.STATUS = {
    idle: 'IDLE',
    init: 'INIT',
    running: 'RUNNING',
    paused: 'PAUSED',
    stopped: 'STOPPED',
    completed: 'COMPLETED',
    error: 'ERROR',
    failed: 'FAILED',
};
const httpsRxp = /^https:/;
const getRequestAgent = (url, proxy) => {
    let options;
    if (proxy) {
        options = {
            proxy: {
                host: proxy.host,
                port: proxy.port,
            },
        };
    }
    return options ? (httpsRxp.test(url) ? tunnel_1.httpsOverHttp : tunnel_1.httpOverHttp)(options) : undefined;
};
exports.getRequestAgent = getRequestAgent;
