"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAcoustid = exports.handleAcoustidTest = exports.handleAcoustidScrapeBatch = exports.handleAcoustidScrape = exports.scrapeSingleFile = void 0;
const node_path_1 = __importDefault(require("node:path"));
const pathUtil_1 = require("../../utils/pathUtil");
const commonUtils_1 = require("../commonUtils");
const acoustidFingerprint_1 = require("./acoustidFingerprint");
const acoustidLookup_1 = require("./acoustidLookup");
const acoustidTagWriter_1 = require("./acoustidTagWriter");
/**
 * 单文件刮削核心逻辑
 */
const scrapeSingleFile = async (params) => {
    const { relativePath, writeTags = true, overwriteExisting = false } = params;
    console.log(`[Acoustid] Starting scrape for: ${relativePath}`);
    // Step 1: 解析路径
    const filePath = (0, pathUtil_1.resolveAudioFilePath)(relativePath);
    if (!filePath) {
        return { success: false, message: `File not found: ${relativePath}` };
    }
    // Step 2: 检查文件格式
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    if (!acoustidFingerprint_1.SUPPORTED_AUDIO_EXTS.includes(ext)) {
        return { success: false, message: `Unsupported format: ${ext}. Supported: ${acoustidFingerprint_1.SUPPORTED_AUDIO_EXTS.join(', ')}` };
    }
    try {
        // Step 3: 生成指纹
        const fpResult = await (0, acoustidFingerprint_1.generateFingerprint)(filePath);
        // Step 4: 查询 Acoustid
        const lookupResult = await (0, acoustidLookup_1.lookupByFingerprint)(fpResult.fingerprint, fpResult.duration);
        if (!lookupResult || !lookupResult.metadata) {
            console.log(`[Acoustid] Scrape complete (no match): ${relativePath}`);
            return {
                success: true,
                filePath,
                fingerprint: fpResult.fingerprint,
                duration: fpResult.duration,
                acoustidResult: lookupResult ? { acoustidId: lookupResult.acoustidId, score: lookupResult.score } : null,
                metadata: null,
                coverUrl: null,
                tagsWritten: false,
                tagDetails: null
            };
        }
        // Step 5-8: 写入标签 + 封面
        let tagDetails = null;
        if (writeTags) {
            try {
                tagDetails = await (0, acoustidTagWriter_1.writeAcoustidTags)(filePath, lookupResult.metadata, lookupResult.coverUrl, overwriteExisting, lookupResult.acoustidId);
            }
            catch (tagErr) {
                console.error(`[Acoustid] Tag writing error: ${tagErr.message}`);
            }
        }
        console.log(`[Acoustid] Scrape complete: ${relativePath}`);
        return {
            success: true,
            filePath,
            fingerprint: fpResult.fingerprint,
            duration: fpResult.duration,
            acoustidResult: { acoustidId: lookupResult.acoustidId, score: lookupResult.score },
            metadata: lookupResult.metadata,
            coverUrl: lookupResult.coverUrl,
            tagsWritten: tagDetails?.written || false,
            tagDetails
        };
    }
    catch (err) {
        console.error(`[Acoustid] Scrape failed: ${relativePath}: ${err.message}`);
        return { success: false, message: err.message, filePath };
    }
};
exports.scrapeSingleFile = scrapeSingleFile;
/**
 * POST /api/music/acoustid/scrape — 单文件刮削
 */
const handleAcoustidScrape = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        void (0, commonUtils_1.safeAsync)(res, async () => {
            const { relativePath, writeTags, overwriteExisting } = body;
            if (!relativePath) {
                (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: 'Missing relativePath' });
                return;
            }
            const result = await (0, exports.scrapeSingleFile)({
                relativePath,
                writeTags: writeTags !== false,
                overwriteExisting: overwriteExisting === true
            });
            (0, commonUtils_1.sendJsonResponse)(res, result.success ? 200 : 400, { success: result.success, data: result });
        }, 'AcoustidScrape');
    });
};
exports.handleAcoustidScrape = handleAcoustidScrape;
/**
 * POST /api/music/acoustid/scrape-batch — 批量刮削
 */
const handleAcoustidScrapeBatch = (req, res) => {
    void (0, commonUtils_1.readBodySafe)(req, res).then((body) => {
        if (!body)
            return;
        void (0, commonUtils_1.safeAsync)(res, async () => {
            const { relativePaths, writeTags, overwriteExisting } = body;
            if (!Array.isArray(relativePaths) || relativePaths.length === 0) {
                (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: 'Missing or empty relativePaths array' });
                return;
            }
            const write = writeTags !== false;
            const overwrite = overwriteExisting === true;
            const results = [];
            let succeeded = 0;
            let failed = 0;
            for (const rp of relativePaths) {
                const result = await (0, exports.scrapeSingleFile)({
                    relativePath: rp,
                    writeTags: write,
                    overwriteExisting: overwrite
                });
                results.push(result);
                if (result.success)
                    succeeded++;
                else
                    failed++;
            }
            console.log(`[Acoustid] Batch scrape: ${succeeded}/${relativePaths.length} succeeded`);
            (0, commonUtils_1.sendJsonResponse)(res, 200, {
                success: true,
                data: { total: relativePaths.length, succeeded, failed, results }
            });
        }, 'AcoustidScrapeBatch');
    });
};
exports.handleAcoustidScrapeBatch = handleAcoustidScrapeBatch;
/**
 * GET /api/music/acoustid/test?path=... — 快速测试
 */
const handleAcoustidTest = (req, res, urlObj) => {
    const relativePath = urlObj.searchParams.get('path');
    if (!relativePath) {
        (0, commonUtils_1.sendJsonResponse)(res, 400, { success: false, message: 'Missing path parameter' });
        return;
    }
    void (0, commonUtils_1.safeAsync)(res, async () => {
        const result = await (0, exports.scrapeSingleFile)({
            relativePath,
            writeTags: true,
            overwriteExisting: false
        });
        (0, commonUtils_1.sendJsonResponse)(res, 200, { success: result.success, data: result });
    }, 'AcoustidTest');
};
exports.handleAcoustidTest = handleAcoustidTest;
/**
 * 服务启动时初始化 WASM (供 server.ts 调用)
 */
const initAcoustid = async () => {
    try {
        await (0, acoustidFingerprint_1.initWasm)();
    }
    catch (err) {
        console.error('[Acoustid] Init failed, scraper will not be available:', err.message);
    }
};
exports.initAcoustid = initAcoustid;
