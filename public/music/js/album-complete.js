// ========== Album Complete - 专辑补全功能 ==========
// 负责跨平台专辑搜索、虚拟歌曲列表、批量下载等功能。
// 依赖全局函数: getUserAuthHeaders, showToast, showSelect, formatDuration, buildCoverUrl, escapeHtml
// ==================================================

// 虚拟歌曲数据存储
let _albumVirtualSongs = [];
let _albumVirtualSongCheckboxes = new Map();

/**
 * 跨平台专辑搜索 - 使用歌曲搜索+专辑聚合去重方案
 * @param {string} albumName - 专辑名
 * @param {string} singer - 歌手名
 * @returns {Array} 聚合后的歌曲列表
 */
async function searchAlbumFromAllPlatforms(albumName, singer) {
    const allSongs = [];
    const platforms = ['wy', 'tx', 'kw', 'kg', 'mg'];
    const platformNames = {
        wy: '网易云音乐',
        tx: 'QQ音乐',
        kw: '酷我音乐',
        kg: '酷狗音乐',
        mg: '咪咕'
    };

    // 更新进度
    const updateProgress = (platform, index, total) => {
        const percent = Math.round(((index + 1) / total) * 100);
        const statusEl = document.getElementById('album-search-status');
        const detailEl = document.getElementById('album-search-detail');
        const progressBar = document.getElementById('album-search-progress-bar');
        const progressText = document.getElementById('album-search-progress-text');

        if (statusEl) statusEl.textContent = `正在搜索 ${platformNames[platform] || platform}...`;
        if (detailEl) detailEl.textContent = `已搜索 ${index}/${total} 个平台`;
        if (progressBar) progressBar.style.width = `${percent}%`;
        if (progressText) progressText.textContent = `${percent}%`;
    };

    // 显示进度框
    const progressEl = document.getElementById('album-search-progress');
    if (progressEl) {
        progressEl.classList.remove('hidden');
        progressEl.style.display = 'flex'; // 强制显示
    } else {
        // 尝试查找所有包含 album-search 的元素
        const allElements = document.querySelectorAll('[id*="album-search"]');
    }

    try {
        // 并行搜索所有平台
        const searchPromises = platforms.map(async (platform, index) => {
            updateProgress(platform, index, platforms.length);

            try {
                const headers = getUserAuthHeaders();

                // 构建URL参数 (搜索API使用GET方法)
                // [Fix] 腾讯音乐API不支持大limit值（200会返回空数组），TX平台使用50，其他平台使用200
                const searchLimit = platform === 'tx' ? '50' : '200';
                const params = new URLSearchParams({
                    name: albumName + ' ' + singer,
                    source: platform,
                    limit: searchLimit,
                    page: '1'
                });

                const response = await fetch(`/api/music/search?${params.toString()}`, {
                    method: 'GET',
                    headers
                });

                const result = await response.json();

                // 兼容两种返回格式:
                // 1. 直接数组: [{name, singer, ...}, ...]
                // 2. 标准格式: {code: 0, data: {list: [...]}}
                let songList = [];
                if (Array.isArray(result)) {
                    songList = result;
                } else if (result.code === 0 && result.data && result.data.list) {
                    songList = result.data.list;
                } else if (result.data && Array.isArray(result.data)) {
                    songList = result.data;
                }

                if (songList.length > 0) {
                    return songList.map(song => ({
                        ...song,
                        _platform: platform,
                        _isVirtual: true  // 标记为虚拟歌曲
                    }));
                }
            } catch (err) {
                console.error(`[AlbumSearch] ${platform} 搜索失败:`, err);
            }
            return [];
        });

        const results = await Promise.all(searchPromises);


        // 合并所有结果
        results.forEach(songs => {
            allSongs.push(...songs);
        });

        // 保留所有音质的搜索结果（不再仅保留无损），有损音质歌曲也可手动勾选补全

        // 严格匹配当前专辑名,过滤出属于该专辑的歌曲
        const albumNameLower = albumName.toLowerCase();
        const matchedSongs = allSongs.filter(song => {
            const songAlbumName = (song.albumName || song.album || '').toLowerCase();
            return songAlbumName === albumNameLower;
        });


        // 按歌曲名去重 (同名歌曲只保留一首)
        // 平台优先级: wy > tx > kw > kg > mg
        const platformPriority = ['wy', 'tx', 'kw', 'kg', 'mg'];
        const platformPriorityMap = new Map();
        platformPriority.forEach((platform, index) => {
            platformPriorityMap.set(platform, index);
        });

        const songMap = new Map();
        matchedSongs.forEach(song => {
            const songKey = song.name;
            if (!songMap.has(songKey)) {
                songMap.set(songKey, song);
            } else {
                // 如果已存在同名歌曲,比较平台优先级
                const existingSong = songMap.get(songKey);
                const existingPriority = platformPriorityMap.get(existingSong._platform) ?? 999;
                const newPriority = platformPriorityMap.get(song._platform) ?? 999;
                // 只保留优先级更高的(数字更小的)
                if (newPriority < existingPriority) {
                    songMap.set(songKey, song);
                }
            }
        });

        const uniqueSongs = Array.from(songMap.values());

        // 更新进度为100%
        const finalPercent = Math.round((platforms.length / platforms.length) * 100);
        const progressBar = document.getElementById('album-search-progress-bar');
        const progressText = document.getElementById('album-search-progress-text');
        const statusEl = document.getElementById('album-search-status');
        if (progressBar) progressBar.style.width = '100%';
        if (progressText) progressText.textContent = '100%';
        if (statusEl) statusEl.textContent = '搜索完成！';
        return uniqueSongs;

    } catch (err) {
        console.error('[AlbumSearch] 搜索失败:', err);
        return [];
    } finally {
        // 延迟隐藏进度框,让用户看到100%
        setTimeout(() => {
            const progressEl = document.getElementById('album-search-progress');
            if (progressEl) {
                progressEl.classList.add('hidden');
                progressEl.style.display = ''; // 清除强制显示
            } else {
                console.error('[AlbumSearch] 隐藏时也未找到进度框元素');
            }
        }, 500);
    }
}

/**
 * 补全专辑其它歌曲
 */
async function completeAlbumSongs() {
    if (!window._albumLibCurrentAlbum) {
        alert('请先打开专辑详情');
        return;
    }

    const albumName = window._albumLibCurrentAlbum.name;
    const singer = window._albumLibCurrentAlbum.singer || '';

    // 获取当前专辑已有的歌曲列表(用于去重)
    const existingSongs = new Set();
    if (window._albumLibCurrentAlbum.songs) {
        window._albumLibCurrentAlbum.songs.forEach(song => {
            // 使用歌曲名+歌手作为去重标识
            const key = song.name;
            existingSongs.add(key);
        });
    }

    try {
        // 搜索所有平台
        const searchResults = await searchAlbumFromAllPlatforms(albumName, singer);

        if (!searchResults || searchResults.length === 0) {
            alert('未找到更多歌曲');
            return;
        }

        // 过滤掉已有的歌曲
        const virtualSongs = searchResults.filter(song => {
            const key = song.name;
            return !existingSongs.has(key);
        });

        if (virtualSongs.length === 0) {
            alert('专辑歌曲已完整,无需补全');
            return;
        }

        // 保存虚拟歌曲,根据音质设置默认勾选状态
        _albumVirtualSongs = virtualSongs;
        _albumVirtualSongCheckboxes.clear();
        virtualSongs.forEach((song, index) => {
            // 只默认勾选flac及以上音质
            const highestQuality = getHighestQuality(song);
            const shouldCheck = highestQuality === 'flac' || highestQuality === 'flac24bit';
            _albumVirtualSongCheckboxes.set(index, shouldCheck);
        });

        // 显示虚拟歌曲列表
        renderVirtualSongsList();

        // 更新同步按钮状态
        updateSyncButtonState();

        // 显示提示
        showToast('success', `找到 ${virtualSongs.length} 首可补全的歌曲`);

    } catch (err) {
        alert('补全失败: ' + (err.message || '未知错误'));
    }
}

/**
 * 获取歌曲的最高音质
 * @param {Object} song - 歌曲对象
 * @returns {string} 最高音质类型 (flac24bit/flac/320k/128k)
 */
function getHighestQuality(song) {
    // 优先级: flac24bit > flac > 320k > 128k
    const qualityPriority = ['flac24bit', 'flac', '320k', '128k'];

    // 如果song.types存在,从types中找最高音质
    if (song.types && Array.isArray(song.types)) {
        for (const q of qualityPriority) {
            if (song.types.some(t => t.type === q)) {
                return q;
            }
        }
    }

    // 如果song._types存在,从_types中找最高音质
    if (song._types && typeof song._types === 'object') {
        for (const q of qualityPriority) {
            if (song._types[q]) {
                return q;
            }
        }
    }

    // 兜底:使用song.quality或默认128k
    return song.quality || 'flac';
}

// Export to global scope for use in other script files (e.g., single_song_ops.js)
window.getHighestQuality = getHighestQuality;

/**
 * 渲染合并歌曲列表 (原有歌曲 + 虚拟歌曲)
 */
function renderVirtualSongsList() {
    const listEl = document.getElementById('albumlib-detail-list');
    if (!listEl || !window._albumLibCurrentAlbum) return;

    const platformNames = {
        kg: '酷狗',
        kw: '酷我',
        tx: 'QQ',
        wy: '网易',
        mg: '咪咕'
    };

    const existingSongs = window._albumLibCurrentAlbum.songs || [];
    const virtualSongs = _albumVirtualSongs || [];

    // 如果没有虚拟歌曲,显示原始列表
    if (virtualSongs.length === 0) {
        window.renderAlbumDetailList();
        return;
    }

    let html = `
    <div class="mb-4 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 mb-1">
          <i class="fas fa-info-circle text-blue-500"></i>
          <span class="text-sm font-bold text-blue-700 dark:text-blue-400">找到 ${virtualSongs.length} 首可补全的歌曲</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="selectAllVirtualSongs()" class="px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-700/50 rounded transition-colors">
            <i class="fas fa-check-square mr-1"></i>全选
          </button>
          <button onclick="deselectAllVirtualSongs()" class="px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-800/50 hover:bg-blue-200 dark:hover:bg-blue-700/50 rounded transition-colors">
            <i class="fas fa-square mr-1"></i>取消
          </button>
        </div>
      </div>
      <p class="text-xs text-blue-600 dark:text-blue-500 mt-1">蓝色背景的歌曲是新找到的,默认只勾选FLAC及以上音质</p>
    </div>
  `;

    // 渲染原有歌曲 (保持原样)
    html += existingSongs.map((song, i) => {
        const ext = (song.ext || '').replace('.', '').toUpperCase();
        const durationStr = song.duration ? formatDuration(song.duration) : '--:--';
        const coverUrl = song.relativePath ? buildCoverUrl(song.relativePath, song.source) : '';
        const isActive = window.isCurrentPlayingSong(song);
        const audioEl = document.getElementById('audio-player');
        const isActuallyPlaying = isActive && audioEl && !audioEl.paused;
        const pathStr = song.relativePath || '';
        const activeTextClass = isActive ? 'text-emerald-600 dark:text-emerald-400' : '';

        return `
      <div class="grid grid-cols-12 gap-1 md:gap-3 px-3 md:px-4 py-2 rounded-xl items-center cursor-pointer transition-all duration-150 hover:t-bg-track group ${isActive ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 't-bg-item-hover'}"
           onclick="playAlbumSong(${i})">
        <div class="col-span-1 text-center flex items-center justify-center">
          ${isActive ? (isActuallyPlaying ? '<div class="flex items-end justify-center gap-[2px] h-3.5"><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0s;height:40%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.15s;height:70%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.3s;height:50%"></span></div>' : '<i class="fas fa-pause text-[10px] text-emerald-500"></i>') : `<span class="text-xs t-text-muted font-mono">${i + 1}</span>`}
        </div>
        <div class="col-span-5 md:col-span-5 flex items-center gap-2 min-w-0 relative group/songname">
          <div class="relative flex-shrink-0">
            ${coverUrl ? `<img src="${coverUrl}" alt="" loading="lazy" class="w-8 h-8 rounded object-cover" onerror="this.style.display='none'">` : `<div class="w-8 h-8 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center"><i class="fas fa-music text-[10px] t-text-muted"></i></div>`}
            ${isActive ? '<div class="absolute inset-0 bg-emerald-500/10 rounded flex items-center justify-center"><div class="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div></div>' : ''}
          </div>
          <span class="truncate text-sm font-medium ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 't-text-main'}">${escapeHtml(song.name || 'Unknown')}</span>
          ${pathStr ? `<div class="absolute left-0 top-full mt-1 z-50 hidden group-hover/songname:block px-2 py-1 rounded text-[11px] font-mono text-white bg-gray-800 dark:bg-gray-700 shadow-lg whitespace-nowrap max-w-[400px] truncate pointer-events-none">${escapeHtml(pathStr)}</div>` : ''}
        </div>
        <div class="hidden md:block md:col-span-2 truncate text-sm ${activeTextClass || 't-text-muted'}">${escapeHtml(song.singer || 'Unknown')}</div>
        <div class="col-span-3 md:col-span-1 text-center text-xs ${activeTextClass || 't-text-muted'} font-mono tabular-nums">${durationStr}</div>
        <div class="col-span-3 md:col-span-3 text-right flex items-center justify-end gap-1">
          ${ext ? `<span class="text-[9px] px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-bold">${ext}</span>` : ''}
        </div>
      </div>
    `;
    }).join('');

    // 渲染虚拟歌曲 (带蓝色背景和复选框)
    html += virtualSongs.map((song, i) => {
        const isChecked = _albumVirtualSongCheckboxes.get(i) !== false;
        const platform = platformNames[song._platform] || song._platform;
        const durationStr = song.interval || song.duration ? formatDuration(typeof song.duration === 'number' ? song.duration : 0) : '--:--';
        const globalIndex = existingSongs.length + i;

        // 获取最高音质
        const highestQuality = getHighestQuality(song);
        const qualityLabel = highestQuality.toUpperCase();

        // 根据音质设置标签颜色: FLAC及以下→蓝色, FLAC以上(Hi-Res)→金黄色
        let qualityColorClass = 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400';
        if (highestQuality === 'flac24bit') {
            qualityColorClass = 'bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400';
        }

        return `
      <div class="grid grid-cols-12 gap-1 md:gap-3 px-3 md:px-4 py-2 rounded-xl items-center transition-all duration-150 hover:t-bg-track group bg-blue-50/30 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/30">
        <div class="col-span-1 text-center flex items-center justify-center">
          <input type="checkbox" 
                 id="virtual-song-${i}" 
                 ${isChecked ? 'checked' : ''} 
                 onchange="toggleVirtualSong(${i}, this.checked)"
                 class="w-4 h-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500 cursor-pointer">
        </div>
        <div class="col-span-5 md:col-span-5 flex items-center gap-2 min-w-0 relative group/songname">
          <div class="relative flex-shrink-0">
            <div class="w-8 h-8 rounded bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <i class="fas fa-cloud-download-alt text-[10px] text-blue-500"></i>
            </div>
          </div>
          <span class="truncate text-sm font-medium t-text-main">
            ${escapeHtml(song.name || 'Unknown')}
          </span>
          <span class="flex-shrink-0 px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[9px] font-bold">
            ${platform}
          </span>
        </div>
        <div class="hidden md:block md:col-span-2 truncate text-sm t-text-muted">${escapeHtml(song.singer || 'Unknown')}</div>
        <div class="col-span-3 md:col-span-1 text-center text-xs t-text-muted font-mono tabular-nums">${durationStr}</div>
        <div class="col-span-3 md:col-span-3 text-right flex items-center justify-end gap-1">
          <span class="text-[9px] px-1.5 py-0.5 rounded ${qualityColorClass} font-bold">${qualityLabel}</span>
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-bold">
            <i class="fas fa-ghost mr-1"></i>虚拟
          </span>
        </div>
      </div>
    `;
    }).join('');

    listEl.innerHTML = html;
}

/**
 * 渲染专辑详情列表（包含虚拟歌曲复选框）
 * 复用 renderVirtualSongsList 的逻辑
 */
function renderAlbumDetailListWithVirtualSongs() {
    renderVirtualSongsList();
}

/**
 * 切换虚拟歌曲选中状态
 */
function toggleVirtualSong(index, checked) {
    _albumVirtualSongCheckboxes.set(index, checked);
    updateSyncButtonState();
}

/**
 * 全选所有虚拟歌曲
 */
function selectAllVirtualSongs() {
    _albumVirtualSongs.forEach((_, index) => {
        _albumVirtualSongCheckboxes.set(index, true);
    });
    // 重新渲染列表以更新复选框状态
    renderAlbumDetailListWithVirtualSongs();
    updateSyncButtonState();
}

/**
 * 取消所有虚拟歌曲
 */
function deselectAllVirtualSongs() {
    _albumVirtualSongs.forEach((_, index) => {
        _albumVirtualSongCheckboxes.set(index, false);
    });
    // 重新渲染列表以更新复选框状态
    renderAlbumDetailListWithVirtualSongs();
    updateSyncButtonState();
}

/**
 * 更新同步按钮状态
 */
function updateSyncButtonState() {
    const syncBtn = document.getElementById('btn-album-sync');
    if (!syncBtn) return;

    // 统计选中的数量
    let checkedCount = 0;
    _albumVirtualSongCheckboxes.forEach((checked) => {
        if (checked) checkedCount++;
    });

    if (checkedCount > 0) {
        syncBtn.disabled = false;
        syncBtn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        syncBtn.disabled = true;
        syncBtn.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

/**
 * 下载选中的虚拟歌曲到本地
 */
async function downloadVirtualSongs() {
    if (_albumVirtualSongs.length === 0) {
        alert('没有可同步的虚拟歌曲');
        return;
    }

    // 获取选中的歌曲
    const selectedSongs = [];
    _albumVirtualSongCheckboxes.forEach((checked, index) => {
        if (checked && _albumVirtualSongs[index]) {
            selectedSongs.push(_albumVirtualSongs[index]);
        }
    });

    if (selectedSongs.length === 0) {
        alert('请至少选择一首歌曲');
        return;
    }

    // 使用系统样式的确认对话框
    const confirmed = await showSelect(
        '确认下载',
        `确定要下载 <strong>${selectedSongs.length}</strong> 首歌曲到本地吗？`,
        {
            confirmText: '开始下载',
            cancelText: '取消',
            danger: false
        }
    );

    if (!confirmed) {
        return;
    }

    try {
        // 选择下载音质（优先高音质，允许降级到有损）
        const allQualities = window.QualityManager ? window.QualityManager.QUALITY_PRIORITY : ['flac24bit', 'flac', '320k', '128k'];
        const availableSet = new Set();
        selectedSongs.forEach(s => {
            (window.QualityManager ? window.QualityManager.getAvailableQualities(s) : []).forEach(q => availableSet.add(q));
        });
        const availableQualities = allQualities.filter(q => availableSet.has(q));
        if (availableQualities.length === 0) {
            showToast('error', '所选歌曲没有可用音质');
            return;
        }
        const qualityDisplayNames = availableQualities.map(q => window.QualityManager ? window.QualityManager.getQualityDisplayName(q) : q);
        const selectedQualityDisplay = await showOptions('选择下载音质', `请选择 ${selectedSongs.length} 首歌曲的下载音质：\n歌曲实际音质将取不超过该音质的最大可用音质`, qualityDisplayNames);
        if (!selectedQualityDisplay) return;
        const targetQuality = availableQualities[qualityDisplayNames.indexOf(selectedQualityDisplay)];

        showToast('info', `开始添加 ${selectedSongs.length} 首歌曲到下载队列...`);

        // 准备下载任务数据 - 必须符合 downloadManager 的 song 对象格式
        const downloadTasks = selectedSongs.map(song => {
            // 按所选档位取该歌曲实际可用音质（向下降级）
            const actualQuality = window.QualityManager
                ? window.QualityManager.getBestQuality(song, targetQuality)
                : targetQuality;

            // 构造 song.id = source_songmid 格式 (用于去重和进度追踪)
            const songId = `${song._platform}_${song.songmid || song.name}`;

            return {
                id: songId,  // 必须有 id 字段,用于去重检查
                name: song.name,
                singer: song.singer,
                albumName: song.albumName || song.album,
                album: song.albumName || song.album,  // 兼容性字段
                source: song._platform,  // 必须有 source 字段
                songmid: song.songmid,
                quality: actualQuality,  // 按选定音质降级后的实际音质
                img: song.img || song.pic || '',
                pic: song.img || song.pic || '',  // 兼容性字段
                types: song.types || [],  // 保留音质列表
                _types: song._types || {},  // 保留音质列表
                interval: song.interval || '',  // 时长
                isServer: true  // 标记为服务端下载任务
            };
        });

        // [LOG CLEANED] console.log('[AlbumSync] 准备添加下载任务:', downloadTasks.map(t => ({
        //     id: t.id,
        //     name: t.name,
        //     source: t.source,
        //     quality: t.quality
        // })));

        // 使用下载管理器添加任务
        if (window.SystemDownloadManager && typeof window.SystemDownloadManager.addTasks === 'function') {
            const result = await window.SystemDownloadManager.addTasks(downloadTasks);

            showToast('success',
                `已添加 ${result.added} 首歌曲到下载队列` +
                (result.skipped > 0 ? `, 跳过 ${result.skipped} 首` : '')
            );
        } else {
            throw new Error('下载管理器未初始化');
        }

        // 清空虚拟歌曲列表并刷新
        _albumVirtualSongs = [];
        _albumVirtualSongCheckboxes.clear();
        updateSyncButtonState();

        // 刷新专辑列表
        // await refreshAlbumDetail();

    } catch (err) {
        console.error('[AlbumSync] 同步失败:', err);
        alert('同步失败: ' + (err.message || '未知错误'));
    }
}

/**
 * 刷新专辑详情
 * 优化：只查询当前专辑的歌曲，不重新加载整个音乐库
 */
async function refreshAlbumDetail() {
    if (!window._albumLibCurrentAlbum) {
        alert('请先打开专辑详情');
        return;
    }

    const albumName = window._albumLibCurrentAlbum.name;
    const singer = window._albumLibCurrentAlbum.singer;

    try {
        // 显示加载状态
        const syncBtn = document.getElementById('btn-album-refresh');
        if (syncBtn) {
            const originalHtml = syncBtn.innerHTML;
            syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span class="hidden sm:inline">刷新中</span>';
            syncBtn.disabled = true;

            // 只查询当前专辑的歌曲（使用新的 album 过滤参数）
            const headers = {};
            Object.assign(headers, getUserAuthHeaders());
            const res = await fetch(`/api/music/cache/list?album=${encodeURIComponent(albumName)}`, {headers});
            const result = await res.json();

            if (result.success && result.data && result.data.length > 0) {
                // 更新当前专辑数据
                window._albumLibCurrentAlbum.songs = result.data;
                window._albumLibCurrentAlbum._loading = false;

                // 重新渲染
                window.renderAlbumDetailList();

                // 更新统计信息
                const statsEl = document.getElementById('albumlib-detail-stats');
                if (statsEl) {
                    const totalDuration = window._albumLibCurrentAlbum.songs.reduce((sum, s) => sum + (s.duration || 0), 0);
                    const durationStr = totalDuration > 0 ? ` · ${formatDuration(totalDuration)}` : '';
                    statsEl.innerHTML = `<span><i class="fas fa-music text-[10px] mr-1"></i>${window._albumLibCurrentAlbum.songs.length} 首</span>${durationStr ? `<span><i class="fas fa-clock text-[10px] mr-1"></i>${durationStr.slice(3)}</span>` : ''}`;
                }

                // 更新导航栏副标题
                const navSubtitleEl = document.getElementById('albumlib-detail-nav-subtitle');
                if (navSubtitleEl) {
                    navSubtitleEl.textContent = `${singer} · ${window._albumLibCurrentAlbum.songs.length} 首`;
                }

                showToast('success', '刷新成功',);
            } else {
                showToast('warning', '未找到更新的专辑数据',);
            }

            // 恢复按钮状态
            syncBtn.innerHTML = originalHtml;
            syncBtn.disabled = false;
        }

    } catch (err) {
        console.error('[AlbumRefresh] 刷新失败:', err);
        alert('刷新失败: ' + (err.message || '未知错误'));

        // 恢复按钮状态
        const syncBtn = document.getElementById('btn-album-refresh');
        if (syncBtn) {
            syncBtn.innerHTML = '<i class="fas fa-sync-alt"></i><span class="hidden sm:inline">刷新</span>';
            syncBtn.disabled = false;
        }
    }
}

// Window exports
window.getHighestQuality = getHighestQuality;
window.completeAlbumSongs = completeAlbumSongs;
window.downloadVirtualSongs = downloadVirtualSongs;
window.refreshAlbumDetail = refreshAlbumDetail;
window.selectAllVirtualSongs = selectAllVirtualSongs;
window.deselectAllVirtualSongs = deselectAllVirtualSongs;
window.toggleVirtualSong = toggleVirtualSong;
window.renderVirtualSongsList = renderVirtualSongsList;
