"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUploadBackup = exports.handleDownloadBackup = exports.broadcastToSSEClients = exports.getSSEClients = exports.handleProgressSSE = exports.handleGetLogs = exports.handleRestore = exports.handleSyncAllFiles = exports.handleBackup = exports.handleSyncFile = exports.handleTestConnection = void 0;
const node_os_1 = __importDefault(require("node:os"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const formidable_1 = __importDefault(require("formidable"));
const commonUtils_1 = require("./commonUtils");
/** SSE客户端集合 */
const sseClients = new Set();
/**
 * 检查前端认证
 */
const checkFrontendAuth = (req, res) => {
    const auth = req.headers['x-frontend-auth'];
    if (auth !== global.lx.config['frontend.password']) {
        res.writeHead(401);
        res.end('Unauthorized');
        return false;
    }
    return true;
};
/**
 * 测试WebDAV连接
 * POST /api/webdav/test
 */
const handleTestConnection = (req, res) => {
    if (!checkFrontendAuth(req, res))
        return;
    const webdavSync = global.lx.webdavSync;
    if (!webdavSync) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }));
        return;
    }
    void webdavSync.testConnection().then((result) => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, result);
    });
};
exports.handleTestConnection = handleTestConnection;
/**
 * WebDAV文件同步(上传/下载)
 * POST /api/webdav/sync-file
 */
const handleSyncFile = (req, res) => {
    if (!checkFrontendAuth(req, res))
        return;
    void (0, commonUtils_1.readBodySafe)(req, res).then(async (body) => {
        if (!body)
            return;
        await (0, commonUtils_1.safeAsync)(res, async () => {
            const { action, path: filePath } = body;
            const webdavSync = global.lx.webdavSync;
            if (!webdavSync)
                throw new Error('WebDAV not initialized');
            let success = false;
            if (action === 'upload') {
                success = await webdavSync.uploadFile(filePath);
            }
            else if (action === 'download') {
                success = await webdavSync.downloadFile(filePath);
            }
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success });
        }, 'WebDAV Sync File');
    });
};
exports.handleSyncFile = handleSyncFile;
/**
 * WebDAV备份上传
 * POST /api/webdav/backup
 */
const handleBackup = (req, res) => {
    if (!checkFrontendAuth(req, res))
        return;
    const webdavSync = global.lx.webdavSync;
    if (!webdavSync) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }));
        return;
    }
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        const { force } = body;
        void webdavSync.uploadBackup(force).then((success) => {
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success });
        });
    });
};
exports.handleBackup = handleBackup;
/**
 * WebDAV全量文件同步
 * POST /api/webdav/sync
 */
const handleSyncAllFiles = (req, res) => {
    if (!checkFrontendAuth(req, res))
        return;
    const webdavSync = global.lx.webdavSync;
    if (!webdavSync) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }));
        return;
    }
    void webdavSync.syncAllFiles().then((success) => {
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success });
    });
};
exports.handleSyncAllFiles = handleSyncAllFiles;
/**
 * WebDAV恢复(从远程恢复备份)
 * POST /api/webdav/restore
 */
const handleRestore = (req, res) => {
    if (!checkFrontendAuth(req, res))
        return;
    const webdavSync = global.lx.webdavSync;
    if (!webdavSync) {
        res.writeHead(500);
        res.end(JSON.stringify({ success: false, message: 'WebDAV not initialized' }));
        return;
    }
    const reloadServerData = global.reloadServerData;
    void webdavSync.restoreFromRemote().then(async (success) => {
        if (success && reloadServerData) {
            await reloadServerData();
        }
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success });
    });
};
exports.handleRestore = handleRestore;
/**
 * 获取WebDAV同步日志
 * GET /api/webdav/logs
 */
const handleGetLogs = (req, res) => {
    if (!checkFrontendAuth(req, res))
        return;
    const webdavSync = global.lx.webdavSync;
    if (!webdavSync) {
        res.writeHead(404);
        res.end(JSON.stringify({ logs: [] }));
        return;
    }
    const logs = webdavSync.getSyncLogs();
    res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.end(JSON.stringify({ logs }));
};
exports.handleGetLogs = handleGetLogs;
/**
 * WebDAV同步进度SSE推送
 * GET /api/webdav/progress
 */
const handleProgressSSE = (req, res) => {
    const auth = req.headers['x-frontend-auth'] ||
        new URL(req.url, `http://${req.headers.host}`).searchParams.get('auth');
    if (auth !== global.lx.config['frontend.password']) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
    });
    res.write('retry: 10000\\n\\n');
    const client = res;
    sseClients.add(client);
    req.on('close', () => {
        sseClients.delete(client);
    });
};
exports.handleProgressSSE = handleProgressSSE;
/**
 * 获取SSE客户端集合(用于推送进度)
 */
const getSSEClients = () => {
    return sseClients;
};
exports.getSSEClients = getSSEClients;
/**
 * 广播消息到所有SSE客户端
 */
const broadcastToSSEClients = (data) => {
    const sseMsg = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        client.write(sseMsg);
    }
};
exports.broadcastToSSEClients = broadcastToSSEClients;
/**
 * 下载本地备份文件
 * GET /api/backup/download
 */
const handleDownloadBackup = (req, res, urlObj) => {
    const auth = req.headers['x-frontend-auth'] || urlObj.searchParams.get('auth');
    if (auth !== global.lx.config['frontend.password']) {
        res.writeHead(401);
        res.end('Unauthorized');
        return;
    }
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const webdavSync = global.lx.webdavSync;
        if (!webdavSync)
            throw new Error('Backup system not initialized');
        const zipName = await webdavSync.createBackup();
        if (!zipName)
            throw new Error('Backup creation failed');
        const zipPath = node_path_1.default.join(global.lx.dataPath, zipName);
        if (!node_fs_1.default.existsSync(zipPath))
            throw new Error('ZIP file not found');
        res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="${zipName}"`,
        });
        const readStream = node_fs_1.default.createReadStream(zipPath);
        readStream.pipe(res);
        readStream.on('finish', () => {
            // 延时删除本地临时ZIP文件
            setTimeout(() => {
                if (node_fs_1.default.existsSync(zipPath))
                    node_fs_1.default.unlinkSync(zipPath);
            }, 5000);
        });
    }, 'Backup Download');
};
exports.handleDownloadBackup = handleDownloadBackup;
/**
 * 从本地ZIP文件恢复备份
 * POST /api/backup/upload
 */
const handleUploadBackup = (req, res) => {
    if (!checkFrontendAuth(req, res))
        return;
    const form = (0, formidable_1.default)({ multiples: false, uploadDir: node_os_1.default.tmpdir() });
    form.parse(req, async (err, fields, files) => {
        if (err) {
            res.writeHead(500);
            res.end('Upload failed: ' + err.message);
            return;
        }
        // formidable v3 字段返回可能是数组
        let file = files.backup || files.file || Object.values(files)[0];
        if (Array.isArray(file))
            file = file[0];
        if (!file || !file.filepath) {
            res.writeHead(400);
            res.end('No ZIP file uploaded');
            return;
        }
        try {
            const webdavSync = global.lx.webdavSync;
            if (!webdavSync)
                throw new Error('Restore system not initialized');
            await webdavSync.extractZip(file.filepath, global.lx.dataPath);
            // 删除临时上传的文件
            if (node_fs_1.default.existsSync(file.filepath))
                node_fs_1.default.unlinkSync(file.filepath);
            // 还原后自动触发重载
            const reloadServerData = global.reloadServerData;
            if (reloadServerData) {
                await reloadServerData();
            }
            (0, commonUtils_1.sendJsonResponse)(res, 200, { success: true, message: 'Restore from local ZIP success and reloaded' });
        }
        catch (restoreErr) {
            console.error('Local Restore Error:', restoreErr);
            res.writeHead(500);
            res.end('Restore failed: ' + restoreErr.message);
        }
    });
};
exports.handleUploadBackup = handleUploadBackup;
