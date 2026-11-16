"use strict";
/**
 * 电台 API 模块 (Radio Station API Module)
 * 处理电台 CRUD、M3U 导入、分组管理、收藏、封面上传等功能
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRequest = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const formidable_1 = __importDefault(require("formidable"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../utils/db");
// ==================== 辅助函数 ====================
/** 读取请求体 */
const readBody = (req) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
};
/** 发送 JSON 响应 */
const sendJson = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};
/** 从 URL 路径中提取资源 ID */
const extractId = (pathname, prefix) => {
    const segment = pathname.replace(prefix, '').split('/')[0];
    const id = parseInt(segment, 10);
    return isNaN(id) ? null : id;
};
/** 获取封面存储目录 */
const getCoverDir = () => {
    const dataDir = node_path_1.default.resolve(process.cwd(), 'data', 'radio-covers');
    if (!node_fs_1.default.existsSync(dataDir)) {
        node_fs_1.default.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
};
/**
 * 解析 M3U/M3U8 文件内容
 */
const parseM3U = (content) => {
    const lines = content.split(/\r?\n/);
    const stations = [];
    let currentInfo = null;
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '#EXTM3U' || trimmed === '')
            continue;
        if (trimmed.startsWith('#EXTINF:')) {
            currentInfo = {};
            // 提取属性 (tvg-name="xxx" 等)
            const attrRegex = /([\w-]+)="([^"]*)"/g;
            let match;
            while ((match = attrRegex.exec(trimmed)) !== null) {
                const key = match[1];
                const val = match[2];
                switch (key) {
                    case 'tvg-name':
                        currentInfo.name = val;
                        break;
                    case 'group-title':
                        currentInfo.group_name = val;
                        break;
                    case 'tvg-genre':
                        currentInfo.genres = val;
                        break;
                    case 'tvg-country':
                        currentInfo.country = val;
                        break;
                    case 'tvg-language':
                        currentInfo.language = val;
                        break;
                    case 'tvg-region':
                        currentInfo.region = val;
                        break;
                    case 'tvg-city':
                        currentInfo.city = val;
                        break;
                    case 'tvg-type':
                        currentInfo.station_type = val;
                        break;
                    case 'tvg-logo':
                        currentInfo.logo = val;
                        break;
                }
            }
            // 提取逗号后的显示名
            const commaIdx = trimmed.lastIndexOf(',');
            if (commaIdx !== -1) {
                const displayName = trimmed.substring(commaIdx + 1).trim();
                if (!currentInfo.name)
                    currentInfo.name = displayName;
            }
        }
        else if (!trimmed.startsWith('#')) {
            // URL 行
            const url = trimmed;
            if (url.startsWith('http://') || url.startsWith('https://')) {
                const name = currentInfo?.name || url.split('/').pop() || url;
                stations.push({
                    name,
                    url,
                    group_name: currentInfo?.group_name || '默认分组',
                    genres: currentInfo?.genres || '',
                    country: currentInfo?.country || '',
                    region: currentInfo?.region || '',
                    city: currentInfo?.city || '',
                    language: currentInfo?.language || '',
                    station_type: currentInfo?.station_type || '',
                    logo: currentInfo?.logo || '',
                });
            }
            currentInfo = null;
        }
    }
    return stations;
};
// ==================== 统一请求入口 ====================
/**
 * 处理所有 /api/radio/* 请求的统一入口
 */
const handleRequest = async (req, res, urlObj, pathname, _username) => {
    const method = req.method || 'GET';
    try {
        // ===== GET /api/radio/stations =====
        if (pathname === '/api/radio/stations' && method === 'GET') {
            const stations = (0, db_1.getAllStations)();
            sendJson(res, 200, { success: true, data: stations });
            return;
        }
        // ===== POST /api/radio/stations =====
        if (pathname === '/api/radio/stations' && method === 'POST') {
            const body = await readBody(req);
            console.log('[Radio] POST /api/radio/stations body:', body.substring(0, 300));
            const data = JSON.parse(body);
            console.log('[Radio] Parsed data:', JSON.stringify(data));
            if (!data.name || !data.url) {
                console.warn('[Radio] Missing required fields: name or url');
                sendJson(res, 400, { success: false, message: '名称和地址为必填' });
                return;
            }
            const station = (0, db_1.addStation)(data);
            if (station) {
                console.log('[Radio] Station added:', station.id, station.name);
                sendJson(res, 200, { success: true, data: station });
            }
            else {
                console.error('[Radio] addStation returned null for:', data.name);
                sendJson(res, 500, { success: false, message: '添加失败' });
            }
            return;
        }
        // ===== PUT /api/radio/stations/:id =====
        if (pathname.startsWith('/api/radio/stations/') && method === 'PUT') {
            const afterStations = '/api/radio/stations/';
            const rest = pathname.substring(afterStations.length);
            // PUT /api/radio/stations/:id/favorite
            if (rest.endsWith('/favorite')) {
                const idStr = rest.replace('/favorite', '');
                const id = parseInt(idStr, 10);
                if (isNaN(id)) {
                    sendJson(res, 400, { success: false, message: '无效的 ID' });
                    return;
                }
                const newStatus = (0, db_1.toggleFavorite)(id);
                sendJson(res, 200, { success: true, data: { is_favorite: newStatus } });
                return;
            }
            // PUT /api/radio/stations/:id/status
            if (rest.endsWith('/status')) {
                const idStr = rest.replace('/status', '');
                const id = parseInt(idStr, 10);
                if (isNaN(id)) {
                    sendJson(res, 400, { success: false, message: '无效的 ID' });
                    return;
                }
                const body = await readBody(req);
                const { status } = JSON.parse(body);
                if (!status) {
                    sendJson(res, 400, { success: false, message: '状态为必填' });
                    return;
                }
                const ok = (0, db_1.updatePlayStatus)(id, status);
                sendJson(res, 200, { success: ok });
                return;
            }
            // PUT /api/radio/stations/:id (更新电台)
            const id = parseInt(rest, 10);
            if (isNaN(id)) {
                sendJson(res, 400, { success: false, message: '无效的 ID' });
                return;
            }
            const body = await readBody(req);
            const fields = JSON.parse(body);
            const ok = (0, db_1.updateStation)(id, fields);
            sendJson(res, 200, { success: ok });
            return;
        }
        // ===== DELETE /api/radio/stations/:id =====
        if (pathname.startsWith('/api/radio/stations/') && method === 'DELETE') {
            const id = extractId(pathname, '/api/radio/stations/');
            if (id === null) {
                sendJson(res, 400, { success: false, message: '无效的 ID' });
                return;
            }
            const ok = (0, db_1.deleteStation)(id);
            sendJson(res, 200, { success: ok });
            return;
        }
        // ===== POST /api/radio/import-json (JSON 导入) =====
        if (pathname === '/api/radio/import-json' && method === 'POST') {
            try {
                const body = await readBody(req);
                const { stations } = JSON.parse(body);
                if (!Array.isArray(stations) || stations.length === 0) {
                    sendJson(res, 400, { success: false, message: 'stations 必须是非空数组' });
                    return;
                }
                // 验证必填字段
                for (let i = 0; i < stations.length; i++) {
                    const s = stations[i];
                    if (!s.name || !s.url) {
                        sendJson(res, 400, { success: false, message: `第 ${i + 1} 条记录缺少必填字段 name 或 url` });
                        return;
                    }
                }
                const result = (0, db_1.batchAddStations)(stations);
                console.log(`[Radio] JSON import: ${result.inserted} inserted, ${result.updated} updated, ${result.errors} errors`);
                sendJson(res, 200, {
                    success: true,
                    data: {
                        total: stations.length,
                        inserted: result.inserted,
                        updated: result.updated,
                        errors: result.errors,
                    }
                });
            }
            catch (e) {
                console.error('[Radio] JSON import failed:', e.message);
                sendJson(res, 500, { success: false, message: '导入失败: ' + e.message });
            }
            return;
        }
        // ===== POST /api/radio/import (M3U 导入) =====
        if (pathname === '/api/radio/import' && method === 'POST') {
            const form = (0, formidable_1.default)({
                multiples: false,
                uploadDir: require('os').tmpdir(),
                maxFileSize: 10 * 1024 * 1024,
            });
            form.parse(req, async (err, fields, files) => {
                if (err) {
                    sendJson(res, 500, { success: false, message: '文件解析失败: ' + err.message });
                    return;
                }
                try {
                    // formidable v3: fields 值可能是数组
                    const groupName = Array.isArray(fields?.groupName) ? fields.groupName[0] : (fields?.groupName || '默认分组');
                    const rawFile = files?.file || Object.values(files || {})[0];
                    const file = Array.isArray(rawFile) ? rawFile[0] : rawFile;
                    if (!file) {
                        sendJson(res, 400, { success: false, message: '未找到上传文件' });
                        return;
                    }
                    const filePath = file.filepath || file.path;
                    const content = node_fs_1.default.readFileSync(filePath, 'utf-8');
                    const parsed = parseM3U(content);
                    if (parsed.length === 0) {
                        sendJson(res, 400, { success: false, message: 'M3U 文件中没有有效的电台' });
                        return;
                    }
                    // 如果指定了分组名，覆盖所有电台的分组
                    if (groupName && groupName !== '默认分组') {
                        parsed.forEach(s => { s.group_name = groupName; });
                    }
                    const result = (0, db_1.batchAddStations)(parsed);
                    console.log(`[Radio] M3U import: ${result.inserted} inserted, ${result.updated} updated, ${result.errors} errors`);
                    sendJson(res, 200, {
                        success: true,
                        data: {
                            total: parsed.length,
                            inserted: result.inserted,
                            updated: result.updated,
                            errors: result.errors,
                        }
                    });
                }
                catch (e) {
                    console.error('[Radio] M3U import failed:', e.message);
                    sendJson(res, 500, { success: false, message: '导入失败: ' + e.message });
                }
            });
            return;
        }
        // ===== GET /api/radio/groups =====
        if (pathname === '/api/radio/groups' && method === 'GET') {
            const groups = (0, db_1.getAllGroups)();
            sendJson(res, 200, { success: true, data: groups });
            return;
        }
        // ===== POST /api/radio/groups =====
        if (pathname === '/api/radio/groups' && method === 'POST') {
            const body = await readBody(req);
            const { name } = JSON.parse(body);
            if (!name) {
                sendJson(res, 400, { success: false, message: '分组名为必填' });
                return;
            }
            const group = (0, db_1.createGroup)(name);
            if (group) {
                sendJson(res, 200, { success: true, data: group });
            }
            else {
                sendJson(res, 500, { success: false, message: '创建分组失败' });
            }
            return;
        }
        // ===== PUT /api/radio/groups/:id/expand =====
        if (pathname.startsWith('/api/radio/groups/') && pathname.endsWith('/expand') && method === 'PUT') {
            const idStr = pathname.replace('/api/radio/groups/', '').replace('/expand', '');
            const id = parseInt(idStr, 10);
            if (isNaN(id)) {
                sendJson(res, 400, { success: false, message: '无效的 ID' });
                return;
            }
            const newStatus = (0, db_1.toggleGroupExpanded)(id);
            sendJson(res, 200, { success: true, data: { is_expanded: newStatus } });
            return;
        }
        // ===== GET /api/radio/favorites =====
        if (pathname === '/api/radio/favorites' && method === 'GET') {
            const favorites = (0, db_1.getFavoriteStations)();
            sendJson(res, 200, { success: true, data: favorites });
            return;
        }
        // ===== GET /api/radio/filter-options =====
        if (pathname === '/api/radio/filter-options' && method === 'GET') {
            const options = (0, db_1.getFilterOptions)();
            sendJson(res, 200, { success: true, data: options });
            return;
        }
        // ===== GET /api/radio/stations/filter =====
        if (pathname === '/api/radio/stations/filter' && method === 'GET') {
            const filters = {
                genres: urlObj.searchParams.get('genres') || undefined,
                country: urlObj.searchParams.get('country') || undefined,
                region: urlObj.searchParams.get('region') || undefined,
                city: urlObj.searchParams.get('city') || undefined,
                language: urlObj.searchParams.get('language') || undefined,
            };
            const stations = (0, db_1.filterStations)(filters);
            sendJson(res, 200, { success: true, data: stations });
            return;
        }
        // ===== POST /api/radio/cover-upload =====
        if (pathname === '/api/radio/cover-upload' && method === 'POST') {
            const form = (0, formidable_1.default)({
                multiples: false,
                uploadDir: getCoverDir(),
                maxFileSize: 5 * 1024 * 1024,
                keepExtensions: true,
            });
            form.parse(req, async (err, _fields, files) => {
                if (err) {
                    sendJson(res, 500, { success: false, message: '文件解析失败: ' + err.message });
                    return;
                }
                try {
                    const rawFile = files?.cover || files?.file || Object.values(files || {})[0];
                    const file = Array.isArray(rawFile) ? rawFile[0] : rawFile;
                    if (!file) {
                        sendJson(res, 400, { success: false, message: '未找到上传文件' });
                        return;
                    }
                    const originalPath = file.filepath || file.path;
                    const ext = node_path_1.default.extname(originalPath) || '.jpg';
                    const filename = `${node_crypto_1.default.randomUUID()}${ext}`;
                    const destPath = node_path_1.default.join(getCoverDir(), filename);
                    // 如果 formidable 没有保存到目标目录，手动移动
                    if (originalPath !== destPath) {
                        node_fs_1.default.renameSync(originalPath, destPath);
                    }
                    const coverUrl = `/api/radio/cover/${filename}`;
                    sendJson(res, 200, { success: true, data: { url: coverUrl, filename } });
                }
                catch (e) {
                    console.error('[Radio] Cover upload failed:', e.message);
                    sendJson(res, 500, { success: false, message: '封面上传失败: ' + e.message });
                }
            });
            return;
        }
        // ===== GET /api/radio/cover/:filename =====
        if (pathname.startsWith('/api/radio/cover/') && method === 'GET') {
            const filename = pathname.replace('/api/radio/cover/', '');
            // 防止路径穿越
            const safeFilename = node_path_1.default.basename(filename);
            const filePath = node_path_1.default.join(getCoverDir(), safeFilename);
            if (!node_fs_1.default.existsSync(filePath)) {
                res.writeHead(404);
                res.end('Not Found');
                return;
            }
            const ext = node_path_1.default.extname(safeFilename).toLowerCase();
            const mimeTypes = {
                '.jpg': 'image/jpeg',
                '.jpeg': 'image/jpeg',
                '.png': 'image/png',
                '.gif': 'image/gif',
                '.webp': 'image/webp',
                '.svg': 'image/svg+xml',
            };
            const contentType = mimeTypes[ext] || 'image/jpeg';
            const stream = node_fs_1.default.createReadStream(filePath);
            res.writeHead(200, {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400',
            });
            stream.pipe(res);
            return;
        }
        // 未匹配的路由
        sendJson(res, 404, { success: false, message: 'Radio API endpoint not found: ' + pathname });
    }
    catch (err) {
        console.error('[Radio] API error:', err.message, err.stack);
        sendJson(res, 500, { success: false, message: 'Internal server error: ' + err.message });
    }
};
exports.handleRequest = handleRequest;
