"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAddress = exports.moveFile = exports.copyFile = exports.b64DecodeUnicode = exports.saveStrToFile = exports.readLxConfigFile = exports.saveLxConfigFile = exports.gunzipData = exports.gzipData = exports.toMD5 = exports.readFile = exports.removeFile = exports.createDir = exports.getFileStats = exports.checkAndCreateDir = exports.checkPath = exports.dirname = exports.basename = exports.extname = exports.joinPath = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_zlib_1 = require("node:zlib");
const node_path_1 = __importDefault(require("node:path"));
const node_os_1 = require("node:os");
const index_1 = require("./index");
const joinPath = (...paths) => node_path_1.default.join(...paths);
exports.joinPath = joinPath;
const extname = (p) => node_path_1.default.extname(p);
exports.extname = extname;
const basename = (p, ext) => node_path_1.default.basename(p, ext);
exports.basename = basename;
const dirname = (p) => node_path_1.default.dirname(p);
exports.dirname = dirname;
/**
 * 检查路径是否存在
 * @param {*} path 路径
 */
const checkPath = async (path) => {
    return new Promise(resolve => {
        if (!path) {
            resolve(false);
            return;
        }
        node_fs_1.default.access(path, node_fs_1.default.constants.F_OK, err => {
            if (err) {
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
};
exports.checkPath = checkPath;
/**
 * 检查路径并创建目录
 * @param path
 * @returns
 */
const checkAndCreateDir = async (path) => {
    return node_fs_1.default.promises.access(path, node_fs_1.default.constants.F_OK | node_fs_1.default.constants.W_OK)
        .catch(async (err) => {
        if (err.code != 'ENOENT')
            throw err;
        return node_fs_1.default.promises.mkdir(path, { recursive: true });
    })
        .then(() => true)
        .catch((err) => {
        console.error(err);
        return false;
    });
};
exports.checkAndCreateDir = checkAndCreateDir;
const getFileStats = async (path) => {
    return new Promise(resolve => {
        if (!path) {
            resolve(null);
            return;
        }
        node_fs_1.default.stat(path, (err, stats) => {
            if (err) {
                resolve(null);
                return;
            }
            resolve(stats);
        });
    });
};
exports.getFileStats = getFileStats;
/**
 * 检查路径并创建目录
 * @param path
 * @returns
 */
const createDir = async (path) => new Promise((resolve, reject) => {
    node_fs_1.default.access(path, node_fs_1.default.constants.F_OK | node_fs_1.default.constants.W_OK, err => {
        if (err) {
            if (err.code === 'ENOENT') {
                node_fs_1.default.mkdir(path, { recursive: true }, err => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve();
                });
                return;
            }
            reject(err);
            return;
        }
        resolve();
    });
});
exports.createDir = createDir;
const removeFile = async (path) => new Promise((resolve, reject) => {
    node_fs_1.default.access(path, node_fs_1.default.constants.F_OK, err => {
        if (err) {
            err.code == 'ENOENT' ? resolve() : reject(err);
            return;
        }
        node_fs_1.default.unlink(path, err => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
});
exports.removeFile = removeFile;
const readFile = async (path) => node_fs_1.default.promises.readFile(path);
exports.readFile = readFile;
/**
 * 创建 MD5 hash
 * @param {*} str
 */
const toMD5 = (str) => node_crypto_1.default.createHash('md5').update(str).digest('hex');
exports.toMD5 = toMD5;
// Fix gzipData missing
const gzipData = async (str) => {
    return new Promise((resolve, reject) => {
        (0, node_zlib_1.gzip)(str, (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(result);
        });
    });
};
exports.gzipData = gzipData;
const gunzipData = async (buf) => {
    return new Promise((resolve, reject) => {
        (0, node_zlib_1.gunzip)(buf, (err, result) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(result.toString());
        });
    });
};
exports.gunzipData = gunzipData;
/**
 * 保存lx配置文件
 * @param path 保存路径
 * @param data 数据
 */
const saveLxConfigFile = async (path, data) => {
    if (!path.endsWith('.lxmc'))
        path += '.lxmc';
    node_fs_1.default.writeFile(path, await (0, exports.gzipData)(JSON.stringify(data)), 'binary', err => {
        console.log(err);
    });
};
exports.saveLxConfigFile = saveLxConfigFile;
/**
 * 读取lx配置文件
 * @param path 文件路径
 * @returns 数据
 */
const readLxConfigFile = async (path) => {
    let isJSON = path.endsWith('.json');
    let data = await node_fs_1.default.promises.readFile(path, isJSON ? 'utf8' : 'binary');
    if (!data)
        return data;
    if (!isJSON)
        data = await (0, exports.gunzipData)(Buffer.from(data, 'binary'));
    data = JSON.parse(data);
    // 修复v1.14.0出现的导出数据被序列化两次的问题
    if (typeof data != 'object') {
        try {
            data = JSON.parse(data);
        }
        catch (err) {
            return data;
        }
    }
    return data;
};
exports.readLxConfigFile = readLxConfigFile;
const saveStrToFile = async (path, str) => {
    await new Promise((resolve, reject) => {
        node_fs_1.default.writeFile(path, str, err => {
            if (err) {
                index_1.log.error(err);
                reject(err);
                return;
            }
            resolve();
        });
    });
};
exports.saveStrToFile = saveStrToFile;
const b64DecodeUnicode = (str) => {
    // Going backwards: from bytestream, to percent-encoding, to original string.
    // return decodeURIComponent(window.atob(str).split('').map(function(c) {
    //   return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
    // }).join(''))
    return Buffer.from(str, 'base64').toString();
};
exports.b64DecodeUnicode = b64DecodeUnicode;
const copyFile = async (sourcePath, distPath) => {
    return node_fs_1.default.promises.copyFile(sourcePath, distPath);
};
exports.copyFile = copyFile;
const moveFile = async (sourcePath, distPath) => {
    return node_fs_1.default.promises.rename(sourcePath, distPath);
};
exports.moveFile = moveFile;
const getAddress = () => {
    const nets = (0, node_os_1.networkInterfaces)();
    const results = [];
    // console.log(nets)
    for (const interfaceInfos of Object.values(nets)) {
        if (!interfaceInfos)
            continue;
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        for (const interfaceInfo of interfaceInfos) {
            if (interfaceInfo.family === 'IPv4' && !interfaceInfo.internal) {
                results.push(interfaceInfo.address);
            }
        }
    }
    return results;
};
exports.getAddress = getAddress;
