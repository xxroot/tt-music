/**
 * Leaderboard Manager for LX Music Web
 * 排行榜功能模块 — 风格与 SongListManager 保持一致
 */

window.LeaderboardManager = (function () {
    const API_BASE = '/api/music/leaderboard';

    let state = {
        source: 'wy',
        boards: [],          // 当前来源的榜单列表
        currentBangid: null, // 当前选中榜单 bangid
        currentBoardName: '',
        songs: [],           // 当前榜单歌曲列表
        page: 1,             // 后端页码
        localPage: 1,        // 前端渲染页码
        total: 0,
        limit: 100,          // 后端一页加载数量限制
        loading: false,
    };

    let initialized = false;

    // ==================== 初始化 ====================

    function init() {
        if (initialized) return;
        initialized = true;
        state.source = 'wy';
        // 同步 source select 的值
        const sel = document.getElementById('lb-source-select');
        if (sel) sel.value = state.source;
        loadBoards(state.source);
    }

    // ==================== 数据加载 ====================

    async function loadBoards(source) {
        state.source = source;
        state.boards = [];
        state.currentBangid = null;
        state.songs = [];
        state.localPage = 1;
        renderBoards([]);
        renderSongs([]);
        showBoardsLoading(true);

        try {
            const res = await fetch(`${API_BASE}/boards?source=${source}`);
            const data = await res.json();
            if (data.error) throw new Error(data.error);
            state.boards = data.list || [];
            renderBoards(state.boards);
            // 自动选中第一个榜单
            if (state.boards.length > 0) {
                selectBoard(state.boards[0].bangid, state.boards[0].name);
            }
        } catch (e) {
            console.error('[Leaderboard] loadBoards failed:', e);
            document.getElementById('lb-boards-list').innerHTML =
                `<div class="p-4 text-red-500 text-sm">加载失败: ${e.message}</div>`;
        } finally {
            showBoardsLoading(false);
        }
    }

    async function loadSongs(bangid, source, page = 1) {
        state.loading = true;
        state.page = page;

        const container = document.getElementById('lb-songs-list');
        if (page === 1) {
            state.localPage = 1;
            container.innerHTML = `
                <div class="flex items-center justify-center py-20">
                    <i class="fas fa-spinner fa-spin text-4xl text-emerald-500"></i>
                </div>`;
        }

        try {
            const url = `${API_BASE}/list?source=${source}&bangid=${encodeURIComponent(bangid)}&page=${page}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            if (page === 1) {
                state.songs = (data.list || []).map((song, idx) => {
                    if (!song.id || song.id === 'undefined') {
                        song.id = song.songmid || song.songId || song.hash || song.copyrightId || song.mid || `lb_${bangid}_${idx}`;
                    }
                    return song;
                });
            } else {
                const newSongs = (data.list || []).map((song, idx) => {
                    if (!song.id || song.id === 'undefined') {
                        song.id = song.songmid || song.songId || song.hash || song.copyrightId || song.mid || `lb_${bangid}_${state.songs.length + idx}`;
                    }
                    return song;
                });
                state.songs = [...state.songs, ...newSongs];
            }

            state.total = data.total || state.songs.length;
            state.limit = data.limit || 100;

            // 同步 viewingPlaylist 供批量操作全局函数使用
            window.viewingPlaylist = state.songs;

            // [Fix] 从后端数据库拉取历史下载状态，填充 dbDownloadStatusMap
            const songIds = (page === 1 ? state.songs : (data.list || [])).map(s => String(s.id)).filter(Boolean);
            if (window.fetchDbDownloadStatuses) {
                await window.fetchDbDownloadStatuses(songIds, source);
            }

            // 初始化/复位搜索
            if (page === 1 && window.ListSearch) {
                window.ListSearch.init('leaderboard', {
                    renderCallback: () => {
                        renderSongs(state.songs);
                        renderPagination();
                    },
                    getCurrentPage: () => state.localPage,
                    paginationCallback: (targetPage, targetSongIndex) => {
                        state.localPage = targetPage;
                        renderSongs(state.songs);
                        renderPagination();
                        setTimeout(() => {
                            if (window.ListSearch) window.ListSearch.scrollToMatch(targetSongIndex);
                        }, 50);
                    },
                    getList: () => state.songs
                });
            }

            renderSongs(state.songs);
            renderPagination();
        } catch (e) {
            console.error('[Leaderboard] loadSongs failed:', e);
            container.innerHTML = `<div class="text-center text-red-500 p-10">加载失败: ${e.message}</div>`;
        } finally {
            state.loading = false;
        }
    }

    // ==================== 渲染 ====================

    function renderBoards(boards) {
        const container = document.getElementById('lb-boards-list');
        if (!container) return;
        if (!boards || boards.length === 0) {
            container.innerHTML = '<div class="p-4 text-center t-text-muted text-sm">暂无榜单</div>';
            return;
        }

        container.innerHTML = boards.map((board, i) => `
            <div id="lb-board-${board.bangid}"
                onclick="window.LeaderboardManager.selectBoard('${board.bangid}', '${board.name.replace(/'/g, "\\'")}' )"
                class="lb-board-item flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 group ${state.currentBangid == board.bangid ? 'active-option' : 'hover:t-bg-panel t-text-muted'}">
                <span class="text-xs font-mono w-5 text-center flex-shrink-0 ${i < 3 ? 'text-emerald-600 dark:text-emerald-500 font-bold' : 't-text-muted'}">${i + 1}</span>
                <span class="text-sm font-medium truncate flex-1 ${state.currentBangid == board.bangid ? '' : 't-text-main group-hover:t-text-main'}">${board.name}</span>
                <i class="fas fa-chevron-right text-[10px] t-text-muted opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"></i>
            </div>
        `).join('');
    }

    function renderSongs(songs) {
        const container = document.getElementById('lb-songs-list');
        if (!container) return;

        if (!songs || songs.length === 0) {
            container.innerHTML = state.currentBangid
                ? '<div class="flex items-center justify-center py-20 t-text-muted"><i class="fas fa-music text-4xl mb-3 opacity-30"></i><p class="mt-3">暂无歌曲</p></div>'
                : '<div class="flex items-center justify-center py-20 t-text-muted"><i class="fas fa-chart-bar text-4xl mb-3 opacity-30"></i><p class="mt-3">请从左侧选择一个榜单</p></div>';
            return;
        }

        const displayList = window.ListSearch && window.ListSearch.state && window.ListSearch.state.active && window.ListSearch.state.id === 'leaderboard'
            ? window.ListSearch.getDisplayList(songs)
            : songs.map((item, idx) => ({ item, originalIndex: idx }));

        const itemsPerPage = typeof settings !== 'undefined' ? (settings.itemsPerPage === 'all' ? displayList.length : parseInt(settings.itemsPerPage)) : 20;
        const totalItems = displayList.length;
        const totalPages = Math.ceil(totalItems / (itemsPerPage || 20)) || 1;

        if (state.localPage > totalPages) state.localPage = totalPages || 1;
        if (state.localPage < 1) state.localPage = 1;

        const startIndex = (state.localPage - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
        const pageList = displayList.slice(startIndex, endIndex);

        container.innerHTML = pageList.map(({ item: song, originalIndex: index }) => {
            const isSelected = window.selectedItems && window.selectedItems.has(String(song.id));
            const isMatched = window.ListSearch && window.ListSearch.isMatched(index);
            const isCurrentMatch = window.ListSearch && window.ListSearch.isCurrentMatch(index);

            // Get download status - 使用与 app.js 一致的合并逻辑
            const memoryStatusMap = window.SystemDownloadManager ? window.SystemDownloadManager.getAllDownloadStatuses() : new Map();
            const downloadStatusMap = new Map(memoryStatusMap);
            if (window.dbDownloadStatusMap) {
                window.dbDownloadStatusMap.forEach((status, songId) => {
                    if (!downloadStatusMap.has(songId)) {
                        downloadStatusMap.set(songId, status);
                    }
                });
            }
            const dlStatus = downloadStatusMap.get(String(song.id)) || { status: null };

            let rowClass = 'grid grid-cols-12 gap-2 md:gap-4 p-3 rounded-xl hover:t-bg-panel group transition-colors cursor-pointer ';
            if (isCurrentMatch) rowClass += 'search-current ';
            else if (isMatched) rowClass += 'search-match ';
            if (isSelected) rowClass += 'row-selected ring-1 ring-emerald-500/30 ';

            const rank = index + 1;
            const rankClass = rank <= 3 ? 'text-emerald-600 dark:text-emerald-500 font-black text-base' : 'text-gray-400 font-mono text-xs';

            const imgUrl = window.getImgUrl ? window.getImgUrl(song) : (song.img || song.albumImg || '/music/assets/logo.png');

            return `
            <div id="lb-row-${index}" class="${rowClass}" data-song-id="${String(song.id)}"
                 onclick="window.LeaderboardManager.handleRowClick(${index})">
                <!-- 序号 + 复选框 (always visible) -->
                <div class="col-span-1 text-center flex items-center justify-center gap-1">
                    <input type="checkbox"
                           class="batch-checkbox w-4 h-4 text-emerald-600 rounded flex-shrink-0"
                           data-song-id="${String(song.id)}"
                           ${isSelected ? 'checked' : ''}
                           onclick="event.stopPropagation(); handleBatchSelect('${String(song.id)}', this.checked);">
                    <span class="${rankClass}">${rank}</span>
                </div>
                <!-- 封面 + 歌名 -->
                <div class="col-span-9 md:col-span-5 lg:col-span-4 flex items-center gap-3 min-w-0">
                    <div class="w-10 h-10 md:w-12 md:h-12 flex-shrink-0 relative rounded-lg overflow-hidden shadow-sm border t-border-main group-hover:shadow-md transition-all group-hover:scale-105 duration-300">
                        <img data-src="${imgUrl}" src="/music/assets/logo.png"
                             class="lazy-image w-full h-full object-cover dynamic-logo is-placeholder"
                             onerror="this.src='/music/assets/logo.png'; this.classList.add('is-placeholder');">
                        <div class="absolute inset-0 bg-black/20 hidden group-hover:flex items-center justify-center transition-all">
                            <i class="fas fa-play text-white text-xs"></i>
                        </div>
                    </div>
                    <div class="min-w-0 flex-1 flex flex-col justify-center overflow-hidden">
                        <div class="font-bold text-sm t-text-main group-hover:text-emerald-500 transition-colors">
                            ${window.createMarqueeHtml ? window.createMarqueeHtml(song.name) : `<span class="truncate">${song.name}</span>`}
                        </div>
                        <div class="flex items-center gap-1 mt-0.5 overflow-hidden">
                            ${window.getSourceTag ? window.getSourceTag(song.source || state.source) : ''}
                            ${window.getQualityTags ? window.getQualityTags(song) : ''}
                            <span data-dl-status>${window.getDownloadStatusIcon ? window.getDownloadStatusIcon(dlStatus, song.id) : ''}</span>
                            <div class="md:hidden flex-1 min-w-0">
                                ${window.createMarqueeHtml ? window.createMarqueeHtml(song.singer, 'text-[10px] t-text-muted') : `<span class="text-[10px] t-text-muted truncate">${song.singer}</span>`}
                            </div>
                        </div>
                    </div>
                </div>
                <!-- 歌手 -->
                <div class="hidden md:flex md:col-span-3 items-center text-xs t-text-muted overflow-hidden">
                    ${window.createMarqueeHtml ? window.createMarqueeHtml(song.singer) : `<span class="truncate">${song.singer || '--'}</span>`}
                </div>
                <!-- 专辑 -->
                <div class="hidden lg:flex lg:col-span-2 items-center text-xs t-text-muted truncate">
                    ${song.albumName || '--'}
                </div>
                <!-- 时长 -->
                <div class="hidden md:flex md:col-span-2 lg:col-span-1 items-center justify-end text-xs font-mono t-text-muted">
                    ${song.interval || '--:--'}
                </div>
                <!-- 操作 -->
                <div class="col-span-2 md:col-span-1 flex items-center justify-end gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="p-1.5 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors"
                            title="播放"
                            onclick="event.stopPropagation(); window.LeaderboardManager.playSong(${index})">
                        <i class="fas fa-play w-3.5 h-3.5"></i>
                    </button>
                    <button class="p-1.5 hover:bg-blue-50 rounded-lg text-blue-600 transition-colors"
                            title="下载"
                            onclick="event.stopPropagation(); downloadSong(${JSON.stringify(song).replace(/"/g, '&quot;')})">
                        <i class="fas fa-download w-3.5 h-3.5"></i>
                    </button>
                </div>
            </div>
            `;
        }).join('');

        if (typeof window.lazyLoadImages === 'function') window.lazyLoadImages();
        if (typeof window.applyMarqueeChecks === 'function') window.applyMarqueeChecks();
    }

    function renderPagination() {
        const prevBtn = document.getElementById('lb-btn-prev');
        const nextBtn = document.getElementById('lb-btn-next');
        const info = document.getElementById('lb-page-info');

        const displayList = window.ListSearch && window.ListSearch.state && window.ListSearch.state.active && window.ListSearch.state.id === 'leaderboard'
            ? window.ListSearch.getDisplayList(state.songs)
            : state.songs.map((item, idx) => ({ item, originalIndex: idx }));

        const itemsPerPage = typeof settings !== 'undefined' ? (settings.itemsPerPage === 'all' ? displayList.length : parseInt(settings.itemsPerPage)) : 20;
        const totalItems = displayList.length;
        const totalPages = Math.ceil(totalItems / (itemsPerPage || 20)) || 1;

        if (prevBtn) prevBtn.disabled = state.localPage <= 1;
        if (nextBtn) {
            // 当本地页数超出，且已经无法再次从后端拿到新数据时，才禁用“下一页”
            const canLoadMore = state.songs.length >= state.limit * state.page;
            nextBtn.disabled = state.localPage >= totalPages && !canLoadMore;
        }
        if (info) info.innerText = `第 ${state.localPage} 页 / 共 ${totalPages} 页`;
    }

    function showBoardsLoading(show) {
        const el = document.getElementById('lb-boards-loading');
        if (el) el.classList.toggle('hidden', !show);
    }

    function updateBoardActiveState(bangid) {
        document.querySelectorAll('.lb-board-item').forEach(el => {
            el.classList.remove('active-option');
            el.classList.add('hover:t-bg-panel', 't-text-muted');
        });
        const target = document.getElementById(`lb-board-${bangid}`);
        if (target) {
            target.classList.add('active-option');
            target.classList.remove('hover:t-bg-panel', 't-text-muted');
        }
    }

    function updateBoardTitle(name) {
        const el = document.getElementById('lb-board-title');
        if (el) el.innerText = name || '';
        const countEl = document.getElementById('lb-song-count');
        if (countEl) countEl.innerText = '';
    }

    function updateSongCountAfterLoad() {
        const countEl = document.getElementById('lb-song-count');
        if (countEl) countEl.innerText = `· ${state.songs.length} 首`;
    }

    // ==================== 提取的核心方法 ====================

    function selectBoard(bangid, name) {
        state.currentBangid = bangid;
        state.currentBoardName = name;
        state.page = 1;
        state.localPage = 1;
        state.songs = [];
        updateBoardActiveState(bangid);
        updateBoardTitle(name);
        if (window.ListSearch) window.ListSearch.resetState();

        // 切换到排行榜视图时，清除之前其他视图残留的选中状态
        if (window.selectedItems && window.selectedItems.size > 0) {
            window.selectedItems.clear();
            window.selectedSongObjects.clear();
            if (typeof updateBatchToolbar === 'function') updateBatchToolbar();
        }

        loadSongs(bangid, state.source, 1).then(() => updateSongCountAfterLoad());
    }

    function playSong(index) {
        const displayList = window.ListSearch && window.ListSearch.state && window.ListSearch.state.active && window.ListSearch.state.id === 'leaderboard'
            ? window.ListSearch.getDisplayList(state.songs).map(item => item.item)
            : state.songs;

        const song = displayList[index];
        if (!song) return;

        if (typeof window.updatePlaylist === 'function') {
            const listWithSource = displayList.map(s => ({ ...s, source: s.source || state.source }));
            window.updatePlaylist(listWithSource, index, 'leaderboard', true);
        }
    }

    function playAll() {
        if (state.songs.length === 0) return;
        if (typeof window.updatePlaylist === 'function') {
            const listWithSource = state.songs.map(s => ({ ...s, source: s.source || state.source }));
            window.updatePlaylist(listWithSource, 0, 'leaderboard', false);
        }
    }

    function changePage(delta) {
        if (state.loading) return;

        const displayList = window.ListSearch && window.ListSearch.state && window.ListSearch.state.active && window.ListSearch.state.id === 'leaderboard'
            ? window.ListSearch.getDisplayList(state.songs)
            : state.songs.map((item, idx) => ({ item, originalIndex: idx }));

        const itemsPerPage = typeof settings !== 'undefined' ? (settings.itemsPerPage === 'all' ? displayList.length : parseInt(settings.itemsPerPage)) : 20;
        const totalItems = displayList.length;
        const totalPages = Math.ceil(totalItems / (itemsPerPage || 20)) || 1;

        const nextLocal = state.localPage + delta;

        if (delta > 0 && nextLocal > totalPages) {
            // 需要向后端加载更多
            const canLoadMore = state.songs.length >= state.limit * state.page;
            if (canLoadMore) {
                loadSongs(state.currentBangid, state.source, state.page + 1).then(() => {
                    state.localPage++; // 加载完后，本地页码加1
                    renderSongs(state.songs); // 刷新视图
                    renderPagination();       // 刷新底部页码标示
                    updateSongCountAfterLoad();
                    document.getElementById('lb-songs-container') && document.getElementById('lb-songs-container').scrollTo({ top: 0, behavior: 'smooth' });
                });
            }
        } else if (nextLocal >= 1 && nextLocal <= totalPages) {
            // 本地直接翻页面
            state.localPage = nextLocal;
            renderSongs(state.songs);
            renderPagination();
            document.getElementById('lb-songs-container') && document.getElementById('lb-songs-container').scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    function changeSource() {
        const sel = document.getElementById('lb-source-select');
        if (!sel) return;
        state.source = sel.value;
        state.currentBangid = null;
        state.currentBoardName = '';
        state.songs = [];
        state.page = 1;
        updateBoardTitle('');
        loadBoards(state.source);
    }

    function handleRowClick(index) {
        // Since checkbox is always visible now, clicking row just plays the song
        playSong(index);
    }


    // ==================== 公共方法 ====================

    return {
        get initialized() { return initialized; },

        init,
        changeSource,
        selectBoard,
        playSong,
        playAll,
        changePage,
        handleRowClick,

        renderSongs: function () {
            renderSongs(state.songs);
            renderPagination();
        },

        resetLocalPage: function () {
            state.localPage = 1;
        },

        getCurrentList: function () {
            return state.songs;
        },

        getCurrentSource: function () {
            return state.source;
        },
    };
})();

// ==================== 全局代理 ====================
function changeLeaderboardSource() { window.LeaderboardManager.changeSource(); }
function leaderboardChangePage(delta) { window.LeaderboardManager.changePage(delta); }
function playAllLeaderboard() { window.LeaderboardManager.playAll(); }

// ==================== 排行榜批量操作与搜索 ====================
function toggleLbBatchMode() {
    window.batchMode = !window.batchMode;
    const batchToolbar = document.getElementById('lb-batch-toolbar');
    const lbContainer = document.getElementById('lb-songs-container');

    if (window.batchMode) {
        if (batchToolbar) batchToolbar.classList.remove('hidden');
        if (lbContainer) lbContainer.classList.add('batch-mode');
    } else {
        if (batchToolbar) batchToolbar.classList.add('hidden');
        if (lbContainer) lbContainer.classList.remove('batch-mode');
        window.selectedItems.clear();
        window.selectedSongObjects.clear();
        const countEl = document.getElementById('lb-batch-selected-count');
        if (countEl) countEl.textContent = '0';
    }
    window.LeaderboardManager.renderSongs();
}

function lbSelectAll() {
    if (!window.LeaderboardManager) return;

    const allSongs = window.LeaderboardManager.getCurrentList();
    if (!allSongs || allSongs.length === 0) return;

    // --- 逻辑对齐：当开启“仅显示匹配项”过滤时，全选应仅针对匹配项 ---
    let songsToOperate = allSongs;
    if (window.ListSearch && window.ListSearch.state.active &&
        window.ListSearch.state.id === 'leaderboard' && window.ListSearch.state.onlyShowMatches) {
        songsToOperate = window.ListSearch.getDisplayList(allSongs).map(obj => obj.item);
    }

    // [Fix] 排行榜没有分页，全选时基于 DOM 可见元素获取歌曲（与分页全选逻辑对齐）
    // 从 DOM 容器获取当前可见的歌曲 ID，避免选中搜索过滤已隐藏的项
    const container = document.getElementById('lb-songs-list');
    if (!container) return;
    const visibleIds = new Set();
    container.querySelectorAll('[data-song-id]').forEach(el => {
        visibleIds.add(String(el.dataset.songId));
    });

    // 如果 DOM 中没有可见项，回退到全部歌曲
    if (visibleIds.size === 0) return;

    // 从可见 ID 中筛选出要操作的歌曲
    const visibleSongs = songsToOperate.filter(song => visibleIds.has(String(song.id)));

    let isAllSelected = true;
    for (const song of visibleSongs) {
        if (!window.selectedItems.has(String(song.id))) {
            isAllSelected = false;
            break;
        }
    }

    if (isAllSelected) {
        visibleSongs.forEach(song => window.handleBatchSelect(String(song.id), false));
    } else {
        visibleSongs.forEach(song => window.handleBatchSelect(String(song.id), true));
    }
}
window.lbSelectAll = lbSelectAll;

function lbToggleListSearch() {
    if (window.ListSearch) {
        window.ListSearch.toggleBar();
    }
}

// ==================== 手机端侧边栏切换 ====================
function toggleLbSidebar(force) {
    const sidebar = document.getElementById('lb-sidebar');
    const overlay = document.getElementById('lb-sidebar-overlay');
    if (!sidebar || !overlay) return;

    const isHidden = sidebar.classList.contains('-translate-x-full');
    const show = force !== undefined ? force : isHidden;

    if (show) {
        sidebar.classList.remove('-translate-x-full');
        overlay.classList.remove('hidden');
        setTimeout(() => {
            overlay.classList.add('opacity-100');
        }, 10);
    } else {
        sidebar.classList.add('-translate-x-full');
        overlay.classList.remove('opacity-100');
        setTimeout(() => {
            overlay.classList.add('hidden');
        }, 300);
    }
}

