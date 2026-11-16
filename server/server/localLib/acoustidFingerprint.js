"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateFingerprint = exports.getFfmpegBinaryPath = exports.initWasm = exports.WRITABLE_TAG_EXTS = exports.SUPPORTED_AUDIO_EXTS = void 0;
const node_child_process_1 = require("node:child_process");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
const ffmpegPath_1 = require("../../utils/ffmpegPath");
// Alpine Linux 下优先使用系统 ffmpeg，避免 ffmpeg-static (glibc) DNS 解析不兼容
const ffmpegPath = (0, ffmpegPath_1.getFfmpegPath)();
// 支持指纹生成的音频格式
exports.SUPPORTED_AUDIO_EXTS = ['.mp3', '.flac', '.wav', '.ape', '.dsf', '.dff', '.m4a', '.ogg'];
// 支持标签写入的音频格式 (DFF 不支持内嵌标签)
exports.WRITABLE_TAG_EXTS = ['.mp3', '.flac', '.wav', '.ape', '.dsf', '.m4a', '.ogg'];
/** WASM 模块是否已初始化 */
let wasmReady = false;
/** Fingerprinter 构造函数引用 */
let FingerprinterClass = null;
/**
 * 初始化 WASM 模块 (服务启动时调用一次)
 * 手动加载 .wasm 文件以兼容 tsx 等不支持 .wasm 导入的运行时
 */
const initWasm = async () => {
    if (wasmReady)
        return;
    try {
        // 通过相对路径定位 wasm 包目录，兼容 tsx (src/) 和编译后 (server/) 两种路径
        const wasmPkgDir = (0, node_fs_1.existsSync)(node_path_1.default.join(__dirname, '../../../node_modules/rusty-chromaprint-wasm/dist/rusty_chromaprint_wasm_bg.wasm'))
            ? node_path_1.default.join(__dirname, '../../../node_modules/rusty-chromaprint-wasm/dist')
            : node_path_1.default.join(__dirname, '../../node_modules/rusty-chromaprint-wasm/dist');
        const bgJsPath = node_path_1.default.join(wasmPkgDir, 'rusty_chromaprint_wasm_bg.js');
        const wasmFilePath = node_path_1.default.join(wasmPkgDir, 'rusty_chromaprint_wasm_bg.wasm');
        // 加载 bg.js (ESM 模块，使用动态 import + pathToFileURL 兼容 CommonJS 编译输出)
        const bgModule = await import((0, node_url_1.pathToFileURL)(bgJsPath).href);
        // 读取 .wasm 文件
        const wasmBuffer = (0, node_fs_1.readFileSync)(wasmFilePath);
        const wasmMod = await WebAssembly.compile(wasmBuffer);
        // 实例化 WASM，注入 bg.js 导出的函数作为 import
        const wasmInstance = await WebAssembly.instantiate(wasmMod, {
            './rusty_chromaprint_wasm_bg.js': {
                __wbg_matchsegment_unwrap: bgModule.__wbg_matchsegment_unwrap,
                __wbg_matchsegment_new: bgModule.__wbg_matchsegment_new,
                __wbg___wbindgen_throw_6ddd609b62940d55: bgModule.__wbg___wbindgen_throw_6ddd609b62940d55,
                __wbg_Error_83742b46f01ce22d: bgModule.__wbg_Error_83742b46f01ce22d,
                __wbindgen_init_externref_table: bgModule.__wbindgen_init_externref_table,
            }
        });
        // 将 WASM exports 注入到 bg.js
        bgModule.__wbg_set_wasm(wasmInstance.exports);
        wasmInstance.exports.__wbindgen_start();
        FingerprinterClass = bgModule.Fingerprinter;
        wasmReady = true;
        console.log('[Acoustid] WASM chromaprint initialized');
    }
    catch (err) {
        console.error('[Acoustid] WASM init failed:', err.message);
        throw err;
    }
};
exports.initWasm = initWasm;
/**
 * 获取 ffmpeg 二进制路径（Alpine 感知，委托共享工具）
 */
const getFfmpegBinaryPath = () => {
    return ffmpegPath;
};
exports.getFfmpegBinaryPath = getFfmpegBinaryPath;
/**
 * 使用 ffmpeg 将音频文件解码为 PCM 原始数据
 * 输出格式: s16le (signed 16-bit little-endian), 11025Hz, mono
 */
const decodeToPCM = (filePath) => {
    return new Promise((resolve, reject) => {
        if (!ffmpegPath) {
            reject(new Error('ffmpeg-static not available'));
            return;
        }
        const sampleRate = 11025;
        const channels = 1;
        const ffmpeg = (0, node_child_process_1.spawn)(ffmpegPath, [
            '-i', filePath,
            '-f', 's16le',
            '-acodec', 'pcm_s16le',
            '-ar', String(sampleRate),
            '-ac', String(channels),
            '-v', 'quiet',
            'pipe:1'
        ]);
        const chunks = [];
        let stderrOutput = '';
        ffmpeg.stdout.on('data', (chunk) => {
            chunks.push(chunk);
        });
        ffmpeg.stderr.on('data', (data) => {
            stderrOutput += data.toString();
        });
        ffmpeg.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`ffmpeg decode failed (exit ${code}): ${stderrOutput.slice(-200)}`));
                return;
            }
            const totalBuffer = Buffer.concat(chunks);
            const samples = new Int16Array(totalBuffer.buffer, totalBuffer.byteOffset, totalBuffer.byteLength / 2);
            const duration = samples.length / sampleRate;
            console.log(`[Acoustid] PCM decoded: ${samples.length} samples, ${duration.toFixed(1)}s, ${sampleRate}Hz`);
            resolve({ samples, duration, sampleRate });
        });
        ffmpeg.on('error', (err) => {
            reject(new Error(`ffmpeg spawn failed: ${err.message}`));
        });
    });
};
/**
 * 生成音频文件的 Chromaprint 指纹
 * @param filePath 音频文件的绝对路径
 * @returns 指纹结果 (含 duration, fingerprint, sampleRate)
 */
const generateFingerprint = async (filePath) => {
    if (!wasmReady || !FingerprinterClass) {
        await (0, exports.initWasm)();
    }
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    if (!exports.SUPPORTED_AUDIO_EXTS.includes(ext)) {
        throw new Error(`Unsupported audio format: ${ext}. Supported: ${exports.SUPPORTED_AUDIO_EXTS.join(', ')}`);
    }
    console.log(`[Acoustid] Generating fingerprint for: ${filePath}`);
    // Step 1: ffmpeg 解码为 PCM
    const { samples, duration, sampleRate } = await decodeToPCM(filePath);
    // Step 2: WASM 生成指纹
    const fingerprinter = new FingerprinterClass();
    try {
        fingerprinter.start(sampleRate, 1); // mono
        fingerprinter.consume(samples);
        fingerprinter.finish();
        const fingerprint = fingerprinter.getCompressedFingerprint();
        console.log(`[Acoustid] Fingerprint generated: duration=${duration.toFixed(1)}s, fingerprint length=${fingerprint.length}`);
        return {
            file: filePath,
            duration,
            fingerprint,
            sampleRate
        };
    }
    finally {
        fingerprinter.free();
    }
};
exports.generateFingerprint = generateFingerprint;
