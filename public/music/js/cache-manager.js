/**
 * Cache Manager - 缓存管理模块
 * 管理服务器缓存检查、触发、统计、列表及清理操作
 *
 * @module CacheManager
 */

// ============================================================================
// 服务器缓存辅助函数 (Server Cache Helpers)
// ============================================================================

async function checkServerCache(song, quality, exactQuality = false) {
    try {
        const username = window.currentListData?.username || '';
        const albumName = song.albumName || (song.album && (song.album.name || song.album)) || '';
        const params = new URLSearchParams({
            name: song.name,
            singer: song.singer,
            source: song.source,
            songmid: song.songmid || (song.meta && (song.meta.songmid || song.meta.songId)) || '',
            songId: song.songId || (song.meta && song.meta.songId) || song.id,
            quality: quality || '',
            albumName: albumName
        });
        if (exactQuality) params.append('exactQuality', '1');
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch(`/api/music/file/check?${params}`, {headers});
        if (res.ok) {
            const data = await res.json();
            if (data.exists) {
                let url = null;
                // Use backend URL (contains relativePath: singer/album/file.ext)
                if (data.url) url = data.url;
                if (url) {
                    // Return object with URL, audio metadata, folder source, and relativePath from server
                    return {
                        url,
                        folder: data.folder || 'cache', // 'download' (用户下载) 或 'cache' (在线缓存)
                        relativePath: data.relativePath || null, // 用于 move-to-music 单文件移动
                        sampleRate: data.sampleRate || null,
                        bitDepth: data.bitDepth || null,
                        channels: data.channels || null,
                        bitRate: data.bitRate || null,
                        duration: data.duration || null
                    };
                }
            }
        }
    } catch (e) {
        console.error('[ServerCache] Check failed:', e);
    }
    return null;
}

async function triggerServerCache(song, url, quality) {
    try {
        // [4.5] 本地音乐库歌曲文件缺失时，只有无损及以上音质才下载到 music/ 目录并写入 DB 记录
        // [4.5] 非无损音质不保存到 music/，仅缓存到 cache/（如果开启了服务端缓存）
        const isLossless = window.QualityManager.isLosslessQuality(quality);
        const saveToMusic = !!song._wasMusicLibSong && isLossless;
        if (song._wasMusicLibSong) {
            if (!isLossless) {
                // 非无损音质不下载到 music/，如果未开启缓存则完全跳过
                if (!window.settings.enableServerCache) return;
            }
        } else {
            if (!window.settings.enableServerCache) return;
        }

        const headers = {'Content-Type': 'application/json'};
        Object.assign(headers, getUserAuthHeaders());

        // 添加管理员验证 Header (如果已登录)
        const adminPass = localStorage.getItem('lx_admin_password');
        if (adminPass) headers['x-frontend-auth'] = adminPass;

        // 加个日志
        // console.log('[ServerCache] Triggering cache download for', song, url, quality, saveToMusic);
        await fetch('/api/music/cache/download', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({songInfo: song, url, quality, isOnlyDownload: saveToMusic})
        });
    } catch (e) {
        console.error('[ServerCache] Trigger failed:', e);
    }
}

// ============================================================================
// 缓存统计与重置逻辑 (Cache Statistics & Reset)
// ============================================================================

function calcStorageUsage() {
    let total = 0;
    for (let x in localStorage) {
        if (!localStorage.hasOwnProperty(x)) continue;
        const val = localStorage.getItem(x);
        total += (x.length + val.length) * 2; // UTF-16 characters are 2 bytes
    }
    // Convert to readable format
    if (total < 1024) return total + ' B';
    if (total < 1024 * 1024) return (total / 1024).toFixed(2) + ' KB';
    return (total / (1024 * 1024)).toFixed(2) + ' MB';
}

function updateStorageStatsUI() {
    const el = document.getElementById('storage-usage-info');
    if (el) {
        el.innerText = calcStorageUsage();
    }
}

async function resetAllSettings() {
    const ok = await showSelect('重置所有设置', '确定要重置吗？这不会删除您的歌单，但会恢复音质、列表显示、主题等设置到默认状态。 (Restore all settings to default?)', {danger: true});
    if (!ok) return;
    try {
        // Reset to default
        window.settings = {...window.DEFAULT_SETTINGS};
        localStorage.setItem('lx_settings', JSON.stringify(window.settings));
        localStorage.removeItem('lx_playback_state'); // 同时重置播放进度记忆

        // If sync enabled, push to server
        if (window.settings.saveAccountSettingsToFile) {
            pushSettingsToServer();
        }

        showSuccess('设置已重置，正在重新加载页面...');
        setTimeout(() => {
            window.location.reload();
        }, 1500);
    } catch (e) {
        showError('重置失败: ' + e.message);
    }
}

async function clearCache(type) {
    if (!(await showSelect('清除缓存', '确定要清除本地缓存吗？', {danger: true}))) return;

    let clearServerLyric = false;
    if (type === 'lyric') {
        clearServerLyric = await showSelect('清除缓存', '是否同时清除本地缓存文件夹内的歌词LRC文件？', {danger: true});

        if (clearServerLyric) {
            const isPublicUser = !window.currentListData || !window.currentListData.username || window.currentListData.username === 'default';
            if (isPublicUser && window.lx_config && window.lx_config['user.enablePublicRestriction']) {
                const isAdminSession = localStorage.getItem('lx_admin_password');
                const enableServerLyricCache = window.settings && window.settings.enableServerLyricCache === true;
                if (!enableServerLyricCache && !isAdminSession) {
                    if (typeof window.handleAdminAuth === 'function') {
                        const authorized = await window.handleAdminAuth('清除服务器歌词缓存需要管理员身份');
                        if (!authorized) {
                            // 验证失败或取消时，只取消服务端歌词清理，不影响浏览器层面的缓存清理
                            clearServerLyric = false;
                        }
                    } else {
                        showError('清除服务器歌词缓存受限，需要管理员身份');
                        clearServerLyric = false;
                    }
                }
            }
        }
    }

    let count = 0;
    const keysToRemove = [];

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // [Fix] 统一使用 lx_lyric_ 和 lx_url_ 前缀进行清理
        if (type === 'lyric' && key.startsWith('lx_lyric_')) {
            keysToRemove.push(key);
        } else if (type === 'url' && key.startsWith('lx_url_')) {
            keysToRemove.push(key);
        }
    }

    keysToRemove.forEach(k => {
        localStorage.removeItem(k);
        count++;
    });

    updateStorageStatsUI();
    const mapFromName = {'lyric': '歌词', 'url': '链接'};
    showSuccess(`已清除 ${count} 条${mapFromName[type] || ''}本地缓存`);

    if (clearServerLyric) {
        try {
            const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
            const headers = {};
            Object.assign(headers, getUserAuthHeaders());

            const res = await fetch('/api/music/cache/lyric/clear', {method: 'POST', headers});
            const data = await res.json();
            if (data.success) {
                showSuccess(`已同时清除 ${data.data.deletedCount} 个本地LRC文件`);
                // 刷新缓存列表（如果在看列表的话）
                const drawer = document.getElementById('cache-drawer');
                if (drawer && !drawer.classList.contains('translate-x-full')) {
                    refreshCacheList();
                }
                updateServerCacheSize();
            } else {
                throw new Error(data.message || '清除失败');
            }
        } catch (e) {
            showError('清除本地LRC文件失败: ' + e.message);
        }
    }
}

// 更新服务器缓存大小统计
async function updateServerCacheSize() {
    const infoEl = document.getElementById('server-cache-info');
    if (!infoEl) return;

    try {
        infoEl.textContent = '计算中...';
        infoEl.className = 'text-sm font-bold text-gray-500 t-bg-main px-2 py-1 rounded';

        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const response = await fetch('/api/music/cache/stats', {headers});
        if (!response.ok) {
            throw new Error('获取缓存统计失败');
        }

        const data = await response.json();
        if (data.success) {
            // 格式化文件大小
            const size = data.data.totalSize;
            const count = data.data.fileCount;
            let sizeText = '';

            if (size >= 1024 * 1024 * 1024) {
                sizeText = (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
            } else if (size >= 1024 * 1024) {
                sizeText = (size / (1024 * 1024)).toFixed(2) + ' MB';
            } else if (size >= 1024) {
                sizeText = (size / 1024).toFixed(2) + ' KB';
            } else {
                sizeText = size + ' B';
            }

            infoEl.textContent = `${sizeText} (${count} 首)`;
            infoEl.className = 'text-sm font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded';
        } else {
            throw new Error(data.message || '未知错误');
        }
    } catch (e) {
        console.error('[Cache] 获取服务器缓存统计失败:', e);
        infoEl.textContent = '获取失败';
        infoEl.className = 'text-sm font-bold text-red-500 bg-red-50 px-2 py-1 rounded';
    }
}

// ============================================================================
// 服务器缓存管理 (Server Cache Management)
// ============================================================================

let currentCacheList = [];
let selectedCacheFiles = new Set();
let cacheBatchMode = false;

function toggleCacheDrawer() {
    const drawer = document.getElementById('cache-drawer');
    if (drawer) {
        const isHidden = drawer.classList.contains('translate-x-full');
        if (isHidden) {
            drawer.classList.remove('translate-x-full');
            document.body.style.overflow = 'hidden';
            refreshCacheList();
        } else {
            drawer.classList.add('translate-x-full');
            document.body.style.overflow = '';
            exitCacheBatchMode(); // 关闭时重置状态
        }
    }
}

async function refreshCacheList() {
    const container = document.getElementById('cache-list-container');
    container.innerHTML = window.SystemDownloadManager.getStatusHtml('fa-spinner', '正在读取缓存列表...', true);

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch('/api/music/cache/list?type=dir', {headers});
        const data = await res.json();

        if (data.success) {
            currentCacheList = data.data;
            renderCacheList();
            updateCacheHeaderStats();
        } else {
            throw new Error(data.message || '加载列表失败');
        }
    } catch (e) {
        container.innerHTML = `<div class="p-10 text-center t-text-muted text-sm">${e.message}</div>`;
    }
}

function updateCacheHeaderStats() {
    const countEl = document.getElementById('cache-list-count');
    const sizeEl = document.getElementById('cache-total-size');
    if (countEl) countEl.textContent = `${currentCacheList.length} CACHED FILES`;

    const totalSize = currentCacheList.reduce((acc, curr) => acc + (curr.size || 0), 0);
    if (sizeEl) sizeEl.textContent = (totalSize / (1024 * 1024)).toFixed(2) + ' MB';

    // 更新设置页面的简易统计（如果有）
    updateServerCacheSize();
}

function renderCacheList() {
    const container = document.getElementById('cache-list-container');
    if (currentCacheList.length === 0) {
        container.innerHTML = window.SystemDownloadManager.getStatusHtml('fa-cloud-download-alt', '暂无服务器缓存歌曲');
        return;
    }

    container.innerHTML = currentCacheList.map((item, idx) => {
        const isSelected = selectedCacheFiles.has(item.relativePath || item.filename);

        // 样式同步：使用主列表的来源标签生成函数
        const sourceTagHtml = window.getSourceTag ? window.getSourceTag(item.source) : `<span class="px-1 py-0 rounded text-[10px] font-bold border t-badge-red mr-1">${item.source.toUpperCase()}</span>`;

        // 样式同步：匹配 getQualityTags 的逻辑
        let qTagHtml = '';
        const q = (item.quality || '').toLowerCase();
        const qName = window.QualityManager?.getQualityDisplayName(q) || q.toUpperCase();

        if (q === 'flac24bit' || q === 'hr') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 transition-colors">${qName}</span>`;
        } else if (q === 'flac' || q === 'sq' || q === 'ape') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 transition-colors">${qName}</span>`;
        } else if (q === '320k' || q === 'hq') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 transition-colors">${qName}</span>`;
        } else if (q === '128k' || q === 'mq' || q === 'standard') {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-gray border t-border-main transition-colors">${qName}</span>`;
        } else {
            qTagHtml = `<span class="flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-red border border-red-200 dark:border-red-500/30 transition-colors">${qName}</span>`;
        }

        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        // <img src> 无法携带自定义请求头，将 token 附至 URL 以通过服务端认证
        const authToken = (window.getUserAuthHeaders ? window.getUserAuthHeaders()['x-user-token'] : null)
            || localStorage.getItem('lx_user_token') || '';
        const coverUrl = item.filename
            ? `/api/music/cache/cover?filename=${encodeURIComponent(item.filename)}&user=${encodeURIComponent(username)}${authToken ? `&token=${encodeURIComponent(authToken)}` : ''}${item.source && String(item.source) === 'local' ? `&source=${encodeURIComponent(item.source)}&relativePath=${encodeURIComponent(item.relativePath || item.filename)}` : ''}&t=${Date.now()}`
            : '/music/assets/logo.png';

        return `
            <div class="group flex items-center p-2.5 rounded-2xl hover:t-bg-panel-light transition-all duration-300 gap-3 border border-transparent 
                ${isSelected ? 't-bg-panel-light border-blue-500/30 ring-1 ring-blue-500/10' : ''}" 
                onclick="${cacheBatchMode ? `toggleCacheSelection('${(item.relativePath || item.filename).replace(/'/g, "\\'")}')` : ''}">
                
                ${cacheBatchMode ? `
                <div class="flex-shrink-0 w-5 flex items-center justify-center">
                    <div class="w-4 h-4 rounded border-2 transition-all flex items-center justify-center
                        ${isSelected ? 'bg-blue-500 border-blue-500 shadow-sm' : 'border-gray-300 dark:border-gray-600'}">
                        ${isSelected ? '<i class="fas fa-check text-[8px] text-white"></i>' : ''}
                    </div>
                </div>
                ` : ''}

                <div class="relative w-12 h-12 flex-shrink-0 group-hover:scale-105 transition-transform duration-500">
                    <img class="w-full h-full object-cover rounded-xl shadow-md bg-gray-100" 
                         src="${coverUrl}" 
                         onerror="this.src='/music/assets/logo.png'">
                    <div class="absolute inset-0 bg-black/5 rounded-xl"></div>
                </div>

                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="text-sm font-black t-text-main truncate tracking-tight">${item.name}</span>
                    </div>
                    <div class="flex items-center gap-1.5 mt-0.5">
                        ${sourceTagHtml}
                        ${qTagHtml}
                        <span class="text-[10px] font-bold t-text-muted truncate opacity-60">${item.singer}</span>
                    </div>
                    ${item.hasLyric === true ? `
                        <div class="mt-1">
                            <span class="text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded font-black shadow-sm inline-flex items-center" title="歌词已同步">LRC</span>
                        </div>
                    ` : `
                        <div class="mt-1">
                            <button onclick="event.stopPropagation(); retryCacheLyric(this, ${JSON.stringify(item).replace(/"/g, '&quot;')})" 
                                    class="text-[9px] bg-red-400 hover:bg-red-500 text-white px-1.5 py-0.5 rounded font-black shadow-sm inline-flex items-center gap-1 transition-colors" title="歌词缺失，点击尝试补全">
                                <span>LRC+</span>
                                <i class="fas fa-redo-alt text-[7px]"></i>
                            </button>
                        </div>
                    `}
                </div>

                <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    ${!cacheBatchMode ? `
                        <button onclick="event.stopPropagation(); removeCacheItem('${(item.relativePath || item.filename).replace(/'/g, "\\'")}')" 
                                class="p-2 t-text-muted hover:text-red-500 transition-colors" title="删除">
                            <i class="fas fa-trash-alt text-xs"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');
}

/**
 * 缓存列表专用的歌词重试逻辑
 */
async function retryCacheLyric(btn, item) {
    if (!window.requestServerLyricCache) return;

    // 改变按钮状态
    const originalContent = btn.innerHTML;
    const originalBg = btn.className;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin text-[8px]"></i>';
    btn.disabled = true;

    try {
        // 构造 song 格式以适配 requestServerLyricCache
        const songData = {
            id: item.id,
            songmid: item.id, // 兼容性
            name: item.name,
            singer: item.singer,
            source: item.source,
            albumName: item.album || ''
        };

        await window.requestServerLyricCache(songData, item.quality, true); // 强制补齐

        showSuccess(`已成功补齐歌词: ${item.name}`);
        // 成功后给予反馈并刷新列表
        btn.innerHTML = 'OK';
        btn.className = btn.className.replace('bg-red-400', 'bg-emerald-500');
        setTimeout(() => refreshCacheList(), 1500);
    } catch (e) {
        btn.innerHTML = originalContent;
        btn.disabled = false;
        console.error('[Cache] Retry lyric failed:', e);
    }
}

/**
 * 缓存管理界面：一键补全所有缺失的歌词
 */
async function downloadAllCacheLyrics() {
    if (!currentCacheList || currentCacheList.length === 0) return;

    const missingItems = currentCacheList.filter(item => !item.hasLyric);
    if (missingItems.length === 0) {
        showInfo('没有缺失歌词的缓存文件');
        return;
    }

    showInfo(`正在尝试补全 ${missingItems.length} 个缓存文件的歌词...`);

    // 我们不需要 UI 上的按钮引用，直接调用逻辑
    for (const item of missingItems) {
        try {
            const songData = {
                id: item.id,
                songmid: item.id,
                name: item.name,
                singer: item.singer,
                source: item.source,
                albumName: item.album || ''
            };
            if (window.requestServerLyricCache) {
                await window.requestServerLyricCache(songData, item.quality, true); // 强制补全
            }
            // 每首之间稍作停顿
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            console.warn('[Cache] Batch lyric sync error:', e);
        }
    }

    showSuccess('补全流程执行完毕');
    refreshCacheList();
}


function toggleCacheBatchMode() {
    cacheBatchMode = true;
    selectedCacheFiles.clear();
    document.getElementById('cache-batch-toolbar').classList.remove('hidden');
    document.getElementById('cache-manage-btn').classList.add('hidden');
    document.getElementById('cache-exit-batch-btn').classList.remove('hidden');
    renderCacheList();
    updateCacheBatchCount();
}

function exitCacheBatchMode() {
    cacheBatchMode = false;
    selectedCacheFiles.clear();
    document.getElementById('cache-batch-toolbar').classList.add('hidden');
    document.getElementById('cache-manage-btn').classList.remove('hidden');
    document.getElementById('cache-exit-batch-btn').classList.add('hidden');
    renderCacheList();
}

function toggleCacheSelection(filename) {
    if (selectedCacheFiles.has(filename)) {
        selectedCacheFiles.delete(filename);
    } else {
        selectedCacheFiles.add(filename);
    }
    renderCacheList();
    updateCacheBatchCount();
}

function selectAllCache() {
    currentCacheList.forEach(item => selectedCacheFiles.add(item.relativePath || item.filename));
    renderCacheList();
    updateCacheBatchCount();
}

function deselectAllCache() {
    selectedCacheFiles.clear();
    renderCacheList();
    updateCacheBatchCount();
}

function updateCacheBatchCount() {
    const el = document.getElementById('cache-selected-count');
    if (el) el.textContent = selectedCacheFiles.size;
}

async function removeCacheItem(filename) {
    if ((!window.currentListData || !window.currentListData.username || window.currentListData.username === 'default') && window.lx_config && window.lx_config['user.enablePublicRestriction']) {
        const isAdminSession = localStorage.getItem('lx_admin_password');
        const enableServerCache = window.settings && window.settings.enableServerCache === true;
        if (!enableServerCache && !isAdminSession) {
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('删除服务器缓存文件需要需要管理员身份');
                if (!authorized) return;
            } else {
                showError('删除服务器缓存文件受限，需要管理员身份');
                return;
            }
        }
    }

    if (!(await showSelect('确定删除', '确认从服务器永久删除此缓存文件吗？', {danger: true}))) return;

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = {'Content-Type': 'application/json'};
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch('/api/music/cache/remove', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({filenames: [filename], dir: 'cache'})
        });

        if (res.ok) {
            showSuccess('已删除');
            refreshCacheList();
        } else {
            throw new Error('删除失败');
        }
    } catch (e) {
        showError(e.message);
    }
}

async function batchDeleteCache() {
    if (selectedCacheFiles.size === 0) {
        showError('请先选择文件');
        return;
    }

    if ((!window.currentListData || !window.currentListData.username || window.currentListData.username === 'default') && window.lx_config && window.lx_config['user.enablePublicRestriction']) {
        const isAdminSession = localStorage.getItem('lx_admin_password');
        const enableServerCache = window.settings && window.settings.enableServerCache === true;
        if (!enableServerCache && !isAdminSession) {
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('批量删除服务器缓存需要需要管理员身份');
                if (!authorized) return;
            } else {
                showError('批量删除服务器缓存受限，需要管理员身份');
                return;
            }
        }
    }

    if (!(await showSelect('批量删除', `确定要删除这 ${selectedCacheFiles.size} 个缓存文件吗？`, {danger: true}))) return;

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = {'Content-Type': 'application/json'};
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch('/api/music/cache/remove', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({filenames: Array.from(selectedCacheFiles), dir: 'cache'})
        });

        if (res.ok) {
            showSuccess(`成功删除 ${selectedCacheFiles.size} 个文件`);
            exitCacheBatchMode();
            refreshCacheList();
        } else {
            throw new Error('删除失败');
        }
    } catch (e) {
        showError(e.message);
    }
}

async function clearServerCache() {
    if ((!window.currentListData || !window.currentListData.username || window.currentListData.username === 'default') && window.lx_config && window.lx_config['user.enablePublicRestriction']) {
        const isAdminSession = localStorage.getItem('lx_admin_password');
        const enableServerCache = window.settings && window.settings.enableServerCache === true;
        if (!enableServerCache && !isAdminSession) {
            if (typeof window.handleAdminAuth === 'function') {
                const authorized = await window.handleAdminAuth('完全清理服务器缓存需要需要管理员身份');
                if (!authorized) return;
            } else {
                showError('完全清理服务器缓存受限，需要管理员身份');
                return;
            }
        }
    }

    if (!(await showSelect('完全清理', '确定要清除所有服务器缓存吗？', {danger: true}))) return;

    try {
        const username = (window.currentListData && window.currentListData.username) || localStorage.getItem('lx_sync_user') || '';
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        const res = await fetch('/api/music/cache/clear', {method: 'POST', headers});
        if (res.ok) {
            const data = await res.json();
            showSuccess(`清理完成，释放 ${(data.data.freedSize / (1024 * 1024)).toFixed(2)} MB`);
            refreshCacheList();
            if (cacheBatchMode) exitCacheBatchMode();
        }
    } catch (e) {
        showError(e.message);
    }
}

// ============================================================================
// 暴露到全局 (Expose to Global Scope)
// ============================================================================

window.checkServerCache = checkServerCache;
window.triggerServerCache = triggerServerCache;
window.resetAllSettings = resetAllSettings;
window.clearCache = clearCache;
window.updateServerCacheSize = updateServerCacheSize;
window.toggleCacheDrawer = toggleCacheDrawer;
window.refreshCacheList = refreshCacheList;
window.toggleCacheBatchMode = toggleCacheBatchMode;
window.exitCacheBatchMode = exitCacheBatchMode;
window.toggleCacheSelection = toggleCacheSelection;
window.selectAllCache = selectAllCache;
window.deselectAllCache = deselectAllCache;
window.removeCacheItem = removeCacheItem;
window.batchDeleteCache = batchDeleteCache;
window.clearServerCache = clearServerCache;
window.retryCacheLyric = retryCacheLyric;
window.downloadAllCacheLyrics = downloadAllCacheLyrics;
window.updateStorageStatsUI = updateStorageStatsUI;
