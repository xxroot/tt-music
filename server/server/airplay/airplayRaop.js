"use strict";
/**
 * AirPlay RAOP 音频流发送模块 (AirPlay RAOP Audio Streaming)
 *
 * 封装 @lox-audioserver/node-airplay-sender，提供：
 * - 音频文件解码 (MP3/FLAC/OGG/M4A/WAV → PCM 16bit LE stereo 44.1kHz)
 * - WAV 智能路径 (标准 CD WAV 跳过 ffmpeg 直接推送)
 * - 元数据发送 (title/artist/album/cover，封面推送前按需压缩，避免超大 SETART 导致设备断连)
 * - 音量/进度控制
 * - 流生命周期管理 (设备主动断开后自动清理会话并通知 DMC)
 *
 * 对应 DLNA 侧 upnp.ts 中的 SOAP 控制功能。
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeAudioDuration = exports.streamFromUrl = exports.getConnectedDevice = exports.setProgress = exports.setVolume = exports.setMetadata = exports.isStreaming = exports.getActiveSession = exports.stopStream = exports.startStream = void 0;
const node_airplay_sender_1 = require("@lox-audioserver/node-airplay-sender");
const node_child_process_1 = require("node:child_process");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const needle_1 = __importDefault(require("needle"));
const ffmpegPath_1 = require("../../utils/ffmpegPath");
// ==================== Logging ====================
/** 日志时间戳: HH:mm:ss.SSS (对齐 DLNA 侧排障实践，便于关联多模块日志) */
const ts = () => {
    const d = new Date();
    const pad = (n, w = 2) => String(n).padStart(w, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
};
const log = (...args) => console.log(`[AirPlay-RAOP ${ts()}]`, ...args);
const logWarn = (...args) => console.warn(`[AirPlay-RAOP ${ts()}]`, ...args);
const logError = (...args) => console.error(`[AirPlay-RAOP ${ts()}]`, ...args);
/**
 * 是否透传库 debug 级日志 (config.js 中 airplayDebug=true 时开启)
 * 开启后可见库内部每条 RTSP 请求/响应码、UDP 发送统计，用于排障
 */
const isAirPlayDebug = () => Boolean(global.lx?.config?.airplayDebug);
// ==================== State ====================
let activeSession = null;
/** AirPlay 2 降级记录: deviceId → { failed: boolean, timestamp: number } */
const airplay2FallbackMap = new Map();
const FALLBACK_TTL = 24 * 60 * 60 * 1000; // 24 小时后重试 AirPlay 2
// ==================== Cover ====================
/** 封面压缩阈值: 超过该大小的封面先压缩再推送 */
const COVER_COMPRESS_THRESHOLD = 256 * 1024; // 256KB
/** 压缩后封面最长边像素 */
const COVER_RESIZE_MAX = 512;
/**
 * 拉取并(按需)压缩 AirPlay 封面
 *
 * 根因修复: 部分歌曲内嵌超大封面 (实测 3.1MB PNG)，原样推送给 DMR 时
 * 库将整个封面塞进单个 RTSP SET_PARAMETER (SETART)，设备无法处理超大请求体
 * 而主动断开连接 (显示歌曲信息约 1 秒后退出播放)。
 * 超过 256KB 的封面统一缩放到 512px 内并转 JPEG q80 (通常 <150KB)。
 *
 * @returns { data, mime } 或 undefined (拉取/压缩失败时跳过封面，不影响播放)
 */
const prepareCoverForAirPlay = async (coverUrl) => {
    try {
        const resp = await (0, needle_1.default)('get', coverUrl, {
            timeout: 4000,
            follow_max: 3,
            parse: false,
            headers: { 'User-Agent': 'LX-Music-Server', 'Accept': 'image/*,*/*' },
        });
        const raw = resp.body;
        if (resp.statusCode !== 200 || !raw || !raw.length) {
            logWarn(`封面拉取失败: status=${resp.statusCode}, url=${coverUrl.substring(0, 80)}`);
            return undefined;
        }
        const mime = (resp.headers?.['content-type'] || 'image/jpeg').split(';')[0].trim();
        if (raw.length <= COVER_COMPRESS_THRESHOLD) {
            log(`封面就绪: ${raw.length} bytes (无需压缩), mime=${mime}`);
            return { data: raw, mime };
        }
        // 大封面: sharp 压缩 (懒加载, 加载失败则跳过封面)
        let sharp;
        try {
            sharp = require('sharp');
        }
        catch (err) {
            logWarn(`sharp 不可用，跳过大封面压缩: ${err.message}`);
            return undefined;
        }
        const compressed = await sharp(raw)
            .resize(COVER_RESIZE_MAX, COVER_RESIZE_MAX, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
        log(`封面压缩: ${raw.length} → ${compressed.length} bytes (${COVER_RESIZE_MAX}px inside, JPEG q80)`);
        return { data: compressed, mime: 'image/jpeg' };
    }
    catch (err) {
        logWarn(`封面处理失败 (跳过封面): ${err.message}`);
        return undefined;
    }
};
/**
 * 解析 WAV 文件头部信息
 * 标准 WAV: RIFF header (12) + fmt chunk (24) + data chunk header (8) = 44 bytes
 */
const parseWavHeader = (buffer) => {
    if (buffer.length < 44)
        return null;
    // RIFF header check
    if (buffer.toString('ascii', 0, 4) !== 'RIFF')
        return null;
    if (buffer.toString('ascii', 8, 12) !== 'WAVE')
        return null;
    let offset = 12;
    let audioFormat = 0;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = 0;
    let dataSize = 0;
    // 遍历 chunks
    while (offset < buffer.length - 8) {
        const chunkId = buffer.toString('ascii', offset, offset + 4);
        const chunkSize = buffer.readUInt32LE(offset + 4);
        if (chunkId === 'fmt ') {
            audioFormat = buffer.readUInt16LE(offset + 8);
            channels = buffer.readUInt16LE(offset + 10);
            sampleRate = buffer.readUInt32LE(offset + 12);
            bitsPerSample = buffer.readUInt16LE(offset + 22);
        }
        else if (chunkId === 'data') {
            dataOffset = offset + 8;
            dataSize = chunkSize;
            break;
        }
        offset += 8 + chunkSize;
        // chunks are word-aligned
        if (chunkSize % 2 !== 0)
            offset++;
    }
    if (dataOffset === 0)
        return null;
    return { dataOffset, dataSize, sampleRate, bitsPerSample, channels, audioFormat };
};
/**
 * 判断 WAV 是否为标准 CD 音质 (可直接推送，无需 ffmpeg)
 */
const isStandardCdWav = (header) => {
    return (header.audioFormat === 1 && // PCM
        header.bitsPerSample === 16 &&
        header.sampleRate === 44100 &&
        header.channels === 2);
};
// ==================== Streaming ====================
/** 单次连接尝试超时 (ms) */
const CONNECTION_TIMEOUT_MS = 8000;
/**
 * 单次 RAOP 连接尝试 (内部辅助函数)
 *
 * 包含 bplist-parser 未处理异常捕获，防止库内部崩溃导致进程退出。
 * @param device AirPlay 设备
 * @param options 流选项
 * @param forceAirplay1 强制使用 AirPlay 1 (降级模式)
 */
const attemptConnection = (device, options, forceAirplay1) => {
    return new Promise((resolve, reject) => {
        // 停止已有会话
        if (activeSession) {
            (0, exports.stopStream)();
        }
        const useAirplay2 = forceAirplay1 ? false : device.supportsAirPlay2;
        const modeLabel = useAirplay2 ? 'AP2' : 'AP1';
        // 将设备 TXT 记录转为库期望的 "key=value" 数组格式
        // 库依赖这些记录配置编解码 (cn=)、加密 (et=)、设备能力 (sf=, features=) 等
        const txtArray = Object.entries(device.txt || {}).map(([k, v]) => `${k}=${v}`);
        const senderOptions = {
            host: device.host,
            port: device.port,
            name: 'LX Music Server',
            volume: 50,
            airplay2: useAirplay2,
            txt: txtArray,
            debug: true,
            log: (level, message, data) => {
                // debug 级日志量大，默认过滤；config.js 设 airplayDebug=true 时透传
                if (level === 'debug' && !isAirPlayDebug())
                    return;
                log(`[lib:${level}] ${message}`, data !== undefined ? JSON.stringify(data) : '');
            },
        };
        let sessionStarted = false;
        let settled = false;
        let deviceGoneHandled = false;
        // 防止重复 settle 的包装函数
        const safeResolve = () => {
            if (settled)
                return;
            settled = true;
            process.removeListener('uncaughtException', bplistHandler);
            resolve();
        };
        const safeReject = (err) => {
            if (settled)
                return;
            settled = true;
            process.removeListener('uncaughtException', bplistHandler);
            (0, exports.stopStream)();
            reject(err);
        };
        /**
         * 设备断开后幂等清理: 杀 ffmpeg、停 sender、清 activeSession，并通知 DMC。
         * 消除 ffmpeg 僵尸运行与进度定时器继续 setProgress 导致的 not_found 刷屏。
         * (activeSession 置 null 同时充当 "deviceGone" 标志: 喂数据处检查到后不再发送)
         */
        const handleDeviceGone = (reason) => {
            if (deviceGoneHandled)
                return;
            deviceGoneHandled = true;
            logWarn(`设备断开 (${modeLabel})，主动清理会话: reason=${reason}`);
            (0, exports.stopStream)();
            try {
                options.onDeviceDisconnected?.(reason);
            }
            catch { /* ignore */ }
        };
        // 捕获 bplist-parser 在 RTSP 库内部抛出的未处理异常
        // (库在 mode=2 时跳过非200响应码检查，直接解析 bplist → 400 响应体非 plist → 崩溃)
        const bplistHandler = (err) => {
            const msg = err?.message || '';
            const stack = err?.stack || '';
            if (msg.includes('bplist') || msg.includes('parseBuffer') || stack.includes('bplist')) {
                logError(`捕获 bplist 解析异常 (${modeLabel}):`, msg);
                safeReject(new Error(`AirPlay 2 bplist parse error: ${msg}`));
            }
            // 非 bplist 异常不处理，让其他 handler 或默认行为处理
        };
        process.on('uncaughtException', bplistHandler);
        const sender = new node_airplay_sender_1.LoxAirplaySender();
        log(`创建 LoxAirplaySender: host=${device.host}, port=${device.port}, airplay2=${useAirplay2} (${modeLabel})`);
        const started = sender.start(senderOptions, (event) => {
            // 过滤高频 metrics 事件，只记录有意义的状态事件
            if (event.event !== 'metrics') {
                log(`事件: ${event.event}, message=${event.message}, detail=${JSON.stringify(event.detail || {})}`);
            }
            if (event.event === 'device') {
                // event.message 才是状态 ("connecting"|"ready"|"playing"|"stopped"|...)
                // event.detail.key 是设备标识 (如 "10.240.204.58:5000")
                const status = event.message;
                if ((status === 'ready' || status === 'playing') && !sessionStarted) {
                    sessionStarted = true;
                    log(`设备就绪 (${modeLabel}, status=${status})，开始推送音频`);
                    if (options.metadata) {
                        // 延迟 1 秒发送元数据，等 ffmpeg 开始推流后 RTSP 进入 PLAYING 状态
                        // 库内部 setTrackInfo 要求 RTSP 状态为 PLAYING 才发送，否则直接跳过
                        const meta = options.metadata;
                        setTimeout(() => {
                            void (async () => {
                                // 会话可能已被停止/替换 (设备断开、用户切歌)
                                if (activeSession?.sender !== sender)
                                    return;
                                // 封面不直接交给库 fetch: 大封面 (如内嵌 3.1MB PNG) 会让 DMR 无法处理
                                // SETART 超大请求体而主动断连。先自行拉取并按需压缩，再以 Buffer 传给库。
                                const payload = { ...meta };
                                if (meta.coverUrl) {
                                    const cover = await prepareCoverForAirPlay(meta.coverUrl);
                                    if (cover)
                                        payload.cover = cover;
                                    // 无论成败都不再让库自行 fetch 原图
                                    delete payload.coverUrl;
                                }
                                try {
                                    await sender.setMetadata(payload);
                                }
                                catch (err) {
                                    logWarn(`setMetadata 失败 (${modeLabel}): ${err.message}`);
                                }
                            })();
                        }, 1000);
                    }
                    startAudioFeed(sender, options.source, device, options.onDurationDetected, options.onStreamComplete).then(() => {
                        safeResolve();
                    }).catch((err) => safeReject(err));
                }
                else if (status === 'stopped') {
                    const reason = event.detail?.desc || event.detail?.reason || 'unknown';
                    logWarn(`设备停止 (${modeLabel}): reason=${reason}`);
                    if (!sessionStarted) {
                        safeReject(new Error(`RAOP device stopped: ${reason}`));
                    }
                    else {
                        handleDeviceGone(reason);
                    }
                }
                else if (status === 'need_password') {
                    logWarn('设备需要密码（暂不支持）');
                }
                else if (status === 'pair_failed') {
                    logError(`配对失败 (${modeLabel})`);
                    if (!sessionStarted) {
                        safeReject(new Error('RAOP pair failed'));
                    }
                }
                else if (status === 'connecting') {
                    log(`正在连接设备... (${modeLabel})`);
                }
                else if (status === 'pair_success') {
                    log(`配对成功 (${modeLabel})`);
                }
            }
            else if (event.event === 'error') {
                logError(`错误 (${modeLabel}):`, event.message, event.detail);
                if (!sessionStarted) {
                    safeReject(new Error(`RAOP error: ${event.message}`));
                }
            }
            else if (event.event === 'session-ended') {
                log(`会话结束 (${modeLabel}):`, event.message, event.detail);
                if (!sessionStarted) {
                    safeReject(new Error(`Session ended before start: ${event.message}`));
                }
                else {
                    handleDeviceGone(event.message || 'session-ended');
                }
            }
            else if (event.event === 'buffer') {
                log(`缓冲区: ${event.message}`);
                if (event.message === 'playing' && !sessionStarted) {
                    sessionStarted = true;
                    log(`缓冲区开始播放 (${modeLabel})`);
                    safeResolve();
                }
            }
        });
        if (!started) {
            logError(`sender.start() 返回 false，启动失败 (${modeLabel})`);
            safeReject(new Error('Failed to start RAOP sender'));
            return;
        }
        log(`sender.start() 返回 true (${modeLabel})，等待设备事件...`);
        activeSession = {
            sender,
            ffmpegProcess: null,
            device,
            streaming: false,
        };
        // 安全超时: 8 秒内若未收到 ready/playing 事件
        setTimeout(() => {
            if (!sessionStarted && !settled) {
                logWarn(`连接超时 (${modeLabel}, ${CONNECTION_TIMEOUT_MS}ms)`);
                safeReject(new Error(`RAOP connection timeout (${CONNECTION_TIMEOUT_MS / 1000}s, ${modeLabel})`));
            }
        }, CONNECTION_TIMEOUT_MS);
    });
};
/**
 * 开始播放音频到 AirPlay 设备
 *
 * 先尝试设备检测的 AirPlay 版本，若 AP2 失败则自动降级到 AP1 重试。
 * 降级结果会缓存 24 小时，避免重复等待。
 */
const startStream = (device, options) => {
    // 检查是否有已知的 AP2 降级记录
    const cached = airplay2FallbackMap.get(device.id);
    const skipAp2 = cached && cached.failed && (Date.now() - cached.timestamp < FALLBACK_TTL);
    if (skipAp2 && device.supportsAirPlay2) {
        log(`设备 "${device.name}" 已知 AP2 不兼容，直接使用 AP1`);
        return attemptConnection(device, options, true);
    }
    // 过期记录清理
    if (cached && (Date.now() - cached.timestamp >= FALLBACK_TTL)) {
        airplay2FallbackMap.delete(device.id);
    }
    // 首次尝试：使用设备检测的 AirPlay 版本
    return attemptConnection(device, options, false).catch(async (err) => {
        if (device.supportsAirPlay2) {
            logWarn(`AP2 连接失败，降级到 AP1 重试: ${err.message}`);
            // 记录降级
            airplay2FallbackMap.set(device.id, { failed: true, timestamp: Date.now() });
            // 确保清理上一次失败的会话
            (0, exports.stopStream)();
            // 等待设备完成上一次 RTSP 会话的清理 (TEARDOWN 后设备需要时间重置)
            await new Promise((r) => setTimeout(r, 1500));
            // 降级重试
            return attemptConnection(device, options, true);
        }
        throw err;
    });
};
exports.startStream = startStream;
/**
 * 根据音频源类型开始推送数据
 */
const startAudioFeed = async (sender, source, device, onDurationDetected, onStreamComplete) => {
    // 判断是本地文件还是 HTTP URL
    const isHttp = source.startsWith('http://') || source.startsWith('https://');
    log(`startAudioFeed: source=${source.substring(0, 80)}, isHttp=${isHttp}, ext=${isHttp ? 'N/A' : node_path_1.default.extname(source)}`);
    if (!isHttp) {
        // 本地文件路径
        const ext = node_path_1.default.extname(source).toLowerCase();
        if (ext === '.wav') {
            // WAV 智能路径: 检查是否为标准 CD 音质
            await feedWavFile(sender, source, onStreamComplete);
        }
        else {
            // MP3/FLAC/OGG/M4A → ffmpeg 转 PCM
            feedViaFfmpeg(sender, source, onDurationDetected, onStreamComplete);
        }
    }
    else {
        // HTTP URL → ffmpeg 转 PCM
        feedViaFfmpeg(sender, source, onDurationDetected, onStreamComplete);
    }
    if (activeSession) {
        activeSession.streaming = true;
    }
};
/**
 * WAV 文件智能推送: 标准 CD WAV 直接跳过 ffmpeg
 */
const feedWavFile = async (sender, filePath, onStreamComplete) => {
    return new Promise((resolve, reject) => {
        // 读取头部判断格式
        const headerBuf = Buffer.alloc(128);
        const fd = node_fs_1.default.openSync(filePath, 'r');
        try {
            node_fs_1.default.readSync(fd, headerBuf, 0, 128, 0);
        }
        catch (err) {
            node_fs_1.default.closeSync(fd);
            reject(err);
            return;
        }
        const header = parseWavHeader(headerBuf);
        if (header && isStandardCdWav(header)) {
            // 标准 CD WAV: 直接读取 PCM 数据
            log(`WAV 标准CD音质，直接推送 (跳过ffmpeg)`);
            node_fs_1.default.closeSync(fd);
            const readStream = node_fs_1.default.createReadStream(filePath, {
                start: header.dataOffset,
                highWaterMark: 8192,
            });
            // 实时节流: 磁盘读取速度远快于实时，必须控制发送速率
            // 标准 CD WAV: 44100 Hz × 2 channels × 2 bytes = 176,400 bytes/sec
            const PCM_BYTES_PER_SEC = 44100 * 2 * 2;
            const startTime = Date.now();
            let totalBytes = 0;
            let throttleTimer = null;
            let sendPcmWarned = false;
            readStream.on('data', (chunk) => {
                // 设备已断开/会话已停止或替换: 不再喂数据，销毁读取流 (释放 fd)
                if (!activeSession || activeSession.sender !== sender) {
                    readStream.destroy();
                    return;
                }
                const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
                totalBytes += buf.length;
                try {
                    sender.sendPcm(buf);
                }
                catch (err) {
                    // 设备断开后库 buffer 已 ENDED, 继续 write 会抛错; 只记一次避免刷屏
                    if (!sendPcmWarned) {
                        sendPcmWarned = true;
                        logWarn(`sendPcm 失败，后续 chunk 将被跳过: ${err.message}`);
                    }
                }
                // 累计节流: 基于已发送总量计算期望时间，保证平均速率 = 实时
                const expectedMs = (totalBytes / PCM_BYTES_PER_SEC) * 1000;
                const elapsedMs = Date.now() - startTime;
                const delayMs = expectedMs - elapsedMs;
                if (delayMs > 10) {
                    readStream.pause();
                    // 先清掉旧 timer 再赋值: 防止 stale timer 提前 resume 导致瞬间灌爆缓冲区
                    if (throttleTimer)
                        clearTimeout(throttleTimer);
                    throttleTimer = setTimeout(() => {
                        throttleTimer = null;
                        try {
                            readStream.resume();
                        }
                        catch { /* ignore */ }
                    }, delayMs);
                }
            });
            readStream.on('end', () => {
                if (throttleTimer) {
                    clearTimeout(throttleTimer);
                    throttleTimer = null;
                }
                log('WAV 文件推送完毕');
                // 标记流传输结束，防止后续 setProgress 访问已销毁的 RTSP socket
                if (activeSession) {
                    activeSession.streaming = false;
                    if (onStreamComplete)
                        onStreamComplete();
                }
                resolve();
            });
            readStream.on('error', (err) => {
                if (throttleTimer) {
                    clearTimeout(throttleTimer);
                    throttleTimer = null;
                }
                logError('WAV 读取错误:', err.message);
                reject(err);
            });
        }
        else {
            // 非标准 WAV: 通过 ffmpeg 重采样
            node_fs_1.default.closeSync(fd);
            log(`WAV 非标准格式 (${header?.bitsPerSample}bit/${header?.sampleRate}Hz)，使用ffmpeg转码`);
            feedViaFfmpeg(sender, filePath, undefined, onStreamComplete);
            resolve();
        }
    });
};
/**
 * 通过 ffmpeg 将音频转为 PCM 16bit LE stereo 44.1kHz 并推送
 */
const feedViaFfmpeg = (sender, source, onDurationDetected, onStreamComplete) => {
    const ffmpeg = (0, ffmpegPath_1.getFfmpegPath)();
    const args = [
        '-i', source,
        '-f', 's16le', // PCM 16-bit little-endian
        '-acodec', 'pcm_s16le',
        '-ar', '44100', // 44.1kHz
        '-ac', '2', // stereo
        '-loglevel', 'info', // info 级别以获取 Duration 行（Duration: HH:MM:SS.ms）
        'pipe:1', // 输出到 stdout
    ];
    log(`启动 ffmpeg: ${ffmpeg} ${args.join(' ')}`);
    const proc = (0, node_child_process_1.spawn)(ffmpeg, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (activeSession) {
        activeSession.ffmpegProcess = proc;
    }
    let chunkCount = 0;
    let totalBytes = 0;
    // 实时节流: ffmpeg 转码速度远快于实时，必须控制 PCM 发送速率
    // 否则 AirPlay 设备缓冲区溢出后，ffmpeg 结束 → 无数据 → 设备断开连接
    // PCM 数据速率: 44100 Hz × 2 channels × 2 bytes (16-bit) = 176,400 bytes/sec
    const PCM_BYTES_PER_SEC = 44100 * 2 * 2;
    const startTime = Date.now();
    let throttleTimer = null;
    let sendPcmWarned = false;
    // 保留 stderr 尾部若干行, 退出码非 0 时输出 (原先只记含 'rror' 的行，真因常被吞)
    const STDERR_TAIL_LINES = 15;
    let stderrTail = [];
    proc.stdout.on('data', (chunk) => {
        // 设备已断开/会话已停止或替换: 不再喂数据，暂停输出等 close 统一清理
        if (!activeSession || activeSession.ffmpegProcess !== proc) {
            try {
                proc.stdout?.pause();
            }
            catch { /* ignore */ }
            return;
        }
        chunkCount++;
        totalBytes += chunk.length;
        if (chunkCount === 1 || chunkCount % 1000 === 0) {
            log(`ffmpeg 输出: chunk#${chunkCount}, ${chunk.length} bytes, total=${totalBytes}`);
        }
        try {
            sender.sendPcm(chunk);
        }
        catch (err) {
            // 设备断开后库 buffer 已 ENDED, 继续 write 会抛错; 只记一次避免刷屏
            if (!sendPcmWarned) {
                sendPcmWarned = true;
                logWarn(`sendPcm 失败，后续 chunk 将被跳过: ${err.message}`);
            }
        }
        // 累计节流: 基于已发送总量计算期望时间，保证平均速率 = 实时
        const expectedMs = (totalBytes / PCM_BYTES_PER_SEC) * 1000;
        const elapsedMs = Date.now() - startTime;
        const delayMs = expectedMs - elapsedMs;
        if (delayMs > 10 && proc.stdout) {
            proc.stdout.pause();
            // 先清掉旧 timer 再赋值: 防止 stale timer 提前 resume 导致瞬间灌爆缓冲区
            // (本地文件可灌入 55MB PCM 常驻内存) 及 onStreamComplete 提前误触发
            if (throttleTimer)
                clearTimeout(throttleTimer);
            throttleTimer = setTimeout(() => {
                throttleTimer = null;
                try {
                    proc.stdout?.resume();
                }
                catch { /* ignore */ }
            }, delayMs);
        }
    });
    proc.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg) {
            stderrTail.push(msg);
            if (stderrTail.length > STDERR_TAIL_LINES)
                stderrTail.shift();
        }
        // 提取 Duration 用于自动切歌
        const durationMatch = msg.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
        if (durationMatch) {
            const sec = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseFloat(durationMatch[3]);
            log(`ffmpeg 检测到时长: ${sec}s`);
            // 通过回调更新 DMC 的 duration
            if (onDurationDetected)
                onDurationDetected(sec);
            return; // Duration 行不记录为警告
        }
        // 只记录实际错误和警告，跳过 info 级别的噪音
        if (msg && msg.includes('rror') && !msg.includes('Duration')) {
            logWarn('ffmpeg:', msg);
        }
    });
    proc.on('error', (err) => {
        logError('ffmpeg 进程错误:', err.message);
    });
    proc.on('close', (code) => {
        // 清理节流定时器
        if (throttleTimer) {
            clearTimeout(throttleTimer);
            throttleTimer = null;
        }
        if (activeSession && activeSession.ffmpegProcess === proc) {
            activeSession.ffmpegProcess = null;
        }
        if (code !== 0 && code !== null) {
            logWarn(`ffmpeg 退出码: ${code}`);
            if (stderrTail.length > 0) {
                logWarn(`ffmpeg stderr 尾部:\n${stderrTail.join('\n')}`);
            }
        }
        else {
            log('ffmpeg 转码完成');
        }
        // 标记流传输结束，防止后续 setProgress 访问已销毁的 RTSP socket
        // stopStream() 会先将 activeSession 置 null，此时不会触发回调，避免重复通知
        if (activeSession) {
            activeSession.streaming = false;
            if (onStreamComplete)
                onStreamComplete();
        }
    });
};
/**
 * 停止当前音频流 (幂等: 杀 ffmpeg、停 sender、清 activeSession)
 */
const stopStream = () => {
    log('stopStream 被调用');
    if (!activeSession) {
        log('stopStream: 无活跃会话，忽略');
        return;
    }
    // 终止 ffmpeg 进程
    if (activeSession.ffmpegProcess) {
        try {
            activeSession.ffmpegProcess.kill('SIGTERM');
        }
        catch { /* ignore */ }
        activeSession.ffmpegProcess = null;
    }
    // 停止发送器
    try {
        activeSession.sender.stop();
    }
    catch (err) {
        logWarn('停止发送器错误:', err.message);
    }
    activeSession.streaming = false;
    activeSession = null;
    log('音频流已停止');
};
exports.stopStream = stopStream;
/**
 * 获取当前活跃会话
 */
const getActiveSession = () => {
    return activeSession;
};
exports.getActiveSession = getActiveSession;
/**
 * 检查是否有活跃的流式传输
 */
const isStreaming = () => {
    return activeSession?.streaming || false;
};
exports.isStreaming = isStreaming;
// ==================== Controls ====================
/**
 * 设置元数据 (歌曲信息 + 封面)
 * 某些设备不支持 SETART (返回 500)，需 try/catch 防止 RTSP socket 失效后崩溃
 */
const setMetadata = async (metadata) => {
    if (!activeSession)
        return;
    try {
        await activeSession.sender.setMetadata(metadata);
    }
    catch (err) {
        logWarn(`setMetadata 失败: ${err.message}`);
    }
};
exports.setMetadata = setMetadata;
/**
 * 设置音量 (0-100)
 */
const setVolume = (volume) => {
    if (!activeSession)
        return;
    try {
        activeSession.sender.setVolume(Math.max(0, Math.min(100, Math.round(volume))));
    }
    catch (err) {
        // RTSP socket 可能已被库置 null (ECONNRESET 后)，静默忽略
    }
};
exports.setVolume = setVolume;
/**
 * 设置播放进度 (秒)
 *
 * 库内部 Client.setProgress() 调用 sendNextRequest() (async) 但不返回其 Promise，
 * 导致异步 rejection 无法被 try/catch 或 result.catch() 捕获。
 * 必须在调用前确保 RTSP 连接仍然有效 (streaming=true)，否则 socket 为 null 时会崩溃。
 */
const setProgress = (elapsedSec, durationSec) => {
    if (!activeSession || !activeSession.streaming)
        return;
    try {
        // 库类型声明为 void，实际可能返回 Promise，用 any 绕过类型检查
        const result = activeSession.sender.setProgress(elapsedSec, durationSec);
        // 库可能返回 Promise，异步拒绝不会被 try/catch 捕获，需单独处理
        if (result && typeof result.catch === 'function') {
            result.catch(() => { });
        }
    }
    catch (err) {
        // RTSP socket 可能已被库置 null (ECONNRESET 后)，静默忽略
    }
};
exports.setProgress = setProgress;
/**
 * 获取连接的设备信息
 */
const getConnectedDevice = () => {
    return activeSession?.device || null;
};
exports.getConnectedDevice = getConnectedDevice;
// ==================== Helpers ====================
/**
 * 从 HTTP URL 下载音频并通过 ffmpeg 转码推送
 * (用于在线音频流)
 */
const streamFromUrl = async (device, audioUrl, metadata) => {
    // 对于 HTTP URL，直接传给 ffmpeg（ffmpeg 支持 HTTP 输入）
    return (0, exports.startStream)(device, { source: audioUrl, metadata });
};
exports.streamFromUrl = streamFromUrl;
/**
 * 探测音频文件时长（使用 ffmpeg -i，不转码，约 50-100ms）
 * @returns 时长（秒），失败返回 0
 */
const probeAudioDuration = (source) => {
    return new Promise((resolve) => {
        const ffmpeg = (0, ffmpegPath_1.getFfmpegPath)();
        const proc = (0, node_child_process_1.spawn)(ffmpeg, ['-i', source, '-f', 'null', '-'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let durationSec = 0;
        let stderrData = '';
        proc.stderr.on('data', (data) => {
            stderrData += data.toString();
        });
        proc.on('close', () => {
            // 解析 Duration: HH:MM:SS.ms
            const match = stderrData.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
            if (match) {
                durationSec = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
            }
            resolve(durationSec);
        });
        proc.on('error', () => {
            resolve(0);
        });
        // 超时保护：3秒
        setTimeout(() => {
            try {
                proc.kill('SIGTERM');
            }
            catch { /* ignore */ }
            resolve(0);
        }, 3000);
    });
};
exports.probeAudioDuration = probeAudioDuration;
