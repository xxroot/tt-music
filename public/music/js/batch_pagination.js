// Batch Selection and Deletion Functions
// Batch Selection and Deletion Functions
function handleBatchSelect(songId, isChecked) {
    const id = String(songId); // Force string ID
    if (isChecked) {
        window.selectedItems.add(id);
        // Cache song object if available in viewingPlaylist
        if (typeof viewingPlaylist !== 'undefined' && viewingPlaylist) {
            // Loose comparison just in case, though viewingPlaylist IDs should match render
            const song = window.viewingPlaylist.find(s => String(s.id) === id);
            if (song) window.selectedSongObjects.set(id, song);
        }
    } else {
        window.selectedItems.delete(id);
        window.selectedSongObjects.delete(id);
    }
    updateBatchToolbar();

    // Partial UI Update: Find rows and checkboxes with this song ID and update them
    // This handles both the grid row highlight and the checkbox state
    const elements = document.querySelectorAll(`[data-song-id="${id}"]`);
    elements.forEach(el => {
        if (el.classList.contains('grid')) {
            // It's a row
            if (isChecked) {
                el.classList.add('row-selected', 'ring-1', 'ring-emerald-500/30');
            } else {
                el.classList.remove('row-selected', 'ring-1', 'ring-emerald-500/30');
            }
        }
        if (el.classList.contains('batch-checkbox')) {
            // It's a checkbox
            el.checked = isChecked;
        }
    });
}

/**
 * 轻量级批量选择 DOM 更新
 * 直接根据 selectedItems 集合更新 DOM 中的复选框、行高亮和计数
 * 用于搜索钻取（歌手→专辑明细）等 refreshBatchUI() 无法重渲染的上下文
 */
function updateBatchSelectionDOM() {
    // 更新所有复选框和行状态
    document.querySelectorAll('[data-song-id]').forEach(el => {
        const id = String(el.dataset.songId);
        const selected = window.selectedItems.has(id);
        if (el.classList.contains('grid')) {
            el.classList.toggle('row-selected', selected);
            el.classList.toggle('ring-1', selected);
            el.classList.toggle('ring-emerald-500/30', selected);
        }
        if (el.classList.contains('batch-checkbox')) {
            el.checked = selected;
        }
    });

    // 更新计数
    const size = window.selectedItems.size;
    document.querySelectorAll('#batch-selected-count').forEach(el => el.textContent = size);
    const slCountEl = document.getElementById('sl-batch-selected-count');
    if (slCountEl) slCountEl.textContent = size;
    const lbCountEl = document.getElementById('lb-batch-selected-count');
    if (lbCountEl) lbCountEl.textContent = size;
}

function refreshBatchUI() {
    // 根据当前可见的容器判断活跃视图，与 getActiveContainer() 逻辑一致
    const lbView = document.getElementById('view-leaderboard');
    if (lbView && !lbView.classList.contains('hidden') && window.LeaderboardManager) {
        // 排行榜视图
        window.LeaderboardManager.renderSongs();
        return;
    }

    const slDetail = document.getElementById('songlist-detail-view');
    if (slDetail && !slDetail.classList.contains('hidden') && window.SongListManager) {
        // 歌单详情视图
        window.SongListManager.renderDetail();
        return;
    }

    // 歌手详情页：歌曲列表由 renderSingerSongs 管理，不在此处重渲染
    if (window._onlineSingerState) return;

    // 搜索/收藏视图
    if (typeof renderResults === 'function' && window.viewingPlaylist) {
        renderResults(window.viewingPlaylist);
    }
}

function toggleBatchMode() {
    window.batchMode = !window.batchMode;

    if (window.batchMode) {
        // 进入批量模式：显示工具栏，添加 batch-mode class
        document.querySelectorAll('#batch-toolbar, #sl-batch-toolbar').forEach(el =>
            el.classList.remove('hidden'));
        ['view-search', 'songlist-detail-view'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('batch-mode');
        });
        updateBatchSelectionDOM();
    } else {
        // 退出批量模式：隐藏工具栏，移除 batch-mode class，清除选择
        document.querySelectorAll('#batch-toolbar, #sl-batch-toolbar').forEach(el =>
            el.classList.add('hidden'));
        ['view-search', 'songlist-detail-view'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.remove('batch-mode');
        });
        window.selectedItems.clear();
        window.selectedSongObjects.clear();
        refreshBatchUI();
        updateBatchToolbar();
        updateBatchSelectionDOM();
    }
}

// [Fix] 获取当前活跃的列表容器（解决 || 短路求值导致排行榜/歌单视图中选不中的问题）
// 优先级：可见的容器 > 隐藏的容器
function getActiveContainer() {
    const candidates = [
        document.getElementById('search-results'),
        document.getElementById('sl-detail-list'),
        document.getElementById('lb-songs-list')
    ];
    // 1. 优先返回 offsetParent 不为 null（即可见）的容器
    for (const c of candidates) {
        if (c && c.offsetParent !== null) return c;
    }
    // 2. 回退：返回第一个存在的容器
    for (const c of candidates) {
        if (c) return c;
    }
    return null;
}

function selectAllVisible() {
    // 从当前页面 DOM 获取可见歌曲，而不是整个 viewingPlaylist
    // 这样翻页后全选只会选中当前页的歌曲
    const container = getActiveContainer();
    if (!container) return;

    // 收集当前页可见歌曲的 ID
    const visibleIds = new Set();
    container.querySelectorAll('[data-song-id]').forEach(el => {
        visibleIds.add(String(el.dataset.songId));
    });

    // 先移除当前页可见歌曲的选中状态（避免重复），保留其他页的选择
    visibleIds.forEach(id => {
        window.selectedItems.delete(id);
        window.selectedSongObjects.delete(id);
    });

    // 选中当前页所有可见歌曲
    visibleIds.forEach(id => {
        window.selectedItems.add(id);
        // 从 viewingPlaylist 中找到对应的歌曲对象
        if (window.viewingPlaylist) {
            const song = window.viewingPlaylist.find(s => String(s.id) === id);
            if (song) window.selectedSongObjects.set(id, song);
        }
    });

    refreshBatchUI();
    updateBatchToolbar();
    updateBatchSelectionDOM();
}

function deselectAll() {
    window.selectedItems.clear();
    window.selectedSongObjects.clear();

    // updateBatchToolbar() 会被调用，这里也主动清零防遗漏
    // 使用 querySelectorAll 兼容歌手详情页克隆工具栏产生的重复 ID
    document.querySelectorAll('#batch-selected-count').forEach(el => el.textContent = '0');
    const slCountEl = document.getElementById('sl-batch-selected-count');
    const lbCountEl = document.getElementById('lb-batch-selected-count');
    if (slCountEl) slCountEl.textContent = '0';
    if (lbCountEl) lbCountEl.textContent = '0';

    // 重新渲染UI
    refreshBatchUI();
    updateBatchSelectionDOM();
    if (window.LeaderboardManager && document.getElementById('view-leaderboard') && !document.getElementById('view-leaderboard').classList.contains('hidden')) {
        window.LeaderboardManager.renderSongs();
    }
    updateBatchToolbar();
}

async function selectUndownloaded() {
    // 先清空所有选择
    window.selectedItems.clear();
    window.selectedSongObjects.clear();

    // 从当前页面 DOM 获取可见歌曲（只处理当前页，不跨页选择）
    const container = getActiveContainer();
    if (!container) return;

    // 收集当前页可见歌曲
    const visibleIds = [];
    container.querySelectorAll('[data-song-id]').forEach(el => {
        visibleIds.push(String(el.dataset.songId));
    });

    // [Fix] 如果 dbDownloadStatusMap 尚未初始化或缺少可见歌曲的状态，先从后端拉取
    if (window.fetchDbDownloadStatuses && visibleIds.length > 0) {
        const missingIds = visibleIds.filter(id => {
            const inMemory = window.SystemDownloadManager && window.SystemDownloadManager.getSongDownloadStatus(id)?.status;
            const inDb = window.dbDownloadStatusMap && window.dbDownloadStatusMap.has(id);
            return !inMemory && !inDb;
        });
        if (missingIds.length > 0) {
            // 从 viewingPlaylist 中提取 source（取第一个有 source 的歌曲）
            let source = '';
            if (window.viewingPlaylist && window.viewingPlaylist.length > 0) {
                source = window.viewingPlaylist.find(s => s.source)?.source || '';
            }
            await window.fetchDbDownloadStatuses(missingIds, source);
        }
    }

    // 合并下载状态（与 renderDetail 逻辑一致：内存状态优先，db 状态补充）
    const mergedStatusMap = new Map(
        window.SystemDownloadManager ? window.SystemDownloadManager.getAllDownloadStatuses() : []
    );
    if (window.dbDownloadStatusMap) {
        window.dbDownloadStatusMap.forEach((status, songId) => {
            if (!mergedStatusMap.has(songId)) {
                mergedStatusMap.set(songId, status);
            }
        });
    }

    // 只选中未下载的歌曲（使用统一的 isSongDownloaded 判断函数，与状态图标逻辑一致）
    visibleIds.forEach(id => {
        const statusInfo = mergedStatusMap.get(id) || null;
        if (!window.isSongDownloaded(statusInfo)) {
            window.selectedItems.add(id);
            // 从 viewingPlaylist 中找到对应的歌曲对象
            if (window.viewingPlaylist) {
                const song = window.viewingPlaylist.find(s => String(s.id) === id);
                if (song) window.selectedSongObjects.set(id, song);
            }
        }
    });

    refreshBatchUI();
    updateBatchToolbar();
    updateBatchSelectionDOM();
}

function updateBatchToolbar() {
    const size = window.selectedItems.size;

    // 搜索页计数（使用 querySelectorAll 兼容歌手详情页克隆工具栏产生的重复 ID）
    document.querySelectorAll('#batch-selected-count').forEach(el => el.textContent = size);

    // 歌单详情页计数
    const slCountEl = document.getElementById('sl-batch-selected-count');
    if (slCountEl) slCountEl.textContent = size;

    // 排行榜计数
    const lbCountEl = document.getElementById('lb-batch-selected-count');
    if (lbCountEl) lbCountEl.textContent = size;

    const deleteBtn = document.getElementById('batch-delete-btn');
    if (deleteBtn) {
        // Hide delete button in network search mode
        if (window.currentSearchScope === 'network') {
            deleteBtn.classList.add('hidden');
        } else {
            deleteBtn.classList.remove('hidden');
        }
    }
}

async function batchDeleteFromList() {
    if (window.selectedItems.size === 0) {
        showError('请先选择要删除的歌曲');
        return;
    }

    if (!(await showSelect('批量删除', `确定要删除选中的 ${window.selectedItems.size} 首歌曲吗?`, { danger: true }))) {
        return;
    }

    // Get current list context
    const activeListId = getCurrentActiveListId();
    if (!activeListId || !currentListData) {
        showError('无法确定当前列表');
        return;
    }

    const idsToDelete = Array.from(window.selectedItems);

    if (window.SyncManager.mode === 'local') {
        // Local mode: Use user credentials to directly manipulate data
        const username = localStorage.getItem('lx_sync_user');
        const password = localStorage.getItem('lx_sync_pass');

        if (!username || !password) {
            showError('请先登录本地账号');
            return;
        }

        try {
            // Call user-specific API endpoint
            const res = await fetch('/api/music/user/list/remove', {
                method: 'POST',
                headers: getUserAuthHeaders(),
                body: JSON.stringify({
                    listId: activeListId,
                    songIds: idsToDelete
                })
            });

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(errorText || '删除失败');
            }

            // Reload data from server
            const data = await window.SyncManager.sync();
            const oldUsername = currentListData ? currentListData.username : null;
            currentListData = data;
            if (oldUsername) currentListData.username = oldUsername; // Preserve username
            localStorage.setItem('lx_list_data', JSON.stringify(data));
            renderMyLists(data);

            // Refresh current view
            handleListClick(activeListId);

            console.log('[Batch] 本地模式删除成功');

        } catch (e) {
            showError('批量删除失败: ' + e.message);
            console.error('[Batch] 删除错误:', e);
        }
    } else if (window.SyncManager.mode === 'remote') {
        // Remote mode: Modify cache, sync on next connection
        try {
            // Get current list
            const listToModify = getListById(activeListId);
            if (!listToModify) {
                throw new Error('找不到当前列表');
            }

            // Remove items from list
            const remainingItems = listToModify.filter(item => !idsToDelete.includes(item.id));
            setListById(activeListId, remainingItems);

            // Save to cache
            localStorage.setItem('lx_list_data', JSON.stringify(currentListData));
            console.log('[Batch] WS模式:已修改缓存,下次连接时将同步');

            // If currently connected, push the change immediately
            if (window.SyncManager.client && window.SyncManager.client.isConnected) {
                try {
                    await pushDataChange();
                    console.log('[Batch] WS模式:实时推送成功');
                } catch (e) {
                    console.warn('[Batch] WS推送失败(将在下次连接时同步):', e);
                }
            }

            // Update UI
            renderMyLists(currentListData);
            handleListClick(activeListId);

        } catch (e) {
            showError('批量删除失败: ' + e.message);
            console.error('[Batch] WS删除错误:', e);
        }
    }

    // Clear selection
    window.selectedItems.clear();
    window.selectedSongObjects.clear();
    updateBatchToolbar();
    refreshBatchUI();
}

// Helper: Get current active list ID
function getCurrentActiveListId() {
    // From UI context or currentSearchScope
    if (window.currentSearchScope === 'local_list') {
        // Should track which list is being viewed
        return window.currentViewingListId || null;
    }
    return null;
}

// Helper: Get list by ID
function getListById(listId) {
    if (!currentListData) return null;
    if (listId === 'default') return currentListData.defaultList;
    if (listId === 'love') return currentListData.loveList;
    const userList = currentListData.userList.find(l => l.id === listId);
    return userList ? userList.list : null;
}

// Helper: Set list by ID
function setListById(listId, newList) {
    if (!currentListData) return;
    if (listId === 'default') currentListData.defaultList = newList;
    else if (listId === 'love') currentListData.loveList = newList;
    else {
        const userList = currentListData.userList.find(l => l.id === listId);
        if (userList) userList.list = newList;
    }
}

// Pagination Functions
function updatePaginationInfo(start, end, total) {
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
        if (total === 0) {
            infoEl.textContent = '无结果';
        } else {
            infoEl.textContent = `显示 ${start}-${end} / 共 ${total} 首`;
        }
    }
}

function goToPage(page) {
    currentPage = page;
    renderResults(window.viewingPlaylist);
}

async function nextPage() {
    const searchType = typeof getSearchType === 'function' ? getSearchType() : 'song';
    const totalItems = window.viewingPlaylist ? window.viewingPlaylist.length : 0;
    const itemsPerPage = settings.itemsPerPage === 'all' ? totalItems : parseInt(settings.itemsPerPage);
    const totalPages = Math.ceil((totalItems || 1) / (itemsPerPage || 1));

    if (currentPage < totalPages) {
        currentPage++;
        renderResults(window.viewingPlaylist);
    } else if (window.currentSearchScope === 'network') {
        // 专辑/歌手搜索不走 append 模式，直接翻页
        if (searchType === 'album' || searchType === 'singer') {
            const nextNetPage = (window.currentNetworkPage || 1) + 1;
            await window.doSearch(nextNetPage);
            return;
        }
        const btn = document.querySelector('button[onclick="nextPage()"]');
        const oldHtml = btn ? btn.innerHTML : '';
        if (btn) {
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 加载中...';
            btn.disabled = true;
        }

        try {
            const nextNetPage = (window.currentNetworkPage || 1) + 1;
            await window.doSearch(nextNetPage, true);
        } finally {
            if (btn) {
                btn.innerHTML = oldHtml;
                btn.disabled = false;
            }
        }
    }
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        renderResults(viewingPlaylist);
    }
}

// Settings: Items Per Page
function changeItemsPerPage(value) {
    const val = value === 'all' ? 'all' : parseInt(value);
    if (typeof window.updateSetting === 'function') {
        window.updateSetting('itemsPerPage', val);
    } else {
        settings.itemsPerPage = val;
        localStorage.setItem('lx_settings', JSON.stringify(settings));
    }
    currentPage = 1; // Reset to first page
    if (window.ListSearch) {
        window.ListSearch.config.itemsPerPage = val === 'all' ? 999999 : val;
    }

    const activeView = (function () {
        if (document.getElementById('songlist-detail-view') && !document.getElementById('songlist-detail-view').classList.contains('hidden')) return 'collection';
        if (document.getElementById('view-leaderboard') && !document.getElementById('view-leaderboard').classList.contains('hidden')) return 'leaderboard';
        return 'search';
    })();

    // 歌手详情页"热门歌曲"Tab：用独立分页重渲染，避免落入 else 分支导致视图错乱
    if (window._onlineSingerState && window._singerActiveTab === 'songs' && typeof window.rerenderSingerSongs === 'function') {
        window.rerenderSingerSongs();
        return;
    }

    if (activeView === 'leaderboard' && window.LeaderboardManager) {
        window.LeaderboardManager.resetLocalPage();
        window.LeaderboardManager.renderSongs();
    } else if (activeView === 'collection' && window.SongListManager) {
        window.SongListManager.renderCurrentList();
    } else {
        renderResults(window.viewingPlaylist || viewingPlaylist);
    }
}

// Load settings from localStorage
function loadSettings() {
    const saved = localStorage.getItem('lx_settings');
    if (saved) {
        try {
            settings = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }
}


async function handleBatchCollect() {
    const selectedCount = window.selectedItems.size;
    if (selectedCount === 0) {
        if (typeof showInfo === 'function') showInfo('请先选择歌曲');
        else alert('请先选择歌曲');
        return;
    }

    const musicInfos = Array.from(window.selectedSongObjects.values());

    // 复用 app.js 中的歌单选择弹窗
    if (typeof openPlaylistAddModal === 'function') {
        openPlaylistAddModal(musicInfos);
    } else {
        showError('收藏组件未就绪');
    }
}

// Export functions to window
window.handleBatchSelect = handleBatchSelect;
window.toggleBatchMode = toggleBatchMode;
window.selectAllVisible = selectAllVisible;
window.deselectAll = deselectAll;
window.selectUndownloaded = selectUndownloaded;
window.batchDeleteFromList = batchDeleteFromList;
window.handleBatchCollect = handleBatchCollect;
window.updateBatchSelectionDOM = updateBatchSelectionDOM;
window.goToPage = goToPage;
window.nextPage = nextPage;
window.prevPage = prevPage;
window.changeItemsPerPage = changeItemsPerPage;
