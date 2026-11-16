/**
 * Download Manager for LX Server Web Frontend
 * 管理并行下载、进度追踪、暂停/恢复、重试,使用 Fetch + ReadableStream
 *
 * @module DownloadManager
 * @version 2.0
 */

// ==================== 常量配置 ====================

/** 下载任务默认最大重试次数 */
const DEFAULT_MAX_RETRIES = 2;

/** 云端下载超时检测时间(毫秒): 5 分钟 */
const CLOUD_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/** 云端无数据超时检测时间(毫秒): 10 分钟 */
const CLOUD_NO_DATA_TIMEOUT_MS = 10 * 60 * 1000;

/** 服务端轮询间隔(毫秒): 2 秒 */
const SERVER_POLL_INTERVAL_MS = 2000;

/** 全局速度更新间隔(毫秒): 1 秒 */
const SPEED_UPDATE_INTERVAL_MS = 1000;

/** 本地下载速度计算间隔(毫秒): 500ms */
const LOCAL_SPEED_CALC_INTERVAL_MS = 500;

/** 下载重试延迟(毫秒): 2 秒 */
const DOWNLOAD_RETRY_DELAY_MS = 2000;

/** Blob URL 清理延迟(毫秒): 10 秒 */
const BLOB_URL_CLEANUP_DELAY_MS = 10000;

/** 默认音质偏好: 优先最高音质, 无对应高音质时自动向下降级 */
const DEFAULT_DOWNLOAD_QUALITY_PREF = 'flac24bit';

class DownloadManager {
    constructor() {
        // 任务队列
        this.tasks = [];

        // 并发控制
        this.maxConcurrent = window.settings?.downloadConcurrency || 6;
        this.activeCount = 0;

        // UI 元素引用
        this.drawer = document.getElementById('download-drawer');
        this.listContainer = document.getElementById('download-list-container');
        this.globalSpeedEl = document.getElementById('download-global-speed');
        this.progressTextEl = document.getElementById('download-progress-text');

        // 速度计算
        this.lastTotalBytes = 0;
        this.lastTime = Date.now();
        this.speedInterval = setInterval(() => this.updateGlobalSpeed(), SPEED_UPDATE_INTERVAL_MS);

        // 服务端进度轮询
        this.serverPollInterval = setInterval(() => this.pollServerProgress(), SERVER_POLL_INTERVAL_MS);

        // 从 sessionStorage 恢复任务
        this.restoreTasks();
    }

    // ==================== 并发控制 ====================

    /**
     * 动态更新最大并发数
     * @param {number} value - 新的并发限制值
     */
    updateMaxConcurrent(value) {
        console.log('[DownloadManager] Concurrency limit updated to:', value);
        this.maxConcurrent = value;
        this.processQueue();
    }

    // ==================== 服务端进度轮询 ====================

    /**
     * 轮询服务端下载进度(云端任务 + 本地代理任务)
     * 包含超时检测机制
     */
    async pollServerProgress() {
        // 防重入: 上一次 poll 尚未完成时跳过,避免并发请求乱序导致进度回跳
        if (this._polling) return;
        this._polling = true;
        try {
            // 筛选需要轮询的任务: 只轮询 downloading 状态的任务
            const tasksToPoll = this.tasks.filter(t =>
                t.status === 'downloading'
            );
            if (tasksToPoll.length === 0) return;

            // 超时检测: 云端下载中的任务超过 5 分钟无进度变化则标记超时
            // 注意: waiting(云端排队)状态不检测超时,排队时间可能较长
            // 注意: 仅当进度值(received/progress)实际变化时才重置 lastProgressTime
            const now = Date.now();
            tasksToPoll.forEach(task => {
                if (task.isServer && task.lastProgressTime && task.status === 'downloading') {
                    const elapsed = now - task.lastProgressTime;
                    if (elapsed > CLOUD_DOWNLOAD_TIMEOUT_MS) {
                        console.warn(`[DownloadManager] Task timeout (云端下载): ${task.song.name} (no progress for ${Math.round(elapsed/1000)}s)`);
                        this.markTaskTimeout(task, 'TIMEOUT 超时');
                    }
                }
            });

            // 构建任务 ID 映射(前端 task.id -> 后端 rawId)
            const idMap = this.buildTaskIdMap(tasksToPoll);
            const ids = Object.keys(idMap).join(',');
            try {
                const resp = await fetch(`/api/music/cache/progress?ids=${encodeURIComponent(ids)}`);
                const result = await resp.json();
                if (result.success) {
                    const data = result.data;
                    this.updateTasksFromPolling(data, idMap, now);
                }
            } catch (e) {
                console.error('[DownloadManager] Server poll error:', e);
            }
        } finally {
            this._polling = false;
        }
    }

    /**
     * 构建任务 ID 映射(前端 task.id -> 后端 rawId)
     * @param {Array} tasks - 任务列表
     * @returns {Object} idMap - { rawId: taskId }
     */
    buildTaskIdMap(tasks) {
        const idMap = {};
        tasks.forEach(t => {
            if (t.isServer) {
                // task.id 格式: server_source_rawId，提取 rawId 用于查询 progress API
                const rawSongId = t.song?.id || t.song?.songmid || '';
                const rawId = rawSongId || t.id.replace(/^server_(batch_)?/, '');
                idMap[rawId] = t.id;
            } else {
                // 本地代理下载直接使用 taskId
                idMap[t.id] = t.id;
            }
        });
        return idMap;
    }

    /**
     * 根据轮询数据更新任务状态
     * @param {Object} data - 后端返回的进度数据
     * @param {Object} idMap - 任务 ID 映射
     * @param {number} now - 当前时间戳
     */
    updateTasksFromPolling(data, idMap, now) {
        let needsQueueProcess = false;

        // 处理有进度数据的任务
        Object.keys(data).forEach(rawId => {
            const taskId = idMap[rawId];
            const task = this.tasks.find(t => t.id === taskId);
            if (!task) return;

            const progressInfo = data[rawId];
            if (!progressInfo) return;

            // 如果本地任务已处于暂停状态,则忽略轮询结果中的 downloading 状态覆盖
            if (task.status === 'paused' && (progressInfo.status === 'downloading' || progressInfo.status === 'waiting')) {
                task.downloadedBytes = progressInfo.received || 0;
                task.totalBytes = progressInfo.total || 0;
                return;
            }

            // 计算轮询任务速度
            this.updatePolledTaskSpeed(task, progressInfo);

            // 更新任务状态和进度
            this.updateTaskStatusFromPoll(task, progressInfo);

            // 更新最后进度时间(仅当进度值实际变化时)
            this.updateTaskProgressTime(task, progressInfo);

            // 更新进度数据
            task.progress = progressInfo.progress || 0;
            task.downloadedBytes = progressInfo.received || 0;
            task.totalBytes = progressInfo.total || 0;

            // 处理完成/标记状态 — 内联完成逻辑,延迟 processQueue 避免循环中多次 renderList
            if (this.isTaskFinished(task, progressInfo)) {
                task.status = 'finished';
                task.progress = 100;
                task.errorMsg = '';
                this.saveTasks();
                needsQueueProcess = true;
            } else if (progressInfo.status !== 'error') {
                task.errorMsg = '';
            }

            this.renderTask(task);
        });

        // 处理没有进度数据的任务: key 已被删除 = 下载完成或从未开始
        if (this.handleMissingProgressTasks(data, idMap, now)) {
            needsQueueProcess = true;
        }

        // 循环结束后统一调用一次 processQueue,避免 DOM 抖动
        if (needsQueueProcess) {
            this.processQueue();
        }
    }

    /**
     * 计算轮询任务速度
     */
    updatePolledTaskSpeed(task, progressInfo) {
        if (task.lastPolledBytes === undefined || task.lastPolledTime === undefined) return;

        const now = Date.now();
        const elapsed = (now - task.lastPolledTime) / 1000;
        if (elapsed > 0) {
            const downloaded = (progressInfo.received || 0) - task.lastPolledBytes;
            task.speed = Math.max(0, downloaded / elapsed);
        }
        task.lastPolledBytes = progressInfo.received || 0;
        task.lastPolledTime = Date.now();
    }

    /**
     * 根据轮询数据更新任务状态
     */
    updateTaskStatusFromPoll(task, progressInfo) {
        if (progressInfo.status === 'finished' || progressInfo.status === 'tagging') {
            task.status = 'finished';
        } else if (progressInfo.status === 'error') {
            task.status = 'error';
            task.errorMsg = progressInfo.errorMsg || '下载失败';
            this.saveTasks();
            this.processQueue();
        } else if (progressInfo.status === 'waiting') {
            // 服务端 waiting 状态: HTTP 请求已发出但还没收到响应
            // 客户端保持为 'downloading' 但重置 lastProgressTime 防止误判超时
            task.status = 'downloading';
        } else if (task.isServer && (progressInfo.progress || 0) >= 100) {
            // 云端任务进度达100%但后端状态仍为downloading时,直接视为完成
            task.status = 'finished';
        } else {
            task.status = 'downloading';
        }
    }

    /**
     * 更新任务最后进度时间(仅当进度值实际变化时)
     */
    updateTaskProgressTime(task, progressInfo) {
        const prevProgress = task.progress || 0;
        const prevReceived = task.downloadedBytes || 0;
        const newProgress = progressInfo.progress || 0;
        const newReceived = progressInfo.received || 0;

        if (newProgress !== prevProgress || newReceived !== prevReceived) {
            task.lastProgressTime = Date.now();
        }
    }

    /**
     * 判断任务是否已完成
     */
    isTaskFinished(task, progressInfo) {
        return progressInfo.status === 'tagging' ||
               progressInfo.status === 'finished' ||
               (task.isServer && (progressInfo.progress || 0) >= 100);
    }

    /**
     * 标记任务为完成状态
     */
    markTaskFinished(task) {
        task.status = 'finished';
        task.progress = 100;
        task.errorMsg = '';
        // 不再自动下载歌词缓存
        this.saveTasks();
        this.processQueue();
    }

    /**
     * 处理缺失进度数据的任务
     */
    handleMissingProgressTasks(data, idMap, now) {
        let needsQueueProcess = false;
        this.tasks.filter(task => {
            const rawId = task.isServer ? (task.song?.id || task.song?.songmid || task.id.replace(/^server_(batch_)?/, '')) : task.id;
            return data[rawId] === undefined && task.status === 'downloading';
        }).forEach(task => {
            if (task.progress >= 99 || task.status === 'tagging') {
                // 进度很高或正在标记,视为已完成 — 内联完成逻辑,延迟 processQueue
                task.status = 'finished';
                task.progress = 100;
                task.errorMsg = '';
                this.saveTasks();
                task.speed = 0;
                needsQueueProcess = true;
                this.renderTask(task);
            } else if (task.isServer && task.lastProgressTime && (now - task.lastProgressTime > CLOUD_NO_DATA_TIMEOUT_MS)) {
                // 云端任务长时间无服务端进度数据: 服务端可能卡住
                console.warn(`[DownloadManager] Task timeout (无服务端数据): ${task.song.name} (no data for ${Math.round((now - task.lastProgressTime)/1000)}s)`);
                this.markTaskTimeout(task, 'TIMEOUT 超时(服务端无响应)');
            }
        });
        return needsQueueProcess;
    }

    /**
     * 标记任务超时
     * @param {Object} task - 任务对象
     * @param {string} errorMsg - 错误信息
     */
    markTaskTimeout(task, errorMsg) {
        task.status = 'error';
        task.errorMsg = errorMsg;
        task.speed = 0;
        this.renderTask(task);
        this.saveTasks();
        this.processQueue();
    }

    // ==================== UI 操作 ====================

    /**
     * 切换下载抽屉显示/隐藏
     */
    toggleDrawer() {
        if (this.drawer.classList.contains('translate-x-full')) {
            this.drawer.classList.remove('translate-x-full');
        } else {
            this.drawer.classList.add('translate-x-full');
        }
    }

    // ==================== 工具函数 ====================

    /**
     * 字节数转换为可读字符串
     * @param {number} bytes - 字节数
     * @returns {string} 格式化后的字符串
     */
    formatSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * HTML 转义,防止 XSS
     * @param {string} unsafe - 未转义的字符串
     * @returns {string} 转义后的字符串
     */
    escapeHtml(unsafe) {
        return (unsafe || '').toString()
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    /**
     * 获取歌曲封面 URL
     * @param {Object} song - 歌曲对象
     * @returns {string} 封面 URL
     */
    getSongCover(song) {
        if (!song) return '/music/assets/logo.png';
        return song.img || song.pic ||
            (song.meta && (song.meta.picUrl || song.meta.img)) ||
            (song.album && (song.album.picUrl || song.album.img)) ||
            '/music/assets/logo.png';
    }

    /**
     * 生成状态 HTML(用于空列表占位)
     * @param {string} icon - Font Awesome 图标类名
     * @param {string} text - 提示文本
     * @param {boolean} isSpin - 是否旋转动画
     * @returns {string} HTML 字符串
     */
    getStatusHtml(icon, text, isSpin = false) {
        return `
            <div class="flex flex-col items-center justify-center h-full text-center p-10 space-y-4">
                <i class="fas ${icon} ${isSpin ? 'fa-spin' : ''} text-4xl t-text-muted opacity-20"></i>
                <p class="text-sm t-text-muted font-medium">${text}</p>
            </div>
        `;
    }

    // ==================== 任务管理 ====================

    /**
     * 批量添加下载任务
     * @param {Array} songs - 歌曲对象数组
     * @returns {Promise<{added: number, skipped: number}>} 添加和跳过的数量
     */
    async addTasks(songs) {
        let addedCount = 0;
        let skippedCount = 0;

        // 第一批过滤：检查队列中是否已存在（waiting/downloading/finished）
        const songsToCheck = [];
        for (const song of songs) {
            // 1. 检查是否已在队列中（waiting 或 downloading）
            const existing = this.tasks.find(t =>
                t.song.id === song.id &&
                (t.status === 'waiting' || t.status === 'downloading')
            );
            if (existing) {
                skippedCount++;
                continue;
            }

            // 2. 检查是否已在当前会话中完成
            const finished = this.tasks.find(t => t.song.id === song.id && t.status === 'finished');
            if (finished) {
                skippedCount++;
                continue;
            }

            // 通过前两关检查，加入待数据库检查列表
            songsToCheck.push(song);
        }

        // 3. 批量检查 music 目录中是否已存在文件（复用 fetchDbDownloadStatuses）
        if (songsToCheck.length > 0 && window.fetchDbDownloadStatuses) {
            // 直接传入歌曲对象数组，由后端检查文件系统
            await window.fetchDbDownloadStatuses(songsToCheck);

            // 过滤掉数据库中已下载的歌曲
            const songsToAdd = songsToCheck.filter(song => {
                const songId = String(song.id || song.songmid || '');
                const dbStatus = window.dbDownloadStatusMap?.get(songId);
                if (dbStatus && dbStatus.status === 'finished') {
                    skippedCount++;
                    return false;
                }
                return true;
            });

            // 创建新任务
            for (const song of songsToAdd) {
                this.createTask(song);
                addedCount++;
            }
        } else {
            // 如果批量检查不可用，直接添加所有歌曲
            for (const song of songsToCheck) {
                this.createTask(song);
                addedCount++;
            }
        }

        // 自动打开抽屉
        if (this.drawer && this.drawer.classList.contains('translate-x-full')) {
            this.toggleDrawer();
        }

        this.renderList();
        this.processQueue();
        this.saveTasks();

        return { added: addedCount, skipped: skippedCount };
    }

    /**
     * 创建下载任务并添加到队列
     * @param {Object} song - 歌曲对象
     */
    createTask(song) {
        const isServerTask = song.isServer || false;
        const taskId = song.taskId ||
            (isServerTask ? 'server_' : 'dl_') +
            Date.now() + '_' +
            Math.random().toString(36).substr(2, 5);

        this.tasks.push({
            id: taskId,
            song: song,
            isServer: isServerTask,
            quality: song.quality || '',
            status: 'waiting',
            errorMsg: '',
            progress: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            speed: 0,
            retryCount: 0,
            maxRetries: DEFAULT_MAX_RETRIES,
            controller: null,
            downloadStartTime: Date.now(),
            lastProgressTime: Date.now()
        });
    }

    /**
     * 处理下载队列,根据并发限制启动任务
     */
    processQueue() {
        // 计算当前活跃任务数(本地 + 服务端)
        const localActive = this.tasks.filter(t =>
            !t.isServer && t.status === 'downloading'
        ).length;
        const serverActive = this.tasks.filter(t =>
            t.isServer && (t.status === 'downloading' || t.status === 'tagging')
        ).length;
        this.activeCount = localActive + serverActive;

        // 达到并发上限,停止调度
        if (this.activeCount >= this.maxConcurrent) {
            this.renderList();
            this.updateGlobalProgress();
            return;
        }

        // 查找下一个等待中的任务
        const nextTask = this.tasks.find(t => t.status === 'waiting');
        if (nextTask) {
            const pendingCount = this.tasks.filter(t => t.status === 'waiting').length;
            console.log(`[DL-DIAG] processQueue: active=${this.activeCount}/${this.maxConcurrent}, pending=${pendingCount}, next=${nextTask.song.name}`);
            if (nextTask.isServer) {
                this.startServerDownload(nextTask);
            } else {
                this.startDownload(nextTask);
            }
            // 递归填充其他槽位
            this.processQueue();
        }

        this.renderList();
        this.updateGlobalProgress();
    }

    // ==================== 服务端下载 ====================

    /**
     * 触发后端缓存下载(云端任务)
     * @param {Object} task - 任务对象
     */
    async startServerDownload(task) {
        task.status = 'downloading';
        this.renderTask(task);

        try {
            if (typeof resolveSongUrl !== 'function') {
                throw new Error('resolveSongUrl missing');
            }

            // 解析 URL - 按选定音质下载
            const urlStartMs = Date.now();
            const { quality, rawUrl } = await this.resolveAndExtractUrl(task);
            console.log(`[DL-DIAG] URL resolved: ${task.song.name}, resolveMs=${Date.now() - urlStartMs}`);

            // 提交到后端
            const submitMs = Date.now();
            await this.submitServerDownload(task, rawUrl, quality);
            console.log(`[DL-DIAG] Server submitted: ${task.song.name}, submitMs=${Date.now() - submitMs}`);
        } catch (e) {
            console.warn('[DownloadManager] Failed to start server task:', task.id, e);
            task.status = 'error';
            task.errorMsg = e.message || '启动失败';
            this.renderTask(task);
            this.processQueue();
        }
    }

    /**
     * 解析歌曲 URL 并提取真实地址
     * @param {Object} task - 任务对象
     * @returns {Promise<{quality: string, rawUrl: string}>}
     */
    async resolveAndExtractUrl(task) {
        const targetPref = task.quality || window.settings?.preferredQuality || DEFAULT_DOWNLOAD_QUALITY_PREF;
        const quality = window.QualityManager ?
            window.QualityManager.getBestDownloadQuality(task.song, targetPref) :
            null;

        // 如果没有可用音质,跳过下载
        if (!quality) {
            console.log(`[DownloadManager] 跳过无可用音质的歌曲: ${task.song.name}`);
            task.status = 'error';
            task.errorMsg = '无可用音质';
            this.renderTask(task);
            this.processQueue();
            throw new Error('无可用音质');
        }

        task.quality = quality;
        this.renderTask(task);

        const result = await resolveSongUrl(task.song, quality, true, true,true);
        if (!result || !result.url) {
            throw new Error('解析失败');
        }

        // 提取真实 URL(如果是代理地址)
        let rawUrl = result.url;
        if (rawUrl.startsWith('/api/music/download')) {
            const proxyParams = new URLSearchParams(
                rawUrl.includes('?') ? rawUrl.split('?')[1] : ''
            );
            const extracted = proxyParams.get('url');
            if (extracted) {
                rawUrl = decodeURIComponent(extracted);
            }
        }

        if (!rawUrl.startsWith('http')) {
            throw new Error('无法获取有效的外部下载地址');
        }

        return { quality, rawUrl };
    }

    /**
     * 提交服务端下载请求
     * @param {Object} task - 任务对象
     * @param {string} rawUrl - 真实 URL
     * @param {string} quality - 音质
     */
    async submitServerDownload(task, rawUrl, quality) {
        const headers = {
            'Content-Type': 'application/json',
            ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
        };

        const res = await fetch('/api/music/cache/download', {
            method: 'POST',
            headers,
            body: JSON.stringify({
                songInfo: task.song,
                url: rawUrl,
                quality,
                isOnlyDownload: true
            })
        });

        if (!res.ok) {
            throw new Error('服务器拒绝缓存');
        }

        // 更新 task.id 为 server_${source}_${songId} 格式,使轮询时匹配
        const rawSongId = task.song.id || task.song.songmid || '';
        const source = task.song.source || 'unknown';
        const serverKey = `${source}_${rawSongId}`;
        task.id = 'server_' + serverKey;

        // 重置超时计时 & 初始化轮询速度计算基准
        task.downloadStartTime = Date.now();
        task.lastProgressTime = Date.now();
        task.lastPolledBytes = 0;
        task.lastPolledTime = Date.now();
    }

    // ==================== 本地下载 ====================

    /**
     * 启动本地下载任务(通过代理)
     * @param {Object} task - 任务对象
     */
    async startDownload(task) {
        task.status = 'downloading';
        task.errorMsg = '';
        task.speed = 0;
        task.controller = new AbortController();
        this.renderTask(task);

        try {
            // 1. 解析 URL 和音质 - 按选定音质下载
            const { quality, finalUrl, filename } = await this.prepareLocalDownload(task);

            // 2. 使用 Stream 下载并追踪进度
            const blob = await this.downloadWithProgress(task, finalUrl);

            // 3. 完成下载,创建 Blob 并触发浏览器下载
            await this.completeLocalDownload(task, blob, filename);

        } catch (error) {
            this.handleDownloadError(task, error);
        }
    }

    /**
     * 准备本地下载: 解析 URL,构建代理地址
     * @param {Object} task - 任务对象
     * @returns {Promise<{quality: string, finalUrl: string, filename: string}>}
     */
    async prepareLocalDownload(task) {
        const targetPref = task.quality || window.settings?.preferredQuality || DEFAULT_DOWNLOAD_QUALITY_PREF;
        const quality = window.QualityManager ?
            window.QualityManager.getBestDownloadQuality(task.song, targetPref) :
            null;

        // 如果没有可用音质,跳过下载
        if (!quality) {
            console.log(`[DownloadManager] 跳过无可用音质的歌曲: ${task.song.name}`);
            task.status = 'error';
            task.errorMsg = '无可用音质';
            this.activeCount--;
            this.renderTask(task);
            this.processQueue();
            throw new Error('无可用音质');
        }

        task.quality = quality;
        this.renderTask(task);

        const headers = {
            'Content-Type': 'application/json',
            ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
        };

        // 获取解析 URL
        const resolveRes = await fetch('/api/music/url', {
            method: 'POST',
            headers,
            body: JSON.stringify({ songInfo: task.song, quality }),
            signal: task.controller.signal
        });

        if (!resolveRes.ok) throw new Error('Failed to resolve URL');
        const resolveData = await resolveRes.json();
        if (!resolveData.url) throw new Error('No download URL found');

        let finalUrl = resolveData.url;
        let ext = resolveData.type || 'mp3';
        if (ext.startsWith('flac')) ext = 'flac';
        if (ext === '128k' || ext === '320k') ext = 'mp3';
        const filename = `${task.song.singer} - ${task.song.name}.${ext}`;

        // 构建代理 URL(用于 tagging 支持)
        finalUrl = this.buildProxyDownloadUrl(task, finalUrl, filename);

        return { quality, finalUrl, filename };
    }

    /**
     * 构建代理下载 URL(包含元数据用于 tagging)
     * @param {Object} task - 任务对象
     * @param {string} originalUrl - 原始 URL
     * @param {string} filename - 文件名
     * @returns {string} 代理 URL
     */
    buildProxyDownloadUrl(task, originalUrl, filename) {
        let shouldProxyDownload = window.settings?.enableProxyDownload || true;
        if (!shouldProxyDownload && window.settings?.enableAutoProxy) {
            if (window.location.protocol === 'https:' && originalUrl.startsWith('http://')) {
                shouldProxyDownload = true;
            }
        }

        if (shouldProxyDownload && !originalUrl.startsWith('/api/music/download')) {
            // 添加元数据用于 tagging
            const albumName = task.song.albumName ||
                (task.song.album && typeof task.song.album === 'string' ? task.song.album : (task.song.album?.name || ''));
            let coverUrl = this.getSongCover(task.song);

            // 相对路径改为绝对路径,服务器才能正确抓取并嵌入封面
            if (coverUrl && coverUrl.startsWith('/')) {
                coverUrl = window.location.origin + coverUrl;
            }

            const metadataParams = [
                `tag=1`,
                `name=${encodeURIComponent(task.song.name)}`,
                `singer=${encodeURIComponent(task.song.singer)}`,
                `album=${encodeURIComponent(albumName)}`,
                coverUrl ? `pic=${encodeURIComponent(coverUrl)}` : ''
            ].filter(Boolean).join('&');

            const proxyUrl = `/api/music/download?url=${encodeURIComponent(originalUrl)}&filename=${encodeURIComponent(filename)}&taskId=${task.id}&${metadataParams}`;
            return proxyUrl;
        } else {
            return originalUrl;
        }
    }

    /**
     * 使用 Stream 下载并实时追踪进度
     * @param {Object} task - 任务对象
     * @param {string} url - 下载 URL
     * @returns {Promise<Blob>} 下载的文件 Blob
     */
    async downloadWithProgress(task, url) {
        const response = await fetch(url, { signal: task.controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status} when fetching file`);

        const contentLength = response.headers.get('content-length');
        task.totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

        const reader = response.body.getReader();
        let receivedLength = 0;
        const chunks = [];

        let lastUpdate = performance.now();
        let downloadedSinceLastUpdate = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            chunks.push(value);
            receivedLength += value.length;
            task.downloadedBytes = receivedLength;
            downloadedSinceLastUpdate += value.length;

            if (task.totalBytes) {
                task.progress = Math.round((receivedLength / task.totalBytes) * 100);
            }

            // 每 500ms 更新速度
            const now = performance.now();
            if (now - lastUpdate > LOCAL_SPEED_CALC_INTERVAL_MS) {
                const elapsedSecs = (now - lastUpdate) / 1000;
                task.speed = downloadedSinceLastUpdate / elapsedSecs;
                lastUpdate = now;
                downloadedSinceLastUpdate = 0;
                this.renderTask(task);
            }
        }

        // 合并 chunks 为 Blob
        return new Blob(chunks);
    }

    /**
     * 完成本地下载: 触发浏览器下载
     * @param {Object} task - 任务对象
     * @param {Blob} blob - 下载的文件 Blob
     * @param {string} filename - 文件名
     */
    async completeLocalDownload(task, blob, filename) {
        task.progress = 100;
        task.speed = 0;
        task.status = 'finished';
        this.renderTask(task);

        this.activeCount--;
        this.saveTasks();

        // 触发浏览器下载
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 清理 Blob URL
        setTimeout(() => URL.revokeObjectURL(blobUrl), BLOB_URL_CLEANUP_DELAY_MS);

        // 触发下一个任务
        this.processQueue();
    }

    /**
     * 处理下载错误
     * @param {Object} task - 任务对象
     * @param {Error} error - 错误对象
     */
    handleDownloadError(task, error) {
        this.activeCount--;

        if (task.controller && task.controller.signal.aborted) {
            task.status = 'paused';
            task.errorMsg = '已暂停';
        } else {
            console.error(`Download error for ${task.song.name}:`, error);
            task.errorMsg = error.message;

            // 重试逻辑
            if (task.retryCount < task.maxRetries) {
                this.scheduleRetry(task);
                return;
            } else {
                task.status = 'error';
            }
        }

        this.renderTask(task);
        this.processQueue();
    }

    /**
     * 调度任务重试
     * @param {Object} task - 任务对象
     */
    scheduleRetry(task) {
        task.retryCount++;
        task.status = 'error';
        this.renderTask(task);

        // 2 秒后重试
        setTimeout(() => {
            // 检查任务是否被用户手动取消或暂停
            if (task.controller?.signal?.aborted || task.status === 'paused' || task.status === 'finished') {
                console.log('[DownloadManager] Abort retry for task:', task.id);
                return;
            }

            // 创建新任务放到队列末尾
            const newTask = {
                ...task,
                status: 'waiting',
                errorMsg: '',
                downloadedBytes: 0,
                progress: 0,
                controller: null,
                lastProgressTime: Date.now()
            };
            this.tasks = this.tasks.filter(t => t.id !== task.id);
            this.tasks.push(newTask);
            this.renderList();
            this.processQueue();
        }, DOWNLOAD_RETRY_DELAY_MS);
    }

    // ==================== 任务控制 ====================

    /**
     * 暂停指定任务
     * @param {string} taskId - 任务 ID
     */
    pauseTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        if (task.isServer) {
            this.pauseServerTask(task);
        } else {
            this.pauseLocalTask(task);
        }
    }

    /**
     * 暂停云端任务
     * @param {Object} task - 任务对象
     */
    pauseServerTask(task) {
        if (task.status === 'downloading' || task.status === 'waiting') {
            const songKey = task.id.replace(/^server_(batch_)?/, '');
            this.notifyServerStop(songKey);
            task.status = 'paused';
            task.errorMsg = '已暂停';
            this.renderTask(task);
        }
    }

    /**
     * 暂停本地任务
     * @param {Object} task - 任务对象
     */
    pauseLocalTask(task) {
        if (task.status === 'downloading' && task.controller) {
            task.controller.abort();
        }
        if (task.status === 'downloading' || task.status === 'waiting') {
            task.status = 'paused';
            task.errorMsg = '已暂停';
            this.renderTask(task);
        }
    }

    /**
     * 恢复指定任务
     * @param {string} taskId - 任务 ID
     */
    resumeTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task || (task.status !== 'paused' && task.status !== 'error')) return;

        task.status = 'waiting';
        task.downloadedBytes = 0;
        task.progress = 0;
        task.lastProgressTime = Date.now();
        this.renderTask(task);

        if (task.isServer) {
            this.resumeServerTask(task);
        } else {
            this.processQueue();
        }
    }

    /**
     * 恢复云端任务(需重新解析 URL)
     * @param {Object} task - 任务对象
     */
    async resumeServerTask(task) {
        try {
            const { rawUrl, quality } = await this.resolveAndExtractUrl(task);
            await this.submitServerDownload(task, rawUrl, quality);
            task.status = 'downloading';
            this.renderTask(task);
        } catch (err) {
            console.warn('[DownloadManager] Resume cloud task failed:', task.song.name, err);
            task.status = 'error';
            task.errorMsg = err.message || '恢复失败';
            this.renderTask(task);
        }
    }

    /**
     * 删除指定任务
     * @param {string} taskId - 任务 ID
     */
    deleteTask(taskId) {
        const task = this.tasks.find(t => t.id === taskId);
        if (!task) return;

        // 停止进行中的任务
        if (task.isServer && (task.status === 'downloading' || task.status === 'waiting')) {
            const songKey = task.id.replace(/^server_(batch_)?/, '');
            this.notifyServerStop(songKey);
        } else if (!task.isServer && task.status === 'downloading' && task.controller) {
            task.controller.abort();
        }

        // 从队列中移除
        this.tasks = this.tasks.filter(t => t.id !== taskId);
        this.renderList();
        this.processQueue();
        this.saveTasks();
    }

    /**
     * 通知服务端停止任务
     * @param {string} songKey - 歌曲 key
     */
    notifyServerStop(songKey) {
        const headers = {
            'Content-Type': 'application/json',
            ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
        };
        fetch('/api/music/cache/stop', {
            method: 'POST',
            headers,
            body: JSON.stringify({ songKey })
        }).catch(e => console.warn('[DownloadManager] Failed to stop server task:', e));
    }

    /**
     * 暂停所有任务
     */
    pauseAll() {
        this.tasks.forEach(t => {
            if (t.status === 'downloading' || t.status === 'waiting') {
                this.pauseTask(t.id);
            }
        });
    }

    /**
     * 恢复所有暂停任务
     */
    resumeAll() {
        this.tasks.forEach(t => {
            if (t.status === 'paused') {
                this.resumeTask(t.id);
            }
        });
    }

    /**
     * 重试所有超时失败的任务
     */
    retryAllFailed() {
        const failedTasks = this.tasks.filter(t =>
            t.status === 'error' && /TIMEOUT|超时/i.test(t.errorMsg || '')
        );

        if (failedTasks.length === 0) {
            if (window.showInfo) window.showInfo('没有超时失败的任务');
            return;
        }

        failedTasks.forEach(t => {
            t.retryCount = 0;
            t.downloadedBytes = 0;
            t.progress = 0;
            t.errorMsg = '';
            t.lastProgressTime = Date.now();

            // 移到队列末尾
            this.tasks = this.tasks.filter(x => x.id !== t.id);

            if (t.isServer) {
                this.retryServerTask(t);
            } else {
                t.status = 'waiting';
                this.tasks.push(t);
            }
        });

        this.renderList();
        this.processQueue();
    }

    /**
     * 重试云端任务
     * @param {Object} task - 任务对象
     */
    async retryServerTask(task) {
        task.status = 'waiting';
        this.tasks.push(task);
        this.renderTask(task);

        try {
            const { rawUrl, quality } = await this.resolveAndExtractUrl(task);
            await this.submitServerDownload(task, rawUrl, quality);
            task.status = 'downloading';
            this.renderTask(task);
        } catch (err) {
            console.warn('[DownloadManager] Retry cloud task failed:', task.song.name, err);
            task.status = 'error';
            task.errorMsg = err.message || '重试失败';
            this.renderTask(task);
        }
    }

    clearCompleted() {
        this.tasks = this.tasks.filter(t => t.status !== 'finished');
        this.renderList();
        this.saveTasks();
    }

    clearFailed() {
        // 清空所有状态为 error 的任务
        const failedCount = this.tasks.filter(t => t.status === 'error').length;
        if (failedCount === 0) {
            if (window.showInfo) window.showInfo('没有失败的任务');
            return;
        }
        this.tasks = this.tasks.filter(t => t.status !== 'error');
        this.renderList();
        this.saveTasks();
        this.updateGlobalSpeed();
        if (window.showSuccess) window.showSuccess(`已清空 ${failedCount} 个失败任务`);
    }

    clearAll() {
        // 先弹确认框
        if (typeof showSelect === 'function') {
            showSelect('停止并清空任务', '确认要立即停止所有进行中的任务并清空列表吗？', {
                confirmText: '确认停止',
                danger: true
            }).then(confirmed => {
                if (!confirmed) return;
                this.tasks.forEach(t => {
                    // 本地任务调用 abort
                    if ((t.status === 'downloading' || t.status === 'waiting') && t.controller) {
                        try { t.controller.abort(); } catch (e) { }
                    }
                });

                // [NEW] 通知服务器中止所有该用户的缓存任务
                const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
                fetch('/api/music/cache/stop', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-user-name': username
                    },
                    body: JSON.stringify({ all: true })
                }).catch(err => console.error('[DownloadManager] Failed to stop server tasks:', err));

                this.tasks = [];
                this.activeCount = 0;
                this.renderList();
                this.saveTasks();
            });
        } else {
            // fallback：直接清空
            this.tasks.forEach(t => {
                if (t.status === 'downloading' && t.controller) t.controller.abort();
            });
            this.tasks = [];
            this.activeCount = 0;
            this.renderList();
            this.saveTasks();
        }
    }

    // Sync: scan disk files and write missing DB records, then refresh UI status
    async syncFileToDb() {
        try {
            const res = await fetch('/api/music/db/sync', {
                method: 'POST',
                headers: window.getUserAuthHeaders ? window.getUserAuthHeaders() : {}
            });
            const result = await res.json();
            if (result.success) {
                const count = result.synced || 0;
                if (count > 0) {
                    if (typeof showSuccess === 'function') {
                        showSuccess(`同步完成：新增 ${count} 条数据库记录`);
                    } else {
                        alert(`同步完成：新增 ${count} 条数据库记录`);
                    }
                    // Clear stale dbDownloadStatusMap so next render fetches fresh data
                    if (window.dbDownloadStatusMap) {
                        window.dbDownloadStatusMap.clear();
                    }
                } else {
                    if (typeof showInfo === 'function') {
                        showInfo('同步完成：所有文件已在数据库中');
                    } else {
                        alert('同步完成：所有文件已在数据库中');
                    }
                }
            } else {
                throw new Error(result.message || '同步失败');
            }
        } catch (e) {
            console.warn('[DownloadManager] syncFileToDb failed:', e);
            if (typeof showError === 'function') {
                showError('同步失败: ' + e.message);
            } else {
                alert('同步失败: ' + e.message);
            }
        }
    }

    // Persist tasks to sessionStorage
    saveTasks() {
        try {
            // Serialize only the data we need, not the AbortController
            const data = this.tasks.map(t => ({
                id: t.id,
                song: t.song,
                isServer: t.isServer,
                quality: t.quality,
                status: t.status === 'downloading' ? (t.isServer ? 'waiting' : 'waiting') : t.status,
                progress: t.status === 'finished' ? 100 : (t.isServer ? t.progress : 0),
                errorMsg: t.errorMsg || '',
                retryCount: t.retryCount || 0,
                maxRetries: t.maxRetries || 2
            }));
            sessionStorage.setItem('lx_download_tasks', JSON.stringify(data));

            // Update global download status map for UI rendering
            window.downloadStatusMap = this.getAllDownloadStatuses();
        } catch (e) {
            console.warn('[DownloadManager] Failed to save tasks to sessionStorage:', e);
        }
    }

    // Restore tasks from sessionStorage on page load
    restoreTasks() {
        try {
            const raw = sessionStorage.getItem('lx_download_tasks');
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!Array.isArray(data) || data.length === 0) return;

            data.forEach(t => {
                this.tasks.push({
                    id: t.id,
                    song: t.song,
                    isServer: t.isServer || false,
                    quality: t.quality || '',
                    // Local downloading → reset to waiting to re-download; server/finished → keep status
                    status: t.status,
                    progress: t.progress || 0,
                    downloadedBytes: 0,
                    totalBytes: 0,
                    speed: 0,
                    errorMsg: t.errorMsg || '',
                    retryCount: t.retryCount || 0,
                    maxRetries: t.maxRetries || 2,
                    controller: null,
                    // 恢复任务时设置时间戳，确保超时检测能正常工作
                    downloadStartTime: Date.now(),
                    lastProgressTime: Date.now()
                });
            });

            this.renderList();
            // Start queued local tasks
            this.processQueue();
            // Update global download status map
            window.downloadStatusMap = this.getAllDownloadStatuses();
            console.log(`[DownloadManager] Restored ${data.length} tasks from sessionStorage`);
        } catch (e) {
            console.warn('[DownloadManager] Failed to restore tasks from sessionStorage:', e);
        }
    }

    // Update the UI Global Speed Counter
    updateGlobalSpeed() {
        let totalSpeed = 0;
        let active = 0;
        let pctTotal = 0;
        let pctCount = 0;

        this.tasks.forEach(t => {
            if (t.status === 'downloading') {
                totalSpeed += (t.speed || 0);
                active++;
            }
            // 所有任务都纳入进度计算（server 任务可能 totalBytes=0，但 progress/status 是已知的）
            if (t.status === 'finished') {
                pctTotal += 100;
                pctCount++;
            } else if (t.status === 'downloading' || t.status === 'waiting') {
                pctTotal += (t.progress || 0);
                pctCount++;
            }
        });

        if (this.globalSpeedEl) {
            const finishedCount = this.tasks.filter(t => t.status === 'finished').length;
            const errorCount = this.tasks.filter(t => t.status === 'error').length;
            this.globalSpeedEl.innerHTML = `${this.formatSize(totalSpeed)}/s • ${this.tasks.length} TASKS <span class="text-emerald-500">✓${finishedCount}</span> <span class="text-red-400">✗${errorCount}</span>`;
        }

        if (this.progressTextEl) {
            const overallProgress = pctCount > 0 ? Math.round(pctTotal / pctCount) : 0;
            this.progressTextEl.innerText = `${overallProgress}%`;
        }

        // Update header badge
        this.updateHeaderBadge();
    }

    // Update the header download task badge
    updateHeaderBadge() {
        const badge = document.getElementById('download-task-badge');
        if (!badge) return;

        // Count active tasks (downloading + waiting)
        const activeCount = this.tasks.filter(t => t.status === 'downloading' || t.status === 'waiting').length;

        if (activeCount > 0) {
            badge.textContent = activeCount > 999 ? '999+' : activeCount;
            badge.classList.remove('hidden');
            badge.classList.add('flex');
        } else {
            badge.classList.add('hidden');
            badge.classList.remove('flex');
        }
    }

    updateGlobalProgress() {
        this.updateGlobalSpeed(); // Calculates and updates
    }

    // Render a single task row item to HTML
    renderTaskHtml(task) {
        const coverSrc = this.getSongCover(task.song);
        const sourceName = {
            'wy': '网易', 'tx': 'QQ', 'kg': '酷狗', 'kw': '酷我', 'mg': '咪咕'
        }[task.song.source] || task.song.source;

        let qualityLabel = task.quality || window.settings?.preferredQuality || '优先最高';
        // 如果是音质代码（如 320k），尝试转换为显示名称
        if (window.QualityManager) {
            // 先尝试把代码转换成名称（如 320k -> 高品质）
            const displayName = window.QualityManager.getQualityDisplayName(qualityLabel);
            if (displayName) qualityLabel = displayName;
        }

        let statusBg = 'bg-gray-100 t-text-muted';
        let statusText = '等待中';
        let actionBtnHTML = '';
        let progressWidth = task.progress || 0;
        let speedText = '';
        let isServerTask = task.isServer || false;

        if (task.status === 'downloading') {
            statusBg = isServerTask ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600';
            // 云端任务：若 totalBytes=0 且 progress=0，说明还没轮询到进度，显示 indeterminate 而非 "云端 0%"
            const hasRealProgress = isServerTask && (task.totalBytes > 0 || task.progress > 0);
            statusText = isServerTask
                ? (hasRealProgress ? `云端 ${progressWidth}%` : '云端下载中')
                : `${progressWidth}%`;
            speedText = task.speed > 0 ? `${this.formatSize(task.speed)}/s` : '';

            if (!isServerTask) {
                actionBtnHTML = `
                    <button onclick="window.SystemDownloadManager.pauseTask('${task.id}')" class="w-8 h-8 rounded-full border border-yellow-200 text-yellow-500 hover:bg-yellow-50 flex items-center justify-center transition-colors shadow-sm" title="暂停">
                        <i class="fas fa-pause text-xs"></i>
                    </button>
                `;
            }
        } else if (task.status === 'paused') {
            statusBg = 'bg-yellow-100 text-yellow-600';
            statusText = '已暂停';
            actionBtnHTML = `
                <button onclick="window.SystemDownloadManager.resumeTask('${task.id}')" class="w-8 h-8 rounded-full border border-emerald-200 text-emerald-500 hover:bg-emerald-50 flex items-center justify-center transition-colors shadow-sm" title="继续">
                    <i class="fas fa-play text-xs"></i>
                </button>
            `;
        } else if (task.status === 'error') {
            statusBg = 'bg-red-100 text-red-600';
            statusText = task.retryCount > 0 && task.retryCount < task.maxRetries ? `重试 (${task.retryCount})` : '失败';
            actionBtnHTML = `
                <button onclick="window.SystemDownloadManager.resumeTask('${task.id}')" class="w-8 h-8 rounded-full border border-red-200 text-red-500 hover:bg-red-50 flex items-center justify-center transition-colors shadow-sm" title="重试">
                    <i class="fas fa-redo text-xs"></i>
                </button>
            `;
        } else if (task.status === 'finished') {
            statusBg = 'bg-emerald-100 text-emerald-600';
            statusText = isServerTask ? '已存云端' : '已完成';
            progressWidth = 100;
        } else if (task.status === 'waiting') {
            statusText = isServerTask ? '云端排队' : '等待中';
            if (!isServerTask) {
                actionBtnHTML = `
                    <button onclick="window.SystemDownloadManager.pauseTask('${task.id}')" class="w-8 h-8 rounded-full border border-yellow-200 text-yellow-500 hover:bg-yellow-50 flex items-center justify-center transition-colors shadow-sm" title="暂停">
                        <i class="fas fa-pause text-xs"></i>
                    </button>
                `;
            }
        }

        // Always show delete button mostly
        if (task.status !== 'downloading' || isServerTask) {
            actionBtnHTML += `
                <button onclick="window.SystemDownloadManager.deleteTask('${task.id}')" class="w-8 h-8 rounded-full border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors ml-1 shadow-sm" title="移除任务">
                    <i class="fas fa-trash-alt text-xs"></i>
                </button>
            `;
        } else {
            actionBtnHTML += `
                <button onclick="window.SystemDownloadManager.deleteTask('${task.id}')" class="w-8 h-8 rounded-full border border-red-100 text-red-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors ml-1 shadow-sm" title="取消下载">
                    <i class="fas fa-times text-xs"></i>
                </button>
            `;
        }

        return `
            <div id="dl-task-${task.id}" class="relative p-3 rounded-xl t-bg-panel hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors border border-transparent hover:t-border-main group flex gap-3 overflow-hidden shadow-sm mb-2">
                <!-- Progress Bar Background -->
                ${task.status !== 'waiting' && task.status !== 'error' ? `
                <div class="absolute bottom-0 left-0 h-2 ${isServerTask ? 'bg-orange-400' : 'bg-emerald-400'} transition-all duration-300 opacity-70" style="width: ${progressWidth}%"></div>
                ` : ''}

                <!-- Cover -->
                <div class="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 shadow-sm border t-border-main">
                    <img src="${this.escapeHtml(coverSrc)}" class="w-full h-full object-cover">
                    ${(task.status === 'downloading') ? `
                    <div class="absolute inset-0 bg-black/40 flex items-center justify-center backdrop-blur-[2px]">
                        <i class="fas ${(isServerTask ? 'fa-cloud-upload-alt' : 'fa-spinner fa-spin')} text-white text-xs"></i>
                    </div>` : ''}
                </div>

                <!-- Info -->
                <div class="flex-1 min-w-0 flex flex-col justify-center">
                    <div class="flex items-center gap-1.5 mb-1 flex-nowrap">
                        <span class="shrink-0 text-[10px] font-bold text-white ${isServerTask ? 'bg-orange-500' : 'bg-red-400'} px-1.5 py-0.5 rounded uppercase tracking-wider">${this.escapeHtml(sourceName)}</span>
                        <span class="shrink-0 text-[10px] font-bold text-white ${isServerTask ? 'bg-purple-500' : 'bg-sky-500'} px-1.5 py-0.5 rounded tracking-wider">${isServerTask ? '云端' : '本地'}</span>
                        <h4 class="text-sm font-bold t-text-main truncate leading-tight flex-1 min-w-0 dynamic-marquee overflow-hidden" data-text="${this.escapeHtml(task.song.name)}">${this.escapeHtml(task.song.name)}</h4>
                    </div>
                    
                    <div class="flex items-center justify-between mt-1">
                        <div class="text-[10px] t-text-muted truncate flex gap-2 items-center">
                            <span class="text-emerald-600 font-medium px-1 bg-emerald-50 rounded">${this.escapeHtml(qualityLabel)}</span>
                            <span class="truncate opacity-60">${this.escapeHtml(task.song.singer)}</span>
                        </div>
                        
                        <div class="flex items-center gap-1.5 font-bold justify-end">
                            ${speedText ? `<span class="text-[10px] font-mono text-emerald-500">${speedText}</span>` : ''}

                            <span class="text-[10px] px-1.5 py-0.5 rounded ${statusBg} truncate max-w-[160px] text-right">
                                ${task.errorMsg ? `<span title="${this.escapeHtml(task.errorMsg)}">${this.escapeHtml(task.errorMsg)}</span>` : statusText}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Actions -->
                <div class="flex items-center pl-1 opacity-0 group-hover:opacity-100 transition-all transform translate-x-2 group-hover:translate-x-0">
                    ${actionBtnHTML}
                </div>
            </div>
        `;
    }

    // Refresh entire list DOM
    renderList() {
        if (!this.listContainer) return;

        if (this.tasks.length === 0) {
            this.listContainer.innerHTML = this.getStatusHtml('fa-inbox', '暂无下载任务');
            return;
        }

        this.listContainer.innerHTML = this.tasks.map(t => this.renderTaskHtml(t)).join('');
        // 触发标题滚动检测
        if (typeof applyMarqueeChecks === 'function') applyMarqueeChecks();
    }

    // Update specific task in DOM to avoid full re-render
    renderTask(task) {
        if (!this.listContainer) return;
        const taskEl = document.getElementById(`dl-task-${task.id}`);
        if (!taskEl) {
            // Task element doesn't exist (maybe switched views?), do full render
            this.renderList();
            return;
        }

        // Quick efficient replacement
        const div = document.createElement('div');
        div.innerHTML = this.renderTaskHtml(task);
        const newEl = div.firstElementChild;
        taskEl.parentNode.replaceChild(newEl, taskEl);
        // 触发标题滚动检测
        if (typeof applyMarqueeChecks === 'function') applyMarqueeChecks();

        // [New] 实时更新音乐列表中的状态列
        this.updateListStatusColumn(task);
    }

    // [New] 更新音乐列表中指定歌曲的状态列
    updateListStatusColumn(task) {
        if (!task || !task.song) return;
        const songId = String(task.song.id);
        if (!songId) return;

        // 更新全局状态映射
        if (!window.dbDownloadStatusMap) {
            window.dbDownloadStatusMap = new Map();
        }
        window.dbDownloadStatusMap.set(songId, {
            status: task.status,
            errorMsg: task.errorMsg,
            isServer: task.isServer
        });

        // 更新 DOM 中的状态列图标
        // 支持多种列表容器：搜索结果、歌单详情、排行榜
        // 每个行都有 data-song-id 属性
        const rows = document.querySelectorAll(`[data-song-id="${songId}"]`);
        rows.forEach(row => {
            // 找到标题列中的状态图标容器 (data-dl-status 属性)
            const statusEl = row.querySelector('[data-dl-status]');
            if (statusEl && typeof window.getDownloadStatusIcon === 'function') {
                statusEl.innerHTML = window.getDownloadStatusIcon(
                    { status: task.status, errorMsg: task.errorMsg, isServer: task.isServer },
                    songId
                );
            }
        });
    }

    // Get download status for a specific song (by song ID)
    // Returns: { status: 'finished'|'error'|'downloading'|'waiting'|'paused'|null, errorMsg?: string }
    getSongDownloadStatus(songId) {
        if (!songId) return { status: null };
        const idStr = String(songId);
        const task = this.tasks.find(t => String(t.song.id) === idStr);
        if (!task) return { status: null };
        return { status: task.status, errorMsg: task.errorMsg, isServer: task.isServer };
    }

    // Get all download statuses as a map for efficient lookup during render
    // Returns: Map<songId, { status, errorMsg, isServer }>
    getAllDownloadStatuses() {
        const map = new Map();
        this.tasks.forEach(t => {
            const songId = String(t.song.id);
            // Only keep the most relevant status for each song
            // Priority: downloading > waiting > paused > error > finished
            const existing = map.get(songId);
            if (!existing) {
                map.set(songId, { status: t.status, errorMsg: t.errorMsg, isServer: t.isServer });
            } else {
                const priority = { downloading: 5, waiting: 4, paused: 3, error: 2, finished: 1 };
                if ((priority[t.status] || 0) > (priority[existing.status] || 0)) {
                    map.set(songId, { status: t.status, errorMsg: t.errorMsg, isServer: t.isServer });
                }
            }
        });
        return map;
    }
}

// Global UI Toggles for Download Drawer
window.toggleDownloadDrawer = function () {
    if (window.SystemDownloadManager) {
        window.SystemDownloadManager.toggleDrawer();
    }
};

window.openDownloadManager = function () {
    if (window.SystemDownloadManager) {
        if (window.SystemDownloadManager.drawer.classList.contains('translate-x-full')) {
            window.SystemDownloadManager.toggleDrawer();
        }
    }
};

// Initialize globally
window.SystemDownloadManager = new DownloadManager();

// ==================== 全局下载状态工具函数 ====================

/**
 * 渲染下载状态图标 HTML（用于歌单详情、排行榜等列表的状态列）
 * @param {Object} statusInfo - { status: 'finished'|'error'|'downloading'|'waiting'|'paused'|null, errorMsg?: string, isServer?: boolean }
 * @param {string} songId - 歌曲 ID（用于 tooltip 等）
 * @returns {string} HTML 字符串
 */
window.getDownloadStatusIcon = function (statusInfo, songId) {
    if (!statusInfo || !statusInfo.status) {
        return '<span class="inline-flex items-center justify-center w-5 h-5" title="未下载"><i class="fas fa-circle text-[6px] text-gray-500"></i></span>';
    }
    switch (statusInfo.status) {
        case 'finished':
            return '<span class="inline-flex items-center justify-center w-5 h-5" title="已下载"><i class="fas fa-check-circle text-emerald-500 text-sm"></i></span>';
        case 'downloading':
        case 'tagging':
            return '<span class="inline-flex items-center justify-center w-5 h-5" title="下载中"><i class="fas fa-spinner fa-spin text-blue-400 text-sm"></i></span>';
        case 'waiting':
            return '<span class="inline-flex items-center justify-center w-5 h-5" title="等待中"><i class="fas fa-clock text-yellow-400 text-sm"></i></span>';
        case 'paused':
            return '<span class="inline-flex items-center justify-center w-5 h-5" title="已暂停"><i class="fas fa-pause-circle text-yellow-500 text-sm"></i></span>';
        case 'error':
            return '<span class="inline-flex items-center justify-center w-5 h-5" title="下载失败"><i class="fas fa-times-circle text-red-400 text-sm"></i></span>';
        default:
            return '<span class="inline-flex items-center justify-center w-5 h-5" title="未下载"><i class="fas fa-circle text-[6px] text-gray-500"></i></span>';
    }
};

/**
 * 判断歌曲是否为“已下载”状态（finished 或 error 均视为已尝试下载）
 * @param {Object|null} statusInfo - { status: string }
 * @returns {boolean}
 */
window.isSongDownloaded = function (statusInfo) {
    if (!statusInfo || !statusInfo.status) return false;
    return statusInfo.status === 'finished' || statusInfo.status === 'error';
};

/**
 * 从后端文件系统批量检查歌曲在 music 目录中是否存在
 * 在歌单详情、排行榜加载时调用，确保历史下载记录能被UI感知
 * @param {Array} songs - 歌曲对象数组 [{ id, name, singer, albumName, source }]
 */
window.fetchDbDownloadStatuses = async function (songs) {
    if (!songs || songs.length === 0) return;
    try {
        const batch = songs.slice(0, 100).map(s => ({
            id: String(s.id || s.songmid || ''),
            name: s.name || '',
            singer: s.singer || 'Unknown',
            albumName: s.albumName || 'Unknown',
            source: s.source || ''
        })).filter(s => s.id && s.name);

        if (batch.length === 0) return;

        const res = await fetch('/api/music/cache/status', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(window.getUserAuthHeaders ? window.getUserAuthHeaders() : {})
            },
            body: JSON.stringify({ songs: batch })
        });
        const result = await res.json();
        if (result.success && result.data) {
            if (!window.dbDownloadStatusMap) {
                window.dbDownloadStatusMap = new Map();
            }
            Object.entries(result.data).forEach(([id, info]) => {
                // 仅当内存中还没有该歌曲的状态时，才用文件系统状态补充
                if (!window.dbDownloadStatusMap.has(id)) {
                    window.dbDownloadStatusMap.set(id, {
                        status: info.exists ? 'finished' : null,
                        isServer: true,
                        relativePath: info.relativePath || '',
                        ext: info.ext || ''
                    });
                }
            });
        }
    } catch (e) {
        console.warn('[DownloadManager] fetchDbDownloadStatuses failed:', e);
    }
};
