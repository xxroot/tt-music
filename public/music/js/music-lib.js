/**
 * Music Library - 音乐库管理
 * 从 app.js 提取的音乐库模块
 * 包含音乐库加载、渲染、搜索、排序、批量操作、DB维护等功能
 *
 * 依赖: utils.js, pagination-factory.js
 * @module MusicLib
 */

// ========== 音乐库功能 ==========
// ============================================================================
// 音乐库管理 (Music Library Management)
// ============================================================================
let _musicLibList = [];        // 当前页歌曲数据
let _musicLibFiltered = [];   // 同 _musicLibList (服务端已过滤)
let _musicLibLoaded = false;
let _musicLibPage = 1;
let _musicLibPageSize = 30;
let _musicLibTotal = 0;       // 服务端返回的总数
let _musicLibTotalPages = 0;  // 服务端返回的总页数
let _musicLibSelectMode = false;
let _musicLibSelected = new Set();
let _musicLibSearchDebounce = null;
let _currentSourceFilter = '';  // 当前来源筛选值
let _musicLibOrder = 'desc';     // 排序方向 (默认降序)

/** 全局来源列表 (启动时加载) */
let availableSources = [];

// buildCoverUrl, formatFileSize, escapeHtml, escapeJs 已提取到 js/utils.js

async function loadMusicLib() {
    const listEl = document.getElementById('musiclib-list');
    const countEl = document.getElementById('musiclib-song-count');
    if (!listEl) return;

    listEl.innerHTML = '<div class="flex flex-col items-center justify-center py-20 t-text-muted"><i class="fas fa-compact-disc text-5xl mb-4 opacity-20"></i><p class="text-base font-medium animate-pulse">加载中...</p></div>';

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const searchInput = document.getElementById('musiclib-search-input');
        const search = searchInput ? searchInput.value.trim() : '';
        const sortSelect = document.getElementById('musiclib-sort-select');
        const sort = sortSelect ? sortSelect.value : 'id';

        const params = new URLSearchParams({
            page: _musicLibPage,
            pageSize: _musicLibPageSize,
            sort: sort,
            order: _musicLibOrder,
            search: search
        });

        // 来源筛选参数
        if (_currentSourceFilter) {
            params.set('source', _currentSourceFilter);
        }

        const res = await fetch(`/api/music/db/page?${params}`, {headers});
        const result = await res.json();
        if (result.success) {
            _musicLibList = result.data || [];
            _musicLibFiltered = _musicLibList;
            _musicLibLoaded = true;
            _musicLibTotal = result.total || 0;
            _musicLibTotalPages = result.totalPages || 0;
            if (countEl) countEl.textContent = `共 ${_musicLibTotal} 首`;
            renderMusicLibList();

            // 后台触发 DB 同步，确保新增文件也被记录
            /*            fetch('/api/music/db/sync', {method: 'POST', headers}).then(r => r.json()).then(syncResult => {
                            if (syncResult.success && syncResult.synced > 0) {
                                // 有新文件，静默重新加载当前页
                                fetch(`/api/music/db/page?${params}`, {headers}).then(r2 => r2.json()).then(refreshResult => {
                                    if (refreshResult.success) {
                                        _musicLibList = refreshResult.data || [];
                                        _musicLibFiltered = _musicLibList;
                                        _musicLibTotal = refreshResult.total || 0;
                                        _musicLibTotalPages = refreshResult.totalPages || 0;
                                        if (countEl) countEl.textContent = `共 ${_musicLibTotal} 首`;
                                        renderMusicLibList();
                                    }
                                }).catch(() => {});
                            }
                        }).catch(() => {});*/
        } else {
            _musicLibList = [];
            _musicLibFiltered = [];
            _musicLibTotal = 0;
            _musicLibTotalPages = 0;
            listEl.innerHTML = '<div class="flex flex-col items-center justify-center py-20 t-text-muted"><i class="fas fa-compact-disc text-5xl mb-4 opacity-20"></i><p class="text-base font-medium">暂无已下载的歌曲</p></div>';
            if (countEl) countEl.textContent = '共 0 首';
        }
    } catch (err) {
        console.error('[MusicLib] Failed to load:', err);
        listEl.innerHTML = '<div class="flex flex-col items-center justify-center py-20 t-text-muted"><i class="fas fa-exclamation-circle text-5xl mb-4 opacity-20 text-red-400"></i><p class="text-base font-medium">加载失败</p></div>';
    }
}

function filterMusicLib() {
    // 服务端搜索，防抖 300ms
    clearTimeout(_musicLibSearchDebounce);
    _musicLibSearchDebounce = setTimeout(() => {
        _musicLibPage = 1;
        loadMusicLib();
    }, 300);
}

/** 点击歌手时搜索该字段（保留供其他地方调用） */
function musicLibSearchByField(keyword) {
    if (!keyword) return;
    const searchInput = document.getElementById('musiclib-search-input');
    if (searchInput) {
        searchInput.value = keyword;
    }
    _musicLibPage = 1;
    loadMusicLib();
}

/**
 * 从单曲列表点击歌手 → 跳转到歌手明细
 * @param {string} singerName - 歌手名称
 */
function navigateToSingerDetail(singerName) {
    if (!singerName) return;
    // 切换到歌手视图，延迟等 switchTab 完成后再打开详情
    if (typeof switchTab === 'function') {
        switchTab('singerlib');
    }
    setTimeout(() => {
        if (typeof openSingerDetail === 'function') {
            openSingerDetail(singerName, '', '', 0, 0, '', '', '');
        }
    }, 120);
}

/**
 * 从单曲列表点击专辑 → 跳转到专辑明细
 * @param {string} albumName - 专辑名称
 * @param {string} albumSinger - 歌手名称
 */
function navigateToAlbumDetail(albumName, albumSinger) {
    if (!albumName) return;
    // 清除层层返回上下文：从单曲进入专辑，返回时直接回专辑列表
    window._albumLibFromSinger = null;
    if (typeof openAlbumByName === 'function') {
        openAlbumByName({
            album: albumName,
            singer: albumSinger || '',
            singCount: 0,
            duration: 0,
            genre: '',
            year: '',
            albumArtist: albumSinger || '',
            source: '',
            img: ''
        });
    }
}

window.musicLibSearchByField = musicLibSearchByField;
window.navigateToSingerDetail = navigateToSingerDetail;
window.navigateToAlbumDetail = navigateToAlbumDetail;

function sortMusicLib(skipFilter) {
    // 服务端排序，重新加载当前页
    _musicLibPage = 1;
    loadMusicLib();
}

// 切换单曲排序方向
function toggleMusicLibSortOrder() {
    const orderBtn = document.getElementById('musiclib-sort-order-btn');
    if (!orderBtn) return;

    // 切换排序方向
    _musicLibOrder = _musicLibOrder === 'asc' ? 'desc' : 'asc';

    // 更新图标
    const icon = orderBtn.querySelector('i');
    if (_musicLibOrder === 'asc') {
        icon.className = 'fas fa-sort-amount-up text-sm';
        orderBtn.title = '当前: 正序 (点击切换为倒序)';
    } else {
        icon.className = 'fas fa-sort-amount-down text-sm';
        orderBtn.title = '当前: 倒序 (点击切换为正序)';
    }

    // 重新加载列表
    _musicLibPage = 1;
    loadMusicLib();
}

window.toggleMusicLibSortOrder = toggleMusicLibSortOrder;

function renderMusicLibList() {
    const listEl = document.getElementById('musiclib-list');
    if (!listEl) return;

    if (!_musicLibFiltered.length) {
        listEl.innerHTML = '<div class="flex flex-col items-center justify-center py-20 t-text-muted"><i class="fas fa-compact-disc text-5xl mb-4 opacity-20"></i><p class="text-base font-medium">没有匹配的歌曲</p></div>';
        updateMusicLibPagination();
        return;
    }

    // 服务端已分页，直接渲染当前页数据
    const startIdx = (_musicLibPage - 1) * _musicLibPageSize;
    listEl.innerHTML = _musicLibFiltered.map((song, i) => {
        const globalIdx = startIdx + i;
        const displayIdx = globalIdx + 1;  // 显示序号
        // 显示 quality 而非 ext，区分 flac24bit 和 flac，本地库非常见格式统一金黄标签
        const qualityMap = {
            '128k': '128k',
            '192k': '192k',
            '320k': '320k',
            'flac': 'FLAC',
            'ape': 'APE',
            'wav': 'WAV',
            'ogg': 'OGG',
            'm4a': 'M4A',
            'flac24bit': 'Hi-Res',
            'dsf': 'DSF',
            'dff': 'DFF',
            'aiff': 'AIFF',
            'aif': 'AIFF',
            'dts': 'DTS',
            'wv': 'WV',
            'wma': 'WMA',
        };
        const qualityLower = (song.quality || '').toLowerCase();
        const qualityLabel = song.quality ? (qualityMap[qualityLower] || qualityLower.toUpperCase()) : '';
        // 根据音质设置标签颜色: FLAC→绿色, Hi-Res/非常见格式→金黄色, 其它→蓝色
        const hiResFormats = ['flac24bit', 'dsf', 'dff', 'aiff', 'aif', 'dts', 'wv', 'wma'];
        let qualityColorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-blue border border-blue-200 dark:border-blue-500/30 transition-colors'
        if (qualityLower === 'flac24bit' || hiResFormats.includes(qualityLower)) {
            qualityColorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-yellow border border-yellow-200 dark:border-yellow-500/30 transition-colors'
        } else if (qualityLower === 'flac') {
            qualityColorClass = 'flex-shrink-0 px-1 py-0 rounded text-[10px] t-badge-green border border-emerald-200 dark:border-emerald-500/30 transition-colors'
        }

        const ext = (song.ext || '').replace('.', '').toUpperCase();
        const sizeStr = song.size ? formatFileSize(song.size) : '';
        const durationStr = song.duration ? formatDuration(song.duration) : '--:--';
        // 构造音频元信息标签: sampleRate / bitDepth / bitRate
        const audioMetaParts = [];
        if (song.sampleRate) {
            const sr = song.sampleRate >= 1000 ? (song.sampleRate / 1000).toFixed(1).replace('.0', '') + 'kHz' : song.sampleRate + 'Hz';
            audioMetaParts.push(sr);
        }
        if (song.bitDepth) audioMetaParts.push(song.bitDepth + 'Bit');
        if (song.bitRate) {
            const br = song.bitRate >= 1000 ? (song.bitRate / 1000).toFixed(0) + 'Kbps' : song.bitRate + 'Bps';
            audioMetaParts.push(br);
        }
        const audioMetaStr = audioMetaParts.length ? audioMetaParts.join(' / ') : '';
        const coverUrl = (song.img?.startsWith('http') && song.img) ||
            (song.relativePath && buildCoverUrl(song.relativePath, song.source)) || '';
        const isActive = isCurrentPlayingSong(song);
        const isActuallyPlaying = isActive && typeof audio !== 'undefined' && !audio.paused;
        const isChecked = _musicLibSelected.has(globalIdx);
        const selectModeClass = _musicLibSelectMode ? 'search-match' : '';
        const pathStr = song.relativePath || '';
        const activeTextClass = isActive ? 'text-emerald-600 dark:text-emerald-400' : '';
        return `
            <div class="grid grid-cols-12 gap-2 md:gap-4 px-3 md:px-4 py-3 rounded-xl items-center transition-all duration-200 hover:t-bg-track group hover:shadow-sm hover:scale-[1.005] ${isActive ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : 't-bg-item-hover'} ${isChecked ? 'row-selected' : ''} ${selectModeClass}">
                <div class="col-span-1 text-center flex items-center justify-center gap-1">
                    ${_musicLibSelectMode ? `<input type="checkbox" ${isChecked ? 'checked' : ''} onclick="event.stopPropagation(); musicLibToggleItem(${i})" class="w-3.5 h-3.5 accent-emerald-500">` : (isActive ? (isActuallyPlaying ? '<div class="flex items-end justify-center gap-[2px] h-3.5"><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0s;height:40%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.15s;height:70%"></span><span class="w-[3px] bg-emerald-500 rounded-full animate-eq-bar" style="animation-delay:0.3s;height:50%"></span></div>' : '<i class="fas fa-pause text-[10px] text-emerald-500"></i>') : `<span class="text-xs t-text-muted font-mono">${displayIdx}</span>`)}
                </div>
                <div class="col-span-5 md:col-span-5 flex items-center gap-2 min-w-0 relative group/songname cursor-pointer" onclick="${_musicLibSelectMode ? `musicLibToggleItem(${i})` : `playMusicLibSong(${i})`}">
                    <div class="relative w-10 h-10 flex-shrink-0">
                        ${coverUrl ? `<img src="${coverUrl}" alt="" loading="lazy" class="w-10 h-10 rounded object-cover transition-transform duration-200 group-hover/songname:scale-105 group-hover/songname:shadow-md" onerror="this.style.display='none'">` : `<div class="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center transition-transform duration-200 group-hover/songname:scale-105"><i class="fas fa-music text-[11px] t-text-muted"></i></div>`}
                        <div class="absolute inset-0 bg-black/20 rounded hidden group-hover/songname:flex items-center justify-center transition-all">
                            <i class="fas fa-play text-white text-[10px]"></i>
                        </div>
                    </div>
                    <div class="flex flex-col min-w-0 flex-1">
                        <span class="truncate text-sm ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 't-text-main'} font-medium">${escapeHtml(song.name || 'Unknown')}</span>
                        <div class="flex items-center gap-1 mt-0.5 overflow-hidden whitespace-nowrap">
                            ${song.source ? getSourceTag(song.source) : ''}
                            ${qualityLabel ? `<span class="text-[9px] px-1.5 py-0.5 rounded ${qualityColorClass} font-bold flex-shrink-0">${qualityLabel}</span>` : ''}
                            ${audioMetaStr ? `<span class="text-[9px] t-text-muted truncate">${audioMetaStr}</span>` : ''}
                        </div>
                    </div>
                    ${pathStr ? `<div class="absolute left-0 top-full mt-1 z-50 hidden group-hover/songname:block px-2 py-1 rounded text-[11px] font-mono text-white bg-gray-800 dark:bg-gray-700 shadow-lg whitespace-nowrap max-w-[400px] truncate pointer-events-none">${escapeHtml(pathStr)}</div>` : ''}
                </div>
                <!-- 歌手列：点击跳转到歌手明细 (Navigate to singer detail) -->
                <div class="hidden md:block md:col-span-2 truncate text-sm ${activeTextClass || 't-text-muted'} cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors" data-truncate-tooltip onclick="event.stopPropagation(); navigateToSingerDetail('${escapeJs(song.singer || '')}')">${escapeHtml(song.singer || 'Unknown')}</div>
                <!-- 专辑列：点击跳转到专辑明细 (Navigate to album detail) -->
                <div class="hidden md:block md:col-span-2 truncate text-sm ${activeTextClass || 't-text-muted'} cursor-pointer hover:text-emerald-600 dark:hover:text-emerald-400 hover:underline transition-colors" data-truncate-tooltip onclick="event.stopPropagation(); navigateToAlbumDetail('${escapeJs(song.album || '')}', '${escapeJs(song.singer || '')}')">${escapeHtml(song.album || '')}</div>
                <div class="col-span-2 md:col-span-1 text-center flex flex-col items-center">
                    <span class="text-xs ${activeTextClass || 't-text-muted'} font-mono tabular-nums">${durationStr}</span>
                    ${sizeStr ? `<span class="text-[9px] t-text-muted">${sizeStr}</span>` : ''}
                </div>
                <div class="col-span-4 md:col-span-1 text-right flex items-center justify-end gap-1">
                    <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-400 hover:text-blue-500 transition-all" title="编辑" onclick="event.stopPropagation(); openTagEditor(${i}, 'musiclib')">
                        <i class="fas fa-pen text-[10px]"></i>
                    </button>
                    <button class="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400 hover:text-red-500 transition-all" title="删除" onclick="event.stopPropagation(); musicLibDeleteSingle(${i})">
                        <i class="fas fa-trash-alt text-[10px]"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    updateMusicLibPagination();
    updateMusicLibBatchBar();
    _initTruncateTooltips();
}

// ===== 音乐库分页 (由 pagination-factory.js 工厂生成) =====
const _musicLibPaginator = createLibPaginator({
    getPage: () => _musicLibPage, setPage: (p) => { _musicLibPage = p; },
    getPageSize: () => _musicLibPageSize, setPageSize: (s) => { _musicLibPageSize = s; },
    getTotal: () => _musicLibTotal, getTotalPages: () => _musicLibTotalPages,
    loadFn: loadMusicLib, prefix: 'musiclib', itemLabel: '首',
    defaultPageSize: 30, scrollContainerId: 'musiclib-list', pageInfoId: 'musiclib-page-info'
});
const updateMusicLibPagination = _musicLibPaginator.updatePagination;
const musicLibPrevPage = _musicLibPaginator.prevPage;
const musicLibNextPage = _musicLibPaginator.nextPage;
const musicLibGoToPage = _musicLibPaginator.goToPage;
const musicLibChangePageSize = _musicLibPaginator.changePageSize;

// ===== Multi-select / Batch operations =====

function toggleMusicLibBatchMode() {
    _musicLibSelectMode = !_musicLibSelectMode;
    const toggleBtn = document.getElementById('musiclib-batch-toggle');
    const batchToolbar = document.getElementById('musiclib-batch-toolbar');
    const selectAllCb = document.getElementById('musiclib-select-all-cb');
    const headerHash = document.getElementById('musiclib-header-hash');

    if (_musicLibSelectMode) {
        toggleBtn?.classList.add('text-emerald-500');
        if (batchToolbar) batchToolbar.classList.remove('hidden');
        if (selectAllCb) selectAllCb.classList.remove('hidden');
        if (headerHash) headerHash.classList.add('hidden');
    } else {
        toggleBtn?.classList.remove('text-emerald-500');
        if (batchToolbar) batchToolbar.classList.add('hidden');
        if (selectAllCb) selectAllCb.classList.add('hidden');
        if (headerHash) headerHash.classList.remove('hidden');
        _musicLibSelected.clear();
    }
    renderMusicLibList();
}

function musicLibToggleItem(pageIdx) {
    const globalIdx = (_musicLibPage - 1) * _musicLibPageSize + pageIdx;
    if (_musicLibSelected.has(globalIdx)) {
        _musicLibSelected.delete(globalIdx);
    } else {
        _musicLibSelected.add(globalIdx);
    }
    renderMusicLibList();
}

function musicLibSelectAllVisible(checked) {
    // 全选当前页所有歌曲
    for (let i = 0; i < _musicLibFiltered.length; i++) {
        const globalIdx = (_musicLibPage - 1) * _musicLibPageSize + i;
        if (checked) {
            _musicLibSelected.add(globalIdx);
        } else {
            _musicLibSelected.delete(globalIdx);
        }
    }
    renderMusicLibList();
}

function musicLibDeselectAll() {
    _musicLibSelected.clear();
    renderMusicLibList();
}

function updateMusicLibBatchBar() {
    const countEl = document.getElementById('musiclib-selected-count');
    const selectAllCb = document.getElementById('musiclib-select-all-cb');
    const batchToolbar = document.getElementById('musiclib-batch-toolbar');

    if (!_musicLibSelectMode) {
        if (batchToolbar) batchToolbar.classList.add('hidden');
        return;
    }
    if (batchToolbar) batchToolbar.classList.remove('hidden');

    const count = _musicLibSelected.size;
    if (countEl) countEl.textContent = count;

    // Update select-all checkbox state
    if (selectAllCb) {
        let allChecked = true;
        let anyChecked = false;
        for (let i = 0; i < _musicLibFiltered.length; i++) {
            const globalIdx = (_musicLibPage - 1) * _musicLibPageSize + i;
            if (_musicLibSelected.has(globalIdx)) {
                anyChecked = true;
            } else {
                allChecked = false;
            }
        }
        selectAllCb.checked = allChecked && (_musicLibFiltered.length > 0);
        selectAllCb.indeterminate = anyChecked && !allChecked;
    }
}

async function musicLibDeleteSingle(pageIdx) {
    const song = _musicLibFiltered[pageIdx];
    if (!song) return;

    // 显示确认弹窗
    _showMusicLibBatchDeleteConfirm(
        `确定要删除 "${song.name || 'Unknown'}" 吗？`,
        '此操作不可恢复',
        async () => {
            _showMusicLibBatchDeleteModal(`正在删除...`, '请稍候');
            try {
                const headers = {'Content-Type': 'application/json'};
                Object.assign(headers, getUserAuthHeaders());
                await fetch('/api/music/cache/remove', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({filenames: [song.relativePath]})
                });
                const globalIdx = (_musicLibPage - 1) * _musicLibPageSize + pageIdx;
                _musicLibSelected.delete(globalIdx);
                await loadMusicLib();
                _showMusicLibBatchDeleteResult('删除完成', `已成功删除 "${song.name || 'Unknown'}"`);
            } catch (err) {
                console.error('[MusicLib] Delete failed:', err);
                _showMusicLibBatchDeleteResult('删除失败', err.message || '未知错误', true);
            }
        }
    );
}

async function musicLibBatchDelete() {
    if (_musicLibSelected.size === 0) return;
    const count = _musicLibSelected.size;

    // 显示确认弹窗
    _showMusicLibBatchDeleteConfirm(
        `确定要删除选中的 ${count} 首歌曲吗？`,
        '此操作不可恢复',
        async () => {
            _showMusicLibBatchDeleteModal(`正在删除 ${count} 首歌曲...`, '请勿关闭页面，正在处理中');
            try {
                const filenames = [];
                _musicLibSelected.forEach(idx => {
                    const pageIdx = idx - (_musicLibPage - 1) * _musicLibPageSize;
                    const song = (pageIdx >= 0 && pageIdx < _musicLibFiltered.length) ? _musicLibFiltered[pageIdx] : null;
                    if (song && song.relativePath) filenames.push(song.relativePath);
                });

                const headers = {'Content-Type': 'application/json'};
                Object.assign(headers, getUserAuthHeaders());
                await fetch('/api/music/cache/remove', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({filenames})
                });
                _musicLibSelected.clear();
                await loadMusicLib();
                _showMusicLibBatchDeleteResult('删除完成', `已成功删除 ${count} 首歌曲`);
            } catch (err) {
                console.error('[MusicLib] Batch delete failed:', err);
                _showMusicLibBatchDeleteResult('删除失败', err.message || '未知错误', true);
            }
        }
    );
}

/**
 * 检测截断文本并添加自定义 tooltip
 * 仅为 scrollWidth > clientWidth 的元素添加悬浮提示
 */
function _initTruncateTooltips() {
    // 确保全局 tooltip 元素存在
    let tip = document.getElementById('truncate-tooltip');
    if (!tip) {
        tip = document.createElement('div');
        tip.id = 'truncate-tooltip';
        tip.className = 'fixed z-[80] px-2.5 py-1.5 rounded-lg text-xs text-white bg-gray-800 dark:bg-gray-700 shadow-xl pointer-events-none opacity-0 transition-opacity duration-150 whitespace-nowrap max-w-[300px] break-all';
        tip.style.cssText = 'transform: translateX(-50%);';
        document.body.appendChild(tip);
    }

    const els = document.querySelectorAll('[data-truncate-tooltip]');
    els.forEach(el => {
        el.addEventListener('mouseenter', () => {
            if (el.scrollWidth <= el.clientWidth) return;
            tip.textContent = el.textContent;
            const rect = el.getBoundingClientRect();
            tip.style.left = rect.left + rect.width / 2 + 'px';
            tip.style.top = rect.bottom + 6 + 'px';
            tip.classList.remove('opacity-0');
            tip.classList.add('opacity-100');
        });

        el.addEventListener('mouseleave', () => {
            tip.classList.remove('opacity-100');
            tip.classList.add('opacity-0');
        });
    });
}

/**
 * 显示删除确认弹窗（确认状态）
 * @param {string} title - 确认标题
 * @param {string} detail - 确认详情
 * @param {Function} onConfirm - 确认后的回调
 */
function _showMusicLibBatchDeleteConfirm(title, detail, onConfirm) {
    const modal = document.getElementById('musiclib-batch-delete-modal');
    const content = document.getElementById('musiclib-batch-delete-modal-content');
    document.getElementById('musiclib-batch-delete-title').textContent = '删除确认';
    document.getElementById('musiclib-batch-delete-confirm-title').textContent = title;
    document.getElementById('musiclib-batch-delete-confirm-detail').textContent = detail;
    document.getElementById('musiclib-batch-delete-confirm').classList.remove('hidden');
    document.getElementById('musiclib-batch-delete-running').classList.add('hidden');
    document.getElementById('musiclib-batch-delete-result').classList.add('hidden');
    document.getElementById('musiclib-batch-delete-close-btn').classList.remove('hidden');
    // 绑定确认按钮回调
    const confirmBtn = document.getElementById('musiclib-batch-delete-confirm-btn');
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.id = 'musiclib-batch-delete-confirm-btn';
    newConfirmBtn.addEventListener('click', onConfirm);
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 50);
}

/**
 * 显示删除进度弹窗（删除中状态）
 * @param {string} status - 状态文字
 * @param {string} detail - 详情文字
 */
function _showMusicLibBatchDeleteModal(status, detail) {
    document.getElementById('musiclib-batch-delete-title').textContent = '删除中';
    document.getElementById('musiclib-batch-delete-status').textContent = status;
    document.getElementById('musiclib-batch-delete-detail').textContent = detail;
    document.getElementById('musiclib-batch-delete-confirm').classList.add('hidden');
    document.getElementById('musiclib-batch-delete-running').classList.remove('hidden');
    document.getElementById('musiclib-batch-delete-result').classList.add('hidden');
    document.getElementById('musiclib-batch-delete-close-btn').classList.add('hidden');
}

/**
 * 显示批量删除结果（成功/失败）
 * @param {string} title - 结果标题
 * @param {string} text - 结果描述
 * @param {boolean} isError - 是否为错误结果
 */
function _showMusicLibBatchDeleteResult(title, text, isError = false) {
    document.getElementById('musiclib-batch-delete-running').classList.add('hidden');
    document.getElementById('musiclib-batch-delete-result').classList.remove('hidden');
    document.getElementById('musiclib-batch-delete-result-title').textContent = title;
    document.getElementById('musiclib-batch-delete-result-text').textContent = text;
    // 错误时替换图标为红色叉号
    const iconContainer = document.getElementById('musiclib-batch-delete-result').querySelector('.w-16');
    if (isError) {
        iconContainer.className = 'w-16 h-16 bg-red-500 text-white rounded-full flex items-center justify-center text-3xl shadow-lg shadow-red-200';
        iconContainer.innerHTML = '<i class="fas fa-times"></i>';
    } else {
        iconContainer.className = 'w-16 h-16 bg-emerald-500 text-white rounded-full flex items-center justify-center text-3xl shadow-lg shadow-emerald-200';
        iconContainer.innerHTML = '<i class="fas fa-check"></i>';
    }
    document.getElementById('musiclib-batch-delete-close-btn').classList.remove('hidden');
}

/**
 * 关闭批量删除弹窗
 */
function closeMusicLibBatchDeleteModal() {
    const modal = document.getElementById('musiclib-batch-delete-modal');
    const content = document.getElementById('musiclib-batch-delete-modal-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }, 300);
}

window.closeMusicLibBatchDeleteModal = closeMusicLibBatchDeleteModal;

// 共享内部函数 window 导出（供 album-lib.js 等模块访问）
window._initTruncateTooltips = _initTruncateTooltips;
window._showMusicLibBatchDeleteConfirm = _showMusicLibBatchDeleteConfirm;
window._showMusicLibBatchDeleteModal = _showMusicLibBatchDeleteModal;
window._showMusicLibBatchDeleteResult = _showMusicLibBatchDeleteResult;

// [formatDuration 已移至 js/utils.js]

function playMusicLibSong(pageIndex) {
    if (pageIndex < 0 || pageIndex >= _musicLibFiltered.length) return;
    const cachedSong = _musicLibFiltered[pageIndex];

    // 构建 playSong 兼容的 song 对象，保留封面和音质所需字段
    const song = Object.assign({}, cachedSong, {
        id: cachedSong.id || `cache_${pageIndex}`,
        _musicLibIndex: (_musicLibPage - 1) * _musicLibPageSize + pageIndex,
        _serverCachePath: cachedSong.relativePath,
        _isMusicLibSong: true,
    });

    // 将当前页歌曲设置为播放列表
    currentPlaylist = _musicLibFiltered.map((s, i) => {
        s._serverCachePath = s.relativePath;
        s._isMusicLibSong = true;
        return s;
    });
    // 播放列表变更时重置乱序状态
    if (playMode === 'random') resetShuffleState(pageIndex);

    // Reset album scope since we're playing from music library, not album view
    currentPlayingScope = 'local_list';
    _currentAlbumIndex = -1;

    // [DLNA] 同步歌单到后端 DMC（新歌单，立即播放）
    syncPlaylistToDmc(currentPlaylist, pageIndex, true);

    // [DLNA Fix] DLNA 模式下，syncPlaylistToDmc(playImmediately=true) 已经让 DMC 开始播放
    if (!_upnpActiveDeviceId || _castDeviceType !== 'upnp') {
        playSong(song, pageIndex, null, false, false, true);
    }
}

async function playAllMusicLib() {
    if (!_musicLibTotal) {
        showInfo('音乐库中没有歌曲');
        return;
    }

    // 获取全部歌曲作为播放列表
    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());
        const res = await fetch('/api/music/cache/list', {headers});
        const result = await res.json();
        if (!result.success || !result.data || !result.data.length) {
            showInfo('音乐库中没有歌曲');
            return;
        }

        currentPlaylist = result.data.map((s, i) => {
            s._serverCachePath = s.relativePath;
            s._isMusicLibSong = true;
            return s;
        });
        if (playMode === 'random') resetShuffleState(0);

        currentPlayingScope = 'local_list';
        _currentAlbumIndex = -1;

        syncPlaylistToDmc(currentPlaylist, 0, true);

        if (!_upnpActiveDeviceId || _castDeviceType !== 'upnp') {
            playSong(currentPlaylist[0], 0, null, false, false, true);
        }
    } catch (err) {
        console.error('[MusicLib] Play all failed:', err);
        showInfo('播放全部失败');
    }
}

window.loadMusicLib = loadMusicLib;
window.filterMusicLib = filterMusicLib;
window.sortMusicLib = sortMusicLib;
window.playMusicLibSong = playMusicLibSong;
window.playAllMusicLib = playAllMusicLib;
window.musicLibPrevPage = musicLibPrevPage;
window.musicLibNextPage = musicLibNextPage;
window.musicLibGoToPage = musicLibGoToPage;
window.musicLibChangePageSize = musicLibChangePageSize;
window.toggleMusicLibBatchMode = toggleMusicLibBatchMode;
window.musicLibToggleItem = musicLibToggleItem;
window.musicLibSelectAllVisible = musicLibSelectAllVisible;
window.musicLibDeselectAll = musicLibDeselectAll;
window.musicLibDeleteSingle = musicLibDeleteSingle;
window.musicLibBatchDelete = musicLibBatchDelete;

// ===== DB Maintenance Functions (ML-14/ML-15) =====

/**
 * 显示DB维护弹窗
 * @param {string} title - 弹窗标题
 */
function showDbMaintenanceModal(title) {
    const modal = document.getElementById('db-maintenance-modal');
    const content = document.getElementById('db-maintenance-modal-content');
    document.getElementById('db-maintenance-title').textContent = title;
    document.getElementById('db-maintenance-status').textContent = '正在扫描...';
    document.getElementById('db-maintenance-detail').textContent = '请稍候';
    document.getElementById('db-maintenance-progress-bar').style.width = '0%';
    document.getElementById('db-maintenance-running').classList.remove('hidden');
    document.getElementById('db-maintenance-result').classList.add('hidden');
    document.getElementById('db-maintenance-close-btn').style.display = 'none';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => {
        content.classList.remove('scale-95', 'opacity-0');
        content.classList.add('scale-100', 'opacity-100');
    }, 50);
}

/**
 * 更新DB维护弹窗进度
 * @param {string} status - 状态文字
 * @param {string} detail - 详情文字
 * @param {number} percent - 进度百分比 0-100
 */
function updateDbMaintenanceProgress(status, detail, percent) {
    document.getElementById('db-maintenance-status').textContent = status;
    document.getElementById('db-maintenance-detail').textContent = detail;
    document.getElementById('db-maintenance-progress-bar').style.width = `${Math.min(100, Math.max(0, percent))}%`;
}

/**
 * 显示DB维护结果
 * @param {string} title - 结果标题
 * @param {string} text - 结果描述
 */
function showDbMaintenanceResult(title, text) {
    document.getElementById('db-maintenance-running').classList.add('hidden');
    document.getElementById('db-maintenance-result').classList.remove('hidden');
    document.getElementById('db-maintenance-result-title').textContent = title;
    document.getElementById('db-maintenance-result-text').textContent = text;
    document.getElementById('db-maintenance-close-btn').style.display = '';
}

/**
 * 关闭DB维护弹窗
 */
function closeDbMaintenanceModal() {
    const modal = document.getElementById('db-maintenance-modal');
    const content = document.getElementById('db-maintenance-modal-content');
    content.classList.remove('scale-100', 'opacity-100');
    content.classList.add('scale-95', 'opacity-0');
    setTimeout(() => {
        modal.classList.remove('flex');
        modal.classList.add('hidden');
    }, 300);
}

/**
 * 删除失效音乐 (ML-14)
 * 遍历DB中所有音乐，如果文件不存在则删除对应DB记录
 */
async function musicLibCleanupStale() {
    const confirmed = await showSelect('删除失效和重复的音乐', '将执行以下操作：\n\n1. 清理失效记录\n   - 扫描数据库中所有记录，删除本地文件不存在的DB记录\n\n2. 清理重复记录\n   - 按"专辑 + 歌手 + 歌名"判断重复\n   - 优先删除文件不存在的重复记录\n   - 保留符合标准格式的记录（如 wy_123、kg_456 等）\n   - 删除其余重复记录及对应文件\n\n⚠️ 此操作将同时删除DB记录和物理文件，不可恢复！\n确定继续吗？', {
        confirmText: '确定删除',
        confirmColor: 'bg-red-500'
    });
    if (!confirmed) return;

    showDbMaintenanceModal('删除失效和重复的音乐');

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        // Step 1: 删除失效记录
        updateDbMaintenanceProgress('正在扫描失效记录...', '检查数据库中的文件是否存在', 20);

        const cleanupResp = await fetch('/api/music/db/cleanup', {
            method: 'POST',
            headers
        });

        updateDbMaintenanceProgress('正在删除失效记录...', '处理中', 40);

        const cleanupResult = await cleanupResp.json();
        const staleCount = cleanupResult.success ? (cleanupResult.deletedCount || 0) : 0;

        // Step 2: 删除重复记录
        updateDbMaintenanceProgress('正在扫描重复记录...', '按 专辑+歌手+歌名 判断重复', 50);

        const dedupResp = await fetch('/api/music/db/deduplicate', {
            method: 'POST',
            headers
        });

        updateDbMaintenanceProgress('正在删除重复记录...', '清理无效文件并保留标准格式记录', 70);

        const dedupResult = await dedupResp.json();
        const duplicateCount = dedupResult.success ? (dedupResult.deletedCount || 0) : 0;

        // 显示结果
        if (cleanupResult.success && dedupResult.success) {
            const totalCount = staleCount + duplicateCount;
            if (totalCount === 0) {
                showDbMaintenanceResult('扫描完成', '没有发现失效或重复的音乐记录');
            } else {
                const details = [];
                if (staleCount > 0) details.push(`删除失效记录 ${staleCount} 条`);
                if (duplicateCount > 0) details.push(`删除重复记录 ${duplicateCount} 条`);
                showDbMaintenanceResult('清理完成', details.join('，'));
                loadMusicLib(); // 刷新列表
            }
        } else {
            const errorMsg = cleanupResult.message || dedupResult.message || '未知错误';
            showDbMaintenanceResult('操作部分失败', errorMsg);
        }
    } catch (err) {
        console.error('[ML-14] Cleanup stale and deduplicate failed:', err);
        showDbMaintenanceResult('操作失败', err.message || '网络错误');
    }
}

/**
 * 补齐缺失数据 (ML-15)
 * 遍历DB中所有音乐，检查元数据是否缺失，从本地文件读取并补充
 * 使用 SSE 流式响应实时显示进度（完成数/总进度）+ 并发处理
 */
async function musicLibEnrichMeta() {
    const confirmed = await showSelect('补齐缺失数据', '将扫描数据库中所有记录，检查并补充缺失的元数据（年份、流派、音质参数等）。\n已补充过的记录不会重复扫描。确定继续吗？', {
        confirmText: '确定补充',
        confirmColor: 'bg-blue-500'
    });
    if (!confirmed) return;

    showDbMaintenanceModal('补齐缺失数据');
    updateDbMaintenanceProgress('正在扫描缺失元数据的记录...', '检查数据库中的元数据字段', 5);

    try {
        const headers = {};
        Object.assign(headers, getUserAuthHeaders());

        const resp = await fetch('/api/music/db/enrich', {
            method: 'POST',
            headers
        });

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let totalCount = 0;

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, {stream: true});

            // 解析 SSE 事件
            const lines = buffer.split('\n');
            buffer = '';
            let currentEvent = '';
            let currentData = '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7).trim();
                } else if (line.startsWith('data: ')) {
                    currentData = line.slice(6);
                } else if (line === '' && currentEvent && currentData) {
                    // 空行 = 事件结束
                    try {
                        const data = JSON.parse(currentData);

                        if (currentEvent === 'start') {
                            totalCount = data.total || 0;
                            updateDbMaintenanceProgress(
                                `正在补充元数据...`,
                                `共 ${totalCount} 条记录需要处理`,
                                10
                            );
                        } else if (currentEvent === 'progress') {
                            const completed = data.completed || 0;
                            const total = data.total || totalCount;
                            const enriched = data.enrichedCount || 0;
                            const lyrics = data.lyricsDownloaded || 0;
                            const covers = data.coversEmbedded || 0;
                            const pct = total > 0 ? Math.round((completed / total) * 80) + 10 : 50; // 10-90%

                            const details = [];
                            details.push(`已处理 ${completed}/${total}`);
                            if (lyrics > 0) details.push(`歌词 ${lyrics}`);
                            if (covers > 0) details.push(`封面 ${covers}`);

                            updateDbMaintenanceProgress(
                                `补充元数据中 (${completed}/${total})`,
                                details.join('，'),
                                pct
                            );
                        } else if (currentEvent === 'complete') {
                            const count = data.enrichedCount || 0;
                            const total = data.total || 0;
                            const lyrics = data.lyricsDownloaded || 0;
                            const covers = data.coversEmbedded || 0;

                            if (total === 0) {
                                showDbMaintenanceResult('扫描完成', '没有需要补充元数据的记录');
                            } else {
                                const details = [];
                                details.push(`处理 ${count}/${total} 条记录`);
                                if (lyrics > 0) details.push(`下载歌词 ${lyrics} 首`);
                                if (covers > 0) details.push(`补充封面 ${covers} 首`);
                                showDbMaintenanceResult('补充完成', details.join('，'));
                                loadMusicLib(); // 刷新列表
                            }
                        }
                    } catch (parseErr) {
                        console.warn('[ML-15] SSE parse error:', parseErr);
                    }
                    currentEvent = '';
                    currentData = '';
                } else if (line !== '' && !line.startsWith('event:') && !line.startsWith('data:')) {
                    // 不完整的行，保留到下一次
                    buffer = line;
                }
            }
        }
    } catch (err) {
        console.error('[ML-15] Enrich metadata failed:', err);
        showDbMaintenanceResult('操作失败', err.message || '网络错误');
    }
}

window.musicLibCleanupStale = musicLibCleanupStale;
window.musicLibEnrichMeta = musicLibEnrichMeta;
window.closeDbMaintenanceModal = closeDbMaintenanceModal;

// ===== 模块变量 window 导出 (使用 defineProperty 保持实时同步) =====
// let 变量不能通过 window.xxx = xxx 一次性赋值导出，因为后续重新赋值不会同步到 window。
// 使用 Object.defineProperty 的 getter/setter 确保其他模块始终读到最新值。
Object.defineProperty(window, '_musicLibList', { get() { return _musicLibList; }, set(v) { _musicLibList = v; }, configurable: true });
Object.defineProperty(window, '_musicLibFiltered', { get() { return _musicLibFiltered; }, set(v) { _musicLibFiltered = v; }, configurable: true });
Object.defineProperty(window, '_musicLibLoaded', { get() { return _musicLibLoaded; }, set(v) { _musicLibLoaded = v; }, configurable: true });
Object.defineProperty(window, '_musicLibPage', { get() { return _musicLibPage; }, set(v) { _musicLibPage = v; }, configurable: true });
Object.defineProperty(window, '_musicLibPageSize', { get() { return _musicLibPageSize; }, set(v) { _musicLibPageSize = v; }, configurable: true });
Object.defineProperty(window, '_musicLibTotal', { get() { return _musicLibTotal; }, set(v) { _musicLibTotal = v; }, configurable: true });
Object.defineProperty(window, '_musicLibTotalPages', { get() { return _musicLibTotalPages; }, set(v) { _musicLibTotalPages = v; }, configurable: true });
Object.defineProperty(window, '_musicLibSelectMode', { get() { return _musicLibSelectMode; }, set(v) { _musicLibSelectMode = v; }, configurable: true });
Object.defineProperty(window, '_musicLibSelected', { get() { return _musicLibSelected; }, set(v) { _musicLibSelected = v; }, configurable: true });
Object.defineProperty(window, '_currentSourceFilter', { get() { return _currentSourceFilter; }, set(v) { _currentSourceFilter = v; }, configurable: true });
Object.defineProperty(window, '_musicLibOrder', { get() { return _musicLibOrder; }, set(v) { _musicLibOrder = v; }, configurable: true });
Object.defineProperty(window, 'availableSources', { get() { return availableSources; }, set(v) { availableSources = v; }, configurable: true });
window.loadMusicLib = loadMusicLib;
window.musicLibSearchByField = musicLibSearchByField;
window.renderMusicLibList = renderMusicLibList;
window._initTruncateTooltips = _initTruncateTooltips;
window._showMusicLibBatchDeleteConfirm = _showMusicLibBatchDeleteConfirm;
window._showMusicLibBatchDeleteModal = _showMusicLibBatchDeleteModal;
window._showMusicLibBatchDeleteResult = _showMusicLibBatchDeleteResult;
