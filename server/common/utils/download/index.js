"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDownload = void 0;
const Downloader_1 = __importDefault(require("./Downloader"));
const util_1 = require("./util");
const index_1 = require("../index");
const noop = () => { };
const createDownload = ({ url, path, fileName, method = 'get', forceResume, proxy, 
// resumeTime = 5000,
onCompleted = noop, onError = noop, onFail = noop, onStart = noop, onStop = noop, onProgress = noop, }) => {
    const dl = new Downloader_1.default(url, path, fileName, {
        requestOptions: {
            method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
            },
            agent: (0, util_1.getRequestAgent)(url, proxy),
            timeout: 60 * 1000,
        },
        forceResume,
    });
    dl.on('completed', () => {
        onCompleted();
    }).on('error', (err) => {
        if (err.message === 'socket hang up')
            return;
        onError(err);
    }).on('start', () => {
        onStart();
        // pauseResumeTimer(dl, resumeTime)
    }).on('progress', (stats) => {
        const speed = (0, index_1.sizeFormate)(stats.speed);
        onProgress({
            progress: parseInt(stats.progress.toFixed(2)),
            speed,
            downloaded: stats.downloaded,
            total: stats.total,
            writeQueue: stats.writeQueue,
        });
        // if (debugDownload) {
        //   const downloaded = sizeFormate(stats.downloaded)
        //   const total = sizeFormate(stats.total)
        //   console.log(`${speed}/s - ${progress}% [${downloaded}/${total}]`)
        // }
    }).on('stop', () => {
        onStop();
        // debugDownload && console.log('paused')
    }).on('fail', resp => {
        onFail(resp);
        // debugDownload && console.log('fail')
    });
    // debugDownload && console.log('Downloading: ', url)
    dl.start().catch(err => {
        onError(err);
    });
    return dl;
};
exports.createDownload = createDownload;
