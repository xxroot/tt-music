// ========== Playback - 核心播放引擎 ==========
// 负责歌曲解析、播放控制、播放状态管理、音频事件处理。
// 依赖全局: sendDlnaCommand, upnpSetVolume, upnpSeekTo, toggleLove, renderMyLists, settings
// ==================================================

// --- 播放状态 (从 app.js 迁移) ---
let currentPlaylist = [];
let currentIndex = -1;
let preSelectedNextIndex = null; // 预先选定的下一首索引 (用于确保随机模式下的预读一致性)
// [ML-06 优化] Fisher-Yates 随机播放索引系统，避免重复和 O(n) 拒绝采样
let shuffleOrder = []; // 乱序索引数组
let shufflePos = -1; // 当前乱序播放位置
let currentPlayingScope = 'network'; // Scope for active playback
let currentPlayingSong = null; // Track currently playing song independently of view
let currentPlaybackRate = 1.0;

Object.defineProperty(window, 'currentPlaylist', { get() { return currentPlaylist; }, set(v) { currentPlaylist = v; }, configurable: true });
Object.defineProperty(window, 'currentIndex', { get() { return currentIndex; }, set(v) { currentIndex = v; }, configurable: true });
Object.defineProperty(window, 'preSelectedNextIndex', { get() { return preSelectedNextIndex; }, set(v) { preSelectedNextIndex = v; }, configurable: true });
Object.defineProperty(window, 'shuffleOrder', { get() { return shuffleOrder; }, set(v) { shuffleOrder = v; }, configurable: true });
Object.defineProperty(window, 'shufflePos', { get() { return shufflePos; }, set(v) { shufflePos = v; }, configurable: true });
Object.defineProperty(window, 'currentPlayingScope', { get() { return currentPlayingScope; }, set(v) { currentPlayingScope = v; }, configurable: true });
Object.defineProperty(window, 'currentPlayingSong', { get() { return currentPlayingSong; }, set(v) { currentPlayingSong = v; }, configurable: true });
Object.defineProperty(window, 'currentPlaybackRate', { get() { return currentPlaybackRate; }, set(v) { currentPlaybackRate = v; }, configurable: true });

const audio = document.getElementById('audio-player');

// --- 音量与播放模式 (从 app.js 迁移) ---
let currentVolume = 0.75; // 默认音量 75%
let isMuted = false;
Object.defineProperty(window, 'currentVolume', { get() { return currentVolume; }, set(v) { currentVolume = v; }, configurable: true });
Object.defineProperty(window, 'isMuted', { get() { return isMuted; }, set(v) { isMuted = v; }, configurable: true });

let playMode = 'order'; // 'list': 列表循环, 'single': 单曲循环, 'random': 随机播放, 'order': 顺序播放
Object.defineProperty(window, 'playMode', { get() { return playMode; }, set(v) { playMode = v; }, configurable: true });

// Playback Logic
let currentLoadingSongId = null; // Track currently loading song
let loadingRequestCounter = 0;   // To identify unique play requests
let currentLoadingRequestId = 0; // Track latest request ID

let currentQuality = null; // 当前播放音质 (从 settings.preferredQuality 动态获取)
let currentSourceType = 'normal'; // 当前链接来源类型: 'normal' | 'cache' | 'server_cache'
let hintTimeout = null;

// 获取来源类型的中文描述
function getSourceTypeText(sourceType) {
    const map = {
        'server_cache': '服务器',
        'cache': '浏览器链接缓存',
        'normal': '在线解析'
    };
    return map[sourceType] || '解析成功';
}

// --- Expiration & Prefetch Management ---
/**
 * 探活 URL 是否依然有效 (不下载数据，仅检查响应状态)
 * @param {string} url
 * @returns {Promise<boolean>}
 */
async function probeUrl(url) {
    if (!url) return false;
    // 本地 API 或 代理路径通常被认为有效
    if (url.startsWith('/') || url.includes(window.location.host)) return true;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT.URL_RESOLVE); // 5秒超时

        // 使用 Range 请求 0-1 字节，以最小代价触发 CORS 检查和链接有效性验证
        const response = await fetch(url, {
            method: 'GET',
            headers: {'Range': 'bytes=0-1'},
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        // 返回 200 或 206 表示链接依然可用
        return response.ok;
    } catch (e) {
        console.warn(`[Probe] URL probe failed: ${url.substring(0, 40)}...`, e.message);
        return false;
    }
}

const prefetchManager = {
    cache: new Map(), // Map<songId, {url, quality, sourceType, timestamp}>
    bufferer: new Audio(), // 隐藏的缓冲器，用于预加载数据流

    init() {
        this.bufferer.muted = true;
        this.bufferer.preload = 'auto'; // 强制浏览器尽可能多地预缓冲
    },

    set(songId, data) {
        this.cache.set(songId, {...data, timestamp: Date.now()});

        // 核心升级：触发数据流预加载
        if (data.url) {
            this.bufferer.src = data.url;
            this.bufferer.load(); // 诱导浏览器开始填充缓冲区
        }

        if (this.cache.size > 5) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }
    },
    get(songId) {
        const data = this.cache.get(songId);
        if (data && (Date.now() - data.timestamp < 30 * 60 * 1000)) { // 30分钟过期
            return data;
        }
        return null;
    },
    clear() {
        this.cache.clear();
        this.bufferer.src = '';
    }
};
prefetchManager.init(); // 立即初始化缓冲器

// --- Handle Missing Local File ---
// When a local file is missing (deleted), this function:
// 1. Tries to download from online sources
// 2. If download succeeds, plays the downloaded file
// 3. If download also fails, deletes the DB record and marks song as unplayable
// 4. Auto-skips to next song
async function handleMissingLocalFile(song, index) {
    // Prevent double-handling (e.g., both audio error and UPNP status update can trigger this)
    if (song._handlingMissing) return;
    song._handlingMissing = true;

    // [LOG CLEANED] console.log(`[MissingFile] Local file missing for: ${song.name}, trying online download...`);
    showInfo(`本地文件缺失: ${song.name}, 正在尝试线上下载...`);

    // Clear server_cache path markers to force online resolution
    const savedServerCachePath = song._serverCachePath;
    delete song._serverCachePath;
    song._isMusicLibSong = false;

    try {
        // [4.5] 本地音乐缺失时只下载无损及以上音质，优先尝试无损解析
        let targetQuality = window.QualityManager.getBestDownloadQuality(song, settings.preferredQuality || 'flac24bit');
        if (!targetQuality) {
            // Music lib song may not have types info, try default lossless quality
            targetQuality = 'flac24bit';
        }
        const urlResult = await resolveSongUrl(song, targetQuality, false, true);

        if (urlResult && urlResult.url && urlResult.sourceType !== 'server_cache') {
            // Online resolution succeeded - play it
            // _isMusicLibSong and _serverCachePath are already cleared,
            // so playSong will resolve to the online URL which works on UPNP devices too
            // [LOG CLEANED] console.log(`[MissingFile] Online resolution succeeded for: ${song.name} (quality: ${urlResult.quality})`);

            // [4.5] 只有实际解析为无损及以上音质才标记为需要保存到 music/
            if (window.QualityManager.isLosslessQuality(urlResult.quality)) {
                showSuccess(`无损下载成功: ${song.name} (${urlResult.quality})`);
                // [4.4] 标记为原本地音乐库歌曲，triggerServerCache 会下载到 music/ 并写 DB
                song._wasMusicLibSong = true;
            } else {
                showInfo(`无损不可用，以 ${urlResult.quality} 播放: ${song.name}`);
                // [4.5] 非无损音质不保存到 music/ 目录
                song._wasMusicLibSong = false;
            }
            playSong(song, index);
            return true;
        }
    } catch (e) {
        console.warn(`[MissingFile] Lossless resolution failed for: ${song.name}`, e.message);
        // [4.5] 无损解析失败，尝试任意音质播放（但不保存到 music/ 目录）
        try {
            const fallbackQuality = window.QualityManager.getBestQuality(song, settings.preferredQuality || '320k');
            const fallbackResult = await resolveSongUrl(song, fallbackQuality, false, true);
            if (fallbackResult && fallbackResult.url && fallbackResult.sourceType !== 'server_cache') {
                showInfo(`无损不可用，以 ${fallbackResult.quality} 播放: ${song.name}`);
                // [4.5] 非无损音质不保存到 music/ 目录
                song._wasMusicLibSong = false;
                playSong(song, index);
                return true;
            }
        } catch (e2) {
            console.warn(`[MissingFile] Fallback resolution also failed for: ${song.name}`, e2.message);
        }
    }

    // Online resolution also failed - delete DB record and mark as unplayable
    song._unplayable = true;
    // [LOG CLEANED] console.log(`[MissingFile] Marking as unplayable: ${song.name}`);
    showError(`文件缺失且无法下载: ${song.name}, 已自动跳过`);

    // Try to delete DB record in background (fire-and-forget)
    if (savedServerCachePath) {
        try {
            const headers = {'Content-Type': 'application/json'};
            Object.assign(headers, getUserAuthHeaders());
            fetch('/api/music/cache/remove', {
                method: 'POST',
                headers,
                body: JSON.stringify({filenames: [savedServerCachePath]})
            }).catch(() => {
            }); // Ignore errors
            // [LOG CLEANED] console.log(`[MissingFile] DB record deletion requested for: ${savedServerCachePath}`);
        } catch (e) { /* ignore */
        }
    }

    // Auto-skip to next song
    setTimeout(() => playNext(), 500);
    return false;
}

// --- URL Fetching Logic (Unified Resolution) ---

/** 判断是否为本地库歌曲 */
function isLocalLibrarySong(song) {
    return song.source && String(song.source) === 'local';
}

/**
 * 统一的歌曲解析入口，支持播放和预读调用
 * 包含：本地/服务器缓存检查、在线解析、自动降级逻辑
 */
async function resolveSongUrl(song, quality, isSilent = false, isRetry = false, download = false) {
    // directUrl 快速路径: DLNA DMS / 电台等已有直连 URL 的歌曲
    if (song.directUrl) {
        return {url: song.directUrl, sourceType: 'normal', quality: song.quality || quality};
    }

    // 本地库歌曲快速路径: 直接通过 POST /api/music/file/check 解析
    if (isLocalLibrarySong(song)) {
        const relativePath = song.relativePath || song._serverCachePath || '';
        if (relativePath) {
            try {
                const headers = {'Content-Type': 'application/json'};
                Object.assign(headers, getUserAuthHeaders());
                const res = await fetch('/api/music/file/check', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        source: song.source,
                        relativePath: relativePath,
                        downloadOrPlay: !!download
                    })
                });
                const data = await res.json();
                if (data.exists) {
                    const fileUrl = `/api/music/cache/file/${encodeURIComponent(song.source)}/${encodeURIComponent(relativePath)}`;
                    const resolvedUrl = await applyAutoProxy(fileUrl, song);
                    // Enrich song with audio metadata
                    if (data.sampleRate) song.sampleRate = data.sampleRate;
                    if (data.bitDepth) song.bitDepth = data.bitDepth;
                    if (data.channels) song.channels = data.channels;
                    if (data.bitRate) song.bitRate = data.bitRate;
                    return {url: resolvedUrl, sourceType: 'server_cache', quality, folder: 'local'};
                }
            } catch (err) {
                console.error('[Resolve] Local library check failed:', err);
            }
        }
        // 本地库文件不存在
        if (!isSilent) showInfo('本地库文件不存在: ' + song.name);
        return {url: null, sourceType: 'not_found', quality};
    }

    // [优化] 统一服务端缓存检查 (合并音乐库歌曲和普通歌曲的检查逻辑)
    // 音乐库歌曲: 验证 _serverCachePath 指向的文件是否仍存在
    // 普通歌曲: 在 preferServerCache 开启时检查服务端缓存
    // 两者都通过 checkServerCache 一次调用完成 (GET /api/music/file/check)，避免 HEAD 二次请求
    const shouldCheckServerCache = !isRetry && (
        (song._isMusicLibSong && song._serverCachePath) ||
        (!song._isMusicLibSong && settings.preferServerCache)
    );
    if (shouldCheckServerCache) {
        console.log('[Resolve] Checking server cache for:', song.name, quality);
        // const cleanedSong = cleanSongData(song);
        const serverCacheResult = await window.checkServerCache(song, quality);
        if (serverCacheResult) {
            // 命中服务端缓存，应用代理逻辑并返回
            // [优化] 音乐库歌曲的文件若在 cache/ 目录中，自动移动到 music/ 目录
            if (serverCacheResult.folder === 'cache' && song._isMusicLibSong) {
                const moveHeaders = {'Content-Type': 'application/json'};
                Object.assign(moveHeaders, getUserAuthHeaders());
                const moveBody = JSON.stringify({relativePath: serverCacheResult.relativePath || ''});
                if (isSilent) {
                    // prefetchNextSong 调用: 异步执行，不阻塞播放
                    fetch('/api/music/cache/move-to-music', {
                        method: 'POST', headers: moveHeaders, body: moveBody
                    }).catch(e => console.warn('[MoveToMusic] Async move failed:', e.message));
                } else {
                    // playSong 直接调用: 同步等待移动完成
                    try {
                        await fetch('/api/music/cache/move-to-music', {
                            method: 'POST', headers: moveHeaders, body: moveBody
                        });
                    } catch (e) {
                        console.warn('[MoveToMusic] Move failed, continuing playback:', e.message);
                    }
                }
            }

            const resolvedUrl = await applyAutoProxy(serverCacheResult.url, song);
            // Enrich song with audio metadata from local file
            if (serverCacheResult.sampleRate) song.sampleRate = serverCacheResult.sampleRate;
            if (serverCacheResult.bitDepth) song.bitDepth = serverCacheResult.bitDepth;
            if (serverCacheResult.channels) song.channels = serverCacheResult.channels;
            if (serverCacheResult.bitRate) song.bitRate = serverCacheResult.bitRate;
            return {url: resolvedUrl, sourceType: 'server_cache', quality, folder: serverCacheResult.folder};
        }
        // 缓存未命中
        if (song._isMusicLibSong) {
            // 音乐库文件不存在(已被删除)，清除标记后走在线解析
            console.warn(`[Resolve] Local file not found for "${song.name}", falling back to online resolution`);
            delete song._serverCachePath;
            song._isMusicLibSong = false;
            song._wasMusicLibSong = true;
        }
    } else if (isRetry && song._isMusicLibSong && song._serverCachePath) {
        // 重试时跳过存在性检查（首次已验证或网络问题，文件状态不太可能变化）
        const cacheUrl = `/api/music/cache/file/${encodeURIComponent(song._serverCachePath)}`;
        return {url: cacheUrl, sourceType: 'server_cache', quality};
    }

    // 服务端缓存未命中，调用 fetchSongUrl 进行在线解析（不再重复检查缓存）
    try {
        console.log('[Resolve] Online resolution for:', song.name, quality);
        const result = await fetchSongUrl(song, quality, isRetry, isSilent, download);
        if (result.errorMsg) throw new Error(result.errorMsg);
        return result;
    } catch (error) {
        // 区分"平台不支持"和"解析失败"
        const isPlatformNotSupported = error.message && (
            error.message.includes('未找到支持') ||
            error.message.includes('not supported')
        );

        // 如果不是平台问题，且还有下级音质，递归尝试降级
        const nextQuality = isPlatformNotSupported ? null : window.QualityManager.getNextLowerQuality(quality, song);

        if (nextQuality) {
            if (!isSilent) {
                const fromName = window.QualityManager.getQualityDisplayName(quality);
                const toName = window.QualityManager.getQualityDisplayName(nextQuality);
                showInfo(`从 ${fromName} 降级到 ${toName} 播放...`);
            }
            return await resolveSongUrl(song, nextQuality, isSilent, true);
        }

        // 核心增强：如果质量降级也失败了，且开启了自动尝试换源
        if (settings.enableAutoSwitchSource && !isSilent) {
            // [LOG CLEANED] console.log(`[AutoSource] 原始源解析失败，准备尝试全网匹配: ${song.name}`);
            const matchedSong = await findOtherSourceMatch(song);
            if (matchedSong) {
                showInfo(`找到备选源，尝试从 ${getSourceName(matchedSong.source)} 播放...`);
                // 递归调用 resolveSongUrl 以复用缓存检查逻辑，但不再允许再次换源（避免死循环）
                const bestNextQuality = window.QualityManager.getBestQuality(matchedSong, settings.preferredQuality || '320k');
                // 临时禁用换源，避免死循环
                const originalEnableAutoSwitch = settings.enableAutoSwitchSource;
                settings.enableAutoSwitchSource = false;
                try {
                    return await resolveSongUrl(matchedSong, bestNextQuality, isSilent, true);
                } finally {
                    settings.enableAutoSwitchSource = originalEnableAutoSwitch;
                }
            }
        }

        // 所有尝试均失败，直接抛出错误
        throw error;
    }
}

/**
 * 跨平台寻找相同歌曲的匹配逻辑
 * 基本规则：歌名+歌手+时长匹配
 */
async function findOtherSourceMatch(song) {
    if (!song.name || !song.singer) return null;

    try {
        const query = `${song.name} ${song.singer}`;
        const headers = {'Content-Type': 'application/json'};
        Object.assign(headers, getUserAuthHeaders());

        showInfo('正在自动尝试换源匹配...');

        // 仅在主流源中搜索
        const searchSources = ['kw', 'kg', 'tx', 'wy', 'mg'].filter(s => s !== song.source);
        const searchPromises = searchSources.map(s =>
            fetch(`${API_BASE}/search?name=${encodeURIComponent(query)}&source=${s}&page=1`, {headers})
                .then(res => res.json())
                .then(data => Array.isArray(data) ? data.map(item => ({...item, source: s})) : [])
                .catch(() => [])
        );

        const allResults = await Promise.all(searchPromises);
        const flatResults = allResults.flat();

        if (flatResults.length === 0) return null;

        const targetDuration = timeToSeconds(song.interval);
        const cleanedTargetName = song.name.toLowerCase().trim();

        // 匹配算法
        for (const item of flatResults) {
            const itemDuration = timeToSeconds(item.interval);
            const durationDiff = Math.abs(targetDuration - itemDuration);

            // 1. 时长校验：误差在 5 秒以内
            if (durationDiff > 5) continue;

            // 2. 歌名校验：简单包含或相等（忽略大小写）
            const cleanedItemName = item.name.toLowerCase().trim();
            if (!cleanedItemName.includes(cleanedTargetName) && !cleanedTargetName.includes(cleanedItemName)) continue;

            // 3. 歌手校验：简单比对
            if (item.singer && song.singer) {
                const cleanedItemSinger = item.singer.toLowerCase();
                const cleanedTargetSinger = song.singer.toLowerCase();
                if (!cleanedItemSinger.includes(cleanedTargetSinger) && !cleanedTargetSinger.includes(cleanedItemSinger)) continue;
            }

            // [LOG CLEANED] console.log(`[AutoSource] 匹配成功: ${item.name} via ${item.source} (时长误差: ${durationDiff}s)`);
            return item;
        }

        // [LOG CLEANED] console.log(`[AutoSource] 未找到合适的匹配结果 (Total searched: ${flatResults.length})`);
        return null;
    } catch (e) {
        console.warn('[AutoSource] 匹配逻辑执行出错:', e);
        return null;
    }
}

/**
 * 辅助：将 mm:ss 转换为秒数
 */
function timeToSeconds(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return 0;
    const parts = timeStr.split(':');
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }
    return 0;
}

/**
 * 辅助：获取源名称
 */
function getSourceName(source) {
    const names = {kw: '酷我', kg: '酷狗', tx: 'QQ', wy: '网易', mg: '咪咕'};
    return names[source] || source.toUpperCase();
}

/**
 * 统一应用代理逻辑，处理 HTTPS 环境下的 HTTP 链接
 * 增强：优先尝试将 HTTP 升级为 HTTPS 并探测可用性，失败后再回退到服务器代理
 */
async function applyAutoProxy(url, song) {
    if (!url) return url;

    // 已经过代理或为本地路径的无需处理
    if (url.startsWith('/api/music/download') || url.startsWith('/') || url.includes(window.location.host)) {
        return url;
    }

    // 优先级 1：如果手动开启了“播放音乐代理”，则无条件走代理 (用于解决 IP 封锁或跨域限制)
    if (settings.enableProxyPlayback) {
        // 如果同时启用了自定义代理，优先使用（客户端直接请求，不经服务器中转）
        if (settings.enableCustomProxy && settings.customProxyUrl) {
            const proxyUrl = settings.customProxyUrl.replace('{url}', url);
            return proxyUrl;
        }
        const filename = `${song.singer} - ${song.name}.mp3`;
        return `/api/music/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&inline=1`;
    }

    const isHttpsEnv = window.location.protocol === 'https:';
    const isHttpLink = url.startsWith('http://');

    // 优先级 2：HTTPS 环境下遇到 HTTP 链接的自动处理 (探测升级或自动代理)
    if (isHttpsEnv && isHttpLink) {
        // 尝试自动升级协议，减少代理开销
        const httpsUrl = url.replace('http://', 'https://');

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), TIMEOUT.NETWORK_PROBE); // 2秒探测超时

            const response = await fetch(httpsUrl, {
                method: 'GET',
                headers: {'Range': 'bytes=0-1'},
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                return httpsUrl;
            }
        } catch (e) {
            console.warn(`[Proxy] HTTPS Probe failed, falling back to auto-proxy: ${song.name}`);
        }

        // 探测失败，如果开启了“自动代理”，则走服务器代理以通过 Mixed Content 检查
        if (settings.enableAutoProxy) {
            // 优先使用自定义代理（客户端直接请求，不经服务器中转）
            if (settings.enableCustomProxy && settings.customProxyUrl) {
                const proxyUrl = settings.customProxyUrl.replace('{url}', url);
                return proxyUrl;
            }
            const filename = `${song.singer} - ${song.name}.mp3`;
            return `/api/music/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}&inline=1`;
        }
    }

    return url;
}

async function fetchSongUrl(song, quality, isRetry = false, isSilent = false, download = false) {
    const cleanedSong = window.cleanSongData(song);
    const cacheKey = `lx_url_${cleanedSong.id}_${quality}`;

    // [优化] 检查本地链接缓存（localStorage），不再检查服务端缓存（已由 resolveSongUrl 统一处理）
    const allowLinkCache = !isRetry && settings.enableSongUrlCache !== false;
    if (allowLinkCache) {
        let cachedUrl = localStorage.getItem(cacheKey);
        if (cachedUrl) {
            // 核心修复：命中本地缓存时也必须应用代理逻辑，否则 HTTPS 下无法播放 HTTP 缓存链接
            cachedUrl = await applyAutoProxy(cachedUrl, song);
            return {url: cachedUrl, sourceType: 'cache', quality};
        }
    }

    const reqId = Math.random().toString(36).slice(2) + Date.now().toString(36);
    let progressEs = null;
    try {
        progressEs = new EventSource(`/api/music/progress?reqId=${reqId}`);
        progressEs.onmessage = (e) => {
            if (isSilent) return;
            try {
                const attempt = JSON.parse(e.data);
                const songNamePrefix = attempt.name || song.name || '';
                const msg = `[${songNamePrefix}] ${attempt.message || (attempt.status === 'success' ? '解析成功' : '解析失败')}`;
                if (attempt.status === 'success') showSuccess(msg);
                else showError(msg);
            } catch (_) {
            }
        };
    } catch (_) {
    }

    const headers = {'Content-Type': 'application/json'};
    // 携带认证信息 (Token 或密码)
    Object.assign(headers, getUserAuthHeaders());
    headers['x-req-id'] = reqId;

    try {
        const res = await fetch(`${API_BASE}/url`, {
            method: 'POST',
            headers,
            body: JSON.stringify({songInfo: song, quality})
        });

        if (!res.ok) {
            let errorMsg = `HTTP ${res.status}`;
            let result = {};
            try {
                result = await res.json();
                if (result.error) errorMsg = result.error;
            } catch (e) {
            }
            throw {message: errorMsg, attempts: result.attempts};
        }

        const result = await res.json();
        if (result.url) {
            // 使用异步统一代理函数
            const finalUrl = await applyAutoProxy(result.url, song);

            if (settings.enableSongUrlCache !== false) {
                try {
                    localStorage.setItem(cacheKey, finalUrl);
                    updateStorageStatsUI();
                } catch (e) {
                }
            }
            // [4.5] 传递实际解析音质给 triggerServerCache，确保音质验证准确
            // [4.5] 本地音乐缺失时，即使未开启服务端缓存，也要下载（仅无损保存到 music/）
            console.log('[Resolve] Online Success:', 'result.type:', result.type)
            const actualQuality = result.type || quality;
            console.log('[Resolve] Online Success:', 'Quality:', actualQuality, 'enableServerCache:', settings.enableServerCache, '_wasMusicLibSong', song._wasMusicLibSong, 'download', download)
            if (!download && (settings.enableServerCache || song._wasMusicLibSong)) {
                window.triggerServerCache(song, finalUrl, actualQuality);
            }
            // [LOG CLEANED] console.log(`[Resolve] Online Success: ${song.name} via ${result.sourceName || 'Unknown'}`);
            return {
                url: finalUrl,
                sourceType: 'normal',
                quality: result.type || quality,
                sourceName: result.sourceName,
                errorMsg: result.errorMsg
            };
        }
        throw new Error('服务器未返回播放链接');
    } finally {
        if (progressEs) {
            progressEs.close();
            progressEs = null;
        }
    }
}

// ============================================================================
// 核心播放控制 (Core Playback Controls)
// ============================================================================
function getNextIndex() {
    if (!currentPlaylist || currentPlaylist.length === 0) return -1;

    // [Random Prefetch Fix] 如果处于随机播放模式，且已有预选内容，优先返回预选
    if (playMode === 'random' && preSelectedNextIndex !== null) {
        if (preSelectedNextIndex >= 0 && preSelectedNextIndex < currentPlaylist.length) {
            return preSelectedNextIndex;
        }
        preSelectedNextIndex = null; // 重置失效索引
    }

    let nextIndex;
    switch (playMode) {
        case 'single':
            nextIndex = currentIndex;
            break;
        case 'random':
            // [ML-06 优化] Fisher-Yates 洗牌索引系统，避免重复和 O(n) 拒绝采样
            if (currentPlaylist.length === 1) {
                nextIndex = 0;
            } else if (shuffleOrder.length === 0 || shuffleOrder.length !== currentPlaylist.length) {
                // 洗牌索引未初始化或播放列表已变更，重新生成
                shuffleOrder = generateShuffleOrder(currentPlaylist.length, currentIndex);
                shufflePos = 0;
                nextIndex = shuffleOrder[shufflePos];
            } else {
                shufflePos++;
                if (shufflePos >= shuffleOrder.length) {
                    // 所有歌曲已播放一遍，重新洗牌
                    shuffleOrder = generateShuffleOrder(currentPlaylist.length, currentIndex);
                    shufflePos = 0;
                }
                nextIndex = shuffleOrder[shufflePos];
                // 避免与当前歌曲重复
                if (nextIndex === currentIndex && currentPlaylist.length > 1) {
                    shufflePos++;
                    if (shufflePos >= shuffleOrder.length) {
                        shuffleOrder = generateShuffleOrder(currentPlaylist.length, currentIndex);
                        shufflePos = 0;
                    }
                    nextIndex = shuffleOrder[shufflePos];
                }
            }
            break;
        case 'order':
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) {
                // [Album Auto-Advance] 顺序播放模式下，当前专辑播完后自动切换到下一专辑
                if (currentPlayingScope === 'album' && window._currentAlbumIndex >= 0 && _albumLibData.length > 0) {
                    return -2; // Special sentinel: album ended, should advance to next album
                }
                return -1;
            }
            break;
        case 'list':
        default:
            nextIndex = currentIndex + 1;
            if (nextIndex >= currentPlaylist.length) nextIndex = 0;
            break;
    }
    return nextIndex;
}

// Prefetch next song helper (Recursive Discovery)
async function prefetchNextSong(startFromIndex = null, depth = 0) {
    if (settings.enablePreloader === false || depth > 5) return;

    let targetIndex = startFromIndex;
    if (targetIndex === null) {
        targetIndex = getNextIndex();
        // [Random Prefetch Fix] 如果是随机模式，且尚未有预选结果，将本次生成的索引存入预选
        if (playMode === 'random' && preSelectedNextIndex === null) {
            preSelectedNextIndex = targetIndex;
        }
    }
    // -1: no next song; -2: album ended sentinel (handled by playNext, not prefetch)
    if (targetIndex === -1 || targetIndex === -2 || targetIndex === currentIndex) return;

    const nextSong = currentPlaylist[targetIndex];
    if (!nextSong) return;

    // 如果这首已经被标记为不可播放，拉下一首
    if (nextSong._unplayable) {
        const followingIndex = (targetIndex + 1) >= currentPlaylist.length ? 0 : targetIndex + 1;
        return prefetchNextSong(followingIndex, depth + 1);
    }

    try {
        const targetQual = window.QualityManager.getBestQuality(nextSong, settings.preferredQuality || '320k');

        // 1. 检查内存缓存
        let result = prefetchManager.get(nextSong.id);
        if (result) {
            if (await probeUrl(result.url)) return;
            prefetchManager.cache.delete(nextSong.id);
        }

        // 2. 复用统一解析逻辑 (resolveSongUrl)，且开启静默模式
        result = await resolveSongUrl(nextSong, targetQual, true);

        // 3. 探活获取到的链接
        if (!(await probeUrl(result.url))) {
            localStorage.removeItem(`lx_url_${window.cleanSongData(nextSong).id}_${targetQual}`);
            result = await resolveSongUrl(nextSong, targetQual, true, true);
        }

        prefetchManager.set(nextSong.id, result);
        const sourceDesc = getSourceTypeText(result.sourceType);

    } catch (e) {
        console.warn(`[Prefetch] Skip unplayable [${nextSong.name}]:`, e.message);
        nextSong._unplayable = true; // 标记

        // 递归探测
        const followingIndex = (targetIndex + 1) >= currentPlaylist.length ? 0 : targetIndex + 1;
        if (followingIndex !== currentIndex) {
            return prefetchNextSong(followingIndex, depth + 1);
        }
    }
}

// [管理员认证已移至 js/auth.js]

// [triggerServerCache 已提取到 js/cache-manager.js]

/**
 * playFromView handles user click on a song in the search/list view.
 * It ensures the playback queue is updated to match the viewed list.
 */
function playFromView(index) {
    if (!viewingPlaylist || !viewingPlaylist[index]) return;
    // Update playlist and scope when user explicitly clicks a song to play
    updatePlaylist(viewingPlaylist, index, currentSearchScope);
}

/**
 * 刷新所有可能显示"正在播放"指示的可见列表
 * 在切歌时调用，确保各列表高亮与当前播放歌曲同步
 * 仅在对应视图可见时调用对应渲染函数，避免无谓重渲染
 */
function refreshVisiblePlayingIndicators() {
    // 播放队列
    const queueDrawer = document.getElementById('queue-drawer');
    if (queueDrawer && !queueDrawer.classList.contains('translate-x-full')) {
        if (typeof window.renderQueue === 'function') window.renderQueue();
    }
    // 专辑详情
    if (window._albumLibCurrentAlbum && typeof window.renderAlbumDetailList === 'function') {
        window.renderAlbumDetailList();
    }
    // 音乐库
    const musiclibView = document.getElementById('view-musiclib');
    if (musiclibView && !musiclibView.classList.contains('hidden') &&
        typeof _musicLibFiltered !== 'undefined' && _musicLibFiltered.length &&
        typeof window.renderMusicLibList === 'function') {
        window.renderMusicLibList();
    }
    // 文件夹库
    const folderView = document.getElementById('view-folderlib');
    if (folderView && !folderView.classList.contains('hidden') &&
        typeof window.renderFolderSongList === 'function') {
        window.renderFolderSongList();
    }
    // 歌手库歌曲面板
    const singerView = document.getElementById('view-singerlib');
    if (singerView && !singerView.classList.contains('hidden') &&
        typeof window.renderSingerSongsPanel === 'function') {
        window.renderSingerSongsPanel();
    }
}

async function playSong(song, index, forceQuality = null, noPlay = false, isRetry = false, shouldAddToDefault = null) {
    // 恢复底部 Footer Visualizer（从电台切换回歌曲播放时）
    const vizContainer = document.getElementById('visualizer-container');
    if (vizContainer) vizContainer.style.display = '';

    // 1. Debounce / Lock: If already loading this song, ignore click
    // [Fix] Allow retry to bypass this check
    if (currentLoadingSongId === song.id && !isRetry) {
        return;
    }
    // console.log("当前将要播放的:",song,index)

    // 2. New Song Request: Update target
    const thisRequestSongId = song.id;
    // Clear any pending auto-skip timer
    if (window._autoSkipTimer) {
        clearTimeout(window._autoSkipTimer);
        window._autoSkipTimer = null;
    }

    const thisRequestId = ++loadingRequestCounter;
    currentLoadingSongId = thisRequestSongId;
    currentLoadingRequestId = thisRequestId;

    currentIndex = index;
    // [Random Prefetch Fix] 一旦开始正式播放一首歌曲，清除之前的预选索引，以便下一轮重新生成
    preSelectedNextIndex = null;

    currentPlayingSong = song;
    // currentPlayingSong via Object.defineProperty setter
    updatePlayerInfo(song);
    updateMediaSessionMetadata(song);
    // Notify visualizer of song change (for random color mode)
    if (window.musicVisualizer && window.musicVisualizer.onSongChange) {
        window.musicVisualizer.onSongChange();
    }
    // 异步触发歌词抓取，初步尝试（此时音质可能尚未最终确定，但在 playSong 后续逻辑中会再次同步）
    fetchLyric(song);

    // 刷新所有可见列表的"正在播放"指示（播放队列/专辑/音乐库/文件夹库/歌手库）
    refreshVisiblePlayingIndicators();

    // [Fix] 切换歌曲前强制重置手动滚动状态
    isUserScrolling = false;
    if (scrollLockTimeout) {
        clearTimeout(scrollLockTimeout);
        scrollLockTimeout = null;
    }
    const indicator = document.getElementById('lyric-scroll-indicator');
    if (indicator) {
        indicator.classList.add('hidden');
        indicator.style.display = 'none';
    }

    // Show persistent loading toast
    if (!isRetry) {
        showInfo(`正在加载: ${song.name}...`);
    } else if (isRetry === true) {
        showInfo(`链接过期或失效，正在为您重新在线解析: ${song.name}...`);
    }

    // 处理切换提示的显示与隐藏
    const hint = document.getElementById('toggle-hint');
    if (hint) {
        // 重置为可见：清理内联样式，恢复 CSS 类定义的默认状态 (opacity-80, max-h-8, mt-2)
        hint.style.opacity = '';
        hint.style.maxHeight = '';
        hint.style.marginTop = '';
        hint.classList.remove('opacity-0');

        if (hintTimeout) clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => {
            // 强制使用内联样式隐藏并收起占位
            hint.style.opacity = '0';
            hint.style.maxHeight = '0px';
            hint.style.marginTop = '0px';
        }, 5000);
    }

    // 显示加载状态
    setPlayerStatus('正在准备播放', null, true);

    let targetQuality = forceQuality;
    let isPrefetchFound = false;
    let urlResult = null;

    // 提前检查预读缓存，以便淡出逻辑使用
    if (!targetQuality && !isRetry) {
        urlResult = prefetchManager.get(song.id);
        if (urlResult) {
            urlResult.isPrefetch = true;
            isPrefetchFound = true;

            // [Optimize] 既然主播放器即将接管该 URL，立即清空缓冲器 src 以停止其后台加载
            prefetchManager.bufferer.src = '';
        }
    }

    // [Crossfade] 如果开启了淡入淡出，则先执行淡出
    if (settings.enableCrossfade && !noPlay && audio && !audio.paused && !audio.ended && audio.src) {
        await fadeVolume(0, 300);
    }

    if (!noPlay) {
        try {
            audio.pause();
        } catch (e) {
        }
    }
    updatePlayButton(false);

    try {
        // 1. 智能音质选择与 URL 解析
        if (!urlResult) {
            if (!targetQuality) {
                targetQuality = window.QualityManager.getBestQuality(song, settings.preferredQuality || 'flac24bit');
            }
            setPlayerStatus('正在获取播放链接', null, true);
            urlResult = await resolveSongUrl(song, targetQuality, false, isRetry);
        }

        // 2. Stale Check
        if (currentLoadingRequestId !== thisRequestId) return;

        // [Fix] 移除 dismissAllToasts()，允许成功/失败/尝试信息的 Toast 共存堆叠

        // Display attempts / success message
        const sourceText = getSourceTypeText(urlResult.sourceType);
        const sourceName = urlResult.sourceName || '';

        if (urlResult.isPrefetch) {
            let detail = '解析成功';
            if (urlResult.sourceType === 'cache') detail = '命中缓存链接';
            else if (urlResult.sourceType === 'server_cache') detail = '命中本地文件';
            else if (sourceName) detail = `${sourceName} 解析成功`;
            showSuccess(`[预读] ${song.name} ${detail}`);
        } else if (urlResult.sourceType !== 'normal') {
            // 非在线解析（如命中本地/服务器缓存），WebSocket 进度不会触发，需手动显示
            showSuccess(`[${song.name}] 命中${sourceText}`);
        }
        // 在线解析 (sourceType === 'normal') 的成功提示已由 fetchSongUrl 中的进度监听处理，此处不再重复显示

        // [Real-time Progress handles attempts now via WebSocket]

        if (urlResult.errorMsg) {
            showError(urlResult.errorMsg);
        }

        let finalUrl = urlResult.url;
        currentQuality = urlResult.quality;
        currentSourceType = urlResult.sourceType;

        // [Sync] 确定了最终播放音质后，直接以正确音质重写服务器端歌词缓存文件名
        // 注意：不能再调用 fetchLyric(song)，因为歌词已就绪时 fetchLyric 会提前返回，
        // 永远不会走到写入服务器缓存的逻辑，导致文件名停留在音质未确定时的错误值。
        if (settings.enableServerLyricCache !== false && currentRawLrc) {
            try {
                const _lyricHeaders = {'Content-Type': 'application/json'};
                Object.assign(_lyricHeaders, getUserAuthHeaders());
                // x-user-token 现在由 getUserAuthHeaders 统一管理
                fetch(`${API_BASE}/cache/lyric`, {
                    method: 'POST',
                    headers: _lyricHeaders,
                    body: JSON.stringify({
                        songInfo: {...song, quality: currentQuality},
                        lyricsObj: {
                            lyric: currentRawLrc,
                            tlyric: currentRawTlrc,
                            rlyric: currentRawRlrc,
                            lxlyric: currentRawKlrc
                        }
                    })
                }).catch(e => console.warn('[Lyric] 音质确定后重写服务端缓存失败:', e));
            } catch (e) {
            }
        }

        // [Removed] 这里的代理逻辑已统一移动至 fetchSongUrl 阶段处理，确保预加载地址一致性

        // Pre-handle error for invalid cache links
        if (currentSourceType !== 'normal') {
            const retryHandler = () => {
                // 如果当前播放的不是歌曲（如在线电台），跳过此 handler，避免干扰电台的代理重试逻辑
                if (window.currentPlayingScope === 'online-radio' || window.currentPlayingScope === 'radio') return;
                console.warn(`[Player] ${currentSourceType} link failed, retrying online...`);
                if (currentSourceType === 'cache') {
                    localStorage.removeItem(`lx_url_${window.cleanSongData(song).id}_${targetQuality}`);
                    playSong(song, index, targetQuality, noPlay, true);
                } else if (currentSourceType === 'server_cache') {
                    // [Fix] server_cache link failed (local file missing) -> try online download
                    // Use handleMissingLocalFile which will try online, delete DB if needed, and skip
                    handleMissingLocalFile(song, index);
                }
            };
            audio.addEventListener('error', retryHandler, {once: true});
            const cleanup = () => audio.removeEventListener('error', retryHandler);
            audio.addEventListener('playing', cleanup, {once: true});
            audio.addEventListener('pause', cleanup, {once: true});
        }

        // Cast hook: if a cast device is connected, send to it (before setting audio.src to avoid local buffering)
        if (window._upnpPlaySongHook && window._upnpPlaySongHook(song, finalUrl)) {
            // Cast device is handling playback - no local audio playback needed
            const statusEl3 = document.getElementById('player-status');
            if (statusEl3) statusEl3.innerText = (window._castDeviceType === 'local' ? '服务器' : 'UPNP') + '投屏中 - ' + (_upnpActiveDeviceName || '');
            updatePlayButton(true);
            savePlayHistory(song, currentQuality);
            prefetchNextSong();
            return;
        }

        audio.src = finalUrl;

        if (noPlay) {
            setPlayerStatus('', false);
            updatePlayButton(false);
            if (window._resumeInfo && window._resumeInfo.time > 0) {
                const resumeTime = window._resumeInfo.time;
                delete window._resumeInfo;
                audio.addEventListener('loadedmetadata', () => {
                    audio.currentTime = resumeTime;
                }, {once: true});
            }
            return;
        }

        try {
            if (settings.enableCrossfade) audio.volume = 0;
            else audio.volume = typeof currentVolume !== 'undefined' ? currentVolume : 1;

            await audio.play();

            if (settings.enableCrossfade) fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 1000);

            setPlayerStatus('', true);
            updatePlayButton(true);

            // Save history and handle list logic
            savePlayHistory(song, currentQuality);
            const finalAdd = shouldAddToDefault !== null ? shouldAddToDefault : (currentPlayingScope === 'network' || currentPlayingScope === 'songlist' || currentPlayingScope === 'leaderboard');
            if (finalAdd) {
                // 切换逻辑说明：
                // - 搜索结果(network)：updatePlaylist 把队列设为搜索结果，开启设置才把队列切换到 defaultList
                // - 歌单/排行榜(songlist/leaderboard)：updatePlaylist 已把队列设为歌单/排行榜，
                //   开启设置=保持歌单/排行榜队列(do nothing)，关闭设置=退回 defaultList
                const isSongListOrLeaderboard = currentPlayingScope === 'songlist' || currentPlayingScope === 'leaderboard';
                if (isSongListOrLeaderboard) {
                    // 歌单/排行榜：关闭"切换歌单"时，才退回 defaultList
                    const shouldFallback = settings.switchPlaylistOnSongListPlay === false;
                    if (shouldFallback && typeof currentListData !== 'undefined' && currentListData.defaultList) {
                        currentPlaylist = currentListData.defaultList;
                        currentIndex = 0;
                        currentPlayingScope = 'local_list';
                        window.currentViewingListId = 'default';
                    }
                } else {
                    // 搜索结果：开启"切换歌单"时，切换到 defaultList
                    // [Fix] 仅对搜索结果(network)生效，本地库/专辑播放不应切换
                    const shouldSwitch = settings.switchPlaylistOnSearchPlay !== false
                        && currentPlayingScope === 'network';
                    if (shouldSwitch && typeof currentListData !== 'undefined' && currentListData.defaultList) {
                        currentPlaylist = currentListData.defaultList;
                        currentIndex = 0;
                        currentPlayingScope = 'local_list';
                        window.currentViewingListId = 'default';
                    }
                }
            }

        } catch (playError) {
            // [Fix] 仅在请求仍有效且非 AbortError 时显示“请点击”提示，防止切歌太快导致旧请求的错误覆盖新请求的新状态
            if (currentLoadingRequestId !== thisRequestId) return;
            const isAbort = playError && (playError.name === 'AbortError' || playError.code === 20);
            if (isAbort) return;

            console.error('[Player] Playback blocked:', playError);
            setPlayerStatus('请点击播放按钮');
        }

        // [Trigger Prefetch] 确保即便 play() 被拦截也尝试发起下一首预读
        prefetchNextSong();

    } catch (error) {
        if (currentLoadingRequestId !== thisRequestId) return;
        console.error('[Player] Error:', error);

        setPlayerStatus('播放失败');
        showError(`播放失败: ${error.message || '未知错误'}`);

        // 区分“平台不支持”错误
        const isPlatformNotSupported = error.message && (
            error.message.includes('未找到支持') ||
            error.message.includes('not supported')
        );

        // 未配置音源引导: 同会话仅引导一次, 跳转设置-音源并提示
        const guidedToSourceSettings = isPlatformNotSupported && !sessionStorage.getItem('lx_no_source_guided');
        if (guidedToSourceSettings) {
            sessionStorage.setItem('lx_no_source_guided', '1');
            if (typeof switchTab === 'function') switchTab('settings');
            if (typeof switchSettingsTab === 'function') switchSettingsTab('source');
            showToast('error', '未配置可用音源, 无法在线播放。请先添加/启用音源(单源脚本与 LX MUSIC 客户端格式兼容)', 6000);
        }

        // 引导后不再自动跳下一首, 避免无源时无限循环切歌
        if ((settings.enableAutoSkipOnError || isPlatformNotSupported) && !guidedToSourceSettings) {
            if (window._autoSkipTimer) clearTimeout(window._autoSkipTimer);
            window._autoSkipTimer = setTimeout(() => playNext(), isPlatformNotSupported ? TIMEOUT.AUTO_SKIP_UNSUPPORTED : TIMEOUT.AUTO_SKIP_NORMAL);
        }
        updatePlayButton(false);
    } finally {
        if (currentLoadingRequestId === thisRequestId) {
            currentLoadingRequestId = 0;
            currentLoadingSongId = null;
        }
    }
}

// 设置播放器状态文本
/**
 * 设置播放器状态文本
 * @param {string} status 状态文本
 * @param {boolean|null} isPlaying 播放状态
 * @param {boolean} isLoading 是否显示加载/缓冲动画
 */
function setPlayerStatus(status, isPlaying = null, isLoading = false) {
    const statusEl = document.getElementById('player-status');
    if (!statusEl) return;

    // 如果指定了加载状态，自动应用跳动动画
    if (isLoading && typeof status === 'string') {
        statusEl.innerHTML = `<span class="animate-loading-dots">${status}<span>.</span><span>.</span><span>.</span></span>`;
        return;
    }

    // 处理其他固定文本状态
    if (typeof status === 'string' && (status.includes('请点击') || status.includes('即将跳过'))) {
        // [Fix] 如果音频已经在播放，忽略“请点击”提示，直接落入下方获取实时状态逻辑，避免 UI 冲突
        if (status.includes('请点击') && audio && !audio.paused) {
            // Fall through to show real playStatus
        } else {
            statusEl.innerText = status;
            return;
        }
    }

    // 构建状态文本
    let statusText = '';

    // 确定播放状态
    if (isPlaying === null) {
        // 从 audio 元素获取当前状态
        isPlaying = !audio.paused;
    }

    statusText = isPlaying ? '播放中' : '暂停中';
    // 根据链接来源添加提示
    if (currentSourceType === 'cache') {
        statusText += ' 【缓存链接】';
    } else if (currentSourceType === 'server_cache') {
        statusText += ' 【服务器】';
    }

    statusEl.innerText = statusText;
}


// 保存播放历史（登录时只保存到服务器 defaultList 播放记录歌单，未登录只保存到本地 localStorage）
async function savePlayHistory(song, quality) {
    const isLoggedIn = window.currentListData && window.currentListData.username && window.currentListData.username !== 'default';
    if (isLoggedIn) {
        // 已登录：只保存到服务器端（由 addToDefaultList 写入 defaultList 并同步）
        await addToDefaultList(song);
        return;
    }
    // 未登录：只保存到本地（localStorage 按 origin 天然按服务器隔离）
    try {
        const history = JSON.parse(localStorage.getItem('play_history') || '[]');
        history.unshift({
            ...song,
            quality,
            playedAt: Date.now()
        });
        // 只保留最近 50 条
        localStorage.setItem('play_history', JSON.stringify(history.slice(0, 50)));
    } catch (e) {
        console.error('[Player] 保存播放历史失败:', e);
    }
}

// 添加到试听记录
async function addToDefaultList(song) {
    if (!currentListData || !currentListData.defaultList) return;

    try {
        const cleanedData = window.formatSongForStorage(song);
        const targetId = cleanedData.id;
        const list = currentListData.defaultList;

        // Check if exists
        const idx = list.findIndex(s => s.id === targetId);

        if (idx !== -1) {
            // Already exists, move to top
            list.splice(idx, 1);
        }

        // Add to top
        list.unshift(cleanedData);

        // Limit size to avoid bloat (e.g., 200 songs)
        const MAX_DEFAULT_LIST_SIZE = 200;
        if (list.length > MAX_DEFAULT_LIST_SIZE) {
            list.length = MAX_DEFAULT_LIST_SIZE;
        }

        // Sync
        await window.pushDataChange();

        // Refresh sidebar to update count
        window.renderMyLists(currentListData);
    } catch (e) {
        console.error('[DefaultList] 添加失败:', e);
    }
}

/**
 * 更新当前播放列表并开始播放指定歌曲
 * @param {Array} list 歌曲列表
 * @param {number} startIndex 开始播放的索引 (默认 0)
 * @param {string} scope 搜索范围/来源 (用于播放逻辑识别)
 * @param {boolean} shouldAddToDefault 是否加入默认(试听)列表
 */
function updatePlaylist(list, startIndex = 0, scope = 'local_list', shouldAddToDefault = null) {
    if (!list || list.length === 0) {
        showError('播放列表为空');
        return;
    }

    // [New] Use a shallow copy to prevent mutations from affecting the source list
    currentPlaylist = [...list];
    currentPlayingScope = scope;

    // [ML-06 优化] 播放列表变更时重置乱序状态
    if (playMode === 'random') resetShuffleState(startIndex);

    // Reset album index when switching to non-album scope
    if (scope !== 'album') window._currentAlbumIndex = -1;

    // [DLNA] 同步歌单到后端 DMC（新歌单，立即播放）— 必须在 playSong 之前调用，
    // 这样 _dlnaPlaylistJustSynced 标志会阻止 _upnpPlaySongHook 发重复 play 命令
    // 前端操作：搜索结果/歌单详情页播放
    window.syncPlaylistToDmc(currentPlaylist, startIndex, true);
    // [AirPlay DMC] 同步歌单到 AirPlay DMC
    window.syncPlaylistToAirPlay(currentPlaylist, startIndex, true);

    // [DLNA/AirPlay Fix] 投屏模式下，syncPlaylist(playImmediately=true) 已经让 DMC 开始播放
    // 不要再调用 playSong()，否则会触发 /api/music/url 导致重复请求
    if (window._castDeviceType !== 'upnp' && window._castDeviceType !== 'airplay') {
        // 如果是从网络搜索或歌单来源，确保 playSong 能识别并更新 UI/历史
        playSong(currentPlaylist[startIndex], startIndex, null, false, false, shouldAddToDefault);
    }


    // Refresh queue UI if it's open
    if (!document.getElementById('queue-drawer').classList.contains('translate-x-full')) {
        window.renderQueue();
    }
}


// 显示错误提示（现代化 Toast）
// 移除旧版 showError，由后文统一的 showToast 驱动
// 占位图片变色

// 全局图片设置助手，处理占位图逻辑
window.setImg = (id, src) => {
    const el = document.getElementById(id);
    if (el) {
        // 如果是从占位图切换到真实图片，保留滤镜直到加载完成
        if (el.src.includes('logo.png') && src && !src.includes('logo.png')) {
            el.classList.add('is-placeholder');
            const handleLoad = () => {
                el.classList.remove('is-placeholder');
                el.removeEventListener('load', handleLoad);
                el.removeEventListener('error', handleLoad); // 失败也移除
            };
            el.addEventListener('load', handleLoad);
            el.addEventListener('error', handleLoad);
        } else if (src && src.includes('logo.png')) {
            el.classList.add('is-placeholder');
        } else {
            el.classList.remove('is-placeholder');
        }

        if (src) el.src = src;
        el.onerror = () => {
            el.src = '/music/assets/logo.png';
            el.classList.add('is-placeholder');
        };
    }
};

function updatePlayerInfo(song) {
    // Bottom Player - 更新标题
    const titleEl = document.getElementById('player-title');
    if (titleEl) {
        titleEl.innerText = song.name;
        titleEl.setAttribute('data-text', song.name);
        titleEl.classList.add('truncate');
        titleEl.classList.remove('overflow-hidden');

        // 点击搜索此歌曲
        titleEl.onclick = (e) => {
            e.stopPropagation();
            performSearch(song.name, song.source);
        };
        titleEl.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    // Bottom Player - 更新来源标签
    const sourceEl = document.getElementById('player-source');
    if (sourceEl) {
        if (song.source) {
            const qualityTags = getQualityTags(song);
            sourceEl.innerHTML = getSourceTag(song.source) + qualityTags;
            sourceEl.classList.remove('hidden');
        } else {
            sourceEl.innerHTML = '';
            sourceEl.classList.add('hidden');
        }
    }

    // Bottom Player - 更新艺术家
    const artistEl = document.getElementById('player-artist');
    if (artistEl) {
        artistEl.innerText = song.singer;
        artistEl.setAttribute('data-text', song.singer);
        artistEl.classList.add('truncate');
        artistEl.classList.remove('overflow-hidden');

        // 点击搜索此歌手
        artistEl.onclick = async (e) => {
            e.stopPropagation();
            const singers = song.singer.split(/[、&,，]| \/ /).map(s => s.trim()).filter(s => s);
            if (singers.length > 1) {
                const selected = await showOptions('搜索歌手', '识别到多个歌手，请选择要搜索的对象：', singers);
                if (selected) performSearch(selected, song.source);
            } else {
                performSearch(song.singer, song.source);
            }
        };
        artistEl.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    // 触发滚动检测
    applyMarqueeChecks();

    const imgUrl = getImgUrl(song);

    setImg('player-cover', imgUrl);
    setImg('sidebar-cover', imgUrl);
    setImg('detail-cover', imgUrl);

    // Sidebar Mini Info
    document.getElementById('sidebar-song-info').classList.remove('hidden');
    const sideSongName = document.getElementById('sidebar-song-name');
    if (sideSongName) {
        sideSongName.innerText = song.name;
        sideSongName.onclick = (e) => {
            e.stopPropagation();
            performSearch(song.name, song.source);
        };
        sideSongName.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }
    const sideSinger = document.getElementById('sidebar-singer');
    if (sideSinger) {
        sideSinger.innerText = song.singer;
        sideSinger.onclick = (e) => {
            e.stopPropagation();
            performSearch(song.singer, song.source);
        };
        sideSinger.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    // Audio info tags (format, sampleRate, bitDepth, channels, bitRate)
    updateAudioInfoTags(song);

    // Detail View Info (Lyrics Page)
    const detailTitle = document.getElementById('detail-title');
    const detailContainer = document.getElementById('detail-title-container');

    if (detailTitle && detailContainer) {
        // 直接设置文本，由 CSS 处理双行换行和省略号
        detailTitle.innerText = song.name;
        detailTitle.classList.remove('animate-marquee');
        detailTitle.onclick = (e) => {
            e.stopPropagation();
            if (window.innerWidth < 1025) {
                toggleDetailCover();
            } else {
                performSearch(song.name, song.source);
            }
        };
        detailTitle.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }

    const detailArtist = document.getElementById('detail-artist');
    if (detailArtist) {
        detailArtist.innerText = song.singer;
        detailArtist.onclick = async (e) => {
            e.stopPropagation();
            if (window.innerWidth < 1025) {
                toggleDetailCover();
            } else {
                // 处理多个歌手的情况
                const singers = song.singer.split(/[、&,，]| \/ /).map(s => s.trim()).filter(s => s);
                if (singers.length > 1) {
                    const selected = await showOptions('搜索歌手', '识别到多个歌手，请选择要搜索的对象：', singers);
                    if (selected) performSearch(selected, song.source);
                } else {
                    performSearch(song.singer, song.source);
                }
            }
        };
        detailArtist.classList.add('hover:text-emerald-500', 'cursor-pointer', 'transition-colors');
    }


    // Update Like Button State (Collection Status)
    const btnLike = document.getElementById('player-like-btn');

    let isCollected = false;
    if (currentListData && song) {
        // 使用与添加时一致的标准化 ID 进行检查
        const cleanedSong = window.cleanSongData(song);
        if (cleanedSong) {
            const targetId = cleanedSong.id;
            if (currentListData.loveList.some(s => s.id === targetId)) isCollected = true;
            if (!isCollected && currentListData.userList.some(ul => ul.list.some(s => s.id === targetId))) isCollected = true;
        }
    }

    // Bind click to Open Modal
    btnLike.onclick = (e) => {
        e.stopPropagation();
        openPlaylistAddModal();
    };

    if (isCollected) {
        btnLike.classList.add('text-red-500');
        btnLike.classList.remove('text-gray-300');
    } else {
        btnLike.classList.remove('text-red-500');
        btnLike.classList.add('text-gray-300');
    }

    // [Feature] 收藏歌曲 3D 封面弹出特效
    const coverContainer = document.getElementById('mobile-player-cover-container');
    if (coverContainer) {
        if (isCollected) {
            coverContainer.classList.add('fav-3d-active');
        } else {
            coverContainer.classList.remove('fav-3d-active');
        }
    }
}

async function togglePlay() {
    // 忽略因为长按触发的 click 事件
    if (window.playBtnIsLongPress) {
        window.playBtnIsLongPress = false;
        return;
    }

    // 电台模式：委托给对应的 RadioManager（投屏暂停/恢复由电台模块内部处理）
    if (currentPlayingScope === 'online-radio' && window.OnlineRadioManager) {
        window.OnlineRadioManager.togglePlay();
        return;
    }
    if (currentPlayingScope === 'radio' && window.RadioManager) {
        window.RadioManager.toggleRadioPlay();
        return;
    }

    // UPNP投屏模式：通过UPNP设备控制播放/暂停
    if (typeof _upnpActiveDeviceId !== 'undefined' && _upnpActiveDeviceId) {
        // If the UPNP device is idle (no song loaded), play the current song on it
        // Otherwise (device was paused or is playing), use togglePlayPause to resume/pause
        const song = getCurrentPlayingSong();
        const isDeviceIdle = !_dlnaLastPlayState || _dlnaLastPlayState === 'IDLE' || _dlnaLastPlayState === 'STOPPED';
        if (audio.paused && song && isDeviceIdle) {
            // [DLNA Fix] DLNA 模式下，idle 状态下点击播放应该发送 resume 命令
            // 不要直接调用 playSong()，否则会触发 /api/music/url 导致重复请求
            // 此时歌单应该已经通过 syncPlaylistToDmc 同步，只需让 DMC 恢复播放即可
            // [LOG CLEANED] console.log('[DLNA] togglePlay: device is idle, sending resume command');
            window.sendDlnaCommand('resume', {});
            updatePlayButton(true);
            return;
        }
        window.upnpTogglePlayPause();
        return;
    }

    // [AirPlay DMC] AirPlay投屏模式：通过AirPlay WS控制播放/暂停
    if (typeof AirPlayState !== 'undefined' && AirPlayState.activeDeviceId && _castDeviceType === 'airplay') {
        window.upnpTogglePlayPause();
        return;
    }

    if (audio.paused) {
        // 检查 audio.src 是否有效：为空或无有效源时，尝试重新解析当前歌曲
        const srcIsEmpty = !audio.src || audio.src === '' || audio.src === window.location.href || audio.src.endsWith('/') || audio.src === 'about:blank';
        if (srcIsEmpty && currentPlayingSong) {
            console.warn('[Player] audio.src is empty, re-resolving current song:', currentPlayingSong.name);
            try {
                playSong(currentPlayingSong, currentIndex);
                return;
            } catch (e) {
                console.error('[Player] Re-resolve failed:', e);
                showError('播放失败：无法获取播放链接');
                return;
            }
        }

        if (srcIsEmpty) {
            showError('请先选择一首歌曲播放');
            return;
        }

        try {
            // [Crossfade] 如果开启了淡入淡出，先将进度置为 0，播放后再淡入
            if (settings.enableCrossfade) {
                audio.volume = 0;
            }
            await audio.play();
            updatePlayButton(true);

            if (settings.enableCrossfade) {
                fadeVolume(typeof currentVolume !== 'undefined' ? currentVolume : 1, 600);
            }
        } catch (e) {
            const isNotSupported = e.name === 'NotSupportedError' || (e.message && e.message.includes('no supported sources'));
            if (isNotSupported && currentPlayingSong) {
                console.warn('[Player] Source not supported, re-resolving:', currentPlayingSong.name);
                // 清除可能已失效的缓存链接
                try {
                    const qual = currentQuality || settings.preferredQuality || '320k';
                    localStorage.removeItem(`lx_url_${window.cleanSongData(currentPlayingSong).id}_${qual}`);
                } catch (_) {
                }
                playSong(currentPlayingSong, currentIndex);
                return;
            }
            console.error("[Player] Play blocked:", e);
            if (isNotSupported) {
                showError('播放失败：音频源不可用，请尝试其他歌曲');
            } else {
                setPlayerStatus('请点击播放按钮');
            }
        }
    } else {
        // [Crossfade] 如果开启了淡入淡出，先淡出再暂停
        if (settings.enableCrossfade) {
            await fadeVolume(0, 600);
        }
        audio.pause();
        if (window._autoSkipTimer) {
            clearTimeout(window._autoSkipTimer);
            window._autoSkipTimer = null;
        }
        updatePlayButton(false);
    }
}

function updatePlayButton(isPlaying) {
    const btn = document.getElementById('btn-play');
    btn.innerHTML = isPlaying ? '<i class="fas fa-pause"></i>' : '<i class="fas fa-play ml-1"></i>';
}

/**
 * 清除歌曲相关的 UI 状态（侧边栏/音频标签/详情页/收藏按钮），用于切换到电台播放时调用。
 * 电台播放时底部播放栏由 updateBottomBar() 接管，此函数清除其余残留元素。
 */
function clearSongPlayerInfo() {
    // 侧边栏迷你歌曲信息
    const sidebarInfo = document.getElementById('sidebar-song-info');
    if (sidebarInfo) sidebarInfo.classList.add('hidden');

    // 音频参数标签
    const sidebarAudioInfo = document.getElementById('sidebar-audio-info');
    if (sidebarAudioInfo) sidebarAudioInfo.innerHTML = '';
    const footerAudioInfo = document.getElementById('footer-audio-info');
    if (footerAudioInfo) footerAudioInfo.innerHTML = '';

    // 详情页（歌词页）信息
    const detailTitle = document.getElementById('detail-title');
    if (detailTitle) { detailTitle.innerText = ''; detailTitle.onclick = null; }
    const detailArtist = document.getElementById('detail-artist');
    if (detailArtist) { detailArtist.innerText = ''; detailArtist.onclick = null; }
    const detailCover = document.getElementById('detail-cover');
    if (detailCover) detailCover.src = '';
    const sidebarCover = document.getElementById('sidebar-cover');
    if (sidebarCover) sidebarCover.src = '';

    // 收藏按钮重置
    const btnLike = document.getElementById('player-like-btn');
    if (btnLike) {
        btnLike.classList.remove('text-red-500');
        btnLike.classList.add('text-gray-300');
        btnLike.onclick = null;
    }

    // 底部播放按钮重置为暂停图标
    updatePlayButton(false);
}

/**
 * Update audio info tags in sidebar (format, sampleRate, bitDepth, channels, bitRate)
 */
function updateAudioInfoTags(song) {
    const el = document.getElementById('sidebar-audio-info');
    const footerEl = document.getElementById('footer-audio-info');
    if (!el && !footerEl) return;

    const tags = [];

    // Format (ext)
    const ext = (song.ext || '').replace('.', '').toUpperCase();
    if (ext) {
        tags.push(`<span class="audio-tag">${ext}</span>`);
    }

    // Quality label (skip if redundant with ext, e.g. ext=FLAC + quality=flac)
    if (song.quality) {
        const qMap = {
            '128k': '128k',
            '192k': '192k',
            '320k': '320k',
            'flac': 'FLAC',
            'ape': 'APE',
            'wav': 'WAV',
            'ogg': 'OGG',
            'm4a': 'M4A',
            'flac24bit': 'Hi-Res'
        };
        const qLabel = qMap[song.quality.toLowerCase()] || song.quality.toUpperCase();
        if (qLabel.toUpperCase() !== ext) {
            tags.push(`<span class="audio-tag-quality">${qLabel}</span>`);
        }
    }

    // Sample rate
    if (song.sampleRate) {
        const sr = song.sampleRate >= 1000 ? (song.sampleRate / 1000).toFixed(1).replace('.0', '') + 'kHz' : song.sampleRate + 'Hz';
        tags.push(`<span class="audio-tag">${sr}</span>`);
    }

    // Bit depth
    if (song.bitDepth) {
        tags.push(`<span class="audio-tag">${song.bitDepth}bit</span>`);
    }

    // Channels
    if (song.channels) {
        const chMap = {1: 'Mono', 2: 'Stereo'};
        const chLabel = chMap[song.channels] || song.channels + 'ch';
        tags.push(`<span class="audio-tag">${chLabel}</span>`);
    }

    // Bit rate
    if (song.bitRate) {
        const br = song.bitRate >= 1000 ? (song.bitRate / 1000).toFixed(0) + 'Kbps' : song.bitRate + 'Bps';
        tags.push(`<span class="audio-tag">${br}</span>`);
    }

    const html = tags.join('');
    if (tags.length > 0) {
        if (el) {
            el.innerHTML = html;
            el.style.display = 'flex';
        }
        if (footerEl) {
            footerEl.innerHTML = html;
            footerEl.style.display = 'flex';
        }
    } else {
        if (el) {
            el.innerHTML = '';
            el.style.display = 'none';
        }
        if (footerEl) {
            footerEl.innerHTML = '';
            footerEl.style.display = 'none';
        }
    }
}

/**
 * Switch playback to a different album by index in _albumLibData.
 * Used by auto-advance in order play mode.
 * @param {number} albumIdx - Index in _albumLibData
 */
async function _switchToAlbum(albumIdx) {
    const album = _albumLibData[albumIdx];
    if (!album) return;

    // 异步加载歌曲列表
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch(`/api/music/cache/list?album=${encodeURIComponent(album.album)}`, {headers});
        const result = await res.json();
        if (!result.success || !result.data || result.data.length === 0) return;

        window._albumLibCurrentAlbum = {
            name: album.album,
            singer: album.singer,
            singCount: album.singCount,
            img: album.img || '',
            songs: result.data,
            _loading: false
        };
        window._currentAlbumIndex = albumIdx;
        currentPlayingScope = 'album';

        const songs = result.data;
        // [ML-06 优化] 使用浅拷贝+标记，避免创建大量新对象
        currentPlaylist = songs.map((s, i) => {
            s._serverCachePath = s.relativePath;
            s._isMusicLibSong = true;
            s._isFromAlbumLib = true;
            return s;
        });

        if (playMode === 'random') resetShuffleState(0);

        // [DLNA] 同步歌单到后端 DMC（新歌单，立即播放）
        // 前端操作：自动切换到下一专辑（顺序播放模式）
        syncPlaylistToDmc(currentPlaylist, 0, true);
        // [AirPlay DMC] 同步歌单到 AirPlay DMC
        syncPlaylistToAirPlay(currentPlaylist, 0, true);

        // [DLNA/AirPlay Fix] 投屏模式下，syncPlaylist(playImmediately=true) 已经让 DMC 开始播放
        // 不要再调用 playSong()，否则会触发 /api/music/url 导致重复请求
        if (_castDeviceType !== 'upnp' && _castDeviceType !== 'airplay') {
            playSong(currentPlaylist[0], 0);
        }

        // If album detail view is open, update it to reflect the new album
        if (window._albumLibCurrentAlbum && typeof renderAlbumDetailList === 'function') {
            renderAlbumDetailList();
        }

        // Refresh the album list to show the currently playing album
        if (typeof renderAlbumLibList === 'function') {
            renderAlbumLibList();
        }
    } catch (err) {
        console.error('[AlbumLib] Failed to switch album:', err);
    }
}

/**
 * 播放下一首。具备自动跳过被预读器标记为"不可解析"的歌曲的能力。
 * @param {Number} depth 递归尝试深度，防止死循环
 */
function playNext(depth = 0) {
    // 电台模式：委托给对应的 RadioManager（必须在 DLNA 判断之前，DMC 没有电台列表）
    if (currentPlayingScope === 'online-radio' && window.OnlineRadioManager) {
        window.OnlineRadioManager.playNextStation();
        return;
    }
    if (currentPlayingScope === 'radio' && window.RadioManager) {
        window.RadioManager.playNextStation();
        return;
    }

    // DLNA 模式：委托 DMC 计算下一首，避免前后端索引不一致
    if (_upnpActiveDeviceId && window._castDeviceType === 'upnp') {
        // [LOG CLEANED] console.log(`[DLNA] playNext: delegating to DMC, currentIndex=${currentIndex}`);
        window.sendDlnaCommand('next', {});
        return;
    }

    if (depth > 10) {
        console.warn('[Queue] Too many unplayable songs skipped, stopping.');
        return;
    }

    const nextIndex = getNextIndex();

    // [Album Auto-Advance] 顺序播放模式下，当前专辑播完后自动切换到下一专辑
    if (nextIndex === -2) {
        const nextAlbumIdx = window._currentAlbumIndex + 1;
        if (nextAlbumIdx < _albumLibData.length) {
            _switchToAlbum(nextAlbumIdx);
            return;
        }
        // No more albums, check if album list needs to be loaded
        if (!_albumLibLoaded || _albumLibData.length === 0) {
            loadAlbumLib().then(() => {
                if (_albumLibData.length > 0) {
                    _switchToAlbum(0);
                }
            });
            return;
        }
        // No more albums, stop playback
        return;
    }

    if (nextIndex !== -1 && currentPlaylist[nextIndex]) {
        const nextSong = currentPlaylist[nextIndex];

        // [Logic Fix] 如果这首歌在预读中已经被确认不可解析，直接跳过到再下一首
        if (nextSong._unplayable && nextIndex !== currentIndex) {
            currentIndex = nextIndex; // 更新当前索引以便 getNextIndex() 能找到下一首
            return playNext(depth + 1);
        }

        playSong(nextSong, nextIndex);
    } else {
    }
}

function playPrev() {
    // 电台模式：委托给对应的 RadioManager（必须在 DLNA 判断之前，DMC 没有电台列表）
    if (currentPlayingScope === 'online-radio' && window.OnlineRadioManager) {
        window.OnlineRadioManager.playPrevStation();
        return;
    }
    if (currentPlayingScope === 'radio' && window.RadioManager) {
        window.RadioManager.playPrevStation();
        return;
    }

    // DLNA 模式：委托 DMC 计算上一首
    if (_upnpActiveDeviceId && window._castDeviceType === 'upnp') {
        // [LOG CLEANED] console.log(`[DLNA] playPrev: delegating to DMC, currentIndex=${currentIndex}`);
        window.sendDlnaCommand('previous', {});
        return;
    }

    if (currentPlaylist.length === 0) return;

    let prevIndex;

    switch (playMode) {
        case 'single':
            // 单曲循环：继续播放当前歌曲
            prevIndex = currentIndex;
            break;

        case 'random':
            // [ML-06 优化] Fisher-Yates 洗牌索引系统，向前回退一位
            if (currentPlaylist.length === 1) {
                prevIndex = 0;
            } else if (shuffleOrder.length > 0 && shufflePos > 0) {
                shufflePos--;
                prevIndex = shuffleOrder[shufflePos];
            } else {
                // 无法回退时，随机选一首
                shuffleOrder = generateShuffleOrder(currentPlaylist.length, currentIndex);
                shufflePos = 0;
                prevIndex = shuffleOrder[shufflePos];
                if (prevIndex === currentIndex && currentPlaylist.length > 1) {
                    shufflePos = 1;
                    prevIndex = shuffleOrder[shufflePos];
                }
            }
            break;

        case 'order':
            // 顺序播放：播放上一首
            prevIndex = currentIndex - 1;
            if (prevIndex < 0) {
                // [Album Auto-Advance] 顺序播放模式下，当前专辑第一首时切到上一专辑的最后一首
                if (currentPlayingScope === 'album' && window._currentAlbumIndex > 0 && _albumLibData.length > 0) {
                    const prevAlbumIdx = window._currentAlbumIndex - 1;
                    const prevAlbum = _albumLibData[prevAlbumIdx];
                    if (prevAlbum) {
                        _switchToAlbum(prevAlbumIdx);
                        // Play the last song of the previous album
                        currentIndex = currentPlaylist.length - 1;
                        playSong(currentPlaylist[currentIndex], currentIndex);
                        return;
                    }
                }
                prevIndex = 0; // Stay on first song if no previous album
            }
            break;

        case 'list':
        default:
            // 列表循环：播放上一首
            prevIndex = currentIndex - 1;
            if (prevIndex < 0) prevIndex = currentPlaylist.length - 1;
            break;
    }

    playSong(currentPlaylist[prevIndex], prevIndex);
}

// 音量淡入淡出辅助函数
let volumeFadeInterval = null;

function fadeVolume(targetVolume, duration = 800) {
    if (volumeFadeInterval) clearInterval(volumeFadeInterval);

    const startVolume = audio.volume;
    const steps = 20;
    const increment = (targetVolume - startVolume) / steps;
    const stepTime = duration / steps;
    let currentStep = 0;

    return new Promise((resolve) => {
        volumeFadeInterval = setInterval(() => {
            currentStep++;
            let nextVolume = startVolume + (increment * currentStep);

            // 边界检查
            if (nextVolume < 0) nextVolume = 0;
            if (nextVolume > 1) nextVolume = 1;

            audio.volume = nextVolume;

            if (currentStep >= steps) {
                clearInterval(volumeFadeInterval);
                audio.volume = targetVolume;
                resolve();
            }
        }, stepTime);
    });
}

// Audio Events
audio.addEventListener('timeupdate', () => {
    // 投屏模式下，进度由 DMC 推送更新，跳过本地 audio 的进度覆盖
    if ((_upnpActiveDeviceId && window._castDeviceType === 'upnp') ||
        (typeof AirPlayState !== 'undefined' && AirPlayState.activeDeviceId && window._castDeviceType === 'airplay')) return;

    if (isDragging === 'progress') return; // Skip updating UI while user is dragging

    const current = audio.currentTime;
    const duration = audio.duration;

    // [Crossfade] 自然播放接近结束时提前淡出
    if (settings.enableCrossfade && duration > 5 && (duration - current < 1.0)) {
        if (!window._isFadingOut) {
            window._isFadingOut = true;
            fadeVolume(0, 1000);
        }
    } else if (duration - current > 1.5) {
        window._isFadingOut = false;
    }

    document.getElementById('time-current').innerText = formatTime(current);
    document.getElementById('time-total').innerText = formatTime(duration);

    const pct = (current / duration) * 100;
    document.getElementById('progress-bar').style.width = `${pct}%`;

    // [iOS Fix] Throttled Media Session Position update for Dynamic Island / Lock Screen
    // 每秒同步一次进度，防止 iOS 将 Web Audio 桥接流识别为不可拖拽的“直播”
    const now = Date.now();
    if ('mediaSession' in navigator && (!window._lastMedPosUpdate || now - window._lastMedPosUpdate > 1000)) {
        updatePositionState();
        window._lastMedPosUpdate = now;
    }

    // 自动恢复：保存播放进度 (节流)
    if (settings.autoResume && (!window._lastStateSave || now - window._lastStateSave > 5000)) {
        savePlaybackState();
        window._lastStateSave = now;
    }
});

// Screen Wake Lock (NoSleep.js) Wrapper
let noSleepInstance = null;

function toggleNoSleep(enable) {
    if (typeof NoSleep === 'undefined') return;
    if (!noSleepInstance) {
        noSleepInstance = new NoSleep();
    }
    if (enable && settings.keepScreenAwake) {
        if (!noSleepInstance.isEnabled) {
            noSleepInstance.enable().catch(e => console.warn('[NoSleep] 启用失败:', e));
        }
    } else {
        if (noSleepInstance && noSleepInstance.isEnabled) {
            noSleepInstance.disable();
        }
    }
}

// Update Media Session State on Play/Pause
audio.addEventListener('play', () => {
    toggleNoSleep(true);
    // 确保播放时应用设置的倍速
    audio.playbackRate = currentPlaybackRate;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
        updatePositionState(); // 恢复调用，防止播放瞬间系统推断的外插值错误飞越到最后
    }

    // [Fix] 这里的状态更新确保 UI 与实际播放状态同步 (e.g. 键盘媒体键控制)
    setPlayerStatus('', true); // 使用智能状态显示
    updatePlayButton(true);

    // 刷新所有可见列表的"正在播放"指示（显示 EQ 动画）
    if (currentPlayingSong) refreshVisiblePlayingIndicators();

    // [Notice] 我们不再在这里调用 lyricPlayer.play，而是等待 'playing' 事件
    // 这样可以避免在网络缓冲时歌词就开始跑
    if (lyricPlayer) {
        isUserScrolling = false; // 切回自动滚动模式

        // 隐藏滚动指示器
        const indicator = document.getElementById('lyric-scroll-indicator');
        if (indicator) {
            indicator.classList.add('hidden');
            indicator.style.display = 'none';
        }
    }
});

audio.addEventListener('playing', () => {
    // [Fix] 'playing' 事件表示音频真正开始震动输出，此时同步最准确
    setPlayerStatus('', true); // 恢复正常播放状态
    if ('mediaSession' in navigator) {
        updatePositionState(); // 立即同步

        // [iOS Stability Fix] 针对 iOS 刷新后失效的问题，在 500ms 和 1200ms 再次强制刷新
        // 确保系统在处理完 Web Audio 桥接流后，能再次接收到正确、有时长的 PositionState
        setTimeout(updatePositionState, 500);
        setTimeout(updatePositionState, 1200);
    }
    if (lyricPlayer) {
        lyricPlayer.play(audio.currentTime * 1000);
        isUserScrolling = false;
        scrollToActiveLine(true); // 强制对齐
    }
});

audio.addEventListener('pause', () => {
    // [Fix] 投屏模式下本地 audio 被静音暂停，不更新 UI 状态（由投屏 WS 消息驱动 UI）
    if ((_upnpActiveDeviceId && _castDeviceType === 'upnp') ||
        (typeof AirPlayState !== 'undefined' && AirPlayState.activeDeviceId && _castDeviceType === 'airplay') ||
        _castDeviceType === 'local') {
        return;
    }
    toggleNoSleep(false);
    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
    }

    // [Fix] 这里的状态更新确保 UI 与实际播放状态同步
    setPlayerStatus('', false); // 使用智能状态显示
    updatePlayButton(false);

    if (lyricPlayer) {
        lyricPlayer.pause();
    }
    if (wordAnimationId) cancelAnimationFrame(wordAnimationId); // 立即停止行动画
    if (settings.autoResume) savePlaybackState();

    // 刷新所有可见列表的"正在播放"指示（显示暂停图标）
    if (currentPlayingSong) refreshVisiblePlayingIndicators();
});

// ========================================
// Auto-Resume State Logic
// ========================================

function savePlaybackState() {
    if (!currentPlayingSong) return;
    try {
        const state = {
            song: currentPlayingSong,
            index: currentIndex,
            time: audio.currentTime,
            scope: currentPlayingScope,
            listId: window.currentViewingListId,
            // [Fix] 保存整个当前播放队列副本。
            // 限制长度为 300 首以兼顾性能和容量（通常足够临时列表使用）
            playlist: currentPlaylist ? currentPlaylist.slice(0, 300) : null,
            playMode: playMode,
            albumIndex: window._currentAlbumIndex,
            timestamp: Date.now()
        };
        localStorage.setItem('lx_playback_state', JSON.stringify(state));
    } catch (e) {
        console.error('[Resume] 无法保存播放状态:', e);
    }
}

async function restorePlaybackState() {
    if (!settings.autoResume) return;

    try {
        const saved = localStorage.getItem('lx_playback_state');
        if (!saved) return;

        const state = JSON.parse(saved);
        if (!state || !state.song) return;


        // 1. 恢复播放模式（校验合法性，防止脏数据导致显示"未知"）
        if (state.playMode && ['list', 'single', 'random', 'order'].includes(state.playMode)) {
            playMode = state.playMode;
            updatePlayModeUI();
        }

        // 2. 恢复播放列表 (优先从持久化队列恢复)
        if (state.playlist && state.playlist.length > 0) {
            currentPlaylist = state.playlist;
            currentPlayingScope = state.scope || 'network';
        } else if (['local_list', 'local_all', 'songlist'].includes(state.scope)) {
            // 回退逻辑：如果队列没存，根据作用域恢复
            currentPlayingScope = state.scope;
            window.currentViewingListId = state.listId || 'default';
        }

        // Restore album index for album auto-advance
        if (state.scope === 'album' && typeof state.albumIndex === 'number') {
            window._currentAlbumIndex = state.albumIndex;
        }

        currentIndex = state.index >= 0 ? state.index : 0;
        currentPlayingSong = state.song;
        // currentPlayingSong via Object.defineProperty setter

        // 3. 更新 UI (静默更新)
        updatePlayerInfo(state.song);
        updateMediaSessionMetadata(state.song);
        window.renderQueue(); // 提前渲染队列 UI

        // 4. 设置恢复时间点
        const resumeTime = state.time || 0;
        window._resumeInfo = {
            time: resumeTime,
            song: state.song
        };

        // 5. 延迟加载播放源（静默模式），不切换 Tab，保持默认的专辑界面
        setTimeout(() => {
            // 初始化音频源但不立即播放（除非设置了自动播放，当前 playSong handles resumeTime）
            playSong(state.song, currentIndex, null, true);
        }, 800);

    } catch (e) {
        console.error('[Resume] 恢复播放状态失败:', e);
    }
}

// 辅助函数：根据 ID 查找列表内容
function findListById(data, id) {
    if (!data) return null;
    if (id === 'default') return data.defaultList;
    if (id === 'love') return data.loveList;
    const ul = data.userList.find(l => l.id === id);
    return ul ? ul.list : null;
}

// 辅助函数：获取所有歌曲（我的收藏）
function getAllSongs(data) {
    if (!data) return [];
    let all = [...data.defaultList, ...data.loveList];
    data.userList.forEach(l => {
        all = all.concat(l.list);
    });
    // 去重
    const seen = new Set();
    return all.filter(s => {
        const sid = s.id || s.songmid;
        if (seen.has(sid)) return false;
        seen.add(sid);
        return true;
    });
}

function updatePositionState() {
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState) {
        const duration = audio.duration;
        const currentTime = audio.currentTime;
        // 确保当 duration 有效，避免传入 NaN/Infinity
        if (Number.isFinite(duration) && duration > 0) {
            try {
                const pos = Math.max(0, Math.min(currentTime, duration));
                // 显式同步播放状态，解决 iOS UI 有时出现的按钮与实际状态不同步的问题
                if (audio.paused) {
                    navigator.mediaSession.playbackState = 'paused';
                } else {
                    navigator.mediaSession.playbackState = 'playing';
                }

                navigator.mediaSession.setPositionState({
                    duration: duration,
                    playbackRate: audio.playbackRate || 1,
                    position: pos
                });
            } catch (e) {
                console.warn('[MediaSession] Failed to update position state:', e);
            }
        }
    }
}


// 歌曲播放结束时根据播放模式处理
audio.addEventListener('ended', () => {
    // UPNP投屏模式：本地audio的ended事件不应触发playNext，由UPNP轮询检测曲目结束来触发
    if (typeof _upnpActiveDeviceId !== 'undefined' && _upnpActiveDeviceId) {
        // [LOG CLEANED] console.log('[UPNP] Local audio ended while UPNP active, skipping playNext (handled by UPNP polling)');
        return;
    }
    playNext();
});

audio.addEventListener('canplay', () => {
    if ('mediaSession' in navigator) {
        updatePositionState();
    }

    // [Duration Fix] 如果当前歌曲缺少 duration，用 audio.duration 补上并回写 DB
    if (currentPlayingSong && audio.duration && Number.isFinite(audio.duration) && audio.duration > 0) {
        const songDuration = currentPlayingSong.duration;
        if (!songDuration || songDuration <= 0) {
            const durationSec = Math.round(audio.duration);

            // 更新内存中的 song 对象
            currentPlayingSong.duration = durationSec;

            // 同步更新当前播放列表中同一首歌的 duration
            if (currentPlaylist && currentPlaylist.length > 0) {
                const idx = currentPlaylist.findIndex(s => s.id === currentPlayingSong.id);
                if (idx >= 0) currentPlaylist[idx].duration = durationSec;
            }

            // 异步回写 DB（不阻塞播放）
            try {
                const headers = {'Content-Type': 'application/json'};
                Object.assign(headers, getUserAuthHeaders());
                fetch(`${API_BASE}/cache/update-duration`, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({songId: String(currentPlayingSong.id), duration: durationSec})
                }).then(r => r.json()).then(result => {
                    if (result.success) {
                    }
                }).catch(e => console.warn('[DurationFix] Failed to update DB:', e));
            } catch (e) {
                console.warn('[DurationFix] Failed to send duration update:', e);
            }

            // 刷新音乐库/专辑列表的 UI 显示
            try {
                const musiclibView = document.getElementById('view-musiclib');
                if (musiclibView && !musiclibView.classList.contains('hidden') && typeof _musicLibFiltered !== 'undefined') {
                    // 只更新 _musicLibFiltered 中匹配的歌曲
                    const libItem = _musicLibFiltered.find(s => s.id === currentPlayingSong.id || s.song_id === currentPlayingSong.id);
                    if (libItem) libItem.duration = durationSec;
                }
                if (window._albumLibCurrentAlbum) {
                    const albumSong = window._albumLibCurrentAlbum.songs.find(s => s.id === currentPlayingSong.id || s.song_id === currentPlayingSong.id);
                    if (albumSong) albumSong.duration = durationSec;
                }
            } catch (e) {
            }
        }
    }
});

// Additional events to sync progress
audio.addEventListener('loadedmetadata', updatePositionState);
audio.addEventListener('ratechange', updatePositionState);
audio.addEventListener('seeked', () => {
    updatePositionState();
    setTimeout(updatePositionState, 200); // 针对跳转后的 iOS 二次确认
    if (lyricPlayer) {
        if (!audio.paused) {
            lyricPlayer.play(audio.currentTime * 1000);
        } else {
            // 如果处于暂停状态，只同步位置不启动计时器
            lyricPlayer.pause();
            const time = audio.currentTime * 1000;
            // 找到当前行并高亮
            const lineNum = lyricPlayer._findCurLineNum(time);
            if (lineNum !== undefined && lineNum >= 0) {
                syncLyricByLineNum(lineNum);
            }
        }
    }
});
audio.addEventListener('waiting', () => {
    setPlayerStatus('缓冲歌曲中', null, true);
    if (lyricPlayer) {
        lyricPlayer.pause();
    }
});

audio.addEventListener('stalled', () => {
    setPlayerStatus('缓冲歌曲中', null, true);
});

// Initialize Media Session Actions
if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
        togglePlay();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
        togglePlay();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        playPrev();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        playNext();
    });

    // Support seeking (Bidirectional Progress Control)
    navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) {
            audio.currentTime = details.seekTime;
            updatePositionState();
        }
    });

    /*
    // 注释掉以下两个 Handler 以确保 iOS 优先显示“上一曲/下一曲”按钮
    // 进度条的拖动由上面的 'seekto' 处理，不依赖这两个按钮
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.max(audio.currentTime - skipTime, 0);
        updatePositionState();
    });

    navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        audio.currentTime = Math.min(audio.currentTime + skipTime, audio.duration);
        updatePositionState();
    });
    */
}

function updateMediaSessionMetadata(song) {
    if (!('mediaSession' in navigator)) return;

    const imgUrl = getImgUrl(song);
    // Ensure absolute URL if possible
    const fullImgUrl = new URL(imgUrl, window.location.href).href;

    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name,
            artist: song.singer,
            album: song.albumName || '',
            artwork: [
                {src: fullImgUrl, sizes: '96x96', type: 'image/jpeg'},
                {src: fullImgUrl, sizes: '128x128', type: 'image/jpeg'},
                {src: fullImgUrl, sizes: '192x192', type: 'image/jpeg'},
                {src: fullImgUrl, sizes: '256x256', type: 'image/jpeg'},
                {src: fullImgUrl, sizes: '384x384', type: 'image/jpeg'},
                {src: fullImgUrl, sizes: '512x512', type: 'image/jpeg'}
            ]
        });
        // Reset playback state logic is handled by event listeners, but metadata update often implies new song start
        // updatePositionState() will be called when loadedmetadata fires for new source
    } catch (e) {
        console.warn('[MediaSession] Failed to update metadata:', e);
    }
}


function seek(e) {
    // 投屏模式：使用 UPNP 时长
    const activeDuration = (_upnpActiveDeviceId && _dlnaLastDuration > 0) ? _dlnaLastDuration : audio.duration;
    // Prevent seek if duration is not ready or has infinite duration (live stream)
    if (!activeDuration || !Number.isFinite(activeDuration)) return;

    const container = document.getElementById('progress-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width)); // Clamp between 0 and 1
    const time = pct * activeDuration;

    // Ensure time is valid
    if (Number.isFinite(time)) {
        if (_upnpActiveDeviceId) {
            window.upnpSeekTo(time);
        } else {
            audio.currentTime = time;
        }
    }
}

// ========== 音量控制 ==========
// (currentVolume/isMuted 声明见文件底部「音量与播放模式」节)

// 初始化音量
audio.volume = currentVolume;
updateVolumeUI();

// 设置音量
function setVolume(e) {
    const container = document.getElementById('volume-container');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width)); // 限制在 0-1 之间

    currentVolume = pct;
    audio.volume = currentVolume;
    isMuted = false;

    updateVolumeUI();

    // [DLNA DMC] 投屏模式下同步音量到 DMR（只发不收，天然防死循环）
    if (typeof _upnpActiveDeviceId !== 'undefined' && _upnpActiveDeviceId && window._castDeviceType === 'upnp') {
        window.upnpSetVolume(Math.round(currentVolume * 100));
    }

    // 保存到本地存储
    try {
        localStorage.setItem('lx_volume', currentVolume.toString());
    } catch (e) {
        console.error('[Volume] 保存音量失败:', e);
    }
}

// 切换静音
function toggleMute() {
    isMuted = !isMuted;
    audio.muted = isMuted;
    updateVolumeUI();

    // [DLNA DMC] 投屏模式下同步静音状态到 DMR
    if (typeof _upnpActiveDeviceId !== 'undefined' && _upnpActiveDeviceId && window._castDeviceType === 'upnp') {
        window.upnpSetVolume(isMuted ? 0 : Math.round(currentVolume * 100));
    }
}

// 更新音量 UI
function updateVolumeUI() {
    const volumeBar = document.getElementById('volume-bar');
    const volumeIcon = document.getElementById('volume-icon');

    if (volumeBar) {
        const displayVolume = isMuted ? 0 : currentVolume;
        volumeBar.style.width = `${displayVolume * 100}%`;
    }

    if (volumeIcon) {
        if (isMuted || currentVolume === 0) {
            volumeIcon.className = 'fas fa-volume-mute w-4';
        } else if (currentVolume < 0.5) {
            volumeIcon.className = 'fas fa-volume-down w-4';
        } else {
            volumeIcon.className = 'fas fa-volume-up w-4';
        }
    }
}

// ========== 播放模式 ==========
// (playMode 声明见文件底部「音量与播放模式」节)

/**
 * [ML-06 优化] Fisher-Yates 洗牌算法生成乱序索引数组
 * 保证每首歌曲在重新洗牌前只播放一次，避免重复和 O(n) 拒绝采样
 * @param {number} length - 播放列表长度
 * @param {number} startIdx - 当前播放的索引（确保不放在首位）
 * @returns {number[]} 乱序索引数组
 */
function generateShuffleOrder(length, startIdx = -1) {
    if (length <= 0) return [];
    const order = Array.from({length}, (_, i) => i);
    // Fisher-Yates 洗牌
    for (let i = length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
    }
    // 确保当前播放的歌曲不在乱序数组的第0位（避免切随机时立即重复）
    if (startIdx >= 0 && startIdx < length && order[0] === startIdx && length > 1) {
        // 与第1位交换
        [order[0], order[1]] = [order[1], order[0]];
    }
    return order;
}

/**
 * [ML-06 优化] 重置乱序播放状态（播放列表变更或切换到随机模式时调用）
 * @param {number} startIdx - 当前播放的索引
 */
function resetShuffleState(startIdx = -1) {
    shuffleOrder = generateShuffleOrder(currentPlaylist.length, startIdx);
    shufflePos = 0; // 从乱序数组的第0位开始
}

// 设置播放模式
function setPlayMode(mode) {
    playMode = mode;
    // [ML-06 优化] 切换到随机模式时生成乱序索引
    if (mode === 'random' && currentPlaylist.length > 0) {
        resetShuffleState(currentIndex);
    }
    // [Random Prefetch Fix] 切换模式时清空预读预选索引
    preSelectedNextIndex = null;
    updatePlayModeUI();

    // 保存到本地存储
    try {
        localStorage.setItem('lx_play_mode', mode);
    } catch (e) {
        console.error('[PlayMode] 保存播放模式失败:', e);
    }

    // 同步到用户设置（跟随账号持久化）
    settings.playMode = mode;
    try {
        localStorage.setItem('lx_settings', JSON.stringify(settings));
    } catch (e) {
        console.error('[PlayMode] 保存设置失败:', e);
    }
    if (typeof pushSettingsToServer === 'function' && settings.saveAccountSettingsToFile) {
        pushSettingsToServer();
    }

    // Close menu (Mobile/Click mode)
    const menu = document.getElementById('play-mode-menu');
    if (menu) menu.classList.remove('force-visible');

    // 使用统一的 Toast 系统显示提示
    showSuccess(`播放模式：${getPlayModeName(mode)}`);

    // [DLNA DMC] 投屏模式下同步播放模式到后端 DMC（只发不收，天然防死循环）
    if (typeof _upnpActiveDeviceId !== 'undefined' && _upnpActiveDeviceId && window._castDeviceType === 'upnp') {
        const dmcModeMap = {list: 'listLoop', order: 'list', single: 'singleLoop', random: 'random'};
        window.sendDlnaCommand('setPlayMode', {mode: dmcModeMap[mode] || mode});
    }
}

// 切换播放模式菜单（适配移动端点击）
function togglePlayModeMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('play-mode-menu');
    if (menu) {
        menu.classList.toggle('force-visible');
    }
}

// 切换播放倍速菜单（适配移动端点击）
function togglePlaybackRateMenu(e) {
    if (e) e.stopPropagation();
    const menu = document.getElementById('playback-rate-menu');
    if (menu) {
        menu.classList.toggle('force-visible');
    }
}

// 设置播放倍速
function setPlaybackRate(rate) {
    currentPlaybackRate = parseFloat(rate);
    audio.playbackRate = currentPlaybackRate;
    if (lyricPlayer) {
        lyricPlayer.setPlaybackRate(currentPlaybackRate);
        // 强制同步当前音频时间，确保位置严格匹配
        lyricPlayer.play(audio.currentTime * 1000);
        isUserScrolling = false; // 重置手动滚动模式，进入自动跟随
        scrollToActiveLine(true); // 立即对齐并滚动到当前行
    }
    updatePlaybackRateUI();

    // 关闭菜单
    const menu = document.getElementById('playback-rate-menu');
    if (menu) menu.classList.remove('force-visible');

    // 增加提示
    showInfo(`播放速度：${rate}x`);
}

// 更新播放倍速 UI
function updatePlaybackRateUI() {
    const btn = document.getElementById('playback-rate-btn');
    if (btn) {
        btn.innerText = currentPlaybackRate === 1.0 ? '1.0x' : `${currentPlaybackRate}x`;
        btn.classList.toggle('text-emerald-500', currentPlaybackRate !== 1.0);
    }

    const options = document.querySelectorAll('.playback-rate-option');
    options.forEach(opt => {
        const rate = parseFloat(opt.dataset.rate);
        if (rate === currentPlaybackRate) {
            opt.classList.add('active-option', 'font-bold');
        } else {
            opt.classList.remove('active-option', 'font-bold');
        }
    });
}

// 监听全局点击，关闭菜单
document.addEventListener('click', (e) => {
    // 关闭播放模式菜单
    const pmMenu = document.getElementById('play-mode-menu');
    const pmBtn = document.getElementById('play-mode-btn');
    if (pmMenu && pmBtn && !pmMenu.contains(e.target) && !pmBtn.contains(e.target)) {
        pmMenu.classList.remove('force-visible');
    }

    // 关闭倍速菜单
    const prMenu = document.getElementById('playback-rate-menu');
    const prBtn = document.getElementById('playback-rate-btn');
    if (prMenu && prBtn && !prMenu.contains(e.target) && !prBtn.contains(e.target)) {
        prMenu.classList.remove('force-visible');
    }
});

// 更新播放模式 UI
function updatePlayModeUI() {
    const btn = document.getElementById('play-mode-btn');
    const label = document.getElementById('play-mode-label');
    const options = document.querySelectorAll('.play-mode-option');

    // 更新按钮图标和颜色
    if (btn) {
        const icons = {
            'list': 'fa-redo',
            'single': 'fa-redo-alt',
            'random': 'fa-random',
            'order': 'fa-play'
        };
        const colors = {
            'list': 'text-emerald-500',
            'single': 'text-blue-500',
            'random': 'text-purple-500',
            'order': 'text-gray-500'
        };

        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = `fas ${icons[playMode]}`;
            // 保留关键样式类（p-2, text-lg, transition-colors），只替换颜色类
            const prevColor = ['text-emerald-500', 'text-blue-500', 'text-purple-500', 'text-gray-500', 't-text-muted'].find(c => btn.classList.contains(c));
            if (prevColor) btn.classList.remove(prevColor);
            btn.classList.add(colors[playMode]);
            // 确保 p-2 和 text-lg 存在
            if (!btn.classList.contains('p-2')) btn.classList.add('p-2');
            if (!btn.classList.contains('text-lg')) btn.classList.add('text-lg');
            if (!btn.classList.contains('transition-colors')) btn.classList.add('transition-colors');
            btn.title = getPlayModeName(playMode);
        }
    }

    // 更新文字标签
    if (label) {
        label.textContent = getPlayModeName(playMode);
    }

    // 高亮当前选中的选项
    options.forEach(opt => {
        if (opt.dataset.mode === playMode) {
            opt.classList.add('active-option', 'font-bold');
        } else {
            opt.classList.remove('active-option', 'font-bold');
        }
    });
}

function getPlayModeName(mode) {
    const names = {
        'list': '列表循环',
        'single': '单曲循环',
        'random': '随机播放',
        'order': '顺序播放'
    };
    return names[mode] || names['order']; // 兜底显示"顺序播放"，避免"未知"
}

function formatTime(s) {
    if (!s || isNaN(s)) return '00:00';
    const min = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
}

// ========== Window Exports ==========
window.getSourceTypeText = getSourceTypeText;
window.probeUrl = probeUrl;
window.prefetchManager = prefetchManager;
window.handleMissingLocalFile = handleMissingLocalFile;
window.resolveSongUrl = resolveSongUrl;
window.findOtherSourceMatch = findOtherSourceMatch;
window.timeToSeconds = timeToSeconds;
window.getSourceName = getSourceName;
window.applyAutoProxy = applyAutoProxy;
window.fetchSongUrl = fetchSongUrl;
window.getNextIndex = getNextIndex;
window.prefetchNextSong = prefetchNextSong;
window.playFromView = playFromView;
window.playSong = playSong;
window.setPlayerStatus = setPlayerStatus;
window.savePlayHistory = savePlayHistory;
window.addToDefaultList = addToDefaultList;
window.updatePlaylist = updatePlaylist;
window.updatePlayerInfo = updatePlayerInfo;
window.togglePlay = togglePlay;
window.updatePlayButton = updatePlayButton;
window.clearSongPlayerInfo = clearSongPlayerInfo;
window.updateAudioInfoTags = updateAudioInfoTags;
window.playNext = playNext;
window.playPrev = playPrev;
window.fadeVolume = fadeVolume;
window.toggleNoSleep = toggleNoSleep;
window.savePlaybackState = savePlaybackState;
window.restorePlaybackState = restorePlaybackState;
window.findListById = findListById;
window.getAllSongs = getAllSongs;
window.updatePositionState = updatePositionState;
window.updateMediaSessionMetadata = updateMediaSessionMetadata;
window.seek = seek;
window.setVolume = setVolume;
window.toggleMute = toggleMute;
window.updateVolumeUI = updateVolumeUI;
window.generateShuffleOrder = generateShuffleOrder;
window.resetShuffleState = resetShuffleState;
window.setPlayMode = setPlayMode;
window.togglePlayModeMenu = togglePlayModeMenu;
window.togglePlaybackRateMenu = togglePlaybackRateMenu;
window.setPlaybackRate = setPlaybackRate;
window.updatePlaybackRateUI = updatePlaybackRateUI;
window.updatePlayModeUI = updatePlayModeUI;
window.getPlayModeName = getPlayModeName;
window.formatTime = formatTime;
