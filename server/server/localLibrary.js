"use strict";
/**
 * 本地库管理核心模块 (Local Library Core Module)
 * 提供配置读写、目录管理、扫描引擎、文件查找、封面选取等功能
 */
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
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUpdateScraping = exports.handleWatchDebounce = exports.handleWatchStatus = exports.handleWatchStop = exports.handleWatchStart = exports.handleGetSources = exports.handleScanErrors = exports.handleCancelScan = exports.handleScanStatus = exports.handleStartScan = exports.handleBrowse = exports.handleDeleteLibrary = exports.handleAddLibrary = exports.handleGetLibraryStatus = exports.handleGetLibraries = exports.broadcastScanProgress = exports.handleScanEvents = exports.findAlbumCoverForSong = exports.getLocalFileRecord = exports.resolveLocalFilePath = exports.buildLocalSongRecord = exports.extractDiscNumber = exports.extractTrackNumber = exports.extractSongName = exports.readAudioTags = exports.extractYear = exports.extractAlbum = exports.extractSinger = exports.generateSongId = exports.findAlbumCover = exports.browseDirectories = exports.getBrowseRoots = exports.removeLibrary = exports.addLibrary = exports.updateLibraryField = exports.getLocalLibraryStatus = exports.getLocalLibrarySources = exports.getLibraryByPath = exports.getLibraryByName = exports.getLibraryBySource = exports.getLibraryById = exports.saveLocalLibraries = exports.loadLocalLibraries = exports.isFileUnderScraping = exports.removeScrapingDirectory = exports.addScrapingDirectory = exports.invalidateAlbumCoverCache = exports.clearCoverCache = exports.IMAGE_EXTENSIONS = exports.LOCAL_AUDIO_EXTENSIONS = void 0;
exports.handleScanFolder = exports.startFolderScan = exports.handleFolderSongs = exports.getScanStatus = exports.cancelScan = exports.startScan = void 0;
const MusicTagUtil = __importStar(require("../utils/MusicTagUtil"));
const pathUtil_1 = require("../utils/pathUtil");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const db_core_1 = require("../utils/db-core");
const db_songs_1 = require("../utils/db-songs");
const commonUtils_1 = require("./commonUtils");
const fileCache_1 = require("./fileCache");
const acoustidFingerprint_1 = require("./localLib/acoustidFingerprint");
const acoustidLookup_1 = require("./localLib/acoustidLookup");
const acoustidTagWriter_1 = require("./localLib/acoustidTagWriter");
// ==================== 常量 ====================
/** 保留字: 不允许作为库名 */
const RESERVED_SOURCES = ['wy', 'qq', 'tx', 'kg', 'kw', 'mg', 'local', 'file', 'unknown'];
/** 本地库扫描支持的音频扩展名 */
exports.LOCAL_AUDIO_EXTENSIONS = [
    '.flac', '.wav', '.mp3', '.m4a', '.ogg', '.ape',
    '.wv', '.dsf', '.dff', '.aiff', '.aif', '.dts', '.iso', '.nrg', '.m3u'
];
/** 封面图片扩展名 */
exports.IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
/** 封面文件名优先级 (不区分大小写) */
const COVER_PRIORITY = {
    'cover': 1,
    'folder': 2,
    'front': 3,
    '封面': 4,
    'font': 5,
};
// ==================== 全局状态 ====================
/** 活跃扫描状态表 */
const activeScans = new Map();
/** SSE 客户端集合 (用于扫描进度推送) */
const scanSSEClients = new Set();
/** 封面查找结果缓存 (albumDir -> { coverFile, ts }) */
const coverCache = new Map();
const COVER_CACHE_TTL = 10 * 60 * 1000; // 10 分钟
/** 清空封面查找缓存 (图片变更后调用) */
const clearCoverCache = () => {
    coverCache.clear();
};
exports.clearCoverCache = clearCoverCache;
/** 失效指定专辑目录的封面缓存 (Watcher 图片变更时调用) */
const invalidateAlbumCoverCache = (albumDir) => {
    coverCache.delete(albumDir);
};
exports.invalidateAlbumCoverCache = invalidateAlbumCoverCache;
// ==================== 刮削白名单 (防止 watcher 递归触发) ====================
/** 正在刮削中的目录白名单 */
const scrapingDirectories = new Set();
/** 将目录加入刮削白名单 */
const addScrapingDirectory = (dir) => {
    scrapingDirectories.add(dir);
    console.log(`[LocalLibrary] Directory added to scraping whitelist: ${dir}`);
};
exports.addScrapingDirectory = addScrapingDirectory;
/** 将目录从刮削白名单移除 */
const removeScrapingDirectory = (dir) => {
    scrapingDirectories.delete(dir);
    console.log(`[LocalLibrary] Directory removed from scraping whitelist: ${dir}`);
};
exports.removeScrapingDirectory = removeScrapingDirectory;
/** 检查文件路径是否在白名单目录下（前缀匹配） */
const isFileUnderScraping = (filePath) => {
    for (const dir of scrapingDirectories) {
        if (filePath.startsWith(dir + path_1.default.sep) || filePath.startsWith(dir + '/') || filePath === dir) {
            return true;
        }
    }
    return false;
};
exports.isFileUnderScraping = isFileUnderScraping;
// ==================== 配置管理 ====================
/** 获取配置文件路径 */
const getConfigPath = () => {
    const dataPath = global.lx?.dataPath || path_1.default.join(process.cwd(), 'data');
    return path_1.default.join(dataPath, 'localLibraries.json');
};
// 本地库不再有默认根目录，库目录完全由用户通过 Web 端浏览添加 (见 getBrowseRoots)
/** 读取本地库配置 */
const loadLocalLibraries = () => {
    try {
        const configPath = getConfigPath();
        if (fs_1.default.existsSync(configPath)) {
            const raw = fs_1.default.readFileSync(configPath, 'utf-8');
            return JSON.parse(raw);
        }
    }
    catch (err) {
        console.error('[LocalLibrary] Failed to load config:', err.message);
    }
    return { version: 1, libraries: [] };
};
exports.loadLocalLibraries = loadLocalLibraries;
/** 保存本地库配置 */
const saveLocalLibraries = (config) => {
    try {
        const configPath = getConfigPath();
        const dir = path_1.default.dirname(configPath);
        if (!fs_1.default.existsSync(dir))
            fs_1.default.mkdirSync(dir, { recursive: true });
        fs_1.default.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    }
    catch (err) {
        console.error('[LocalLibrary] Failed to save config:', err.message);
    }
};
exports.saveLocalLibraries = saveLocalLibraries;
/** 按 ID 查找库配置 */
const getLibraryById = (id) => {
    const config = (0, exports.loadLocalLibraries)();
    return config.libraries.find(lib => lib.id === id) || null;
};
exports.getLibraryById = getLibraryById;
/** 按 source 查找库配置 (source 固定值: 'local') */
const getLibraryBySource = (source) => {
    if (source !== 'local')
        return null;
    const config = (0, exports.loadLocalLibraries)();
    return config.libraries[0] || null;
};
exports.getLibraryBySource = getLibraryBySource;
/** 按库名查找库配置 */
const getLibraryByName = (name) => {
    const config = (0, exports.loadLocalLibraries)();
    return config.libraries.find(lib => lib.name === name) || null;
};
exports.getLibraryByName = getLibraryByName;
/** 按文件路径查找所属库 (多库场景: 路径须在某库根目录内) */
const getLibraryByPath = (filePath) => {
    const resolved = path_1.default.resolve(filePath);
    const config = (0, exports.loadLocalLibraries)();
    for (const lib of config.libraries) {
        const libRoot = path_1.default.resolve(lib.path);
        if (resolved === libRoot || resolved.startsWith(libRoot + path_1.default.sep)) {
            return lib;
        }
    }
    return null;
};
exports.getLibraryByPath = getLibraryByPath;
/** 返回所有本地库的 source 列表 */
const getLocalLibrarySources = () => {
    const config = (0, exports.loadLocalLibraries)();
    return config.libraries.length > 0 ? ['local'] : [];
};
exports.getLocalLibrarySources = getLocalLibrarySources;
/** 获取本地库状态 (用于前端多库管理 UI) */
const getLocalLibraryStatus = () => {
    const config = (0, exports.loadLocalLibraries)();
    return {
        enabled: config.libraries.length > 0,
        libraries: config.libraries,
        browseRoots: (0, exports.getBrowseRoots)(),
        enableScraping: global.lx?.config?.['localLibrary.enableScraping'] !== false,
    };
};
exports.getLocalLibraryStatus = getLocalLibraryStatus;
/** 更新单个库字段 */
const updateLibraryField = (id, field, value) => {
    const config = (0, exports.loadLocalLibraries)();
    const lib = config.libraries.find(l => l.id === id);
    if (lib) {
        lib[field] = value;
        (0, exports.saveLocalLibraries)(config);
    }
};
exports.updateLibraryField = updateLibraryField;
/** 生成库 ID */
const generateLibId = () => 'lib_' + crypto_1.default.randomBytes(3).toString('hex');
/**
 * 判断是否为系统保留目录 (不可添加为本地库)
 * 规则: 下载目录/缓存目录及其全部子目录；两者共同父目录 (音乐主目录) 本身
 */
const isSystemReservedDir = (p) => {
    const resolved = path_1.default.resolve(p);
    const downloadDir = (0, pathUtil_1.getDownloadDir)();
    const cacheDir = (0, pathUtil_1.getCacheDir)();
    if (resolved === downloadDir || resolved.startsWith(downloadDir + path_1.default.sep))
        return true;
    if (resolved === cacheDir || resolved.startsWith(cacheDir + path_1.default.sep))
        return true;
    // 下载与缓存目录的共同父目录 = 音乐主目录 (本地为 cwd，Docker 为 /server/music)
    if (path_1.default.dirname(downloadDir) === path_1.default.dirname(cacheDir) && resolved === path_1.default.dirname(downloadDir))
        return true;
    return false;
};
/** 添加本地库 (支持任意目录，可添加多个；系统保留目录与嵌套目录不可添加) */
const addLibrary = (pathArg, nameArg) => {
    if (!pathArg) {
        return { success: false, error: '请指定要添加的目录' };
    }
    const resolvedPath = path_1.default.resolve(pathArg);
    // 检查路径是否存在且为目录
    if (!fs_1.default.existsSync(resolvedPath)) {
        return { success: false, error: `目录不存在: ${pathArg}` };
    }
    if (!fs_1.default.statSync(resolvedPath).isDirectory()) {
        return { success: false, error: `不是目录: ${resolvedPath}` };
    }
    // 系统保留目录 (下载/缓存目录及其共同父目录) 不可添加
    if (isSystemReservedDir(resolvedPath)) {
        return { success: false, error: '系统保留目录不可添加为本地库' };
    }
    const config = (0, exports.loadLocalLibraries)();
    // 路径去重 + 双向子目录重叠校验 (绝对路径比对，同一目录不允许重复添加，嵌套目录不允许添加)
    for (const lib of config.libraries) {
        const libPath = path_1.default.resolve(lib.path);
        if (resolvedPath === libPath) {
            return { success: false, error: `该目录已在本地库中: ${lib.name}` };
        }
        if (resolvedPath.startsWith(libPath + path_1.default.sep)) {
            return { success: false, error: `不支持添加本地库的子目录: 该目录属于已添加的本地库「${lib.name}」` };
        }
        if (libPath.startsWith(resolvedPath + path_1.default.sep)) {
            return { success: false, error: `不支持添加包含已有本地库的目录: 本地库「${lib.name}」位于该目录内` };
        }
    }
    const library = {
        id: generateLibId(),
        path: resolvedPath,
        name: (nameArg && nameArg.trim()) || path_1.default.basename(resolvedPath) || '本地音乐库',
        addedAt: (0, db_core_1.formatLocalDateTime)(new Date()),
        lastScanAt: null,
        songCount: 0,
        status: 'idle',
        autoWatch: true,
        autoWatchDebounce: 3000,
    };
    config.libraries.push(library);
    (0, exports.saveLocalLibraries)(config);
    console.log(`[LocalLibrary] Added library "${library.name}" at ${resolvedPath}`);
    return { success: true, library };
};
exports.addLibrary = addLibrary;
/** 移除本地库 (删除库配置 + 清理该库 DB 记录，不影响其他库) */
const removeLibrary = (libraryId) => {
    const config = (0, exports.loadLocalLibraries)();
    if (config.libraries.length === 0) {
        return { success: false, error: '本地库未启用' };
    }
    // 未指定 ID 时删除第一个 (兼容旧前端)
    const library = libraryId ? config.libraries.find(l => l.id === libraryId) : config.libraries[0];
    if (!library) {
        return { success: false, error: '本地库不存在' };
    }
    // 先停止监听 (如果已开启)
    try {
        const watcher = require('./localLibraryWatcher');
        if (watcher.stopWatcher) {
            watcher.stopWatcher(library.id);
        }
    }
    catch {
        // 监听模块可能尚未加载
    }
    // 删除该库的 DB 记录 (按 file_path 前缀，不影响其他库与下载记录)
    const deletedRecords = (0, db_songs_1.deleteDownloadRecordsByPathPrefix)(library.path);
    // 从配置移除
    config.libraries = config.libraries.filter(l => l.id !== library.id);
    (0, exports.saveLocalLibraries)(config);
    console.log(`[LocalLibrary] Removed library "${library.name}", deleted ${deletedRecords} records`);
    return { success: true, deletedRecords };
};
exports.removeLibrary = removeLibrary;
// ==================== 目录浏览 ====================
/**
 * 获取浏览根目录集合 (Web 端目录浏览器可浏览的范围)
 * 根 = 文件系统根 (本地与 Docker 均从文件系统根浏览任意目录)
 * 附加已注册库路径作为快捷根，便于快速回到已添加的库
 */
const getBrowseRoots = () => {
    const roots = [];
    const seen = new Set();
    const addRoot = (p, name, isFsRoot = false) => {
        const resolved = path_1.default.resolve(p);
        try {
            if (!fs_1.default.existsSync(resolved) || !fs_1.default.statSync(resolved).isDirectory())
                return;
        }
        catch {
            return; // 无权限或不可访问目录跳过
        }
        if (seen.has(resolved))
            return;
        seen.add(resolved);
        roots.push({ path: resolved, name: name || path_1.default.basename(resolved) || resolved, isFsRoot });
    };
    // 1. 文件系统根 (macOS/Linux 为 /，Windows 为盘符根)
    const fsRoot = path_1.default.parse(process.cwd()).root;
    addRoot(fsRoot, fsRoot, true);
    // 2. 已注册库路径 (快捷根，便于快速浏览已添加的库)
    const config = (0, exports.loadLocalLibraries)();
    for (const lib of config.libraries) {
        addRoot(lib.path, lib.name);
    }
    return roots;
};
exports.getBrowseRoots = getBrowseRoots;
/**
 * 浏览服务器目录 (文件系统根浏览 + 系统保留目录/已添加库标记)
 * @param dirPath 浏览目录，为空时返回文件系统根
 */
const browseDirectories = (dirPath) => {
    const roots = (0, exports.getBrowseRoots)();
    const rootPaths = roots.map(r => r.path);
    // 无 path 参数时默认第一个根 (文件系统根)
    const resolvedPath = dirPath ? path_1.default.resolve(dirPath) : rootPaths[0];
    // 路径穿越防护: 必须在某个浏览根内或就是浏览根 (根目录本身以 path.sep 结尾，不能重复拼接)
    const inRoot = rootPaths.find(root => resolvedPath === root || resolvedPath.startsWith(root.endsWith(path_1.default.sep) ? root : root + path_1.default.sep));
    if (!inRoot) {
        throw new Error('非法路径: 不在可浏览目录内');
    }
    if (!fs_1.default.existsSync(resolvedPath)) {
        throw new Error(`目录不存在: ${dirPath}`);
    }
    // 已注册库路径集合 (用于 isAdded 标记)
    const config = (0, exports.loadLocalLibraries)();
    const addedPaths = config.libraries.map(lib => path_1.default.resolve(lib.path));
    const entries = fs_1.default.readdirSync(resolvedPath, { withFileTypes: true });
    const directories = entries
        .filter(e => e.isDirectory() && !e.name.startsWith('.'))
        .map(e => {
        const fullDirPath = path_1.default.join(resolvedPath, e.name);
        // 浅层检测该目录是否包含子目录 (不递归)
        let hasSubDirs = false;
        try {
            const subEntries = fs_1.default.readdirSync(fullDirPath, { withFileTypes: true });
            hasSubDirs = subEntries.some(sub => sub.isDirectory() && !sub.name.startsWith('.'));
        }
        catch {
            // 无权限或不可读目录视为无子目录
        }
        return {
            name: e.name,
            path: fullDirPath,
            hasSubDirs,
            isSystemDir: isSystemReservedDir(fullDirPath),
            isAdded: addedPaths.includes(fullDirPath),
        };
    })
        .sort((a, b) => a.name.localeCompare(b.name));
    // 计算父路径 (不超过所在根目录)
    const parentPath = resolvedPath === inRoot
        ? null
        : path_1.default.dirname(resolvedPath);
    return {
        currentPath: resolvedPath,
        parentPath,
        rootPath: inRoot,
        roots,
        directories,
    };
};
exports.browseDirectories = browseDirectories;
// ==================== 封面查找 ====================
/**
 * 在专辑目录中查找封面图片 (SPEC §3.3)
 * @param albumDir 专辑目录绝对路径
 * @returns 封面文件名或 null
 */
const findAlbumCover = (albumDir) => {
    // 检查缓存
    const cached = coverCache.get(albumDir);
    if (cached && Date.now() - cached.ts < COVER_CACHE_TTL) {
        return cached.coverFile;
    }
    let result = null;
    try {
        if (!fs_1.default.existsSync(albumDir)) {
            coverCache.set(albumDir, { coverFile: null, ts: Date.now() });
            return null;
        }
        const files = fs_1.default.readdirSync(albumDir);
        const images = files
            .filter(f => exports.IMAGE_EXTENSIONS.includes(path_1.default.extname(f).toLowerCase()))
            .map(f => {
            const nameWithoutExt = path_1.default.basename(f, path_1.default.extname(f));
            const nameLower = nameWithoutExt.toLowerCase();
            // 中文名 "封面" 不转小写比较
            const priority = COVER_PRIORITY[nameLower] ?? COVER_PRIORITY[nameWithoutExt] ?? 99;
            const stats = fs_1.default.statSync(path_1.default.join(albumDir, f));
            return { file: f, name: nameLower, size: stats.size, priority };
        })
            .filter(img => img.size > 10 * 1024) // > 10KB
            .sort((a, b) => {
            if (a.priority !== b.priority)
                return a.priority - b.priority;
            return b.size - a.size; // 同优先级按大小降序
        });
        result = images.length > 0 ? images[0].file : null;
    }
    catch (err) {
        console.error(`[LocalLibrary] findAlbumCover error: ${albumDir}`, err.message);
        result = null;
    }
    console.info(`[LocalLibrary] findAlbumCover result: ${albumDir} -> ${result}`);
    coverCache.set(albumDir, { coverFile: result, ts: Date.now() });
    return result;
};
exports.findAlbumCover = findAlbumCover;
// ==================== 元数据提取 ====================
/**
 * 生成 song_id: libraryId + relative_path 的 MD5 前 16 位
 * 多库场景下相同相对路径 (如同名专辑目录结构) 在不同库生成不同 id，避免 source+song_id 唯一约束冲突
 */
const generateSongId = (libraryId, relativePath) => {
    return crypto_1.default.createHash('md5').update(`${libraryId}:${relativePath}`).digest('hex').substring(0, 16);
};
exports.generateSongId = generateSongId;
/**
 * 提取歌手名 (SPEC §3.5)
 */
const extractSinger = (filePath, _relativePath, tagArtist) => {
    // 0. 优先使用 tag 中的 artist
    if (tagArtist && tagArtist.trim())
        return tagArtist.trim();
    const fileName = path_1.default.basename(filePath, path_1.default.extname(filePath));
    const parentDir = path_1.default.basename(path_1.default.dirname(filePath));
    // 1. xxxx(singer).ext — 括号内为歌手名 (支持中英文括号和方括号)
    const bracketMatch = fileName.match(/^(.+?)[(（\[]([^)）\]]+)[)）\]]$/);
    if (bracketMatch)
        return bracketMatch[2].trim();
    // 2. xxx-singer.ext — 连字符前为歌手名
    const dashMatch = fileName.match(/^([^-]+)-(.+)$/);
    if (dashMatch)
        return dashMatch[2].trim();
    // 3. xxx -singer.ext — 空格+连字符前为歌手名
    const spaceDashMatch = fileName.match(/^(.+?)\s+-(.+)$/);
    if (spaceDashMatch)
        return spaceDashMatch[2].trim();
    // 6. singer《xxx》.ext — 《》前为歌手名
    const bookTitleMatch = fileName.match(/^([^《]+)《.+》$/);
    if (bookTitleMatch)
        return bookTitleMatch[1].trim();
    // 4. singer - album/xxx.ext — 父目录名中空格+连字符前为歌手名
    const dirSpaceDashMatch = parentDir.match(/^(.+?)\s+-(.+)$/);
    if (dirSpaceDashMatch)
        return dirSpaceDashMatch[1].trim();
    // 5. singer-album/xxx.ext — 父目录名中连字符前为歌手名
    const dirDashMatch = parentDir.match(/^([^-]+)-(.+)$/);
    if (dirDashMatch)
        return dirDashMatch[1].trim();
    // 7. 无法匹配
    return '未知';
};
exports.extractSinger = extractSinger;
/**
 * 提取专辑名 (SPEC §3.6)
 */
const extractAlbum = (filePath, _relativePath, tagAlbum) => {
    if (tagAlbum && tagAlbum.trim()) {
        return tagAlbum.trim();
    }
    const parentDir = path_1.default.basename(path_1.default.dirname(filePath));
    const grandParentDir = path_1.default.basename(path_1.default.dirname(path_1.default.dirname(filePath)));
    // 0. 如果父目录末尾有 CD 编号, 优先使用父目录名
    const cdSuffix = parentDir.match(/[\s_]+CD\s*[\dA-Za-z]+$/i);
    if (cdSuffix) {
        return grandParentDir[1].trim();
    }
    // 1. 父目录名包含《》号
    const bookMatch = parentDir.match(/《([^》]+)》/);
    if (bookMatch)
        return bookMatch[1].trim();
    // 2-4. 父目录名以"群星"或"VA"开头 (不区分大小写)
    const vaMatch = parentDir.match(/^(?:群星|va)\s*[-\s]\s*(.*)$/i);
    if (vaMatch) {
        let albumPart = vaMatch[1].trim();
        // 检查是否有《》号
        const vaBookMatch = albumPart.match(/^《([^》]+)》/);
        if (vaBookMatch)
            return vaBookMatch[1].trim();
        return albumPart || parentDir;
    }
    // 群星/VA + 无分隔符
    const vaNoSepMatch = parentDir.match(/^(?:群星|va)\s+(.+)$/i);
    if (vaNoSepMatch) {
        let albumPart = vaNoSepMatch[1].trim();
        const vaBookMatch2 = albumPart.match(/^《([^》]+)》/);
        if (vaBookMatch2)
            return vaBookMatch2[1].trim();
        return albumPart;
    }
    // 5. 父目录名去掉末尾括号中的年份
    let albumName = parentDir.replace(/[(（]\d{4}[)）]$/, '').trim();
    // 6. CD 子目录合并规则: 父目录匹配 cd + 数字/字母
    const cdMatch = parentDir.match(/^cd\s*[\dA-Za-z]+$/i);
    if (cdMatch) {
        albumName = `${grandParentDir}-${parentDir}`;
    }
    // 后处理: 清理 - 前后的空格
    albumName = albumName.replace(/\s*-\s*/g, '-');
    return albumName || parentDir;
};
exports.extractAlbum = extractAlbum;
/**
 * 提取年份 (SPEC §3.6.1)
 */
const extractYear = (_filePath, relativePath, tagYear) => {
    // 0. 优先使用 tag 中的 year
    if (tagYear) {
        const y = typeof tagYear === 'string' ? parseInt(tagYear, 10) : tagYear;
        if (y >= 1900 && y <= 2099)
            return y;
    }
    // 1. 从 relative_path 中提取 4 位年份
    // const yearMatch = relativePath.match(/(?:^|[ (（\[/\s])((?:19|20)\d{2})(?!\d)/)
    const yearMatch = relativePath.match(/(?:^|[ ()）\]\[《》/\s\-])((?:19|20)\d{2})(?!\d)/);
    if (yearMatch)
        return parseInt(yearMatch[1], 10);
    // 2. 无法提取
    return null;
};
exports.extractYear = extractYear;
/**
 * 从音频文件中读取元数据标签 (MusicTagger)
 * @param filePath 音频文件绝对路径
 * @returns 提取到的标签，失败时返回空对象
 */
const readAudioTags = (filePath) => {
    // 使用 readExtendedTags 以获取 discNumber/discTotal/audioQuality/trackNumber/albumArtist/composer
    return MusicTagUtil.readExtendedTags(filePath);
};
exports.readAudioTags = readAudioTags;
/**
 * 从文件名中提取歌曲名 (去掉曲目编号前缀)
 * 支持格式: 1-02.song_name, 1-02-song_name, 1-02 song_name, 1.song_name, 1 song_name
 * @param fileName 不含扩展名的文件名
 * @returns 提取到的歌曲名
 */
const extractSongName = (fileName, tagTitle) => {
    // 1. 优先使用 tag 中的 title
    if (tagTitle && tagTitle.trim())
        return tagTitle.trim();
    // 2. 去掉前导点号
    let name = fileName.replace(/^\.+/, '');
    // 3. 去掉曲目编号前缀: 1-02.song_name / 1-02-song_name / 1-02 song_name / 1.song_name / 1 song_name
    const trackPrefixMatch = name.match(/^\d{1,3}(?:-\d{1,3})?[.\s-]+(.+)$/);
    if (trackPrefixMatch)
        return trackPrefixMatch[1].trim();
    // 4. 无法匹配，使用清理后的文件名
    return name;
};
exports.extractSongName = extractSongName;
/**
 * 从文件名提取曲目编号 (Extract track number from filename fallback)
 * 支持格式: 01.xxx, 01 xxx, 2-01.xxx, 2-01 xxx, 02-01 xxx, 02 01.xxx
 * @param fileName 不含扩展名的文件名
 * @param tagTrackNumber tag 中的 track number (优先)
 */
const extractTrackNumber = (fileName, tagTrackNumber) => {
    // 1. 优先使用 tag 中的 trackNumber
    if (tagTrackNumber && tagTrackNumber > 0)
        return tagTrackNumber;
    // 2. 去掉前导点号
    const name = fileName.replace(/^\.+/, '');
    // 3. 匹配编号前缀: DD-TT / DD TT / TT 格式
    const m = name.match(/^(\d{1,3})(?:[ -](\d{1,3}))?[.\s-]+.+$/);
    if (!m)
        return 0; // 无法提取，默认 0
    // 若有两组数字 (disc-track)，track = 第二组；否则 track = 第一组
    const track = m[2] ? parseInt(m[2], 10) : parseInt(m[1], 10);
    return track > 0 ? track : 0;
};
exports.extractTrackNumber = extractTrackNumber;
/**
 * 从文件名提取光盘编号 (Extract disc number from filename fallback)
 * 支持格式: 2-01.xxx (disc=2), 02-01.xxx (disc=2), 02 01.xxx (disc=2)
 * 其它格式默认为 1
 * @param fileName 不含扩展名的文件名
 * @param tagDiscNumber tag 中的 disc number (优先)
 */
const extractDiscNumber = (fileName, tagDiscNumber) => {
    // 1. 优先使用 tag 中的 discNumber
    if (tagDiscNumber && tagDiscNumber > 0)
        return tagDiscNumber;
    // 2. 去掉前导点号
    const name = fileName.replace(/^\.+/, '');
    // 3. 匹配 DD-TT / DD TT 格式 (两组数字)
    const m = name.match(/^(\d{1,3})(?:[ -](\d{1,3}))?[.\s-]+.+$/);
    if (m && m[2]) {
        // 有两组数字 → 第一组为 disc number
        const disc = parseInt(m[1], 10);
        return disc > 0 ? disc : 1;
    }
    // 4. 无 disc-track 格式，默认返回 1
    return 1;
};
exports.extractDiscNumber = extractDiscNumber;
/**
 * 从扫描到的音频文件构建 DownloadRecord
 * TAG 缺失 title/artist/album 任一字段时自动触发 Acoustid+MusicBrainz 刮削，
 * 刮削结果写回 TAG 并下载封面，刮削失败时使用文件名解析兜底
 * @param filePath 文件绝对路径
 * @param libraryPath 库根目录路径
 * @param source 库 source 标识 (固定值 'local')
 * @param downloadedAt 写入时间 (可选)
 * @param affectedAlbumDirs
 * @param libraryId 库 ID (用于生成唯一 song_id，多库场景必须传入)
 */
const buildLocalSongRecord = async (filePath, libraryPath, source, downloadedAt, affectedAlbumDirs, libraryId) => {
    try {
        const stats = fs_1.default.statSync(filePath);
        const ext = path_1.default.extname(filePath).toLowerCase();
        const fileName = path_1.default.basename(filePath, ext);
        const relativePath = path_1.default.relative(libraryPath, filePath).replace(/\\/g, '/');
        const songId = (0, exports.generateSongId)(libraryId || source, relativePath);
        const albumDir = path_1.default.dirname(filePath);
        // 读取音频标签
        const tags = (0, exports.readAudioTags)(filePath);
        // 判断是否需要刮削: TAG 中缺少 title/artist/album 任一字段
        const needsScraping = !tags.title?.trim() || !tags.artist?.trim() || !tags.album?.trim();
        // Acoustid+MusicBrainz 刮削
        const scrapingEnabled = global.lx?.config?.['localLibrary.enableScraping'] !== false;
        let scrapeMetadata = null;
        if (needsScraping && scrapingEnabled && acoustidFingerprint_1.SUPPORTED_AUDIO_EXTS.includes(ext)) {
            try {
                console.log(`[LocalLibrary] TAG incomplete, triggering scrape: ${relativePath} (title=${!!tags.title?.trim()}, artist=${!!tags.artist?.trim()}, album=${!!tags.album?.trim()})`);
                const fpResult = await (0, acoustidFingerprint_1.generateFingerprint)(filePath);
                const lookupResult = await (0, acoustidLookup_1.lookupByFingerprint)(fpResult.fingerprint, fpResult.duration);
                if (lookupResult?.metadata) {
                    scrapeMetadata = lookupResult.metadata;
                    // 将刮削结果写回 TAG + 下载封面到目录 (现有逻辑: Cover.jpg/Cover.png, 已有则跳过)
                    try {
                        await (0, acoustidTagWriter_1.writeAcoustidTags)(filePath, lookupResult.metadata, lookupResult.coverUrl, false, // overwriteExisting=false: 不覆盖已有 TAG
                        lookupResult.acoustidId);
                        // 封面可能已写入目录，失效缓存以便 findAlbumCover 重新查找
                        (0, exports.invalidateAlbumCoverCache)(albumDir);
                        console.log(`[LocalLibrary] Scrape success: ${relativePath} → title="${scrapeMetadata.title}", artist="${scrapeMetadata.artist}", album="${scrapeMetadata.album}"`);
                    }
                    catch (tagErr) {
                        console.error(`[LocalLibrary] Tag write-back failed for ${relativePath}:`, tagErr.message);
                        // 即使写回失败，scrapeMetadata 仍可用于构建 record
                    }
                }
                else {
                    console.log(`[LocalLibrary] Scrape no match: ${relativePath}`);
                }
            }
            catch (scrapeErr) {
                console.warn(`[LocalLibrary] Scrape failed, using fallback for ${relativePath}:`, scrapeErr.message);
            }
        }
        else if (needsScraping && !scrapingEnabled && acoustidFingerprint_1.SUPPORTED_AUDIO_EXTS.includes(ext)) {
            console.log(`[LocalLibrary] Scraping disabled, using TAG/filename fallback: ${relativePath}`);
        }
        // 确定最终字段值: 刮削成功优先使用刮削结果，否则使用 extract* 函数 (TAG → 文件名解析)
        const songName = scrapeMetadata?.title || (0, exports.extractSongName)(fileName, tags.title);
        const singer = scrapeMetadata?.artist || (0, exports.extractSinger)(filePath, relativePath, tags.artist);
        const album = scrapeMetadata?.album || (0, exports.extractAlbum)(filePath, relativePath, tags.album);
        // 年份: 刮削结果的 date 字段提取年份，否则 extractYear
        let year = null;
        if (scrapeMetadata?.date) {
            const yearMatch = scrapeMetadata.date.match(/^(\d{4})/);
            if (yearMatch) {
                const y = parseInt(yearMatch[1], 10);
                if (y >= 1900 && y <= 2099)
                    year = y;
            }
        }
        if (!year)
            year = (0, exports.extractYear)(filePath, relativePath, tags.year);
        // 其他字段: 刮削结果优先
        const genre = scrapeMetadata?.genre || tags.genre || '';
        const albumArtist = scrapeMetadata?.albumArtist || tags.albumArtist || '';
        const trackNumber = scrapeMetadata?.trackNumber
            ? parseInt(scrapeMetadata.trackNumber, 10) || (0, exports.extractTrackNumber)(fileName, tags.trackNumber)
            : (0, exports.extractTrackNumber)(fileName, tags.trackNumber);
        const discNumber = scrapeMetadata?.discNumber
            ? parseInt(scrapeMetadata.discNumber, 10) || (0, exports.extractDiscNumber)(fileName, tags.discNumber)
            : (0, exports.extractDiscNumber)(fileName, tags.discNumber);
        // 封面查找 (刮削后缓存已失效，会重新查找目录中的 Cover 文件)
        const coverFile = (0, exports.findAlbumCover)(albumDir);
        const imgPath = coverFile
            ? path_1.default.relative(libraryPath, path_1.default.join(albumDir, coverFile)).replace(/\\/g, '/')
            : '';
        affectedAlbumDirs?.delete(albumDir);
        const now = downloadedAt || (0, db_core_1.formatLocalDateTime)(new Date());
        return {
            source,
            song_id: songId,
            song_name: songName,
            singer,
            album,
            quality: ext.replace('.', ''),
            file_path: filePath,
            file_size: stats.size,
            duration: tags.duration || undefined,
            status: 'finished',
            relative_path: relativePath,
            ext,
            has_cover: !!coverFile,
            has_lyric: false,
            mtime: (0, db_core_1.formatLocalDateTime)(stats.mtime),
            genre,
            year: year || undefined,
            track_number: trackNumber,
            disc_number: discNumber,
            disc_total: tags.discTotal || 1,
            audio_quality: tags.audioQuality || '',
            album_artist: albumArtist,
            composer: tags.composer || '',
            sample_rate: tags.sampleRate || undefined,
            bit_depth: tags.bitDepth || undefined,
            channels: tags.channels || undefined,
            bit_rate: tags.bitRate || undefined,
            meta_enriched: 1,
            img: imgPath || undefined,
            downloaded_at: now,
        };
    }
    catch (err) {
        console.error(`[LocalLibrary] buildLocalSongRecord error for ${filePath}:`, err.message);
        return null;
    }
};
exports.buildLocalSongRecord = buildLocalSongRecord;
// ==================== 本地库文件查找 ====================
/**
 * 根据 source + relativePath 解析本地库文件的绝对路径
 * 多库场景: 遍历所有库目录查找，命中即返回
 */
const resolveLocalFilePath = (source, relativePath) => {
    if (source !== 'local')
        return null;
    const config = (0, exports.loadLocalLibraries)();
    if (config.libraries.length === 0) {
        console.log(`[LocalLibrary] No libraries configured for source: ${source}`);
        return null;
    }
    for (const library of config.libraries) {
        const absolutePath = path_1.default.join(library.path, relativePath);
        if (fs_1.default.existsSync(absolutePath)) {
            return absolutePath;
        }
    }
    console.log(`[LocalLibrary] File not found in any library: ${relativePath}`);
    return null;
};
exports.resolveLocalFilePath = resolveLocalFilePath;
/**
 * 获取本地库文件记录 (兼容 checkDownloadAndCache 返回格式)
 */
const getLocalFileRecord = (source, relativePath) => {
    const absolutePath = (0, exports.resolveLocalFilePath)(source, relativePath);
    if (!absolutePath)
        return { exists: false };
    try {
        const stats = fs_1.default.statSync(absolutePath);
        const ext = path_1.default.extname(absolutePath).toLowerCase();
        return {
            exists: true,
            path: absolutePath,
            folder: 'local',
            ext,
            filename: path_1.default.basename(absolutePath),
            size: stats.size,
            mtime: (0, db_core_1.formatLocalDateTime)(stats.mtime),
        };
    }
    catch {
        return { exists: false };
    }
};
exports.getLocalFileRecord = getLocalFileRecord;
/**
 * 为本地库歌曲查找封面 (供 getCacheCover 调用)
 * 多库场景: 遍历所有库目录查找
 */
const findAlbumCoverForSong = (source, relativePath) => {
    if (source !== 'local')
        return null;
    const config = (0, exports.loadLocalLibraries)();
    for (const library of config.libraries) {
        const absolutePath = path_1.default.join(library.path, relativePath);
        if (!fs_1.default.existsSync(absolutePath))
            continue;
        // 如果 relativePath 本身就是图片文件，直接作为封面返回，无需再到目录中查找
        const ext = path_1.default.extname(absolutePath).toLowerCase();
        if (exports.IMAGE_EXTENSIONS.includes(ext)) {
            try {
                const data = fs_1.default.readFileSync(absolutePath);
                const mimeMap = {
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
                };
                return { data, mime: mimeMap[ext] || 'image/jpeg' };
            }
            catch {
                continue;
            }
        }
        const albumDir = path_1.default.dirname(absolutePath);
        const coverFile = (0, exports.findAlbumCover)(albumDir);
        if (coverFile) {
            try {
                const coverPath = path_1.default.join(albumDir, coverFile);
                const data = fs_1.default.readFileSync(coverPath);
                const coverExt = path_1.default.extname(coverFile).toLowerCase();
                const mimeMap = {
                    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                    '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
                };
                return { data, mime: mimeMap[coverExt] || 'image/jpeg' };
            }
            catch {
                // 目录封面读取失败，继续尝试从音频 TAG 中提取
            }
        }
        // 目录中未找到封面图片文件，尝试从音频文件内嵌 TAG 中提取 (Extract from embedded tag as fallback)
        const embedded = (0, fileCache_1.extractCoverFromFile)(absolutePath);
        if (embedded)
            return embedded;
    }
    return null;
};
exports.findAlbumCoverForSong = findAlbumCoverForSong;
// ==================== SSE 扫描进度 ====================
/** SSE 扫描进度端点 (GET /api/music/local/scan/events) */
const handleScanEvents = (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 10000\n\n');
    scanSSEClients.add(res);
    req.on('close', () => { scanSSEClients.delete(res); });
};
exports.handleScanEvents = handleScanEvents;
/** 广播扫描进度到 SSE 客户端 */
const broadcastScanProgress = (message) => {
    if (scanSSEClients.size === 0)
        return;
    const data = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of scanSSEClients) {
        try {
            client.write(data);
        }
        catch { }
    }
};
exports.broadcastScanProgress = broadcastScanProgress;
// ==================== HTTP Handler 函数 ====================
/** 读取 POST 请求 JSON body */
const readJsonBody = (req) => {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk;
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            }
            catch (err) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
};
/** 发送 JSON 响应 */
const sendJson = (res, code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
};
/** GET /api/music/local/libraries — 获取库列表 (兼容旧接口) */
const handleGetLibraries = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const config = (0, exports.loadLocalLibraries)();
    sendJson(res, 200, { code: 0, data: { libraries: config.libraries } });
};
exports.handleGetLibraries = handleGetLibraries;
/** GET /api/music/local/library/status — 获取本地库状态 */
const handleGetLibraryStatus = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const status = (0, exports.getLocalLibraryStatus)();
    sendJson(res, 200, { code: 0, data: status });
};
exports.handleGetLibraryStatus = handleGetLibraryStatus;
/** POST /api/music/local/libraries — 添加本地库 (body: { path, name }) */
const handleAddLibrary = async (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const body = await readJsonBody(req);
        const result = (0, exports.addLibrary)(body.path, body.name);
        if (result.success) {
            sendJson(res, 200, { code: 0, data: { library: result.library } });
        }
        else {
            sendJson(res, 200, { code: -1, msg: result.error });
        }
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleAddLibrary = handleAddLibrary;
/** DELETE /api/music/local/libraries/:id — 移除本地库 (未指定 ID 时删除第一个，兼容旧前端) */
const handleDeleteLibrary = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const pathname = urlObj?.pathname || '';
    const id = pathname.startsWith('/api/music/local/libraries/') ? pathname.replace('/api/music/local/libraries/', '') : undefined;
    const result = (0, exports.removeLibrary)(id);
    if (result.success) {
        sendJson(res, 200, { code: 0, data: { deletedRecords: result.deletedRecords } });
    }
    else {
        sendJson(res, 200, { code: -1, msg: result.error });
    }
};
exports.handleDeleteLibrary = handleDeleteLibrary;
/** GET /api/music/local/browse — 浏览服务器目录 (无 path 时返回浏览根列表) */
const handleBrowse = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const dirPath = urlObj.searchParams.get('path') || undefined;
    try {
        const result = (0, exports.browseDirectories)(dirPath);
        sendJson(res, 200, { code: 0, data: result });
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleBrowse = handleBrowse;
/** POST /api/music/local/scan — 启动扫描 */
const handleStartScan = async (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const body = await readJsonBody(req);
        const libraryId = body.libraryId;
        if (!libraryId) {
            sendJson(res, 200, { code: -1, msg: '缺少 libraryId 参数' });
            return;
        }
        const result = (0, exports.startScan)(libraryId);
        sendJson(res, 200, result);
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleStartScan = handleStartScan;
/** GET /api/music/local/scan/status/:scanId — 查询扫描进度 */
const handleScanStatus = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const scanId = urlObj.pathname.replace('/api/music/local/scan/status/', '');
    const state = (0, exports.getScanStatus)(scanId);
    if (!state) {
        sendJson(res, 200, { code: -1, msg: '扫描任务不存在' });
        return;
    }
    sendJson(res, 200, {
        code: 0,
        data: {
            scanId: state.scanId,
            status: state.status,
            progress: state.progress,
            currentFile: state.currentFile,
            errors: state.errors.slice(0, 100),
        },
    });
};
exports.handleScanStatus = handleScanStatus;
/** POST /api/music/local/scan/cancel/:scanId — 取消扫描 */
const handleCancelScan = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const scanId = urlObj.pathname.replace('/api/music/local/scan/cancel/', '');
    const cancelled = (0, exports.cancelScan)(scanId);
    sendJson(res, 200, { code: 0, data: { status: cancelled ? 'cancelled' : 'not_found' } });
};
exports.handleCancelScan = handleCancelScan;
/** GET /api/music/local/scan/errors/:scanId — 获取扫描错误列表 */
const handleScanErrors = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const scanId = urlObj.pathname.replace('/api/music/local/scan/errors/', '');
    const state = (0, exports.getScanStatus)(scanId);
    if (!state) {
        sendJson(res, 200, { code: -1, msg: '扫描任务不存在' });
        return;
    }
    sendJson(res, 200, {
        code: 0,
        data: {
            scanId: state.scanId,
            errors: state.errors.slice(0, 100),
            totalErrors: state.errors.length,
        },
    });
};
exports.handleScanErrors = handleScanErrors;
/** GET /api/music/local/sources — 获取可用来源列表 */
const handleGetSources = (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const config = (0, exports.loadLocalLibraries)();
    const sources = [
        { type: 'download', label: '下载', values: ['wy', 'tx', 'kg', 'kw', 'mg'] },
    ];
    // 从本地库配置添加来源（去重：多个库只添加一个 local 选项）
    let hasLocalFromConfig = false;
    for (const lib of config.libraries) {
        if (!hasLocalFromConfig) {
            sources.push({
                type: 'local',
                label: '本地',
                libraryId: lib.id,
                name: 'local',
            });
            hasLocalFromConfig = true;
        }
    }
    // 如果配置中没有本地库，但 DB 中已有 source='local' 的歌曲，
    // 则补充"本地库"来源选项
    // 场景：用户之前扫描过本地库但配置被删除/丢失，歌曲记录仍在 DB 中
    if (!hasLocalFromConfig) {
        try {
            const db = (0, db_core_1.getDbInstance)();
            if (db) {
                const result = db.exec(`SELECT DISTINCT source FROM download_records WHERE source = 'local' AND status = 'finished' LIMIT 1`);
                if (result.length > 0 && result[0].values.length > 0) {
                    sources.push({
                        type: 'local',
                        label: '本地',
                        libraryId: '',
                        name: 'local',
                    });
                }
            }
        }
        catch (err) {
            console.error('[LocalLibrary] Failed to check DB for local sources:', err.message);
        }
    }
    sendJson(res, 200, { code: 0, data: { sources } });
};
exports.handleGetSources = handleGetSources;
/** POST /api/music/local/watch/start — 开启自动监听 */
const handleWatchStart = async (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const body = await readJsonBody(req);
        const libraryId = body.libraryId;
        if (!libraryId) {
            sendJson(res, 200, { code: -1, msg: '缺少 libraryId 参数' });
            return;
        }
        const watcher = require('./localLibraryWatcher');
        const started = watcher.startWatcher(libraryId);
        if (!started) {
            sendJson(res, 200, { code: -1, msg: '启动监听失败' });
            return;
        }
        sendJson(res, 200, { code: 0, data: { status: 'started', libraryId } });
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleWatchStart = handleWatchStart;
/** POST /api/music/local/watch/stop — 关闭自动监听 */
const handleWatchStop = async (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const body = await readJsonBody(req);
        const libraryId = body.libraryId;
        if (!libraryId) {
            sendJson(res, 200, { code: -1, msg: '缺少 libraryId 参数' });
            return;
        }
        const watcher = require('./localLibraryWatcher');
        await watcher.stopWatcher(libraryId);
        sendJson(res, 200, { code: 0, data: { status: 'stopped', libraryId } });
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleWatchStop = handleWatchStop;
/** GET /api/music/local/watch/status/:libraryId — 查询监听状态 */
const handleWatchStatus = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const libraryId = urlObj.pathname.replace('/api/music/local/watch/status/', '');
    try {
        const watcher = require('./localLibraryWatcher');
        const status = watcher.getWatcherStatus(libraryId);
        sendJson(res, 200, { code: 0, data: status || { autoWatch: false, watcherActive: false } });
    }
    catch (err) {
        sendJson(res, 200, { code: 0, data: { autoWatch: false, watcherActive: false } });
    }
};
exports.handleWatchStatus = handleWatchStatus;
/** POST /api/music/local/watch/debounce — 设置防抖延迟 */
const handleWatchDebounce = async (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const body = await readJsonBody(req);
        const { libraryId, debounce } = body;
        if (!libraryId || debounce === undefined) {
            sendJson(res, 200, { code: -1, msg: '缺少参数' });
            return;
        }
        const ms = Math.max(1000, Math.min(10000, Number(debounce) || 3000));
        const watcher = require('./localLibraryWatcher');
        watcher.setDebounce(libraryId, ms);
        sendJson(res, 200, { code: 0, data: { debounce: ms } });
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleWatchDebounce = handleWatchDebounce;
/** POST /api/music/local/scraping — 切换刮削开关 */
const handleUpdateScraping = async (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const body = await readJsonBody(req);
        const { enableScraping } = body;
        if (typeof enableScraping !== 'boolean') {
            sendJson(res, 200, { code: -1, msg: '缺少 enableScraping 参数' });
            return;
        }
        // 更新内存配置
        ;
        global.lx.config['localLibrary.enableScraping'] = enableScraping;
        // 持久化到 config.js
        try {
            const configPath = process.env.CONFIG_PATH || path_1.default.join(process.cwd(), 'config.js');
            const raw = fs_1.default.readFileSync(configPath, 'utf-8');
            const jsonStr = raw.replace(/^module\.exports\s*=\s*/, '').trim();
            const configObj = JSON.parse(jsonStr);
            configObj['localLibrary.enableScraping'] = enableScraping;
            fs_1.default.writeFileSync(configPath, `module.exports = ${JSON.stringify(configObj, null, 2)}`);
        }
        catch (writeErr) {
            console.error('[LocalLibrary] Failed to persist scraping config:', writeErr.message);
        }
        console.log(`[LocalLibrary] Scraping ${enableScraping ? 'enabled' : 'disabled'}`);
        sendJson(res, 200, { code: 0, data: { enableScraping } });
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleUpdateScraping = handleUpdateScraping;
// ==================== 扫描引擎 ====================
/** 启动扫描 (异步执行) */
const startScan = (libraryId) => {
    const library = (0, exports.getLibraryById)(libraryId);
    if (!library) {
        return { code: -1, msg: '库目录不存在' };
    }
    if (library.status === 'scanning') {
        return { code: -1, msg: '该库正在扫描中' };
    }
    const scanId = 'scan_' + crypto_1.default.randomBytes(4).toString('hex');
    const state = {
        scanId,
        libraryId,
        status: 'scanning',
        progress: { total: 0, scanned: 0, added: 0, skipped: 0, errors: 0 },
        currentFile: '',
        errors: [],
        cancelled: false,
    };
    activeScans.set(scanId, state);
    // 更新库状态
    (0, exports.updateLibraryField)(libraryId, 'status', 'scanning');
    // 异步执行扫描
    runScan(state, library).catch(err => {
        console.error(`[LocalLibrary] Scan error: ${err.message}`);
        state.status = 'error';
        (0, exports.updateLibraryField)(libraryId, 'status', 'error');
    });
    console.log(`[LocalLibrary] Scan started: ${scanId} for ${library.name}`);
    return { code: 0, data: { scanId, status: 'started' } };
};
exports.startScan = startScan;
/** 取消扫描 */
const cancelScan = (scanId) => {
    const state = activeScans.get(scanId);
    if (!state || state.status !== 'scanning')
        return false;
    state.cancelled = true;
    console.log(`[LocalLibrary] Scan cancelled: ${scanId}`);
    return true;
};
exports.cancelScan = cancelScan;
/** 获取扫描状态 */
const getScanStatus = (scanId) => {
    return activeScans.get(scanId) || null;
};
exports.getScanStatus = getScanStatus;
/** 遍历目录收集音频文件 (recursive=false 时仅收集当前目录直接子文件) */
const collectAudioFiles = (dirPath, basePath, files, recursive = true) => {
    let entries;
    try {
        entries = fs_1.default.readdirSync(dirPath, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.'))
            continue; // 跳过系统文件
        const fullPath = path_1.default.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (recursive)
                collectAudioFiles(fullPath, basePath, files);
        }
        else if (entry.isFile()) {
            const ext = path_1.default.extname(entry.name).toLowerCase();
            if (!exports.LOCAL_AUDIO_EXTENSIONS.includes(ext))
                continue;
            files.push(fullPath);
        }
    }
};
/** 执行扫描 (主逻辑) */
const runScan = async (state, library) => {
    const source = 'local';
    const libraryPath = library.path;
    // 将库根目录加入刮削白名单，防止 watcher 递归触发
    (0, exports.addScrapingDirectory)(libraryPath);
    try {
        // 1. 收集所有音频文件
        console.log(`[LocalLibrary] Collecting audio files from: ${libraryPath}`);
        const audioFiles = [];
        collectAudioFiles(libraryPath, libraryPath, audioFiles);
        state.progress.total = audioFiles.length;
        console.log(`[LocalLibrary] Found ${audioFiles.length} audio files`);
        if (audioFiles.length === 0) {
            // 空库: 清理该库旧记录 (文件可能已被移走)
            const cleaned = (0, db_songs_1.deleteDownloadRecordsByPathPrefix)(libraryPath);
            if (cleaned > 0)
                console.log(`[LocalLibrary] Cleaned ${cleaned} stale records`);
            state.status = 'completed';
            (0, exports.updateLibraryField)(library.id, 'status', 'idle');
            (0, exports.updateLibraryField)(library.id, 'lastScanAt', (0, db_core_1.formatLocalDateTime)(new Date()));
            (0, exports.updateLibraryField)(library.id, 'songCount', 0);
            // 空库也广播完成事件，避免前端指示器卡死
            (0, exports.broadcastScanProgress)({
                type: 'local_scan_complete',
                scanId: state.scanId,
                libraryId: state.libraryId,
                result: { added: 0, skipped: 0, errors: 0 },
            });
            return;
        }
        // 2. 清理该库旧记录并查重
        // song_id 规则含 libraryId，旧规则 (仅相对路径) 的记录按 file_path 前缀清理，避免升级后重复入库
        const deletedOld = (0, db_songs_1.deleteDownloadRecordsByPathPrefix)(libraryPath);
        if (deletedOld > 0) {
            console.log(`[LocalLibrary] Cleaned ${deletedOld} legacy records for ${library.name}`);
        }
        const existingIds = (0, db_songs_1.getSongIdsByPathPrefix)(libraryPath);
        console.log(`[LocalLibrary] Existing records: ${existingIds.size}`);
        // 3. 逐个处理文件
        const now = (0, db_core_1.formatLocalDateTime)(new Date());
        for (const filePath of audioFiles) {
            // 检查取消标志
            if (state.cancelled) {
                state.status = 'cancelled';
                break;
            }
            const relativePath = path_1.default.relative(libraryPath, filePath).replace(/\\/g, '/'); // 统一正斜杠
            const songId = (0, exports.generateSongId)(library.id, relativePath);
            state.currentFile = relativePath;
            state.progress.scanned++;
            // 查重
            if (existingIds.has(songId)) {
                state.progress.skipped++;
                // 跳过的文件也需要推送进度，避免全部跳过时前端无进度更新
                if (state.progress.scanned % 2 === 0) {
                    (0, exports.broadcastScanProgress)({
                        type: 'local_scan_progress',
                        scanId: state.scanId,
                        libraryId: state.libraryId,
                        progress: state.progress,
                        currentFile: state.currentFile,
                    });
                    await new Promise(r => setImmediate(r));
                }
                continue;
            }
            // 处理文件 (使用公共函数 buildLocalSongRecord)
            try {
                const record = await (0, exports.buildLocalSongRecord)(filePath, libraryPath, source, now, undefined, library.id);
                if (!record) {
                    state.progress.errors++;
                    // 构建失败的文件也需要推送进度
                    if (state.progress.scanned % 2 === 0) {
                        (0, exports.broadcastScanProgress)({
                            type: 'local_scan_progress',
                            scanId: state.scanId,
                            libraryId: state.libraryId,
                            progress: state.progress,
                            currentFile: state.currentFile,
                        });
                        await new Promise(r => setImmediate(r));
                    }
                    continue;
                }
                // 写入 DB
                (0, db_songs_1.upsertDownloadRecord)(record);
                state.progress.added++;
                existingIds.add(songId);
            }
            catch (err) {
                state.progress.errors++;
                const errorRelPath = path_1.default.relative(libraryPath, filePath).replace(/\\/g, '/');
                console.error(`[LocalLibrary] Scan error for ${errorRelPath}:`, err.message || err);
                state.errors.push({
                    relativePath: errorRelPath,
                    error: err.message || String(err),
                    timestamp: (0, db_core_1.formatLocalDateTime)(new Date()),
                });
            }
            // 每 50 个文件推送进度
            if (state.progress.scanned % 2 === 0) {
                (0, exports.broadcastScanProgress)({
                    type: 'local_scan_progress',
                    scanId: state.scanId,
                    libraryId: state.libraryId,
                    progress: state.progress,
                    currentFile: state.currentFile,
                });
                // yield 避免阻塞事件循环
                await new Promise(r => setImmediate(r));
            }
        }
        // 4. 更新库配置
        if (state.status !== 'cancelled') {
            state.status = 'completed';
        }
        (0, exports.updateLibraryField)(library.id, 'status', 'idle');
        (0, exports.updateLibraryField)(library.id, 'lastScanAt', (0, db_core_1.formatLocalDateTime)(new Date()));
        (0, exports.updateLibraryField)(library.id, 'songCount', state.progress.added + state.progress.skipped);
        // 5. 推送最终进度 (100%)，确保前端显示完整进度后再隐藏
        (0, exports.broadcastScanProgress)({
            type: 'local_scan_progress',
            scanId: state.scanId,
            libraryId: state.libraryId,
            progress: state.progress,
            currentFile: state.currentFile,
        });
        // 6. 广播完成事件
        (0, exports.broadcastScanProgress)({
            type: 'local_scan_complete',
            scanId: state.scanId,
            libraryId: state.libraryId,
            result: {
                added: state.progress.added,
                skipped: state.progress.skipped,
                errors: state.progress.errors,
            },
        });
        console.log(`[LocalLibrary] Scan ${state.status}: ${state.progress.added} added, ${state.progress.skipped} skipped, ${state.progress.errors} errors`);
        if (state.errors.length > 0) {
            console.error('[LocalLibrary] Error details:');
            for (const e of state.errors) {
                console.error(`  - ${e.relativePath}: ${e.error}`);
            }
        }
        // 7. 延迟清理扫描状态 (保留 5 分钟供前端查询最终结果)
        setTimeout(() => {
            activeScans.delete(state.scanId);
        }, 5 * 60 * 1000);
    }
    finally {
        (0, exports.removeScrapingDirectory)(libraryPath);
    }
};
/** GET /api/music/local/folder-songs — 从文件系统读取目录歌曲 + 检查 DB 入库状态 (多库: 目录须位于某个已注册库内) */
const handleFolderSongs = (req, res, urlObj) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    const dirPath = urlObj.searchParams.get('path');
    if (!dirPath) {
        sendJson(res, 200, { code: -1, msg: '缺少 path 参数' });
        return;
    }
    const resolvedPath = path_1.default.resolve(dirPath);
    // 路径校验: 必须在某个已注册库的根目录内 (多库场景)
    const library = (0, exports.getLibraryByPath)(resolvedPath);
    if (!library) {
        sendJson(res, 200, { code: -1, msg: '非法路径: 不在任何本地库目录内' });
        return;
    }
    const rootPath = library.path;
    if (!fs_1.default.existsSync(resolvedPath)) {
        sendJson(res, 200, { code: -1, msg: `目录不存在: ${dirPath}` });
        return;
    }
    // 计算相对于库根目录的路径
    const folderRelativePath = path_1.default.relative(rootPath, resolvedPath).replace(/\\/g, '/');
    const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
    const pageSize = parseInt(urlObj.searchParams.get('pageSize') || '30', 10);
    const sort = urlObj.searchParams.get('sort') || 'mtime';
    const order = urlObj.searchParams.get('order') || 'desc';
    const search = (urlObj.searchParams.get('search') || '').trim().toLowerCase();
    try {
        // 1. 从文件系统收集音频文件 (仅当前目录直接子文件，不递归子目录)
        const audioFiles = [];
        collectAudioFiles(resolvedPath, rootPath, audioFiles, false);
        // 2. 构建文件条目 (轻量 stat，不读 tag)
        const fileEntries = [];
        for (const filePath of audioFiles) {
            try {
                const stats = fs_1.default.statSync(filePath);
                if (!stats.isFile())
                    continue;
                const ext = path_1.default.extname(filePath).toLowerCase();
                const fileName = path_1.default.basename(filePath, ext);
                const relativePath = path_1.default.relative(rootPath, filePath).replace(/\\/g, '/');
                const songId = (0, exports.generateSongId)(library.id, relativePath);
                fileEntries.push({
                    absolutePath: filePath,
                    relativePath,
                    fileName,
                    ext,
                    mtimeMs: stats.mtimeMs,
                    size: stats.size,
                    songId,
                });
            }
            catch {
                // 跳过无法 stat 的文件
            }
        }
        // 3. 搜索过滤 (按文件名关键词匹配)
        let filtered = fileEntries;
        if (search) {
            filtered = fileEntries.filter(f => f.fileName.toLowerCase().includes(search));
        }
        // 4. 排序
        filtered.sort((a, b) => {
            let cmp = 0;
            switch (sort) {
                case 'name':
                    cmp = a.fileName.localeCompare(b.fileName, 'zh-CN');
                    break;
                case 'size':
                    cmp = a.size - b.size;
                    break;
                case 'mtime':
                default:
                    cmp = a.mtimeMs - b.mtimeMs;
                    break;
            }
            return order === 'asc' ? cmp : -cmp;
        });
        // 5. 统计总数
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const offset = (page - 1) * pageSize;
        const pageEntries = filtered.slice(offset, offset + pageSize);
        // 6. 批量 DB 检查: 获取所有 local source 的 song_id 集合
        const existingIds = (0, db_songs_1.getSongIdsBySource)('local');
        // 7. 对当页文件，收集已入库的 songId
        const matchedIds = [];
        for (const entry of pageEntries) {
            if (existingIds.has(entry.songId)) {
                matchedIds.push(entry.songId);
            }
        }
        // 8. 批量获取已入库歌曲的完整 DB 记录
        const dbRecords = matchedIds.length > 0 ? (0, db_songs_1.getDownloadRecords)('local', matchedIds) : new Map();
        // 9. 统计已入库/未入库数量 (全量，非仅当页)
        let totalInDb = 0;
        const allMatchedIds = [];
        for (const entry of filtered) {
            if (existingIds.has(entry.songId)) {
                totalInDb++;
                allMatchedIds.push(entry.songId);
            }
        }
        const totalNotInDb = total - totalInDb;
        // 10. 构建当页结果列表
        const data = [];
        for (const entry of pageEntries) {
            const inDb = existingIds.has(entry.songId);
            if (inDb) {
                // 已入库: 使用 DB 记录完整数据
                const record = dbRecords.get(entry.songId);
                if (record) {
                    const mapped = (0, db_core_1.mapRecordToFrontendFormat)(record);
                    if (mapped) {
                        data.push({ ...mapped, inDb: true });
                        continue;
                    }
                }
                // DB 记录获取失败时降级为文件名解析兜底
            }
            // 未入库 (或 DB 记录获取失败): 用文件名解析兜底
            const qualityFromExt = entry.ext.replace('.', '').toLowerCase();
            const songName = (0, exports.extractSongName)(entry.fileName);
            const singer = (0, exports.extractSinger)(entry.absolutePath, entry.relativePath);
            const album = (0, exports.extractAlbum)(entry.absolutePath, entry.relativePath);
            data.push({
                id: inDb ? entry.songId : '',
                songId: inDb ? entry.songId : '',
                name: songName,
                singer: singer || '未知',
                album: album || '未知',
                albumName: album || '未知',
                source: 'local',
                quality: qualityFromExt,
                type: qualityFromExt ? [qualityFromExt] : [],
                ext: qualityFromExt,
                size: entry.size,
                duration: 0,
                img: '',
                relativePath: entry.relativePath,
                mtime: new Date(entry.mtimeMs).toISOString(),
                inDb,
                hasCover: false,
                hasLyric: false,
                sampleRate: null,
                bitDepth: null,
                channels: null,
                bitRate: null,
            });
        }
        // 11. 检测目录下的封面文件 (cover.jpg/folder.jpg 等)
        let folderCover = '';
        const coverFileName = (0, exports.findAlbumCover)(resolvedPath);
        if (coverFileName) {
            const coverAbsPath = path_1.default.join(resolvedPath, coverFileName);
            folderCover = path_1.default.relative(rootPath, coverAbsPath).replace(/\\/g, '/');
        }
        // 12. 计算已入库歌曲总时长 (分批查询避免 SQLite 999 参数限制)
        let totalDuration = 0;
        if (allMatchedIds.length > 0) {
            const dbInstance = (0, db_core_1.getDbInstance)();
            if (dbInstance) {
                const BATCH = 900;
                for (let i = 0; i < allMatchedIds.length; i += BATCH) {
                    const batch = allMatchedIds.slice(i, i + BATCH);
                    const placeholders = batch.map(() => '?').join(',');
                    const r = dbInstance.exec(`SELECT SUM(duration) FROM download_records WHERE source = 'local' AND song_id IN (${placeholders}) AND status = 'finished'`, batch);
                    if (r.length > 0 && r[0].values.length > 0) {
                        totalDuration += r[0].values[0][0] || 0;
                    }
                }
            }
        }
        sendJson(res, 200, {
            code: 0,
            data: {
                data,
                total,
                page,
                pageSize,
                totalPages,
                folderPath: folderRelativePath,
                folderName: path_1.default.basename(resolvedPath),
                totalInDb,
                totalNotInDb,
                folderCover,
                totalDuration,
            },
        });
    }
    catch (err) {
        console.error('[LocalLibrary] handleFolderSongs error:', err.message);
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleFolderSongs = handleFolderSongs;
// ==================== 子目录扫描 (Folder Scan) ====================
/** 执行子目录扫描 (逻辑与 runScan 相同，但 collectAudioFiles 从指定子目录开始) */
const runFolderScan = async (state, library, folderPath) => {
    const source = 'local';
    const libraryPath = library.path;
    // 将子目录加入刮削白名单，防止 watcher 递归触发
    (0, exports.addScrapingDirectory)(folderPath);
    try {
        // 1. 从指定子目录收集所有音频文件
        console.log(`[LocalLibrary] Collecting audio files from folder: ${folderPath}`);
        const audioFiles = [];
        collectAudioFiles(folderPath, libraryPath, audioFiles);
        state.progress.total = audioFiles.length;
        console.log(`[LocalLibrary] Found ${audioFiles.length} audio files in folder`);
        if (audioFiles.length === 0) {
            state.status = 'completed';
            (0, exports.updateLibraryField)(library.id, 'status', 'idle');
            (0, exports.updateLibraryField)(library.id, 'lastScanAt', (0, db_core_1.formatLocalDateTime)(new Date()));
            (0, exports.broadcastScanProgress)({
                type: 'local_scan_complete',
                scanId: state.scanId,
                libraryId: state.libraryId,
                result: { added: 0, skipped: 0, errors: 0 },
            });
            return;
        }
        // 2. 批量查重 (按库路径前缀，仅统计本库记录)
        const existingIds = (0, db_songs_1.getSongIdsByPathPrefix)(libraryPath);
        console.log(`[LocalLibrary] Existing records: ${existingIds.size}`);
        // 3. 逐个处理文件
        const now = (0, db_core_1.formatLocalDateTime)(new Date());
        for (const filePath of audioFiles) {
            if (state.cancelled) {
                state.status = 'cancelled';
                break;
            }
            // relativePath 仍相对于 library.path (保持一致性)
            const relativePath = path_1.default.relative(libraryPath, filePath).replace(/\\/g, '/');
            const songId = (0, exports.generateSongId)(library.id, relativePath);
            state.currentFile = relativePath;
            state.progress.scanned++;
            if (existingIds.has(songId)) {
                state.progress.skipped++;
                if (state.progress.scanned % 2 === 0) {
                    (0, exports.broadcastScanProgress)({
                        type: 'local_scan_progress',
                        scanId: state.scanId,
                        libraryId: state.libraryId,
                        progress: state.progress,
                        currentFile: state.currentFile,
                    });
                    await new Promise(r => setImmediate(r));
                }
                continue;
            }
            try {
                const record = await (0, exports.buildLocalSongRecord)(filePath, libraryPath, source, now, undefined, library.id);
                if (!record) {
                    state.progress.errors++;
                    if (state.progress.scanned % 2 === 0) {
                        (0, exports.broadcastScanProgress)({
                            type: 'local_scan_progress',
                            scanId: state.scanId,
                            libraryId: state.libraryId,
                            progress: state.progress,
                            currentFile: state.currentFile,
                        });
                        await new Promise(r => setImmediate(r));
                    }
                    continue;
                }
                (0, db_songs_1.upsertDownloadRecord)(record);
                state.progress.added++;
                existingIds.add(songId);
            }
            catch (err) {
                state.progress.errors++;
                const errorRelPath = path_1.default.relative(libraryPath, filePath).replace(/\\/g, '/');
                console.error(`[LocalLibrary] Folder scan error for ${errorRelPath}:`, err.message || err);
                state.errors.push({
                    relativePath: errorRelPath,
                    error: err.message || String(err),
                    timestamp: (0, db_core_1.formatLocalDateTime)(new Date()),
                });
            }
            if (state.progress.scanned % 2 === 0) {
                (0, exports.broadcastScanProgress)({
                    type: 'local_scan_progress',
                    scanId: state.scanId,
                    libraryId: state.libraryId,
                    progress: state.progress,
                    currentFile: state.currentFile,
                });
                await new Promise(r => setImmediate(r));
            }
        }
        // 4. 更新库配置
        if (state.status !== 'cancelled') {
            state.status = 'completed';
        }
        (0, exports.updateLibraryField)(library.id, 'status', 'idle');
        (0, exports.updateLibraryField)(library.id, 'lastScanAt', (0, db_core_1.formatLocalDateTime)(new Date()));
        // 更新歌曲总数 (按库路径前缀，仅统计本库)
        const allLocalIds = (0, db_songs_1.getSongIdsByPathPrefix)(libraryPath);
        (0, exports.updateLibraryField)(library.id, 'songCount', allLocalIds.size);
        // 5. 推送最终进度
        (0, exports.broadcastScanProgress)({
            type: 'local_scan_progress',
            scanId: state.scanId,
            libraryId: state.libraryId,
            progress: state.progress,
            currentFile: state.currentFile,
        });
        // 6. 广播完成事件
        (0, exports.broadcastScanProgress)({
            type: 'local_scan_complete',
            scanId: state.scanId,
            libraryId: state.libraryId,
            result: {
                added: state.progress.added,
                skipped: state.progress.skipped,
                errors: state.progress.errors,
            },
        });
        console.log(`[LocalLibrary] Folder scan ${state.status}: ${state.progress.added} added, ${state.progress.skipped} skipped, ${state.progress.errors} errors`);
        if (state.errors.length > 0) {
            console.error('[LocalLibrary] Folder scan error details:');
            for (const e of state.errors) {
                console.error(`  - ${e.relativePath}: ${e.error}`);
            }
        }
        // 7. 延迟清理扫描状态
        setTimeout(() => {
            activeScans.delete(state.scanId);
        }, 5 * 60 * 1000);
    }
    finally {
        (0, exports.removeScrapingDirectory)(folderPath);
    }
};
/** 启动子目录扫描 (多库: 目录须位于某个已注册库内) */
const startFolderScan = (folderPath) => {
    const resolvedPath = path_1.default.resolve(folderPath);
    // 路径验证: 必须位于某个已注册本地库内
    const library = (0, exports.getLibraryByPath)(resolvedPath);
    if (!library) {
        return { code: -1, msg: '非法路径: 不在任何本地库目录内' };
    }
    if (library.status === 'scanning') {
        return { code: -1, msg: '该库正在扫描中，请稍后再试' };
    }
    const scanId = 'scan_folder_' + crypto_1.default.randomBytes(4).toString('hex');
    const state = {
        scanId,
        libraryId: library.id,
        status: 'scanning',
        progress: { total: 0, scanned: 0, added: 0, skipped: 0, errors: 0 },
        currentFile: '',
        errors: [],
        cancelled: false,
    };
    activeScans.set(scanId, state);
    (0, exports.updateLibraryField)(library.id, 'status', 'scanning');
    // 异步执行扫描
    runFolderScan(state, library, resolvedPath).catch(err => {
        console.error(`[LocalLibrary] Folder scan error: ${err.message}`);
        state.status = 'error';
        (0, exports.updateLibraryField)(library.id, 'status', 'error');
    });
    return { code: 0, data: { scanId, status: 'started' } };
};
exports.startFolderScan = startFolderScan;
/** POST /api/music/local/scan-folder — 扫描指定子目录并入库 */
const handleScanFolder = async (req, res) => {
    const username = (0, commonUtils_1.verifyUserAccess)(req, res);
    if (!username)
        return;
    try {
        const body = await readJsonBody(req);
        const folderPath = body.path;
        if (!folderPath) {
            sendJson(res, 200, { code: -1, msg: '缺少 path 参数' });
            return;
        }
        const result = (0, exports.startFolderScan)(folderPath);
        sendJson(res, 200, result);
    }
    catch (err) {
        sendJson(res, 200, { code: -1, msg: err.message });
    }
};
exports.handleScanFolder = handleScanFolder;
