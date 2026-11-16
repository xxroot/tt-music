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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = exports.getPlatform = exports.isProd = exports.isMac = exports.isWin = exports.isLinux = void 0;
exports.compareVer = compareVer;
const log = {
    info: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    verbose: console.log,
};
exports.log = log;
exports.isLinux = process.platform == 'linux';
exports.isWin = process.platform == 'win32';
exports.isMac = process.platform == 'darwin';
exports.isProd = process.env.NODE_ENV == 'production';
const getPlatform = (platform = process.platform) => {
    switch (platform) {
        case 'win32': return 'windows';
        case 'darwin': return 'mac';
        default: return 'linux';
    }
};
exports.getPlatform = getPlatform;
// https://stackoverflow.com/a/53387532
function compareVer(currentVer, targetVer) {
    // treat non-numerical characters as lower version
    // replacing them with a negative number based on charcode of each character
    const fix = (s) => `.${s.toLowerCase().charCodeAt(0) - 2147483647}.`;
    const currentVerArr = ('' + currentVer).replace(/[^0-9.]/g, fix).split('.');
    const targetVerArr = ('' + targetVer).replace(/[^0-9.]/g, fix).split('.');
    let c = Math.max(currentVerArr.length, targetVerArr.length);
    for (let i = 0; i < c; i++) {
        // convert to integer the most efficient way
        currentVerArr[i] = ~~currentVerArr[i];
        targetVerArr[i] = ~~targetVerArr[i];
        if (currentVerArr[i] > targetVerArr[i])
            return 1;
        else if (currentVerArr[i] < targetVerArr[i])
            return -1;
    }
    return 0;
}
__exportStar(require("./common"), exports);
